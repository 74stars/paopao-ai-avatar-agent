import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  DiagnosticEventV1Schema,
  DiagnosticsExportCreateRequestV1Schema,
  DiagnosticsExportReceiptV1Schema,
  DiagnosticsExportStatusV1Schema,
  ExportCreateRequestV1Schema,
  ExportReceiptV1Schema,
  ExportStatusV1Schema,
  EntitiesValueV1Schema,
  GoalsValueV1Schema,
  InsightReplyV1Schema,
  NextActionsValueV1Schema,
  isUserVisibleGeneratedText,
  validateInsightReplyUserVisibleContent,
  type ClaimedJobV1,
  type DomainEventV1,
} from "@paopao/contracts";
import type { Clock, DomainEventPublisher, IdGenerator, JobExecutionResult, JobExecutor, JobPreflight } from "@paopao/core";
import { GovernanceError } from "./entry-governance-service.js";
import type { SqliteDatabase } from "./sqlite.js";

type ExportRequest = ReturnType<typeof ExportCreateRequestV1Schema.parse>;
type DiagnosticRequest = ReturnType<typeof DiagnosticsExportCreateRequestV1Schema.parse>;
type ExportJob = Extract<ClaimedJobV1, { type: "create_export" }>;
type DiagnosticJob = Extract<ClaimedJobV1, { type: "create_diagnostics_export" }>;

export function createExportService(dependencies: { database: SqliteDatabase; clock: Clock; ids?: IdGenerator }) {
  const ids = dependencies.ids ?? { next: randomUUID };
  return {
    async create(input: ExportRequest) {
      const parsed = ExportCreateRequestV1Schema.safeParse(input);
      if (!parsed.success) throw new GovernanceError("VALIDATION_FAILED", "Export request validation failed");
      const existing = dependencies.database.prepare("SELECT id,status FROM exports WHERE request_id=?").get(parsed.data.requestId) as { id: string; status: string } | undefined;
      if (existing) return ExportReceiptV1Schema.parse({ exportId: existing.id, status: "queued" });
      const exportId = ids.next();
      const jobId = ids.next();
      const now = dependencies.clock.now();
      dependencies.database.exec("BEGIN IMMEDIATE");
      try {
        dependencies.database.prepare("INSERT INTO exports(id,request_id,format,status,created_at,updated_at) VALUES (?,?,?,'queued',?,?)")
          .run(exportId, parsed.data.requestId, parsed.data.format, now, now);
        dependencies.database.prepare(`INSERT INTO jobs(id,type,entry_id,payload_json,idempotency_key,status,max_attempts,next_run_at,created_at,updated_at)
          VALUES (?,'create_export',NULL,?,?,'queued',3,?,?,?)`)
          .run(jobId, JSON.stringify({ schemaVersion: "create-export-job.v1", exportId }), `create_export:${exportId}`, now, now, now);
        dependencies.database.exec("COMMIT");
      } catch (error) { dependencies.database.exec("ROLLBACK"); throw error; }
      return ExportReceiptV1Schema.parse({ exportId, status: "queued" });
    },
    async get(input: { version: 1; exportId: string }) {
      if (input.version !== 1 || !isUuid(input.exportId)) throw new GovernanceError("VALIDATION_FAILED", "Export status request validation failed");
      const exportId = input.exportId;
      const row = dependencies.database.prepare("SELECT id,status,relative_path,sha256,error_code FROM exports WHERE id=?").get(exportId) as { id: string; status: string; relative_path: string | null; sha256: string | null; error_code: string | null } | undefined;
      if (!row) throw new GovernanceError("NOT_FOUND", "Export not found");
      return ExportStatusV1Schema.parse({ exportId: row.id, status: row.status, path: row.relative_path, sha256: row.sha256, errorCode: row.error_code });
    },
  };
}

export function createDiagnosticsService(dependencies: { database: SqliteDatabase; clock: Clock; ids?: IdGenerator }) {
  const ids = dependencies.ids ?? { next: randomUUID };
  return {
    async createExport(input: DiagnosticRequest) {
      const parsed = DiagnosticsExportCreateRequestV1Schema.safeParse(input);
      if (!parsed.success) throw new GovernanceError("VALIDATION_FAILED", "Diagnostics request validation failed");
      const existing = dependencies.database.prepare("SELECT id FROM diagnostic_exports WHERE request_id=?").get(parsed.data.requestId) as { id: string } | undefined;
      if (existing) return DiagnosticsExportReceiptV1Schema.parse({ diagnosticExportId: existing.id, status: "queued" });
      const diagnosticExportId = ids.next();
      const jobId = ids.next();
      const now = dependencies.clock.now();
      dependencies.database.exec("BEGIN IMMEDIATE");
      try {
        dependencies.database.prepare("INSERT INTO diagnostic_exports(id,request_id,include_days,status,created_at,updated_at) VALUES (?,?,?,'queued',?,?)")
          .run(diagnosticExportId, parsed.data.requestId, parsed.data.includeDays, now, now);
        dependencies.database.prepare(`INSERT INTO jobs(id,type,entry_id,payload_json,idempotency_key,status,max_attempts,next_run_at,created_at,updated_at)
          VALUES (?,'create_diagnostics_export',NULL,?,?,'queued',3,?,?,?)`)
          .run(jobId, JSON.stringify({ schemaVersion: "create-diagnostics-export-job.v1", diagnosticExportId }), `create_diagnostics_export:${diagnosticExportId}`, now, now, now);
        dependencies.database.exec("COMMIT");
      } catch (error) { dependencies.database.exec("ROLLBACK"); throw error; }
      return DiagnosticsExportReceiptV1Schema.parse({ diagnosticExportId, status: "queued" });
    },
    async getExport(input: { version: 1; diagnosticExportId: string }) {
      if (input.version !== 1 || !isUuid(input.diagnosticExportId)) throw new GovernanceError("VALIDATION_FAILED", "Diagnostics status request validation failed");
      const diagnosticExportId = input.diagnosticExportId;
      const row = dependencies.database.prepare("SELECT id,status,relative_path,sha256,error_code FROM diagnostic_exports WHERE id=?").get(diagnosticExportId) as { id: string; status: string; relative_path: string | null; sha256: string | null; error_code: string | null } | undefined;
      if (!row) throw new GovernanceError("NOT_FOUND", "Diagnostics export not found");
      return DiagnosticsExportStatusV1Schema.parse({ diagnosticExportId: row.id, status: row.status, path: row.relative_path, sha256: row.sha256, errorCode: row.error_code });
    },
  };
}

abstract class FileJobExecutor implements JobExecutor {
  protected readonly outputDirectory: string;
  constructor(protected readonly database: SqliteDatabase, outputDirectory: string, protected readonly clock: Clock, protected readonly events?: DomainEventPublisher,
    protected readonly appVersion = "0.1.0") {
    this.outputDirectory = resolve(outputDirectory);
    mkdirSync(this.outputDirectory, { recursive: true });
  }
  async preflight(_job: ClaimedJobV1): Promise<JobPreflight> { return { ready: true }; }
  abstract execute(job: ClaimedJobV1, signal: AbortSignal): Promise<JobExecutionResult>;
  protected writeBundle(id: string, files: ReadonlyMap<string, string>, manifest: object, sensitiveValues: readonly string[] = []): { path: string; sha256: string } {
    const directoryName = id;
    const destination = join(this.outputDirectory, directoryName);
    if (relative(this.outputDirectory, destination).startsWith("..") || basename(destination) !== directoryName) throw new Error("Unsafe export path");
    const temporary = join(this.outputDirectory, `.${id}.tmp`);
    rmSync(temporary, { recursive: true, force: true });
    mkdirSync(temporary, { recursive: false, mode: 0o700 });
    const fileManifest: Array<{ path: string; sha256: string }> = [];
    try {
      for (const [file, content] of files) {
        if (file.startsWith("/") || file.split("/").includes("..")) throw new Error("Unsafe bundle member");
        for (const sensitive of sensitiveValues) if (sensitive && content.includes(sensitive)) throw new Error("Sensitive content detected");
        const path = join(temporary, file);
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
        fileManifest.push({ path: file, sha256: hash(content) });
      }
      const manifestContent = `${JSON.stringify({ ...manifest, files: fileManifest }, null, 2)}\n`;
      writeFileSync(join(temporary, "manifest.json"), manifestContent, { encoding: "utf8", mode: 0o600 });
      for (const sensitive of sensitiveValues) {
        if (sensitive && scanDirectoryFiles(temporary).some((content) => content.includes(sensitive))) throw new Error("Sensitive content detected after write");
      }
      if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
      renameSync(temporary, destination);
      return { path: directoryName, sha256: hash(manifestContent) };
    } catch (error) {
      rmSync(temporary, { recursive: true, force: true });
      throw error;
    }
  }
  protected failure(code: "EXPORT_FAILED" | "DIAGNOSTICS_EXPORT_FAILED", message: string): JobExecutionResult {
    return { outcome: "failed_final", error: { code, retryable: false, message, correlationId: randomUUID() } };
  }
}

export class CreateExportJobExecutor extends FileJobExecutor {
  async execute(candidate: ClaimedJobV1, _signal: AbortSignal): Promise<JobExecutionResult> {
    const job = asExport(candidate);
    if (!jobIsCurrent(this.database, job, this.clock.now())) return { outcome: "succeeded" };
    const row = this.database.prepare("SELECT format FROM exports WHERE id=?").get(job.payload.exportId) as { format: "json" | "markdown" } | undefined;
    if (!row) return this.failure("EXPORT_FAILED", "Export record is unavailable");
    this.database.prepare("UPDATE exports SET status='running',updated_at=? WHERE id=?").run(this.clock.now(), job.payload.exportId);
    try {
      const records = exportRecords(this.database);
      const files = new Map<string, string>([["entries.json", `${JSON.stringify({ version: 1, entries: records }, null, 2)}\n`]]);
      if (row.format === "markdown") for (const record of records) files.set(`entries/${record.id}.md`, markdownEntry(record));
      const result = this.writeBundle(job.payload.exportId, files,
        { schemaVersion: "paopao-export.v1", contractVersion: "v1", appVersion: this.appVersion, exportId: job.payload.exportId, format: row.format, createdAt: this.clock.now(), entryCount: records.length });
      this.database.prepare("UPDATE exports SET status='ready',relative_path=?,sha256=?,error_code=NULL,updated_at=? WHERE id=?")
        .run(result.path, result.sha256, this.clock.now(), job.payload.exportId);
      await emit(this.events, { version: 1, type: "export:ready", exportId: job.payload.exportId, occurredAt: this.clock.now() });
      return { outcome: "succeeded" };
    } catch {
      this.database.prepare("UPDATE exports SET status='failed',relative_path=NULL,sha256=NULL,error_code='EXPORT_FAILED',updated_at=? WHERE id=?").run(this.clock.now(), job.payload.exportId);
      await emit(this.events, { version: 1, type: "export:failed", exportId: job.payload.exportId, errorCode: "EXPORT_FAILED", occurredAt: this.clock.now() });
      return this.failure("EXPORT_FAILED", "Export creation failed");
    }
  }
}

export class CreateDiagnosticsExportJobExecutor extends FileJobExecutor {
  constructor(database: SqliteDatabase, outputDirectory: string, clock: Clock, private readonly readEvents: (since: string) => readonly unknown[],
    private readonly sensitiveValues: () => readonly string[], events?: DomainEventPublisher, appVersion?: string) {
    super(database, outputDirectory, clock, events, appVersion);
  }
  async execute(candidate: ClaimedJobV1, _signal: AbortSignal): Promise<JobExecutionResult> {
    const job = asDiagnostics(candidate);
    if (!jobIsCurrent(this.database, job, this.clock.now())) return { outcome: "succeeded" };
    const row = this.database.prepare("SELECT include_days FROM diagnostic_exports WHERE id=?").get(job.payload.diagnosticExportId) as { include_days: number } | undefined;
    if (!row) return this.failure("DIAGNOSTICS_EXPORT_FAILED", "Diagnostics record is unavailable");
    this.database.prepare("UPDATE diagnostic_exports SET status='running',updated_at=? WHERE id=?").run(this.clock.now(), job.payload.diagnosticExportId);
    try {
      const since = new Date(Date.parse(this.clock.now()) - row.include_days * 86_400_000).toISOString();
      const diagnosticEvents = this.readEvents(since).map((item) => DiagnosticEventV1Schema.safeParse(item)).filter((item) => item.success && item.data.timestamp >= since).map((item) => item.data);
      const files = new Map<string, string>([
        ["runtime.json", `${JSON.stringify(runtimeReport(this.database), null, 2)}\n`],
        ["events.jsonl", diagnosticEvents.map((event) => JSON.stringify(event)).join("\n") + (diagnosticEvents.length ? "\n" : "")],
        ["delivery-issues.json", `${JSON.stringify(deliveryIssues(this.database), null, 2)}\n`],
      ]);
      const result = this.writeBundle(job.payload.diagnosticExportId, files,
        { schemaVersion: "paopao-diagnostics.v1", contractVersion: "v1", appVersion: this.appVersion, databaseSchemaVersion: runtimeReport(this.database).schemaVersion, diagnosticExportId: job.payload.diagnosticExportId, createdAt: this.clock.now(), includeDays: row.include_days }, this.sensitiveValues());
      this.database.prepare("UPDATE diagnostic_exports SET status='ready',relative_path=?,sha256=?,error_code=NULL,updated_at=? WHERE id=?")
        .run(result.path, result.sha256, this.clock.now(), job.payload.diagnosticExportId);
      await emit(this.events, { version: 1, type: "diagnostics:ready", diagnosticExportId: job.payload.diagnosticExportId, occurredAt: this.clock.now() });
      return { outcome: "succeeded" };
    } catch {
      this.database.prepare("UPDATE diagnostic_exports SET status='failed',relative_path=NULL,sha256=NULL,error_code='DIAGNOSTICS_EXPORT_FAILED',updated_at=? WHERE id=?").run(this.clock.now(), job.payload.diagnosticExportId);
      await emit(this.events, { version: 1, type: "diagnostics:failed", diagnosticExportId: job.payload.diagnosticExportId, errorCode: "DIAGNOSTICS_EXPORT_FAILED", occurredAt: this.clock.now() });
      return this.failure("DIAGNOSTICS_EXPORT_FAILED", "Diagnostics export failed");
    }
  }
}

export function createExportJobExecutor(d: { database: SqliteDatabase; outputDirectory: string; clock: Clock; appVersion?: string; events?: DomainEventPublisher }) { return new CreateExportJobExecutor(d.database, d.outputDirectory, d.clock, d.events, d.appVersion); }
export function createDiagnosticsJobExecutor(d: { database: SqliteDatabase; outputDirectory: string; clock: Clock; appVersion?: string; readEvents: (since: string) => readonly unknown[]; sensitiveValues?: () => readonly string[]; events?: DomainEventPublisher }) { return new CreateDiagnosticsExportJobExecutor(d.database, d.outputDirectory, d.clock, d.readEvents, d.sensitiveValues ?? (() => []), d.events, d.appVersion); }

type ExportEntryRow = { id: string; source: "desktop" | "feishu"; capture_mode: "remember" | "think"; created_at: string; updated_at: string; text: string; memory_type: "diary" | "thought" | "person" | "reading" | "goal" | "other" | null; summary: string | null };
type ExportVersionRow = { revision: number; text: string; created_at: string };
type ExportDerivationRow = { kind: string; value_json: string };
type UserExportEntryV1 = {
  id: string;
  source: ExportEntryRow["source"];
  mode: ExportEntryRow["capture_mode"];
  createdAt: string;
  updatedAt: string;
  text: string;
  originalText: string;
  category: ExportEntryRow["memory_type"];
  summary: string | null;
  versions: Array<{ number: number; text: string; createdAt: string }>;
  organized: {
    entities: Array<{ type: string; name: string }>;
    goals: string[];
    nextActions: Array<{ title: string; dueHint: string | null }>;
    insight: { text: string; nextAction: string | null; evidenceQuotes: string[] } | null;
  };
  evidenceQuotes: string[];
};

function exportRecords(database: SqliteDatabase): UserExportEntryV1[] {
  const entries = database.prepare(`SELECT e.id,e.source,e.capture_mode,e.created_at,e.updated_at,r.text,m.memory_type,m.summary
    FROM entries e JOIN entry_text_revisions r ON r.entry_id=e.id AND r.revision=e.current_text_revision
    LEFT JOIN memories m ON m.entry_id=e.id WHERE e.status NOT IN ('deleting','purged') ORDER BY e.created_at,e.id`).all() as ExportEntryRow[];
  return entries.map((entry) => {
    const versions = database.prepare("SELECT revision,text,created_at FROM entry_text_revisions WHERE entry_id=? ORDER BY revision").all(entry.id) as ExportVersionRow[];
    const evidenceRows = database.prepare("SELECT DISTINCT quote FROM artifact_sources WHERE entry_id=? ORDER BY quote").all(entry.id) as Array<{ quote: string }>;
    return {
      id: entry.id,
      source: entry.source,
      mode: entry.capture_mode,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
      text: entry.text,
      originalText: versions[0]?.text ?? entry.text,
      category: entry.memory_type,
      summary: entry.summary && isUserVisibleGeneratedText(entry.summary) ? entry.summary : null,
      versions: versions.map((version) => ({ number: version.revision, text: version.text, createdAt: version.created_at })),
      organized: exportOrganizedData(database, entry.id),
      evidenceQuotes: evidenceRows.map((row) => row.quote),
    };
  });
}

function exportOrganizedData(database: SqliteDatabase, entryId: string): UserExportEntryV1["organized"] {
  const organized: UserExportEntryV1["organized"] = { entities: [], goals: [], nextActions: [], insight: null };
  const rows = database.prepare("SELECT kind,value_json FROM derivations WHERE entry_id=? AND is_current=1 ORDER BY created_at,id").all(entryId) as ExportDerivationRow[];
  for (const row of rows) {
    let candidate: unknown;
    try { candidate = JSON.parse(row.value_json) as unknown; } catch { continue; }
    if (row.kind === "entities") {
      const parsed = EntitiesValueV1Schema.safeParse(candidate);
      if (parsed.success) organized.entities = parsed.data.items.filter((item) => isUserVisibleGeneratedText(item.name)).map((item) => ({ type: item.type, name: item.name }));
    } else if (row.kind === "goals") {
      const parsed = GoalsValueV1Schema.safeParse(candidate);
      if (parsed.success) organized.goals = parsed.data.items.map((item) => item.title).filter(isUserVisibleGeneratedText);
    } else if (row.kind === "next_actions") {
      const parsed = NextActionsValueV1Schema.safeParse(candidate);
      if (parsed.success) organized.nextActions = parsed.data.items.filter((item) => isUserVisibleGeneratedText(item.title) && (!item.dueHint || isUserVisibleGeneratedText(item.dueHint))).map((item) => ({ title: item.title, dueHint: item.dueHint }));
    } else if (row.kind === "insight_reply") {
      const parsed = InsightReplyV1Schema.safeParse(candidate);
      if (parsed.success && validateInsightReplyUserVisibleContent(parsed.data)) organized.insight = { text: parsed.data.text, nextAction: parsed.data.nextAction?.title ?? null, evidenceQuotes: parsed.data.citations.map((citation) => citation.evidenceQuote) };
    }
  }
  return organized;
}

function markdownEntry(item: UserExportEntryV1): string {
  const lines = [
    `# ${recordTitle(item)}`,
    "",
    item.text,
    "",
    `- 分类：${categoryLabel(item.category)}`,
    `- 记录入口：${item.source === "desktop" ? "桌面端" : "飞书"}`,
    `- 记录时间：${item.createdAt}`,
  ];
  if (item.originalText !== item.text) lines.push("", "## 原始记录", "", item.originalText);
  if (item.organized.goals.length > 0) lines.push("", "## 目标", "", ...item.organized.goals.map((goal) => `- ${goal}`));
  if (item.organized.nextActions.length > 0) lines.push("", "## 下一步", "", ...item.organized.nextActions.map((action) => `- ${action.title}${action.dueHint ? `（${action.dueHint}）` : ""}`));
  return `${lines.join("\n")}\n`;
}

function recordTitle(item: UserExportEntryV1): string {
  const candidate = item.summary ?? item.text;
  return Array.from(candidate.trim().split(/\r?\n/u)[0] || "记录").slice(0, 80).join("");
}

function categoryLabel(category: UserExportEntryV1["category"]): string {
  if (category === null) return "未分类";
  return ({ diary: "日记", thought: "思想", person: "人物", reading: "阅读", goal: "目标", other: "其他" } as const)[category];
}
function asExport(job: ClaimedJobV1): ExportJob { if (job.type !== "create_export") throw new Error("Wrong job type"); return job; }
function asDiagnostics(job: ClaimedJobV1): DiagnosticJob { if (job.type !== "create_diagnostics_export") throw new Error("Wrong job type"); return job; }
async function emit(events: DomainEventPublisher | undefined, event: DomainEventV1) { try { await events?.publish(event); } catch {} }
function jobIsCurrent(database: SqliteDatabase, job: ClaimedJobV1, now: string): boolean {
  return Boolean(database.prepare("SELECT 1 found FROM jobs WHERE id=? AND status='running' AND lease_owner=? AND fencing_token=? AND lease_expires_at>?")
    .get(job.id, job.leaseOwner, job.fencingToken, now));
}
function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value); }
function hash(content: string): string { return createHash("sha256").update(content, "utf8").digest("hex"); }
function scanDirectoryFiles(directory: string): string[] { return ["runtime.json", "events.jsonl", "delivery-issues.json", "manifest.json"].filter((file) => existsSync(join(directory, file))).map((file) => readFileSync(join(directory, file), "utf8")); }
function runtimeReport(database: SqliteDatabase) {
  return { databaseIntegrity: database.pragma("integrity_check", { simple: true }), jobCounts: database.prepare("SELECT status,count(*) count FROM jobs GROUP BY status ORDER BY status").all(), schemaVersion: (database.prepare("SELECT max(version) version FROM schema_migrations").get() as any).version };
}
function deliveryIssues(database: SqliteDatabase) {
  const salt = randomBytes(16).toString("hex");
  const rows = database.prepare(`SELECT message_key,ack_status,ack_attempts,ack_last_error_code,result_status,result_attempts,result_last_error_code,updated_at FROM external_messages
    WHERE ack_status IN ('ack_ambiguous','ack_failed_final') OR result_status IN ('result_ambiguous','result_failed_final')`).all() as any[];
  return rows.flatMap((row) => ([
    ...(row.ack_status === "ack_ambiguous" || row.ack_status === "ack_failed_final" ? [{ messageKeyHash: hash(`${salt}:${row.message_key}`), phase: "ack", status: row.ack_status.slice(4), attempts: row.ack_attempts, errorCode: row.ack_last_error_code, updatedAt: row.updated_at }] : []),
    ...(row.result_status === "result_ambiguous" || row.result_status === "result_failed_final" ? [{ messageKeyHash: hash(`${salt}:${row.message_key}`), phase: "result", status: row.result_status.slice(7), attempts: row.result_attempts, errorCode: row.result_last_error_code, updatedAt: row.updated_at }] : []),
  ]));
}
