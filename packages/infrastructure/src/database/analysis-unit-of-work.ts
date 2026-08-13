import { randomUUID } from "node:crypto";
import type { ClaimedJobV1, MemoryAnalysisV1 } from "@paopao/contracts";
import type { AiAttemptMetadata } from "../ai/types.js";
import type { SqliteDatabase } from "./sqlite.js";

type AnalyzeJobV1 = Extract<ClaimedJobV1, { type: "analyze_entry" }>;

export interface AnalysisSnapshot {
  state: "ready" | "already_committed" | "stale";
  currentText?: string;
}

export interface AnalysisCommit {
  job: AnalyzeJobV1;
  output: MemoryAnalysisV1;
  metadata: AiAttemptMetadata;
}

export class SqliteAnalysisUnitOfWork {
  readonly #database: SqliteDatabase;
  readonly #now: () => string;
  readonly #nextId: () => string;

  constructor(options: { database: SqliteDatabase; now?: () => string; nextId?: () => string }) {
    this.#database = options.database;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#nextId = options.nextId ?? randomUUID;
  }

  load(job: AnalyzeJobV1): AnalysisSnapshot {
    const row = this.#database.prepare(`
      SELECT e.status, e.current_text_revision, r.text,
        EXISTS(SELECT 1 FROM ai_runs a WHERE a.job_id = j.id AND a.error_code IS NULL) AS committed
      FROM jobs j JOIN entries e ON e.id = j.entry_id
      LEFT JOIN entry_text_revisions r ON r.entry_id = e.id AND r.revision = e.current_text_revision
      WHERE j.id = ? AND j.entry_id = ?
    `).get(job.id, job.entryId) as { status: string; current_text_revision: number; text: string | null; committed: number } | undefined;
    if (!row || row.status === "deleting" || row.status === "purged" || row.current_text_revision !== job.payload.textRevision) return { state: "stale" };
    if (row.committed) return { state: "already_committed" };
    if (row.text === null) return { state: "stale" };
    return { state: "ready", currentText: row.text };
  }

  commit(input: AnalysisCommit): "committed" | "already_committed" | "stale" {
    const { job, output, metadata } = input;
    const now = this.#now();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const guard = this.#database.prepare(`
        SELECT e.status, e.current_text_revision,
          EXISTS(SELECT 1 FROM ai_runs a WHERE a.job_id = j.id AND a.error_code IS NULL) AS committed
        FROM jobs j JOIN entries e ON e.id = j.entry_id
        WHERE j.id = ? AND j.entry_id = ? AND j.status = 'running'
          AND j.lease_owner = ? AND j.fencing_token = ? AND j.lease_expires_at > ?
      `).get(job.id, job.entryId, job.leaseOwner, job.fencingToken, now) as { status: string; current_text_revision: number; committed: number } | undefined;
      if (!guard || guard.status === "deleting" || guard.status === "purged" || guard.current_text_revision !== job.payload.textRevision) {
        this.#database.exec("ROLLBACK");
        return "stale";
      }
      if (guard.committed) {
        this.#database.exec("COMMIT");
        return "already_committed";
      }

      const values = [
        ["classification", output.classification],
        ["summary", output.summary],
        ["entities", output.entities],
        ["goals", output.goals],
        ["next_actions", output.nextActions],
      ] as const;
      const derivationIds = new Map<string, string>();
      for (const [kind, value] of values) {
        const previous = this.#database.prepare("SELECT id, artifact_revision FROM derivations WHERE entry_id = ? AND kind = ? AND is_current = 1").get(job.entryId, kind) as { id: string; artifact_revision: number } | undefined;
        if (previous) this.#database.prepare("UPDATE derivations SET is_current = 0 WHERE id = ?").run(previous.id);
        const id = this.#nextId();
        derivationIds.set(kind, id);
        this.#database.prepare(`
          INSERT INTO derivations(id, entry_id, kind, value_json, text_revision, artifact_revision, supersedes_id, is_current, created_by, prompt_version, schema_version, operation_key, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'ai', ?, ?, ?, ?)
        `).run(id, job.entryId, kind, JSON.stringify(value), job.payload.textRevision, (previous?.artifact_revision ?? 0) + 1, previous?.id ?? null,
          metadata.promptVersion, metadata.schemaVersion, `ai:${job.id}:${kind}`, now);
        for (const quote of evidenceFor(kind, value)) this.#insertSource("derivation", id, job.entryId, quote, now);
      }

      const memoryId = (this.#database.prepare("SELECT id FROM memories WHERE entry_id = ?").get(job.entryId) as { id: string } | undefined)?.id ?? this.#nextId();
      this.#database.prepare(`
        INSERT INTO memories(id, entry_id, memory_type, summary, confidence, classification_derivation_id, summary_derivation_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(entry_id) DO UPDATE SET memory_type=excluded.memory_type, summary=excluded.summary,
          confidence=excluded.confidence, classification_derivation_id=excluded.classification_derivation_id,
          summary_derivation_id=excluded.summary_derivation_id, updated_at=excluded.updated_at
      `).run(memoryId, job.entryId, output.classification.inputType, output.summary.text, output.classification.confidence,
        derivationIds.get("classification"), derivationIds.get("summary"), now);
      this.#database.prepare("DELETE FROM artifact_sources WHERE artifact_type = 'memory' AND artifact_id = ?").run(memoryId);
      for (const quote of new Set([output.classification.evidence, ...output.summary.evidence])) this.#insertSource("memory", memoryId, job.entryId, quote, now);

      this.#database.prepare("DELETE FROM entry_search WHERE entry_id = ?").run(job.entryId);
      const text = (this.#database.prepare("SELECT text FROM entry_text_revisions WHERE entry_id = ? AND revision = ?").get(job.entryId, job.payload.textRevision) as { text: string }).text;
      this.#database.prepare("INSERT INTO entry_search(entry_id, current_text, summary, entities, goals, actions) VALUES (?, ?, ?, ?, ?, ?)")
        .run(job.entryId, text, output.summary.text, output.entities.items.map((v) => v.name).join(" "), output.goals.items.map((v) => v.title).join(" "), output.nextActions.items.map((v) => v.title).join(" "));
      this.#database.prepare(`INSERT INTO ai_runs(id, entry_id, job_id, provider, model, prompt_version, schema_version, latency_ms, input_tokens, output_tokens, provider_request_id, error_code, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`)
        .run(this.#nextId(), job.entryId, job.id, metadata.provider, metadata.model, metadata.promptVersion, metadata.schemaVersion, metadata.latencyMs, metadata.inputTokens ?? null, metadata.outputTokens ?? null, metadata.providerRequestId ?? null, now);
      const captureMode = (this.#database.prepare("SELECT capture_mode FROM entries WHERE id = ?").get(job.entryId) as { capture_mode: string }).capture_mode;
      if (captureMode === "think") {
        if (!output.needsUserReview) {
          const insightJobId = this.#nextId();
          const analysisDerivationId = derivationIds.get("summary")!;
          const payload = JSON.stringify({
            schemaVersion: "generate-insight-job.v1",
            entryId: job.entryId,
            textRevision: job.payload.textRevision,
            analysisDerivationId,
          });
          this.#database.prepare(`
            INSERT OR IGNORE INTO jobs(id, type, entry_id, payload_json, idempotency_key, status, max_attempts, next_run_at, created_at, updated_at)
            VALUES (?, 'generate_insight', ?, ?, ?, 'queued', 5, ?, ?, ?)
          `).run(insightJobId, job.entryId, payload, `generate_insight:${job.entryId}:text_revision:${job.payload.textRevision}`, now, now, now);
        } else {
          this.#database.prepare(`
            UPDATE external_messages SET result_status = 'result_failed_final', result_derivation_id = NULL,
              result_next_run_at = NULL, result_last_error_code = 'AI_INVALID_OUTPUT',
              result_fencing_token = result_fencing_token + 1, updated_at = ?
            WHERE provider = 'feishu' AND entry_id = ? AND result_status = 'result_waiting'
          `).run(now, job.entryId);
        }
      }
      this.#database.prepare("UPDATE entries SET status = ?, last_error_code = NULL, updated_at = ? WHERE id = ?")
        .run(output.needsUserReview ? "needs_review" : "ready", now, job.entryId);
      this.#database.exec("COMMIT");
      return "committed";
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  auditFailure(job: AnalyzeJobV1, metadata: AiAttemptMetadata): boolean {
    const now = this.#now();
    return this.#database.prepare(`INSERT INTO ai_runs(id, entry_id, job_id, provider, model, prompt_version, schema_version, latency_ms, input_tokens, output_tokens, provider_request_id, error_code, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
        SELECT 1 FROM jobs j JOIN entries e ON e.id=j.entry_id WHERE j.id=? AND j.entry_id=? AND j.status='running'
          AND j.lease_owner=? AND j.fencing_token=? AND j.lease_expires_at>? AND e.current_text_revision=? AND e.status NOT IN ('deleting','purged'))`)
      .run(this.#nextId(), job.entryId, job.id, metadata.provider, metadata.model, metadata.promptVersion, metadata.schemaVersion, metadata.latencyMs,
        metadata.inputTokens ?? null, metadata.outputTokens ?? null, metadata.providerRequestId ?? null, metadata.errorCode ?? "AI_INVALID_OUTPUT", now,
        job.id, job.entryId, job.leaseOwner, job.fencingToken, now, job.payload.textRevision).changes === 1;
  }

  #insertSource(type: "derivation" | "memory", artifactId: string, entryId: string, quote: string, now: string): void {
    this.#database.prepare("INSERT OR IGNORE INTO artifact_sources(artifact_type, artifact_id, entry_id, quote, created_at) VALUES (?, ?, ?, ?, ?)").run(type, artifactId, entryId, quote, now);
  }
}

function evidenceFor(kind: string, value: any): string[] {
  if (kind === "classification") return [value.evidence];
  if (kind === "summary") return value.evidence;
  return value.items.map((item: { evidence: string }) => item.evidence);
}
