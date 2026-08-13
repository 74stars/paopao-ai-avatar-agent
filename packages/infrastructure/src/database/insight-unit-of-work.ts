import { randomUUID } from "node:crypto";
import {
  MemoryAnalysisV1Schema,
  AiRunMetadataV1Schema,
  type ClaimedJobV1,
  type ErrorCode,
  type InsightReplyV1,
  type RetrievedMemoryV1,
} from "@paopao/contracts";
import type { InsightJobContext } from "../ai/insight-service.js";
import type { SqliteDatabase } from "./sqlite.js";

const RECALL_LIMIT = 8;
type GenerateInsightJobV1 = Extract<ClaimedJobV1, { type: "generate_insight" }>;
type AiRunMetadataV1 = ReturnType<typeof AiRunMetadataV1Schema.parse>;

export class SqliteRetrievalService {
  constructor(private readonly database: SqliteDatabase) {}

  recall(entryId: string, queryText: string): RetrievedMemoryV1[] {
    const query = toFtsQuery(queryText);
    if (!query) return [];
    const rows = this.database.prepare(`
      SELECT m.id AS memory_id, e.id AS entry_id, m.summary, e.created_at,
        (SELECT s.quote FROM artifact_sources s
          WHERE s.artifact_type = 'memory' AND s.artifact_id = m.id AND s.entry_id = e.id
          ORDER BY s.created_at ASC, s.quote ASC LIMIT 1) AS evidence_quote,
        bm25(entry_search) AS rank
      FROM entry_search
      JOIN entries e ON e.id = entry_search.entry_id
      JOIN memories m ON m.entry_id = e.id
      WHERE entry_search MATCH ? AND e.id <> ? AND e.status = 'ready'
      ORDER BY rank ASC, e.created_at DESC, e.id ASC
      LIMIT ?
    `).all(query, entryId, RECALL_LIMIT) as Array<{
      memory_id: string; entry_id: string; summary: string; created_at: string; evidence_quote: string | null; rank: number;
    }>;
    return rows.filter((row) => row.evidence_quote !== null).map((row) => ({
      memoryId: row.memory_id,
      entryId: row.entry_id,
      summary: row.summary,
      evidenceQuote: row.evidence_quote!,
      createdAt: row.created_at,
      score: 1 / (1 + Math.abs(row.rank)),
    }));
  }
}

export class SqliteInsightUnitOfWork {
  readonly #retrieval: SqliteRetrievalService;

  constructor(
    private readonly options: { database: SqliteDatabase; now?: () => string; nextId?: () => string },
  ) {
    this.#retrieval = new SqliteRetrievalService(options.database);
  }

  load = (job: GenerateInsightJobV1): InsightJobContext | null => {
    const row = this.options.database.prepare(`
      SELECT e.status, e.current_text_revision, r.text
      FROM jobs j JOIN entries e ON e.id = j.entry_id
      JOIN entry_text_revisions r ON r.entry_id = e.id AND r.revision = e.current_text_revision
      WHERE j.id = ? AND j.entry_id = ?
    `).get(job.id, job.entryId) as { status: string; current_text_revision: number; text: string } | undefined;
    if (!row || row.status !== "ready" || row.current_text_revision !== job.payload.textRevision) return null;

    const derivations = this.options.database.prepare(`
      SELECT id, kind, value_json FROM derivations
      WHERE entry_id = ? AND text_revision = ? AND is_current = 1
        AND kind IN ('classification','summary','entities','goals','next_actions')
    `).all(job.entryId, job.payload.textRevision) as Array<{ id: string; kind: string; value_json: string }>;
    const values = new Map(derivations.map((item) => [item.kind, { id: item.id, value: JSON.parse(item.value_json) as unknown }]));
    if (values.get("summary")?.id !== job.payload.analysisDerivationId) return null;
    const parsed = MemoryAnalysisV1Schema.safeParse({
      schemaVersion: "memory-analysis.v1",
      classification: values.get("classification")?.value,
      summary: values.get("summary")?.value,
      entities: values.get("entities")?.value,
      goals: values.get("goals")?.value,
      nextActions: values.get("next_actions")?.value,
      needsUserReview: false,
    });
    if (!parsed.success) return null;
    const queryText = [parsed.data.summary.text, ...parsed.data.entities.items.map((item) => item.name), ...parsed.data.goals.items.map((item) => item.title)].join(" ");
    return { currentText: row.text, analysis: parsed.data, retrievedMemories: this.#retrieval.recall(job.entryId, queryText) };
  };

  commit(job: GenerateInsightJobV1, reply: InsightReplyV1, metadata: AiRunMetadataV1): { state: "committed"; derivationId: string } | { state: "already_committed" | "stale" } {
    const database = this.options.database;
    const now = this.options.now?.() ?? new Date().toISOString();
    const nextId = this.options.nextId ?? randomUUID;
    database.exec("BEGIN IMMEDIATE");
    try {
      const guard = database.prepare(`
        SELECT e.status, e.current_text_revision,
          EXISTS(SELECT 1 FROM derivations d WHERE d.operation_key = ?) AS committed,
          EXISTS(SELECT 1 FROM derivations d WHERE d.id = ? AND d.entry_id = e.id
            AND d.kind = 'summary' AND d.text_revision = ? AND d.is_current = 1) AS analysis_current
        FROM jobs j JOIN entries e ON e.id = j.entry_id
        WHERE j.id = ? AND j.entry_id = ? AND j.status = 'running'
          AND j.lease_owner = ? AND j.fencing_token = ? AND j.lease_expires_at > ?
      `).get(`ai:${job.id}:insight_reply`, job.payload.analysisDerivationId, job.payload.textRevision,
        job.id, job.entryId, job.leaseOwner, job.fencingToken, now) as { status: string; current_text_revision: number; committed: number; analysis_current: number } | undefined;
      if (!guard || guard.status === "deleting" || guard.status === "purged" || guard.current_text_revision !== job.payload.textRevision || !guard.analysis_current) {
        database.exec("ROLLBACK");
        return { state: "stale" };
      }
      if (guard.committed) {
        database.exec("COMMIT");
        return { state: "already_committed" };
      }
      const previous = database.prepare("SELECT id, artifact_revision FROM derivations WHERE entry_id = ? AND kind = 'insight_reply' AND is_current = 1").get(job.entryId) as { id: string; artifact_revision: number } | undefined;
      if (previous) database.prepare("UPDATE derivations SET is_current = 0 WHERE id = ?").run(previous.id);
      const derivationId = nextId();
      database.prepare(`
        INSERT INTO derivations(id, entry_id, kind, value_json, text_revision, artifact_revision, supersedes_id, is_current, created_by, prompt_version, schema_version, operation_key, created_at)
        VALUES (?, ?, 'insight_reply', ?, ?, ?, ?, 1, 'ai', ?, 'insight-reply.v1', ?, ?)
      `).run(derivationId, job.entryId, JSON.stringify(reply), job.payload.textRevision, (previous?.artifact_revision ?? 0) + 1, previous?.id ?? null,
        metadata.promptVersion, `ai:${job.id}:insight_reply`, now);
      for (const citation of reply.citations) {
        database.prepare(`
          INSERT INTO artifact_sources(artifact_type, artifact_id, entry_id, quote, created_at)
          VALUES ('derivation', ?, ?, ?, ?)
        `).run(derivationId, citation.entryId, citation.evidenceQuote, now);
      }
      database.prepare(`INSERT INTO ai_runs(id, entry_id, job_id, provider, model, prompt_version, schema_version, latency_ms, input_tokens, output_tokens, provider_request_id, error_code, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`)
        .run(nextId(), job.entryId, job.id, metadata.provider, metadata.model, metadata.promptVersion, metadata.schemaVersion, metadata.latencyMs,
          metadata.inputTokens, metadata.outputTokens, metadata.providerRequestId, now);
      database.prepare(`
        UPDATE external_messages SET result_derivation_id = ?, result_status = 'result_pending',
          result_next_run_at = ?, result_last_error_code = NULL, updated_at = ?
        WHERE provider = 'feishu' AND entry_id = ? AND result_status = 'result_waiting'
      `).run(derivationId, now, now, job.entryId);
      database.exec("COMMIT");
      return { state: "committed", derivationId };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  auditFailure(job: GenerateInsightJobV1, errorCode: ErrorCode): boolean {
    const now = this.options.now?.() ?? new Date().toISOString();
    const nextId = this.options.nextId ?? randomUUID;
    return this.options.database.prepare(`INSERT INTO ai_runs(id, entry_id, job_id, provider, model, prompt_version, schema_version, latency_ms, error_code, created_at)
      SELECT ?, ?, ?, 'unknown', 'unknown', 'insight.v1', 'insight-reply.v1', 0, ?, ? WHERE EXISTS (
        SELECT 1 FROM jobs j JOIN entries e ON e.id = j.entry_id WHERE j.id = ? AND j.entry_id = ? AND j.status = 'running'
          AND j.lease_owner = ? AND j.fencing_token = ? AND j.lease_expires_at > ? AND e.current_text_revision = ? AND e.status = 'ready')`)
      .run(nextId(), job.entryId, job.id, errorCode, now, job.id, job.entryId, job.leaseOwner, job.fencingToken, now, job.payload.textRevision).changes === 1;
  }
}

function toFtsQuery(text: string): string | null {
  const terms = text.normalize("NFKC").match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  const unique = [...new Set(terms.map((term) => term.slice(0, 80)))].slice(0, 12);
  return unique.length ? unique.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ") : null;
}
