import { createHash, randomUUID } from "node:crypto";
import {
  CorrectionReceiptV1Schema,
  EntryCorrectRequestV1Schema,
  EntryReviseTextRequestV1Schema,
  JobRetryRequestV1Schema,
  JobRetryResponseV1Schema,
  TextRevisionReceiptV1Schema,
  type DomainEventV1,
  type EntryCorrectRequestV1,
  type ErrorCode,
} from "@paopao/contracts";
import type { Clock, DomainEventPublisher, IdGenerator } from "@paopao/core";
import type { SqliteDatabase } from "./sqlite.js";

type ReviseRequest = ReturnType<typeof EntryReviseTextRequestV1Schema.parse>;
type RevisionReceipt = ReturnType<typeof TextRevisionReceiptV1Schema.parse>;
type CorrectionReceipt = ReturnType<typeof CorrectionReceiptV1Schema.parse>;
type RetryRequest = ReturnType<typeof JobRetryRequestV1Schema.parse>;
type RetryReceipt = ReturnType<typeof JobRetryResponseV1Schema.parse>;

export class GovernanceError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
    this.name = "GovernanceError";
  }
}

export interface EntryGovernanceService {
  reviseText(input: ReviseRequest): Promise<RevisionReceipt>;
  correct(input: EntryCorrectRequestV1): Promise<CorrectionReceipt>;
  retryJob(input: RetryRequest): Promise<RetryReceipt>;
}

export function createEntryGovernanceService(dependencies: {
  database: SqliteDatabase;
  clock: Clock;
  ids?: IdGenerator;
  events?: DomainEventPublisher;
}): EntryGovernanceService {
  const ids = dependencies.ids ?? { next: randomUUID };
  const events = dependencies.events ?? { publish() {} };
  const unit = new SqliteGovernanceUnitOfWork(dependencies.database, dependencies.clock, ids);
  return {
    async reviseText(input) {
      const parsed = parseOrThrow(EntryReviseTextRequestV1Schema, input);
      const receipt = unit.reviseText(parsed);
      await publishUpdated(events, dependencies.clock, parsed.entryId, "stored");
      return TextRevisionReceiptV1Schema.parse(receipt);
    },
    async correct(input) {
      const parsed = parseOrThrow(EntryCorrectRequestV1Schema, input);
      const receipt = unit.correct(parsed);
      await publishUpdated(events, dependencies.clock, parsed.entryId, "ready");
      return CorrectionReceiptV1Schema.parse(receipt);
    },
    async retryJob(input) {
      const parsed = parseOrThrow(JobRetryRequestV1Schema, input);
      return JobRetryResponseV1Schema.parse(unit.retryJob(parsed));
    },
  };
}

class SqliteGovernanceUnitOfWork {
  constructor(private readonly database: SqliteDatabase, private readonly clock: Clock, private readonly ids: IdGenerator) {}

  reviseText(input: ReviseRequest): RevisionReceipt {
    const operationKey = `revise_text:${input.requestId}`;
    const requestJson = JSON.stringify(input);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const replay = this.database.prepare("SELECT request_json, receipt_json FROM governance_operations WHERE operation_key=?").get(operationKey) as { request_json: string; receipt_json: string } | undefined;
      if (replay) {
        if (replay.request_json !== requestJson) throw new GovernanceError("VALIDATION_FAILED", "requestId was already used for another text revision");
        this.database.exec("COMMIT");
        return TextRevisionReceiptV1Schema.parse(JSON.parse(replay.receipt_json));
      }
      const entry = this.database.prepare("SELECT status, current_text_revision FROM entries WHERE id = ?").get(input.entryId) as { status: string; current_text_revision: number } | undefined;
      assertMutable(entry);
      if (entry.current_text_revision !== input.expectedTextRevision) throw new GovernanceError("REVISION_CONFLICT", "Entry text revision has changed");
      const revision = entry.current_text_revision + 1;
      const now = this.clock.now();
      const affectedJobIds = this.cancelActiveJobs(input.entryId, now);
      this.database.prepare(`INSERT INTO entry_text_revisions(entry_id, revision, text, checksum, created_by, operation_key, created_at)
        VALUES (?, ?, ?, ?, 'user', ?, ?)`)
        .run(input.entryId, revision, input.text, sha256(input.text), operationKey, now);
      const jobId = this.ids.next();
      this.database.prepare(`INSERT INTO jobs(id, type, entry_id, payload_json, idempotency_key, status, max_attempts, next_run_at, created_at, updated_at)
        VALUES (?, 'analyze_entry', ?, ?, ?, 'queued', 5, ?, ?, ?)`)
        .run(jobId, input.entryId, JSON.stringify({ schemaVersion: "analyze-entry-job.v1", entryId: input.entryId, textRevision: revision }),
          `analyze_entry:${input.entryId}:text_revision:${revision}`, now, now, now);
      this.database.prepare("UPDATE entries SET current_text_revision=?, status='stored', last_error_code=NULL, updated_at=? WHERE id=?")
        .run(revision, now, input.entryId);
      this.database.prepare("DELETE FROM entry_search WHERE entry_id=?").run(input.entryId);
      this.database.prepare("INSERT INTO entry_search(entry_id,current_text,summary,entities,goals,actions) VALUES (?,?,'','','','')").run(input.entryId, input.text);
      const receipt = { entryId: input.entryId, textRevision: revision, affectedJobIds: [...affectedJobIds, jobId] };
      this.database.prepare("INSERT INTO governance_operations(operation_key,kind,request_json,receipt_json,created_at) VALUES (?,'revise_text',?,?,?)")
        .run(operationKey, requestJson, JSON.stringify(receipt), now);
      this.database.exec("COMMIT");
      return receipt;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  correct(input: EntryCorrectRequestV1): CorrectionReceipt {
    const operationKey = `correct:${input.requestId}`;
    const requestJson = JSON.stringify(input);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const replay = this.database.prepare("SELECT request_json, receipt_json FROM governance_operations WHERE operation_key=?").get(operationKey) as { request_json: string; receipt_json: string } | undefined;
      if (replay) {
        if (replay.request_json !== requestJson) throw new GovernanceError("VALIDATION_FAILED", "requestId was already used for another correction");
        this.database.exec("COMMIT");
        return CorrectionReceiptV1Schema.parse(JSON.parse(replay.receipt_json));
      }
      const entry = this.database.prepare(`SELECT e.status, e.current_text_revision, r.text FROM entries e
        JOIN entry_text_revisions r ON r.entry_id=e.id AND r.revision=e.current_text_revision WHERE e.id=?`).get(input.entryId) as { status: string; current_text_revision: number; text: string } | undefined;
      assertMutable(entry);
      if (!evidenceFor(input.kind, input.value).every((quote) => entry.text.includes(quote))) {
        throw new GovernanceError("VALIDATION_FAILED", "Correction evidence must quote the current text");
      }
      const current = this.database.prepare("SELECT id, artifact_revision FROM derivations WHERE entry_id=? AND kind=? AND is_current=1").get(input.entryId, input.kind) as { id: string; artifact_revision: number } | undefined;
      if ((current?.id ?? null) !== input.expectedDerivationId) throw new GovernanceError("REVISION_CONFLICT", "Derivation has changed");
      const now = this.clock.now();
      const affectedJobIds = this.cancelActiveJobs(input.entryId, now);
      this.database.prepare(`
        UPDATE external_messages SET result_status = 'result_failed_final', result_derivation_id = NULL,
          result_next_run_at = NULL, result_lease_owner = NULL, result_lease_expires_at = NULL,
          result_last_error_code = 'AI_INVALID_OUTPUT', result_manual_attempt_active = 0,
          result_fencing_token = result_fencing_token + 1, updated_at = ?
        WHERE provider = 'feishu' AND entry_id = ? AND result_status = 'result_waiting'
      `).run(now, input.entryId);
      if (current) this.database.prepare("UPDATE derivations SET is_current=0 WHERE id=?").run(current.id);
      const derivationId = this.ids.next();
      this.database.prepare(`INSERT INTO derivations(id,entry_id,kind,value_json,text_revision,artifact_revision,supersedes_id,is_current,created_by,prompt_version,schema_version,operation_key,created_at)
        VALUES (?,?,?,?,?,?,?,1,'user',NULL,?,?,?)`)
        .run(derivationId, input.entryId, input.kind, JSON.stringify(input.value), entry.current_text_revision, (current?.artifact_revision ?? 0) + 1,
          current?.id ?? null, schemaVersion(input.kind), operationKey, now);
      for (const quote of new Set(evidenceFor(input.kind, input.value))) {
        this.database.prepare("INSERT INTO artifact_sources(artifact_type,artifact_id,entry_id,quote,created_at) VALUES ('derivation',?,?,?,?)")
          .run(derivationId, input.entryId, quote, now);
      }
      this.syncReadModels(input.entryId, entry.text, now);
      this.database.prepare("UPDATE entries SET status='ready',last_error_code=NULL,updated_at=? WHERE id=?").run(now, input.entryId);
      const receipt = { entryId: input.entryId, textRevision: entry.current_text_revision, derivationId, supersedesDerivationId: current?.id ?? null, affectedJobIds };
      this.database.prepare("INSERT INTO governance_operations(operation_key,kind,request_json,receipt_json,created_at) VALUES (?,'correct',?,?,?)")
        .run(operationKey, requestJson, JSON.stringify(receipt), now);
      this.database.exec("COMMIT");
      return receipt;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  retryJob(input: RetryRequest): RetryReceipt {
    const now = this.clock.now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const job = this.database.prepare("SELECT status,type,entry_id,last_error_code FROM jobs WHERE id=?").get(input.jobId) as { status: string; type: string; entry_id: string | null; last_error_code: string | null } | undefined;
      if (!job) throw new GovernanceError("NOT_FOUND", "Job not found");
      if (job.status === "queued") {
        this.database.exec("COMMIT");
        return { jobId: input.jobId, status: "queued" };
      }
      if (!["failed_final", "retry_wait", "waiting_for_network", "waiting_for_configuration"].includes(job.status)) {
        throw new GovernanceError("JOB_NOT_RETRYABLE", "Job cannot be retried in its current state");
      }
      this.database.prepare(`UPDATE jobs SET status='queued',attempts=0,next_run_at=?,lease_owner=NULL,lease_expires_at=NULL,
        last_error_code=NULL,last_error_message=NULL,correlation_id=NULL,updated_at=? WHERE id=?`).run(now, now, input.jobId);
      if ((job.type === "analyze_entry" || job.type === "generate_insight") && job.entry_id && job.last_error_code?.startsWith("AI_")) {
        this.database.prepare(`
          UPDATE external_messages SET result_status = 'result_waiting', result_next_run_at = NULL,
            result_lease_owner = NULL, result_lease_expires_at = NULL, result_last_error_code = NULL,
            result_manual_attempt_active = 0, result_fencing_token = result_fencing_token + 1, updated_at = ?
          WHERE provider = 'feishu' AND entry_id = ? AND result_status = 'result_failed_final'
            AND result_derivation_id IS NULL AND result_last_error_code = ?
        `).run(now, job.entry_id, job.last_error_code);
      }
      if (job.type === "analyze_entry" && job.entry_id) {
        this.database.prepare("UPDATE entries SET status='stored',last_error_code=NULL,updated_at=? WHERE id=? AND status NOT IN ('deleting','purged')").run(now, job.entry_id);
      }
      this.database.exec("COMMIT");
      return { jobId: input.jobId, status: "queued" };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private cancelActiveJobs(entryId: string, now: string): string[] {
    const rows = this.database.prepare("SELECT id FROM jobs WHERE entry_id=? AND status IN ('queued','running','retry_wait','waiting_for_network','waiting_for_configuration')").all(entryId) as Array<{ id: string }>;
    this.database.prepare(`UPDATE jobs SET status='cancelled',lease_owner=NULL,lease_expires_at=NULL,fencing_token=fencing_token+1,updated_at=?
      WHERE entry_id=? AND status IN ('queued','running','retry_wait','waiting_for_network','waiting_for_configuration')`).run(now, entryId);
    return rows.map((row) => row.id);
  }

  private syncReadModels(entryId: string, text: string, now: string): void {
    const rows = this.database.prepare("SELECT kind,value_json,id FROM derivations WHERE entry_id=? AND is_current=1 AND kind IN ('classification','summary','entities','goals','next_actions')").all(entryId) as Array<{ kind: string; value_json: string; id: string }>;
    const values = new Map(rows.map((row) => [row.kind, { id: row.id, value: JSON.parse(row.value_json) as any }]));
    const classification = values.get("classification");
    const summary = values.get("summary");
    if (classification && summary) {
      const memory = this.database.prepare("SELECT id FROM memories WHERE entry_id=?").get(entryId) as { id: string } | undefined;
      const memoryId = memory?.id ?? this.ids.next();
      this.database.prepare(`INSERT INTO memories(id,entry_id,memory_type,summary,confidence,classification_derivation_id,summary_derivation_id,updated_at)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(entry_id) DO UPDATE SET memory_type=excluded.memory_type,summary=excluded.summary,confidence=excluded.confidence,
          classification_derivation_id=excluded.classification_derivation_id,summary_derivation_id=excluded.summary_derivation_id,updated_at=excluded.updated_at`)
        .run(memoryId, entryId, classification.value.inputType, summary.value.text, classification.value.confidence, classification.id, summary.id, now);
      this.database.prepare("DELETE FROM artifact_sources WHERE artifact_type='memory' AND artifact_id=?").run(memoryId);
      for (const quote of new Set([classification.value.evidence, ...summary.value.evidence])) {
        this.database.prepare("INSERT INTO artifact_sources(artifact_type,artifact_id,entry_id,quote,created_at) VALUES ('memory',?,?,?,?)").run(memoryId, entryId, quote, now);
      }
    }
    this.database.prepare("DELETE FROM entry_search WHERE entry_id=?").run(entryId);
    this.database.prepare("INSERT INTO entry_search(entry_id,current_text,summary,entities,goals,actions) VALUES (?,?,?,?,?,?)")
      .run(entryId, text, summary?.value.text ?? "", values.get("entities")?.value.items.map((v: any) => v.name).join(" ") ?? "",
        values.get("goals")?.value.items.map((v: any) => v.title).join(" ") ?? "", values.get("next_actions")?.value.items.map((v: any) => v.title).join(" ") ?? "");
  }
}

function assertMutable(entry: { status: string } | undefined): asserts entry is { status: string } & Record<string, any> {
  if (!entry) throw new GovernanceError("NOT_FOUND", "Entry not found");
  if (entry.status === "deleting" || entry.status === "purged") throw new GovernanceError("ALREADY_DELETED", "Entry is deleted");
}

function evidenceFor(kind: EntryCorrectRequestV1["kind"], value: any): string[] {
  if (kind === "classification") return [value.evidence];
  if (kind === "summary") return value.evidence;
  return value.items.map((item: { evidence: string }) => item.evidence);
}

function schemaVersion(kind: EntryCorrectRequestV1["kind"]): string {
  return `${kind.replace("_", "-")}.v1`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function parseOrThrow<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new GovernanceError("VALIDATION_FAILED", "Request validation failed");
  return parsed.data;
}

async function publishUpdated(events: DomainEventPublisher, clock: Clock, entryId: string, status: "stored" | "ready"): Promise<void> {
  const event: DomainEventV1 = { version: 1, type: "entry:updated", entryId, status, occurredAt: clock.now() };
  try { await events.publish(event); } catch { /* SQLite remains authoritative. */ }
}
