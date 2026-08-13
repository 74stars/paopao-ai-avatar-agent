import { ClaimedJobV1Schema, type ClaimedJobV1 } from "@paopao/contracts";
import type { Clock, JobRepository, JobWaitReason, SanitizedFailureV1 } from "@paopao/core";
import type { SqliteDatabase } from "../database/sqlite.js";

interface JobRow {
  id: string;
  type: ClaimedJobV1["type"];
  entry_id: string | null;
  payload_json: string;
  attempts: number;
  max_attempts: number;
  lease_owner: string;
  lease_expires_at: string;
  fencing_token: number;
}

function addMilliseconds(iso: string, milliseconds: number): string {
  return new Date(Date.parse(iso) + milliseconds).toISOString();
}

export class SqliteJobRepository implements JobRepository {
  readonly #database: SqliteDatabase;
  readonly #clock: Clock;

  constructor(database: SqliteDatabase, clock: Clock) {
    this.#database = database;
    this.#clock = clock;
  }

  claimNext(workerId: string, leaseMs: number, now: string): ClaimedJobV1 | null {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const candidate = this.#database.prepare(`
        SELECT id FROM jobs
        WHERE (status = 'queued' OR status = 'retry_wait') AND next_run_at <= ?
        ORDER BY next_run_at ASC, created_at ASC, id ASC LIMIT 1
      `).get(now) as { id: string } | undefined;
      if (!candidate) {
        this.#database.exec("COMMIT");
        return null;
      }
      const leaseExpiresAt = addMilliseconds(now, leaseMs);
      const claimed = this.#database.prepare(`
        UPDATE jobs SET status = 'running', lease_owner = ?, lease_expires_at = ?,
          fencing_token = fencing_token + 1, updated_at = ?
        WHERE id = ? AND (status = 'queued' OR status = 'retry_wait') AND next_run_at <= ?
      `).run(workerId, leaseExpiresAt, now, candidate.id, now);
      if (claimed.changes !== 1) {
        this.#database.exec("COMMIT");
        return null;
      }
      this.#database.prepare(`
        UPDATE entries SET status = 'processing', updated_at = ?
        WHERE id = (SELECT entry_id FROM jobs WHERE id = ?) AND status NOT IN ('deleting', 'purged')
          AND (SELECT type FROM jobs WHERE id = ?) = 'analyze_entry'
      `).run(now, candidate.id, candidate.id);
      const row = this.#database.prepare(`
        SELECT id, type, entry_id, payload_json, attempts, max_attempts,
          lease_owner, lease_expires_at, fencing_token FROM jobs WHERE id = ?
      `).get(candidate.id) as JobRow;
      this.#database.exec("COMMIT");
      return this.#toClaimedJob(row);
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  startAttempt(jobId: string, workerId: string, fencingToken: number): boolean {
    return this.#guardedUpdate(jobId, workerId, fencingToken, "attempts = attempts + 1");
  }

  renewLease(jobId: string, workerId: string, fencingToken: number, leaseMs: number): boolean {
    const now = this.#clock.now();
    return this.#guardedUpdate(jobId, workerId, fencingToken, "lease_expires_at = ?", [addMilliseconds(now, leaseMs)], now);
  }

  succeed(jobId: string, workerId: string, fencingToken: number): boolean {
    return this.#guardedUpdate(jobId, workerId, fencingToken, "status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL");
  }

  retryLater(jobId: string, workerId: string, fencingToken: number, nextRunAt: string, error: SanitizedFailureV1): boolean {
    return this.#guardedUpdate(jobId, workerId, fencingToken,
      "status = 'retry_wait', next_run_at = ?, lease_owner = NULL, lease_expires_at = NULL, last_error_code = ?, last_error_message = ?, correlation_id = ?",
      [nextRunAt, error.code, error.message, error.correlationId], undefined, "retry_wait", error.code);
  }

  waitFor(jobId: string, workerId: string, fencingToken: number, reason: JobWaitReason, error: SanitizedFailureV1, attemptsBeforeWait?: number): boolean {
    const status = reason === "network" ? "waiting_for_network" : "waiting_for_configuration";
    return this.#guardedUpdate(jobId, workerId, fencingToken,
      "status = ?, attempts = COALESCE(?, attempts), lease_owner = NULL, lease_expires_at = NULL, last_error_code = ?, last_error_message = ?, correlation_id = ?",
      [status, attemptsBeforeWait ?? null, error.code, error.message, error.correlationId], undefined, "retry_wait", error.code);
  }

  failFinal(jobId: string, workerId: string, fencingToken: number, error: SanitizedFailureV1): boolean {
    const entryStatus = ["AI_SAFETY_BLOCKED", "AI_INPUT_TOO_LARGE", "AI_INVALID_OUTPUT"].includes(error.code) ? "needs_review" : "failed_final";
    return this.#guardedUpdate(jobId, workerId, fencingToken,
      "status = 'failed_final', lease_owner = NULL, lease_expires_at = NULL, last_error_code = ?, last_error_message = ?, correlation_id = ?",
      [error.code, error.message, error.correlationId], undefined, entryStatus, error.code, true);
  }

  recoverExpired(now: string): number {
    return this.#database.prepare(`
      UPDATE jobs SET status = 'queued', next_run_at = ?, lease_owner = NULL, lease_expires_at = NULL,
        fencing_token = fencing_token + 1, updated_at = ?
      WHERE status = 'running' AND lease_expires_at <= ?
    `).run(now, now, now).changes;
  }

  resumeWaiting(reason: JobWaitReason, now: string): number {
    const status = reason === "network" ? "waiting_for_network" : "waiting_for_configuration";
    return this.#database.prepare(`
      UPDATE jobs SET status = 'queued', next_run_at = ?, last_error_code = NULL,
        last_error_message = NULL, correlation_id = NULL, updated_at = ? WHERE status = ?
    `).run(now, now, status).changes;
  }

  #guardedUpdate(
    jobId: string,
    workerId: string,
    fencingToken: number,
    assignments: string,
    parameters: unknown[] = [],
    now = this.#clock.now(),
    entryStatus?: string,
    entryErrorCode?: string | null,
    failExternalResult = false,
  ): boolean {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const changed = this.#database.prepare(`
        UPDATE jobs SET ${assignments}, updated_at = ?
        WHERE id = ? AND status = 'running' AND lease_owner = ? AND fencing_token = ? AND lease_expires_at > ?
      `).run(...parameters, now, jobId, workerId, fencingToken, now).changes === 1;
      if (changed && entryStatus) {
        this.#database.prepare(`
          UPDATE entries SET status = ?, last_error_code = ?, updated_at = ?
          WHERE id = (SELECT entry_id FROM jobs WHERE id = ?)
            AND status NOT IN ('deleting', 'purged')
            AND (SELECT type FROM jobs WHERE id = ?) = 'analyze_entry'
        `).run(entryStatus, entryErrorCode ?? null, now, jobId, jobId);
      }
      if (changed && failExternalResult) {
        this.#database.prepare(`
          UPDATE external_messages SET result_status = 'result_failed_final', result_derivation_id = NULL,
            result_next_run_at = NULL, result_lease_owner = NULL, result_lease_expires_at = NULL,
            result_fencing_token = result_fencing_token + 1, result_last_error_code = ?, updated_at = ?
          WHERE provider = 'feishu' AND entry_id = (SELECT entry_id FROM jobs WHERE id = ?)
            AND (SELECT type FROM jobs WHERE id = ?) IN ('analyze_entry', 'generate_insight')
            AND result_status = 'result_waiting'
        `).run(entryErrorCode ?? "AI_FAILED_FINAL", now, jobId, jobId);
      }
      this.#database.exec("COMMIT");
      return changed;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #toClaimedJob(row: JobRow): ClaimedJobV1 {
    const candidate = {
      id: row.id,
      type: row.type,
      entryId: row.entry_id,
      payload: JSON.parse(row.payload_json) as unknown,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      leaseOwner: row.lease_owner,
      leaseExpiresAt: row.lease_expires_at,
      fencingToken: row.fencing_token,
    };
    return ClaimedJobV1Schema.parse(candidate);
  }
}
