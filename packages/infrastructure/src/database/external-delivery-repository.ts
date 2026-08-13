import {
  ClaimedExternalDeliveryV1Schema,
  FeishuDeliveryIssueListResponseV1Schema,
  FeishuDeliveryIssueV1Schema,
  FeishuRecipientV1Schema,
  InsightReplyV1Schema,
  ResolveFeishuDeliveryIssueRequestV1Schema,
  ResolveFeishuDeliveryIssueReceiptV1Schema,
  type ErrorCode,
} from "@paopao/contracts";
import {
  ExternalDeliveryError,
  createExternalDeliveryService,
  type Clock,
  type ControlKind,
  type ExternalDeliveryPhase,
  type ExternalDeliveryRepository,
  type ExternalDeliveryService,
  type FeishuRecipient,
  type ResolveFeishuDeliveryIssueRequest,
} from "@paopao/core";
import type { SqliteDatabase } from "./sqlite.js";

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000] as const;

const PHASE = {
  ack: {
    status: "ack_status",
    replyId: "ack_reply_id",
    attempts: "ack_attempts",
    nextRunAt: "ack_next_run_at",
    owner: "ack_lease_owner",
    expiresAt: "ack_lease_expires_at",
    fencing: "ack_fencing_token",
    manualUsed: "ack_manual_retry_used",
    manualActive: "ack_manual_attempt_active",
    lastError: "ack_last_error_code",
  },
  result: {
    status: "result_status",
    replyId: "result_reply_id",
    attempts: "result_attempts",
    nextRunAt: "result_next_run_at",
    owner: "result_lease_owner",
    expiresAt: "result_lease_expires_at",
    fencing: "result_fencing_token",
    manualUsed: "result_manual_retry_used",
    manualActive: "result_manual_attempt_active",
    lastError: "result_last_error_code",
  },
} as const;

interface ExternalMessageRow {
  message_key: string;
  message_kind: "capture" | "control";
  entry_id: string | null;
  recipient_json: string | null;
  control_status: string | null;
  control_outcome: string | null;
  control_lease_owner: string | null;
  control_lease_expires_at: string | null;
  control_fencing_token: number;
  control_reply_code: string | null;
  ack_status: string;
  ack_attempts: number;
  ack_next_run_at: string | null;
  ack_lease_owner: string | null;
  ack_lease_expires_at: string | null;
  ack_fencing_token: number;
  ack_manual_retry_used: number;
  ack_manual_attempt_active: number;
  ack_last_error_code: string | null;
  result_status: string;
  result_attempts: number;
  result_next_run_at: string | null;
  result_lease_owner: string | null;
  result_lease_expires_at: string | null;
  result_fencing_token: number;
  result_manual_retry_used: number;
  result_manual_attempt_active: number;
  result_last_error_code: string | null;
  result_derivation_id: string | null;
  updated_at: string;
}

interface DeliveryIssueRow {
  message_key: string;
  entry_id: string | null;
  phase: ExternalDeliveryPhase;
  status: "ambiguous" | "failed_final";
  error_code: ErrorCode;
  attempts: number;
  manual_retry_used: number;
  payload_available: number;
  updated_at: string;
}

interface DeliveryCursor {
  updatedAt: string;
  messageKey: string;
  phase: ExternalDeliveryPhase;
}

export class SqliteExternalDeliveryRepository implements ExternalDeliveryRepository {
  constructor(private readonly database: SqliteDatabase, private readonly clock: Clock) {}

  async listDue(input: { now: string; phase?: ExternalDeliveryPhase; entryId?: string; limit: number }) {
    const limit = Math.max(1, Math.min(100, input.limit));
    const rows = this.database.prepare(`
      SELECT message_key, entry_id, phase, attempts FROM (
        SELECT message_key, entry_id, 'ack' AS phase, ack_attempts AS attempts,
          COALESCE(ack_next_run_at, updated_at) AS due_at
        FROM external_messages
        WHERE recipient_json IS NOT NULL
          AND (ack_status = 'ack_pending' OR (ack_status = 'ack_retry_wait' AND ack_next_run_at <= ?))
        UNION ALL
        SELECT message_key, entry_id, 'result' AS phase, result_attempts AS attempts,
          COALESCE(result_next_run_at, updated_at) AS due_at
        FROM external_messages
        WHERE recipient_json IS NOT NULL
          AND (result_status = 'result_pending' OR (result_status = 'result_retry_wait' AND result_next_run_at <= ?))
      )
      WHERE (? IS NULL OR phase = ?) AND (? IS NULL OR entry_id = ?)
      ORDER BY due_at ASC, message_key ASC, phase ASC LIMIT ?
    `).all(input.now, input.now, input.phase ?? null, input.phase ?? null, input.entryId ?? null, input.entryId ?? null, limit) as Array<{
      message_key: string;
      entry_id: string | null;
      phase: ExternalDeliveryPhase;
      attempts: number;
    }>;
    return rows.map((row) => ({ messageKey: row.message_key, entryId: row.entry_id, phase: row.phase, attempts: row.attempts }));
  }

  async claimReply(input: {
    provider: "feishu";
    messageKey: string;
    phase: ExternalDeliveryPhase;
    owner: string;
    leaseMs: number;
    now: string;
  }) {
    const columns = PHASE[input.phase];
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#message(input.messageKey);
      if (!row || row.recipient_json === null) {
        this.database.exec("COMMIT");
        return { decision: "skip" as const, delivery: null };
      }
      const status = row[columns.status];
      if (status === `${input.phase}_sending` && row[columns.expiresAt] !== null && row[columns.expiresAt]! <= input.now) {
        this.database.prepare(`
          UPDATE external_messages SET ${columns.status} = ?, ${columns.owner} = NULL, ${columns.expiresAt} = NULL,
            ${columns.manualActive} = 0, ${columns.fencing} = ${columns.fencing} + 1,
            ${columns.lastError} = 'DELIVERY_AMBIGUOUS', updated_at = ?
          WHERE provider = 'feishu' AND message_key = ? AND ${columns.status} = ?
        `).run(`${input.phase}_ambiguous`, input.now, input.messageKey, `${input.phase}_sending`);
        this.database.exec("COMMIT");
        return { decision: "ambiguous" as const, delivery: null };
      }
      const due = status === `${input.phase}_pending`
        || (status === `${input.phase}_retry_wait` && row[columns.nextRunAt] !== null && row[columns.nextRunAt]! <= input.now);
      if (!due) {
        this.database.exec("COMMIT");
        return { decision: status === `${input.phase}_ambiguous` ? "ambiguous" as const : "skip" as const, delivery: null };
      }

      const recipient = FeishuRecipientV1Schema.parse(JSON.parse(row.recipient_json));
      const derivationId = input.phase === "result" ? row.result_derivation_id : null;
      const payload = input.phase === "ack"
        ? row.message_kind === "control"
          ? this.#controlPayload(row)
          : { kind: "capture_ack" as const }
        : this.#insightPayload(row);
      const expiresAt = addMilliseconds(input.now, input.leaseMs);
      const update = this.database.prepare(`
        UPDATE external_messages SET ${columns.status} = ?, ${columns.owner} = ?, ${columns.expiresAt} = ?,
          ${columns.fencing} = ${columns.fencing} + 1, ${columns.attempts} = ${columns.attempts} + 1,
          ${columns.nextRunAt} = NULL, updated_at = ?
        WHERE provider = 'feishu' AND message_key = ? AND ${columns.status} = ?
      `).run(`${input.phase}_sending`, input.owner, expiresAt, input.now, input.messageKey, status);
      if (update.changes !== 1) {
        this.database.exec("COMMIT");
        return { decision: "skip" as const, delivery: null };
      }
      const delivery = ClaimedExternalDeliveryV1Schema.parse({
        messageKey: row.message_key,
        entryId: row.entry_id,
        phase: input.phase,
        attempts: row[columns.attempts] + 1,
        owner: input.owner,
        fencingToken: row[columns.fencing] + 1,
        recipient,
        derivationId,
        payload,
      });
      this.database.exec("COMMIT");
      return { decision: "send" as const, delivery };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async renewReplyLease(input: {
    provider: "feishu";
    messageKey: string;
    phase: ExternalDeliveryPhase;
    owner: string;
    fencingToken: number;
    leaseMs: number;
    now: string;
  }): Promise<boolean> {
    const columns = PHASE[input.phase];
    return this.database.prepare(`
      UPDATE external_messages SET ${columns.expiresAt} = ?, updated_at = ?
      WHERE provider = 'feishu' AND message_key = ? AND ${columns.status} = ?
        AND ${columns.owner} = ? AND ${columns.fencing} = ? AND ${columns.expiresAt} > ?
    `).run(addMilliseconds(input.now, input.leaseMs), input.now, input.messageKey, `${input.phase}_sending`, input.owner, input.fencingToken, input.now).changes === 1;
  }

  async completeReply(input: {
    provider: "feishu";
    messageKey: string;
    phase: ExternalDeliveryPhase;
    owner: string;
    fencingToken: number;
    externalReplyId: string;
  }): Promise<boolean> {
    const now = this.clock.now();
    const columns = PHASE[input.phase];
    return this.database.prepare(`
      UPDATE external_messages SET ${columns.status} = ?, ${columns.replyId} = ?,
        ${columns.owner} = NULL, ${columns.expiresAt} = NULL, ${columns.nextRunAt} = NULL,
        ${columns.lastError} = NULL, ${columns.manualActive} = 0,
        ${columns.fencing} = ${columns.fencing} + 1, updated_at = ?
      WHERE provider = 'feishu' AND message_key = ? AND ${columns.status} = ?
        AND ${columns.owner} = ? AND ${columns.fencing} = ? AND ${columns.expiresAt} > ?
    `).run(`${input.phase}_sent`, input.externalReplyId, now, input.messageKey, `${input.phase}_sending`, input.owner, input.fencingToken, now).changes === 1;
  }

  async failReply(input: {
    provider: "feishu";
    messageKey: string;
    phase: ExternalDeliveryPhase;
    owner: string;
    fencingToken: number;
    outcome: "confirmed_not_sent" | "unknown";
    error: { code: ErrorCode; retryable: boolean; message: string; correlationId: string };
    now: string;
  }): Promise<boolean> {
    const columns = PHASE[input.phase];
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#message(input.messageKey);
      if (!row || row[columns.status] !== `${input.phase}_sending` || row[columns.owner] !== input.owner
        || row[columns.fencing] !== input.fencingToken || row[columns.expiresAt] === null || row[columns.expiresAt]! <= input.now) {
        this.database.exec("COMMIT");
        return false;
      }
      const manualAttempt = row[columns.manualActive] === 1;
      let nextStatus: string;
      let nextRunAt: string | null = null;
      let errorCode: ErrorCode = input.error.code;
      if (input.outcome === "unknown") {
        nextStatus = `${input.phase}_ambiguous`;
        errorCode = "DELIVERY_AMBIGUOUS";
      } else if (!manualAttempt && input.error.retryable && row[columns.attempts] < MAX_ATTEMPTS) {
        nextStatus = `${input.phase}_retry_wait`;
        nextRunAt = addMilliseconds(input.now, BACKOFF_MS[Math.min(row[columns.attempts] - 1, BACKOFF_MS.length - 1)]);
      } else {
        nextStatus = `${input.phase}_failed_final`;
      }
      const changed = this.database.prepare(`
        UPDATE external_messages SET ${columns.status} = ?, ${columns.nextRunAt} = ?,
          ${columns.owner} = NULL, ${columns.expiresAt} = NULL, ${columns.lastError} = ?,
          ${columns.manualActive} = 0, ${columns.fencing} = ${columns.fencing} + 1, updated_at = ?
        WHERE provider = 'feishu' AND message_key = ? AND ${columns.status} = ?
          AND ${columns.owner} = ? AND ${columns.fencing} = ?
      `).run(nextStatus, nextRunAt, errorCode, input.now, input.messageKey, `${input.phase}_sending`, input.owner, input.fencingToken).changes === 1;
      this.database.exec("COMMIT");
      return changed;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async claimControlEvent(input: {
    provider: "feishu";
    eventKey: string;
    messageKey: string;
    controlKind: ControlKind;
    recipient: FeishuRecipient;
    owner: string;
    leaseMs: number;
    now: string;
  }): Promise<{ decision: "process" | "skip"; fencingToken: number | null }> {
    const recipient = FeishuRecipientV1Schema.parse(input.recipient);
    const recipientJson = JSON.stringify(recipient);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        INSERT INTO processed_events(provider, event_key, message_key, control_kind, status, updated_at)
        VALUES ('feishu', ?, ?, ?, 'received', ?)
        ON CONFLICT(provider, event_key) DO NOTHING
      `).run(input.eventKey, input.messageKey, input.controlKind, input.now);
      const event = this.database.prepare(`
        SELECT message_key, control_kind FROM processed_events WHERE provider = 'feishu' AND event_key = ?
      `).get(input.eventKey) as { message_key: string | null; control_kind: string | null } | undefined;
      if (!event || event.message_key !== input.messageKey || event.control_kind !== input.controlKind) {
        throw new ExternalDeliveryError("VALIDATION_FAILED", "External event key was reused with different control input");
      }
      const conflictingKind = this.database.prepare(`
        SELECT 1 AS found FROM processed_events
        WHERE provider = 'feishu' AND message_key = ? AND control_kind IS NOT NULL AND control_kind <> ? LIMIT 1
      `).get(input.messageKey, input.controlKind);
      if (conflictingKind) throw new ExternalDeliveryError("VALIDATION_FAILED", "External message key was reused for a different control kind");
      this.database.prepare(`
        INSERT INTO external_messages(
          provider, message_key, message_kind, entry_id, recipient_json,
          control_status, control_fencing_token, ack_status, result_status, updated_at
        ) VALUES ('feishu', ?, 'control', NULL, ?, 'control_waiting', 0, 'ack_waiting', 'result_not_required', ?)
        ON CONFLICT(provider, message_key) DO NOTHING
      `).run(input.messageKey, recipientJson, input.now);
      const row = this.#message(input.messageKey);
      if (!row || row.message_kind !== "control" || row.recipient_json !== recipientJson) {
        throw new ExternalDeliveryError("VALIDATION_FAILED", "External message key was reused with different control input");
      }
      if (row.control_status === "control_completed") {
        const canonical = this.database.prepare(`
          SELECT outcome, processed_at FROM processed_events
          WHERE provider = 'feishu' AND message_key = ? AND status = 'completed'
          ORDER BY processed_at ASC, event_key ASC LIMIT 1
        `).get(input.messageKey) as { outcome: string | null; processed_at: string | null } | undefined;
        this.database.prepare(`
          UPDATE processed_events SET status = 'completed', outcome = ?, processed_at = ?, updated_at = ?
          WHERE provider = 'feishu' AND message_key = ? AND status = 'received'
        `).run(canonical?.outcome ?? row.control_outcome, canonical?.processed_at ?? input.now, input.now, input.messageKey);
        this.database.exec("COMMIT");
        return { decision: "skip", fencingToken: null };
      }
      if (row.control_status === "control_claimed" && row.control_lease_expires_at !== null && row.control_lease_expires_at > input.now) {
        this.database.exec("COMMIT");
        return { decision: "skip", fencingToken: null };
      }
      const leaseExpiresAt = addMilliseconds(input.now, input.leaseMs);
      const changed = this.database.prepare(`
        UPDATE external_messages SET control_status = 'control_claimed', control_lease_owner = ?,
          control_lease_expires_at = ?, control_fencing_token = control_fencing_token + 1, updated_at = ?
        WHERE provider = 'feishu' AND message_key = ? AND control_status IN ('control_waiting', 'control_claimed')
          AND (control_status = 'control_waiting' OR control_lease_expires_at <= ?)
      `).run(input.owner, leaseExpiresAt, input.now, input.messageKey, input.now);
      if (changed.changes !== 1) {
        this.database.exec("COMMIT");
        return { decision: "skip", fencingToken: null };
      }
      const token = row.control_fencing_token + 1;
      this.database.exec("COMMIT");
      return { decision: "process", fencingToken: token };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async completeControlEvent(input: {
    provider: "feishu";
    eventKey: string;
    messageKey: string;
    owner: string;
    fencingToken: number;
    outcome: "bound" | "unbound" | "ignored" | "rejected";
    replyCode: "bound" | "unbound" | "binding_required" | "unsupported_message" | "p2p_only" | "help" | "binding_error";
  }): Promise<boolean> {
    const now = this.clock.now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const event = this.database.prepare(`
        SELECT message_key FROM processed_events WHERE provider = 'feishu' AND event_key = ?
      `).get(input.eventKey) as { message_key: string | null } | undefined;
      if (!event || event.message_key !== input.messageKey) {
        this.database.exec("COMMIT");
        return false;
      }
      const changed = this.database.prepare(`
        UPDATE external_messages SET control_status = 'control_completed', control_outcome = ?,
          control_reply_code = ?, control_lease_owner = NULL, control_lease_expires_at = NULL,
          control_fencing_token = control_fencing_token + 1,
          ack_status = 'ack_pending', ack_next_run_at = ?, updated_at = ?
        WHERE provider = 'feishu' AND message_key = ? AND control_status = 'control_claimed'
          AND control_lease_owner = ? AND control_fencing_token = ? AND control_lease_expires_at > ?
      `).run(input.outcome, input.replyCode, now, now, input.messageKey, input.owner, input.fencingToken, now).changes === 1;
      if (changed) {
        this.database.prepare(`
          UPDATE processed_events SET status = 'completed', outcome = ?, processed_at = ?, updated_at = ?
          WHERE provider = 'feishu' AND message_key = ?
        `).run(input.outcome, now, now, input.messageKey);
      }
      this.database.exec("COMMIT");
      return changed;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async listIssues(input: { cursor?: string; limit: number }) {
    const limit = Math.max(1, Math.min(100, input.limit));
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;
    const rows = this.#allIssues();
    const start = cursor === null ? 0 : rows.findIndex((row) => isAfterCursor(row, cursor));
    const offset = start < 0 ? rows.length : start;
    const page = rows.slice(offset, offset + limit);
    const hasMore = offset + limit < rows.length;
    const items = page.map((row) => FeishuDeliveryIssueV1Schema.parse({
      messageKey: row.message_key,
      entryId: row.entry_id,
      phase: row.phase,
      status: row.status,
      errorCode: row.error_code,
      attempts: row.attempts,
      manualRetryAvailable: row.manual_retry_used === 0 && row.payload_available === 1,
      updatedAt: row.updated_at,
    }));
    const last = page.at(-1);
    return FeishuDeliveryIssueListResponseV1Schema.parse({
      items,
      nextCursor: hasMore && last ? encodeCursor({ updatedAt: last.updated_at, messageKey: last.message_key, phase: last.phase }) : null,
    });
  }

  async countIssues(): Promise<number> {
    const row = this.database.prepare(`
      SELECT
        SUM(CASE WHEN ack_status IN ('ack_ambiguous','ack_failed_final') THEN 1 ELSE 0 END) +
        SUM(CASE WHEN result_status IN ('result_ambiguous','result_failed_final') THEN 1 ELSE 0 END) AS count
      FROM external_messages
    `).get() as { count: number | null };
    return row.count ?? 0;
  }

  async resolveIssue(candidate: ResolveFeishuDeliveryIssueRequest) {
    const command = ResolveFeishuDeliveryIssueRequestV1Schema.parse(candidate);
    const columns = PHASE[command.phase];
    const now = this.clock.now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const prior = this.database.prepare(`
        SELECT provider, message_key, phase, action, outcome_status
        FROM external_delivery_operations WHERE request_id = ?
      `).get(command.requestId) as { provider: string; message_key: string; phase: string; action: string; outcome_status: string } | undefined;
      if (prior) {
        if (prior.provider !== "feishu" || prior.message_key !== command.messageKey || prior.phase !== command.phase || prior.action !== command.action) {
          throw new ExternalDeliveryError("VALIDATION_FAILED", "Delivery requestId was reused with different input");
        }
        this.database.exec("COMMIT");
        return ResolveFeishuDeliveryIssueReceiptV1Schema.parse({ status: prior.outcome_status });
      }
      const row = this.#message(command.messageKey);
      if (!row) throw new ExternalDeliveryError("NOT_FOUND", "Delivery issue was not found");
      const status = row[columns.status];
      if (status !== `${command.phase}_ambiguous` && status !== `${command.phase}_failed_final`) {
        throw new ExternalDeliveryError("NOT_FOUND", "Delivery is not awaiting manual resolution");
      }
      let outcomeStatus: "sent_assumed" | "pending";
      if (command.action === "retry_once") {
        if (row[columns.manualUsed] === 1) throw new ExternalDeliveryError("DELIVERY_FAILED_FINAL", "The manual retry budget has already been used");
        if (!this.#hasClaimablePayload(row, command.phase)) {
          throw new ExternalDeliveryError("DELIVERY_FAILED_FINAL", "The delivery payload is no longer available");
        }
        outcomeStatus = "pending";
        this.database.prepare(`
          UPDATE external_messages SET ${columns.status} = ?, ${columns.manualUsed} = 1,
            ${columns.manualActive} = 1, ${columns.nextRunAt} = ?, ${columns.owner} = NULL,
            ${columns.expiresAt} = NULL, ${columns.lastError} = NULL,
            ${columns.fencing} = ${columns.fencing} + 1, updated_at = ?
          WHERE provider = 'feishu' AND message_key = ?
        `).run(`${command.phase}_pending`, now, now, command.messageKey);
      } else {
        outcomeStatus = "sent_assumed";
        this.database.prepare(`
          UPDATE external_messages SET ${columns.status} = ?, ${columns.manualActive} = 0,
            ${columns.nextRunAt} = NULL, ${columns.owner} = NULL, ${columns.expiresAt} = NULL,
            ${columns.lastError} = NULL, ${columns.fencing} = ${columns.fencing} + 1, updated_at = ?
          WHERE provider = 'feishu' AND message_key = ?
        `).run(`${command.phase}_sent_assumed`, now, command.messageKey);
      }
      this.database.prepare(`
        INSERT INTO external_delivery_operations(request_id, provider, message_key, phase, action, outcome_status, created_at)
        VALUES (?, 'feishu', ?, ?, ?, ?, ?)
      `).run(command.requestId, command.messageKey, command.phase, command.action, outcomeStatus, now);
      this.database.exec("COMMIT");
      return ResolveFeishuDeliveryIssueReceiptV1Schema.parse({ status: outcomeStatus });
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async recoverStaleClaims(input: { now: string; providerSupportsIdempotentSend: boolean }) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const controlsReleased = this.database.prepare(`
        UPDATE external_messages SET control_status = 'control_waiting', control_lease_owner = NULL,
          control_lease_expires_at = NULL, control_fencing_token = control_fencing_token + 1, updated_at = ?
        WHERE provider = 'feishu' AND control_status = 'control_claimed' AND control_lease_expires_at <= ?
      `).run(input.now, input.now).changes;
      let repliesMarkedAmbiguous = 0;
      for (const phase of ["ack", "result"] as const) {
        const columns = PHASE[phase];
        if (input.providerSupportsIdempotentSend) {
          this.database.prepare(`
            UPDATE external_messages SET ${columns.status} = ?, ${columns.nextRunAt} = ?,
              ${columns.owner} = NULL, ${columns.expiresAt} = NULL,
              ${columns.fencing} = ${columns.fencing} + 1, updated_at = ?
            WHERE provider = 'feishu' AND ${columns.status} = ? AND ${columns.expiresAt} <= ?
              AND ${columns.manualActive} = 0 AND ${columns.attempts} < ?
          `).run(`${phase}_retry_wait`, input.now, input.now, `${phase}_sending`, input.now, MAX_ATTEMPTS);
          this.database.prepare(`
            UPDATE external_messages SET ${columns.status} = ?, ${columns.owner} = NULL,
              ${columns.expiresAt} = NULL, ${columns.lastError} = 'DELIVERY_FAILED_FINAL',
              ${columns.manualActive} = 0, ${columns.fencing} = ${columns.fencing} + 1, updated_at = ?
            WHERE provider = 'feishu' AND ${columns.status} = ? AND ${columns.expiresAt} <= ?
              AND ${columns.manualActive} = 0 AND ${columns.attempts} >= ?
          `).run(`${phase}_failed_final`, input.now, `${phase}_sending`, input.now, MAX_ATTEMPTS);
          repliesMarkedAmbiguous += this.#markExpiredAmbiguous(phase, input.now, true);
        } else {
          repliesMarkedAmbiguous += this.#markExpiredAmbiguous(phase, input.now, false);
        }
      }
      this.database.exec("COMMIT");
      return { controlsReleased, repliesMarkedAmbiguous };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  #message(messageKey: string): ExternalMessageRow | undefined {
    return this.database.prepare(`SELECT * FROM external_messages WHERE provider = 'feishu' AND message_key = ?`).get(messageKey) as ExternalMessageRow | undefined;
  }

  #controlPayload(row: ExternalMessageRow) {
    if (row.control_status !== "control_completed" || row.control_reply_code === null) {
      throw new ExternalDeliveryError("INTERNAL_ERROR", "Control reply is not ready");
    }
    return { kind: "control" as const, replyCode: row.control_reply_code };
  }

  #insightPayload(row: ExternalMessageRow) {
    if (row.result_derivation_id === null) throw new ExternalDeliveryError("INTERNAL_ERROR", "Insight delivery has no fixed derivation");
    const derivation = this.database.prepare(`
      SELECT value_json FROM derivations WHERE id = ? AND entry_id = ? AND kind = 'insight_reply'
    `).get(row.result_derivation_id, row.entry_id) as { value_json: string } | undefined;
    if (!derivation) throw new ExternalDeliveryError("INTERNAL_ERROR", "Insight delivery derivation is unavailable");
    return { kind: "insight" as const, reply: InsightReplyV1Schema.parse(JSON.parse(derivation.value_json)) };
  }

  #allIssues(): DeliveryIssueRow[] {
    return this.database.prepare(`
      SELECT message_key, entry_id, 'ack' AS phase,
        CASE ack_status WHEN 'ack_ambiguous' THEN 'ambiguous' ELSE 'failed_final' END AS status,
        COALESCE(ack_last_error_code, CASE ack_status WHEN 'ack_ambiguous' THEN 'DELIVERY_AMBIGUOUS' ELSE 'DELIVERY_FAILED_FINAL' END) AS error_code,
        ack_attempts AS attempts, ack_manual_retry_used AS manual_retry_used,
        CASE WHEN recipient_json IS NOT NULL AND (
          message_kind = 'capture' OR (message_kind = 'control' AND control_status = 'control_completed' AND control_reply_code IS NOT NULL)
        ) THEN 1 ELSE 0 END AS payload_available, updated_at
      FROM external_messages WHERE ack_status IN ('ack_ambiguous', 'ack_failed_final')
      UNION ALL
      SELECT message_key, entry_id, 'result' AS phase,
        CASE result_status WHEN 'result_ambiguous' THEN 'ambiguous' ELSE 'failed_final' END AS status,
        COALESCE(result_last_error_code, CASE result_status WHEN 'result_ambiguous' THEN 'DELIVERY_AMBIGUOUS' ELSE 'DELIVERY_FAILED_FINAL' END) AS error_code,
        result_attempts AS attempts, result_manual_retry_used AS manual_retry_used,
        CASE WHEN recipient_json IS NOT NULL AND result_derivation_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM derivations d WHERE d.id = external_messages.result_derivation_id
            AND d.entry_id = external_messages.entry_id AND d.kind = 'insight_reply'
        ) THEN 1 ELSE 0 END AS payload_available, updated_at
      FROM external_messages WHERE result_status IN ('result_ambiguous', 'result_failed_final')
      ORDER BY updated_at DESC, message_key ASC, phase ASC
    `).all() as DeliveryIssueRow[];
  }

  #markExpiredAmbiguous(phase: ExternalDeliveryPhase, now: string, manualOnly: boolean): number {
    const columns = PHASE[phase];
    return this.database.prepare(`
      UPDATE external_messages SET ${columns.status} = ?, ${columns.owner} = NULL,
        ${columns.expiresAt} = NULL, ${columns.lastError} = 'DELIVERY_AMBIGUOUS',
        ${columns.manualActive} = 0, ${columns.fencing} = ${columns.fencing} + 1, updated_at = ?
      WHERE provider = 'feishu' AND ${columns.status} = ? AND ${columns.expiresAt} <= ?
        ${manualOnly ? `AND ${columns.manualActive} = 1` : ""}
    `).run(`${phase}_ambiguous`, now, `${phase}_sending`, now).changes;
  }

  #hasClaimablePayload(row: ExternalMessageRow, phase: ExternalDeliveryPhase): boolean {
    if (row.recipient_json === null) return false;
    try {
      FeishuRecipientV1Schema.parse(JSON.parse(row.recipient_json));
      if (phase === "ack") {
        if (row.message_kind === "control") this.#controlPayload(row);
        return true;
      }
      this.#insightPayload(row);
      return true;
    } catch {
      return false;
    }
  }
}

export function createSqliteExternalDeliveryService(options: { database: SqliteDatabase; clock: Clock }): ExternalDeliveryService {
  return createExternalDeliveryService({ repository: new SqliteExternalDeliveryRepository(options.database, options.clock) });
}

function addMilliseconds(iso: string, milliseconds: number): string {
  return new Date(Date.parse(iso) + milliseconds).toISOString();
}

function encodeCursor(cursor: DeliveryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): DeliveryCursor {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<DeliveryCursor>;
    if (typeof parsed.updatedAt !== "string" || typeof parsed.messageKey !== "string" || (parsed.phase !== "ack" && parsed.phase !== "result")) throw new Error();
    return parsed as DeliveryCursor;
  } catch {
    throw new ExternalDeliveryError("VALIDATION_FAILED", "Invalid delivery issue cursor");
  }
}

function isAfterCursor(row: DeliveryIssueRow, cursor: DeliveryCursor): boolean {
  if (row.updated_at !== cursor.updatedAt) return row.updated_at < cursor.updatedAt;
  if (row.message_key !== cursor.messageKey) return row.message_key > cursor.messageKey;
  return row.phase > cursor.phase;
}
