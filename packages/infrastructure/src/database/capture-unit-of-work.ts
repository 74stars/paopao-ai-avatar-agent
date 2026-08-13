import { createHash, randomUUID } from "node:crypto";
import type { CaptureCommandV1 } from "@paopao/contracts";
import type { CaptureTransactionResult, CaptureUnitOfWork, Clock, IdGenerator } from "@paopao/core";
import type { SqliteDatabase } from "./sqlite.js";

interface EntryRow {
  id: string;
  created_at: string;
}

interface JobRow {
  id: string;
}

export type CaptureStage = "entry" | "revision" | "job" | "external-ledger";

export interface SqliteCaptureUnitOfWorkOptions {
  database: SqliteDatabase;
  clock: Clock;
  ids?: IdGenerator;
  failAfter?: (stage: CaptureStage) => void;
}

const defaultIds: IdGenerator = { next: randomUUID };

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export class SqliteCaptureUnitOfWork implements CaptureUnitOfWork {
  readonly #database: SqliteDatabase;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #failAfter?: (stage: CaptureStage) => void;

  constructor(options: SqliteCaptureUnitOfWorkOptions) {
    this.#database = options.database;
    this.#clock = options.clock;
    this.#ids = options.ids ?? defaultIds;
    this.#failAfter = options.failAfter;
  }

  capture(command: CaptureCommandV1): CaptureTransactionResult {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.#database.prepare("SELECT id, created_at FROM entries WHERE source_key = ?").get(command.sourceKey) as EntryRow | undefined;
      if (existing) {
        if (command.externalRef) this.#registerExternal(command, existing.id, false);
        const job = this.#findAnalyzeJob(existing.id);
        if (!job) throw new Error("Capture ledger is missing its analyze job");
        this.#database.exec("COMMIT");
        return { receipt: { entryId: existing.id, jobId: job.id, status: "stored", deduplicated: true, createdAt: existing.created_at }, created: false };
      }

      const entryId = this.#ids.next();
      const jobId = this.#ids.next();
      const createdAt = command.receivedAt;
      const checksum = sha256(command.rawText);
      this.#database.prepare(`
        INSERT INTO entries(id, source, source_key, modality, raw_text, raw_checksum, capture_mode, status, current_text_revision, created_at, updated_at)
        VALUES (?, ?, ?, 'text', ?, ?, ?, 'stored', 1, ?, ?)
      `).run(entryId, command.source, command.sourceKey, command.rawText, checksum, command.mode, createdAt, createdAt);
      this.#failAfter?.("entry");

      this.#database.prepare(`
        INSERT INTO entry_text_revisions(entry_id, revision, text, checksum, created_by, operation_key, created_at)
        VALUES (?, 1, ?, ?, 'user', ?, ?)
      `).run(entryId, command.rawText, checksum, `capture:${command.sourceKey}:revision:1`, createdAt);
      this.#failAfter?.("revision");

      // FTS is maintained in the same transaction as the canonical text.
      this.#database.prepare(`
        INSERT INTO entry_search(entry_id, current_text, summary, entities, goals, actions)
        VALUES (?, ?, '', '', '', '')
      `).run(entryId, command.rawText);

      const payload = JSON.stringify({ schemaVersion: "analyze-entry-job.v1", entryId, textRevision: 1 });
      this.#database.prepare(`
        INSERT INTO jobs(id, type, entry_id, payload_json, idempotency_key, status, max_attempts, next_run_at, created_at, updated_at)
        VALUES (?, 'analyze_entry', ?, ?, ?, 'queued', 5, ?, ?, ?)
      `).run(jobId, entryId, payload, `analyze_entry:${entryId}:text_revision:1`, createdAt, createdAt, createdAt);
      this.#failAfter?.("job");

      if (command.externalRef) this.#registerExternal(command, entryId, true);
      this.#failAfter?.("external-ledger");
      this.#database.exec("COMMIT");
      return { receipt: { entryId, jobId, status: "stored", deduplicated: false, createdAt }, created: true };
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #findAnalyzeJob(entryId: string): JobRow | undefined {
    return this.#database.prepare("SELECT id FROM jobs WHERE idempotency_key = ?").get(`analyze_entry:${entryId}:text_revision:1`) as JobRow | undefined;
  }

  #registerExternal(command: CaptureCommandV1, entryId: string, firstCapture: boolean): void {
    const external = command.externalRef;
    if (!external) return;
    if (command.sourceKey !== external.messageKey) throw new Error("Feishu sourceKey must equal messageKey");
    const now = this.#clock.now();
    this.#database.prepare(`
      INSERT INTO processed_events(provider, event_key, message_key, status, outcome, processed_at, updated_at)
      VALUES ('feishu', ?, ?, 'completed', 'captured', ?, ?)
      ON CONFLICT(provider, event_key) DO NOTHING
    `).run(external.eventKey, external.messageKey, now, now);
    const event = this.#database.prepare(`
      SELECT message_key, status, outcome FROM processed_events WHERE provider = 'feishu' AND event_key = ?
    `).get(external.eventKey) as { message_key: string | null; status: string; outcome: string | null } | undefined;
    if (!event || event.message_key !== external.messageKey || event.status !== "completed" || event.outcome !== "captured") {
      throw new Error("External event key is already bound to another message or operation");
    }

    const recipient = JSON.stringify({
      appId: external.appId,
      tenantKey: external.tenantKey,
      openId: external.openId,
      chatId: external.chatId,
      chatType: external.chatType,
      messageId: external.messageId,
    });
    this.#database.prepare(`
      INSERT INTO external_messages(
        provider, message_key, message_kind, entry_id, recipient_json,
        ack_status, ack_next_run_at, result_status, updated_at
      ) VALUES ('feishu', ?, 'capture', ?, ?, 'ack_pending', ?, ?, ?)
      ON CONFLICT(provider, message_key) DO NOTHING
    `).run(external.messageKey, entryId, recipient, now, command.mode === "think" ? "result_waiting" : "result_not_required", now);

    const ledger = this.#database.prepare(`
      SELECT entry_id, message_kind, recipient_json FROM external_messages WHERE provider = 'feishu' AND message_key = ?
    `).get(external.messageKey) as { entry_id: string | null; message_kind: string; recipient_json: string | null } | undefined;
    if (!ledger || ledger.entry_id !== entryId || ledger.message_kind !== "capture") {
      throw new Error("External message key is already bound to another entry or recipient");
    }
    const tombstone = this.#database.prepare(`
      SELECT ack_status, result_status, recipient_json, result_derivation_id
      FROM external_messages WHERE provider = 'feishu' AND message_key = ?
    `).get(external.messageKey) as { ack_status: string; result_status: string; recipient_json: string | null; result_derivation_id: string | null };
    if (tombstone.ack_status === "ignored_purged" && tombstone.result_status === "ignored_purged"
      && tombstone.recipient_json === null && tombstone.result_derivation_id === null) {
      return;
    }
    if (ledger.recipient_json !== recipient) throw new Error("External message key is already bound to another entry or recipient");
    void firstCapture;
  }
}
