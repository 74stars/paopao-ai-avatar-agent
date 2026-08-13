import {
  ClassificationValueV1Schema,
  DerivationV1Schema,
  EntitiesValueV1Schema,
  EntryDetailV1Schema,
  EntryListResponseV1Schema,
  ErrorCodeSchema,
  InsightReplyV1Schema,
  LibrarySummaryV1Schema,
  type EntryDetailV1,
  type EntryListRequestV1,
  type EntryListResponseV1,
  type MemoryType,
  NextActionsValueV1Schema,
  SummaryValueV1Schema,
  GoalsValueV1Schema,
} from "@paopao/contracts";
import type { SqliteDatabase } from "./sqlite.js";

type LibrarySummaryV1 = ReturnType<typeof LibrarySummaryV1Schema.parse>;
type CreatedBy = EntryDetailV1["textRevisions"][number]["createdBy"];
type DerivationKind = EntryDetailV1["derivations"][number]["kind"];

type EntryRow = {
  id: string;
  source: "desktop" | "feishu";
  raw_text: string | null;
  status: EntryDetailV1["status"];
  current_text_revision: number;
  created_at: string;
  updated_at: string;
  last_error_code: string | null;
};

type CurrentTextRow = { text: string; revision: number };

type ListRow = EntryRow & {
  current_text: string | null;
  summary: string | null;
  memory_type: MemoryType | null;
};

type DerivationRow = {
  id: string;
  kind: DerivationKind;
  value_json: string;
  text_revision: number;
  artifact_revision: number;
  supersedes_id: string | null;
  is_current: number;
  created_by: CreatedBy;
  prompt_version: string | null;
  schema_version: string;
  created_at: string;
};

const MEMORY_TYPES: readonly MemoryType[] = ["diary", "thought", "person", "reading", "goal", "other"];
const ACTIVE_JOB_STATUSES = ["running", "queued", "waiting_for_network", "waiting_for_configuration", "retry_wait", "failed_final"] as const;

const DERIVATION_SCHEMAS = {
  classification: ClassificationValueV1Schema,
  summary: SummaryValueV1Schema,
  entities: EntitiesValueV1Schema,
  goals: GoalsValueV1Schema,
  next_actions: NextActionsValueV1Schema,
  insight_reply: InsightReplyV1Schema,
} as const;

function truncate(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join("");
}

function titleFor(text: string): string {
  const sentence = text.split(/[.!?。！？\n]/u)[0] ?? text;
  const candidate = sentence.trim() || text.split(/\r?\n/u).find((line) => line.trim())?.trim() || text.trim();
  return truncate(candidate, 80);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, "\\$&");
}

function ftsQuery(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function errorCodeOrNull(value: unknown): EntryDetailV1["activeJobs"][number]["lastErrorCode"] {
  if (value == null) return null;
  const parsed = ErrorCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object") throw new Error("invalid cursor");
    const record = decoded as Record<string, unknown>;
    if (typeof record.createdAt !== "string" || typeof record.id !== "string" || !record.id) throw new Error("invalid cursor");
    return { createdAt: record.createdAt, id: record.id };
  } catch {
    throw new Error("Invalid entry cursor");
  }
}

function currentText(database: SqliteDatabase, entry: EntryRow): CurrentTextRow {
  const revision = database.prepare("SELECT text, revision FROM entry_text_revisions WHERE entry_id = ? AND revision = ?").get(entry.id, entry.current_text_revision) as CurrentTextRow | undefined;
  if (revision) return revision;
  return { text: entry.raw_text ?? "", revision: entry.current_text_revision };
}

function parseCurrentDerivations(database: SqliteDatabase, entryId: string): Map<string, DerivationRow & { value: unknown }> {
  const rows = database.prepare("SELECT id, kind, value_json, text_revision, artifact_revision, supersedes_id, is_current, created_by, prompt_version, schema_version, created_at FROM derivations WHERE entry_id = ? AND is_current = 1").all(entryId) as DerivationRow[];
  const result = new Map<string, DerivationRow & { value: unknown }>();
  for (const row of rows) {
    const schema = DERIVATION_SCHEMAS[row.kind as keyof typeof DERIVATION_SCHEMAS];
    try {
      const value = JSON.parse(row.value_json) as unknown;
      if (!schema.safeParse(value).success) continue;
      result.set(row.kind, { ...row, value });
    } catch {
      // Corrupt derivations are omitted from the DTO; the raw Entry remains readable.
    }
  }
  return result;
}

function parseDerivation(row: DerivationRow): EntryDetailV1["derivations"][number] | null {
  try {
    const value = JSON.parse(row.value_json) as unknown;
    const parsed = DerivationV1Schema.safeParse({
      id: row.id,
      kind: row.kind,
      value,
      textRevision: row.text_revision,
      artifactRevision: row.artifact_revision,
      supersedesId: row.supersedes_id,
      isCurrent: row.is_current === 1,
      createdBy: row.created_by,
      promptVersion: row.prompt_version,
      schemaVersion: row.schema_version,
      createdAt: row.created_at,
    });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export class SqliteEntryQueryService {
  readonly #database: SqliteDatabase;

  constructor(database: SqliteDatabase) {
    this.#database = database;
  }

  list(request: EntryListRequestV1): EntryListResponseV1 {
    const limit = request.limit ?? 30;
    const parameters: unknown[] = [];
    const where = ["e.status NOT IN ('deleting', 'purged')"];

    if (request.sources?.length) {
      where.push(`e.source IN (${request.sources.map(() => "?").join(",")})`);
      parameters.push(...request.sources);
    }
    if (request.statuses?.length) {
      where.push(`e.status IN (${request.statuses.map(() => "?").join(",")})`);
      parameters.push(...request.statuses);
    }
    if (request.types?.length) {
      where.push(`m.memory_type IN (${request.types.map(() => "?").join(",")})`);
      parameters.push(...request.types);
    }

    const search = request.query?.trim() ?? "";
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      if (Array.from(search).length >= 3) {
        where.push("(EXISTS (SELECT 1 FROM entry_search s WHERE s.entry_id = e.id AND entry_search MATCH ?) OR COALESCE(r.text, e.raw_text, '') LIKE ? ESCAPE '\\' OR COALESCE(m.summary, '') LIKE ? ESCAPE '\\')");
        parameters.push(ftsQuery(search), pattern, pattern);
      } else {
        where.push("(COALESCE(r.text, e.raw_text, '') LIKE ? ESCAPE '\\' OR COALESCE(m.summary, '') LIKE ? ESCAPE '\\')");
        parameters.push(pattern, pattern);
      }
    }

    let cursor: { createdAt: string; id: string } | undefined;
    if (request.cursor) {
      cursor = decodeCursor(request.cursor);
      where.push("(e.created_at < ? OR (e.created_at = ? AND e.id < ?))");
      parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }

    const rows = this.#database.prepare(`
      SELECT e.id, e.source, e.raw_text, e.status, e.current_text_revision,
        e.created_at, e.updated_at, e.last_error_code,
        r.text AS current_text, m.summary, m.memory_type
      FROM entries e
      LEFT JOIN entry_text_revisions r ON r.entry_id = e.id AND r.revision = e.current_text_revision
      LEFT JOIN memories m ON m.entry_id = e.id
      WHERE ${where.join(" AND ")}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ?
    `).all(...parameters, limit + 1) as ListRow[];

    const hasNext = rows.length > limit;
    const page = rows.slice(0, limit);
    const items = page.map((row) => {
      const text = row.current_text ?? row.raw_text ?? "";
      const summary = row.summary == null ? null : truncate(row.summary, 500);
      return {
        id: row.id,
        source: row.source,
        currentTextPreview: truncate(text, 240),
        title: titleFor(text),
        summary,
        memoryType: row.memory_type,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        latestRevision: row.current_text_revision,
        lastErrorCode: errorCodeOrNull(row.last_error_code),
      };
    });
    const nextCursor = hasNext && page.length > 0 ? encodeCursor(page.at(-1)!.created_at, page.at(-1)!.id) : null;
    return EntryListResponseV1Schema.parse({ items, nextCursor });
  }

  get(entryId: string): EntryDetailV1 {
    const row = this.#database.prepare("SELECT id, source, raw_text, status, current_text_revision, created_at, updated_at, last_error_code FROM entries WHERE id = ? AND status NOT IN ('deleting', 'purged')").get(entryId) as EntryRow | undefined;
    if (!row) throw new Error("Entry not found");
    const current = currentText(this.#database, row);
    const revisions = this.#database.prepare("SELECT revision, text, created_by, created_at FROM entry_text_revisions WHERE entry_id = ? ORDER BY revision ASC").all(entryId) as Array<{ revision: number; text: string; created_by: CreatedBy; created_at: string }>;
    const derivationRows = this.#database.prepare("SELECT id, kind, value_json, text_revision, artifact_revision, supersedes_id, is_current, created_by, prompt_version, schema_version, created_at FROM derivations WHERE entry_id = ? ORDER BY created_at ASC, id ASC").all(entryId) as DerivationRow[];
    const derivations = derivationRows.map(parseDerivation).filter((value): value is NonNullable<typeof value> => value !== null);
    const currentDerivations = parseCurrentDerivations(this.#database, entryId);

    const classification = currentDerivations.get("classification")?.value as { inputType: MemoryType; confidence: number; evidence: string } | undefined;
    const summary = currentDerivations.get("summary")?.value as { text: string; confidence: number; evidence: string[] } | undefined;
    const memoryRow = this.#database.prepare("SELECT memory_type, summary, confidence FROM memories WHERE entry_id = ?").get(entryId) as { memory_type: MemoryType; summary: string; confidence: number } | undefined;
    const memory = classification && summary
      ? { type: classification.inputType, summary: truncate(summary.text, 500), confidence: Math.min(classification.confidence, summary.confidence) }
      : memoryRow && memoryRow.summary.trim()
        ? { type: memoryRow.memory_type, summary: truncate(memoryRow.summary, 500), confidence: memoryRow.confidence }
        : null;

    const sources = (this.#database.prepare(`
      SELECT s.artifact_type, s.artifact_id, s.entry_id, s.quote
      FROM artifact_sources s
      WHERE (s.artifact_type = 'derivation' AND EXISTS (
          SELECT 1 FROM derivations d WHERE d.id = s.artifact_id AND d.entry_id = ?
        )) OR (s.artifact_type = 'memory' AND EXISTS (
          SELECT 1 FROM memories m WHERE m.id = s.artifact_id AND m.entry_id = ?
        ))
      ORDER BY s.created_at ASC, s.artifact_id ASC, s.entry_id ASC, s.quote ASC
    `).all(entryId, entryId) as Array<{ artifact_type: "derivation" | "memory"; artifact_id: string; entry_id: string; quote: string }>).map((source) => ({ artifactType: source.artifact_type, artifactId: source.artifact_id, entryId: source.entry_id, quote: source.quote })).filter((source) => {
      return source.quote.length > 0 && source.quote.length <= 500 && isUuid(source.artifactId) && isUuid(source.entryId);
    });
    const activeJobs = (this.#database.prepare(`
      SELECT id, type, status, attempts, next_run_at, last_error_code
      FROM jobs WHERE entry_id = ? AND status IN (${ACTIVE_JOB_STATUSES.map(() => "?").join(",")})
      ORDER BY CASE WHEN status = 'running' THEN 0 ELSE 1 END, created_at ASC, id ASC
    `).all(entryId, ...ACTIVE_JOB_STATUSES) as Array<{ id: string; type: EntryDetailV1["activeJobs"][number]["type"]; status: EntryDetailV1["activeJobs"][number]["status"]; attempts: number; next_run_at: string | null; last_error_code: string | null }>).map((job) => ({ id: job.id, type: job.type, status: job.status, attempts: job.attempts, nextRunAt: job.next_run_at, lastErrorCode: errorCodeOrNull(job.last_error_code) }));

    return EntryDetailV1Schema.parse({
      id: row.id,
      source: row.source,
      rawText: row.raw_text ?? "",
      currentText: current.text,
      textRevisions: revisions.map((revision) => ({ revision: revision.revision, text: revision.text, createdBy: revision.created_by, createdAt: revision.created_at })),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      memory,
      derivations,
      sources,
      activeJobs,
    });
  }

  summary(): LibrarySummaryV1 {
    const total = (this.#database.prepare("SELECT count(*) AS count FROM entries WHERE status NOT IN ('deleting', 'purged')").get() as { count: number }).count;
    const rows = this.#database.prepare("SELECT memory_type AS type, count(*) AS count FROM memories m JOIN entries e ON e.id = m.entry_id WHERE e.status NOT IN ('deleting', 'purged') GROUP BY memory_type").all() as Array<{ type: MemoryType; count: number }>;
    const counts = new Map(rows.map((row) => [row.type, row.count]));
    return { total, shelves: MEMORY_TYPES.filter((type) => (counts.get(type) ?? 0) > 0).map((type) => ({ type, count: counts.get(type)! })) };
  }
}

export function createEntryQueryService(database: SqliteDatabase): SqliteEntryQueryService {
  return new SqliteEntryQueryService(database);
}
