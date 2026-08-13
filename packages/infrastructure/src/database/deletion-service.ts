import { randomUUID } from "node:crypto";
import {
  EntryDeleteReceiptV1Schema,
  EntryDeleteRequestV1Schema,
  type ClaimedJobV1,
  type DomainEventV1,
} from "@paopao/contracts";
import type { Clock, DomainEventPublisher, IdGenerator, JobExecutionResult, JobExecutor, JobPreflight } from "@paopao/core";
import { GovernanceError } from "./entry-governance-service.js";
import { checkpointDatabase, type SqliteDatabase } from "./sqlite.js";

type DeleteRequest = ReturnType<typeof EntryDeleteRequestV1Schema.parse>;
type DeleteReceipt = ReturnType<typeof EntryDeleteReceiptV1Schema.parse>;
type PurgeJob = Extract<ClaimedJobV1, { type: "purge_entry" }>;

export interface EntryDeletionService {
  delete(input: DeleteRequest): Promise<DeleteReceipt>;
}

export function createEntryDeletionService(dependencies: {
  database: SqliteDatabase; clock: Clock; ids?: IdGenerator; events?: DomainEventPublisher;
}): EntryDeletionService {
  const ids = dependencies.ids ?? { next: randomUUID };
  return {
    async delete(input) {
      const parsed = EntryDeleteRequestV1Schema.safeParse(input);
      if (!parsed.success) throw new GovernanceError("VALIDATION_FAILED", "Delete request validation failed");
      const request = parsed.data;
      const key = `purge_entry:${request.entryId}:request:${request.requestId}`;
      dependencies.database.exec("BEGIN IMMEDIATE");
      try {
        const replay = dependencies.database.prepare("SELECT id FROM jobs WHERE idempotency_key=?").get(key) as { id: string } | undefined;
        if (replay) {
          dependencies.database.exec("COMMIT");
          return EntryDeleteReceiptV1Schema.parse({ entryId: request.entryId, deletionJobId: replay.id, status: "deleting" });
        }
        const entry = dependencies.database.prepare("SELECT status,current_text_revision FROM entries WHERE id=?").get(request.entryId) as { status: string; current_text_revision: number } | undefined;
        if (!entry) throw new GovernanceError("NOT_FOUND", "Entry not found");
        if (entry.status === "deleting" || entry.status === "purged") throw new GovernanceError("ALREADY_DELETED", "Entry is already deleted");
        if (entry.current_text_revision !== request.expectedTextRevision) throw new GovernanceError("REVISION_CONFLICT", "Entry text revision has changed");
        const now = dependencies.clock.now();
        dependencies.database.prepare(`UPDATE jobs SET status='cancelled',lease_owner=NULL,lease_expires_at=NULL,
          fencing_token=fencing_token+1,updated_at=? WHERE entry_id=? AND status IN ('queued','running','retry_wait','waiting_for_network','waiting_for_configuration')`)
          .run(now, request.entryId);
        const jobId = ids.next();
        dependencies.database.prepare(`INSERT INTO jobs(id,type,entry_id,payload_json,idempotency_key,status,max_attempts,next_run_at,created_at,updated_at)
          VALUES (?,'purge_entry',?,?,?,'queued',3,?,?,?)`)
          .run(jobId, request.entryId, JSON.stringify({ schemaVersion: "purge-entry-job.v1", entryId: request.entryId }), key, now, now, now);
        dependencies.database.prepare("UPDATE entries SET status='deleting',deleted_at=?,updated_at=?,last_error_code=NULL WHERE id=?").run(now, now, request.entryId);
        dependencies.database.prepare(`
          UPDATE external_messages SET recipient_json = NULL, result_derivation_id = NULL,
            ack_reply_id = NULL, ack_status = 'ignored_purged', ack_next_run_at = NULL,
            ack_lease_owner = NULL, ack_lease_expires_at = NULL, ack_last_error_code = NULL,
            ack_manual_attempt_active = 0, ack_fencing_token = ack_fencing_token + 1,
            result_reply_id = NULL, result_status = 'ignored_purged', result_next_run_at = NULL,
            result_lease_owner = NULL, result_lease_expires_at = NULL, result_last_error_code = NULL,
            result_manual_attempt_active = 0, result_fencing_token = result_fencing_token + 1,
            updated_at = ? WHERE entry_id = ?
        `).run(now, request.entryId);
        dependencies.database.prepare("DELETE FROM entry_search WHERE entry_id=?").run(request.entryId);
        dependencies.database.exec("COMMIT");
        const receipt = EntryDeleteReceiptV1Schema.parse({ entryId: request.entryId, deletionJobId: jobId, status: "deleting" });
        await publish(dependencies.events, { version: 1, type: "entry:updated", entryId: request.entryId, status: "deleting", occurredAt: now });
        return receipt;
      } catch (error) {
        dependencies.database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

export class PurgeEntryJobExecutor implements JobExecutor {
  constructor(private readonly database: SqliteDatabase, private readonly clock: Clock, private readonly events?: DomainEventPublisher,
    private readonly afterPurge?: () => Promise<void>) {}

  async preflight(job: ClaimedJobV1): Promise<JobPreflight> {
    asPurge(job);
    return { ready: true };
  }

  async execute(candidate: ClaimedJobV1, _signal: AbortSignal): Promise<JobExecutionResult> {
    const job = asPurge(candidate);
    const now = this.clock.now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const guard = this.database.prepare(`SELECT e.status FROM jobs j JOIN entries e ON e.id=j.entry_id
        WHERE j.id=? AND j.entry_id=? AND j.status='running' AND j.lease_owner=? AND j.fencing_token=? AND j.lease_expires_at>?`)
        .get(job.id, job.entryId, job.leaseOwner, job.fencingToken, now) as { status: string } | undefined;
      if (!guard) {
        this.database.exec("ROLLBACK");
        return { outcome: "succeeded" };
      }
      if (guard.status === "purged") {
        this.database.exec("COMMIT");
        try { await this.afterPurge?.(); } catch {
          return { outcome: "retry", error: { code: "INTERNAL_ERROR", retryable: true, message: "Post-purge backup failed", correlationId: randomUUID() } };
        }
        return { outcome: "succeeded" };
      }
      if (guard.status !== "deleting") throw new GovernanceError("INTERNAL_ERROR", "Purge requires deleting state");
      this.database.prepare(`
        UPDATE external_messages SET recipient_json = NULL, result_derivation_id = NULL,
          ack_reply_id = NULL, ack_status = 'ignored_purged', ack_next_run_at = NULL,
          ack_lease_owner = NULL, ack_lease_expires_at = NULL, ack_last_error_code = NULL,
          ack_manual_attempt_active = 0, ack_fencing_token = ack_fencing_token + 1,
          result_reply_id = NULL, result_status = 'ignored_purged', result_next_run_at = NULL,
          result_lease_owner = NULL, result_lease_expires_at = NULL, result_last_error_code = NULL,
          result_manual_attempt_active = 0, result_fencing_token = result_fencing_token + 1,
          updated_at = ? WHERE entry_id = ?
      `).run(now, job.entryId);
      this.database.prepare(`
        DELETE FROM artifact_sources
        WHERE entry_id = ?
          OR (artifact_type = 'derivation' AND artifact_id IN (
            SELECT id FROM derivations WHERE entry_id = ?
          ))
          OR (artifact_type = 'memory' AND artifact_id IN (
            SELECT id FROM memories WHERE entry_id = ?
          ))
      `).run(job.entryId, job.entryId, job.entryId);
      this.database.prepare("DELETE FROM memories WHERE entry_id=?").run(job.entryId);
      this.database.prepare("DELETE FROM derivations WHERE entry_id=?").run(job.entryId);
      this.database.prepare("DELETE FROM ai_runs WHERE entry_id=?").run(job.entryId);
      this.database.prepare("DELETE FROM entry_text_revisions WHERE entry_id=?").run(job.entryId);
      this.database.prepare("DELETE FROM entry_search WHERE entry_id=?").run(job.entryId);
      this.database.prepare("DELETE FROM governance_operations WHERE json_extract(request_json,'$.entryId')=?").run(job.entryId);
      this.database.prepare(`UPDATE entries SET raw_text=NULL,raw_checksum=NULL,status='purged',purged_at=?,updated_at=?,last_error_code=NULL WHERE id=?`).run(now, now, job.entryId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      return { outcome: "failed_final", error: { code: "INTERNAL_ERROR", retryable: false, message: "Entry purge failed", correlationId: randomUUID() } };
    }
    checkpointDatabase(this.database);
    try { await this.afterPurge?.(); } catch {
      return { outcome: "retry", error: { code: "INTERNAL_ERROR", retryable: true, message: "Post-purge backup failed", correlationId: randomUUID() } };
    }
    await publish(this.events, { version: 1, type: "entry:updated", entryId: job.entryId, status: "purged", occurredAt: now });
    return { outcome: "succeeded" };
  }
}

export function createPurgeEntryJobExecutor(dependencies: { database: SqliteDatabase; clock: Clock; events?: DomainEventPublisher; afterPurge?: () => Promise<void> }): PurgeEntryJobExecutor {
  return new PurgeEntryJobExecutor(dependencies.database, dependencies.clock, dependencies.events, dependencies.afterPurge);
}

function asPurge(job: ClaimedJobV1): PurgeJob {
  if (job.type !== "purge_entry") throw new Error("PurgeEntryJobExecutor only accepts purge_entry jobs");
  return job;
}

async function publish(events: DomainEventPublisher | undefined, event: DomainEventV1): Promise<void> {
  try { await events?.publish(event); } catch { /* SQLite is authoritative. */ }
}
