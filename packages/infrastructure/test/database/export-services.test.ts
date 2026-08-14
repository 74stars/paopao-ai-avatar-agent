import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createCaptureService } from "../../../core/src/index.js";
import { SqliteCaptureUnitOfWork } from "../../src/database/capture-unit-of-work.js";
import { createDiagnosticsJobExecutor, createDiagnosticsService, createExportJobExecutor, createExportService } from "../../src/database/export-services.js";
import { createTemporaryDatabase } from "../../src/database/test-database.js";
import { SqliteJobRepository } from "../../src/scheduler/sqlite-job-repository.js";

const migrationsDirectory = fileURLToPath(new URL("../../src/database/migrations", import.meta.url));
const now = "2026-08-07T00:00:00.000Z";
const clock = { now: () => now };

test("JSON/Markdown exports use a public field whitelist while excluding deleted entries", async () => {
  for (const format of ["json", "markdown"] as const) {
    const temporary = createTemporaryDatabase({ migrationsDirectory, now: clock.now });
    try {
      const outputDirectory = join(temporary.directory, "exports"); mkdirSync(outputDirectory);
      const capture = createCaptureService({ unitOfWork: new SqliteCaptureUnitOfWork({ database: temporary.database, clock, ids: { next: randomUUID } }), clock, events: { publish() {} } });
      const liveId = randomUUID();
      const live = await capture.capture({ version: 1, requestId: liveId, source: "desktop", modality: "text", rawText: "Visible export body", mode: "remember", receivedAt: now, sourceKey: `desktop:${liveId}` });
      const deletedId = randomUUID();
      const deleted = await capture.capture({ version: 1, requestId: deletedId, source: "desktop", modality: "text", rawText: "DELETED_EXPORT_SECRET", mode: "remember", receivedAt: now, sourceKey: `desktop:${deletedId}` });
      temporary.database.prepare("UPDATE entries SET status='deleting' WHERE id=?").run(deleted.entryId);
      temporary.database.prepare("UPDATE jobs SET status='succeeded' WHERE type='analyze_entry'").run();
      const service = createExportService({ database: temporary.database, clock });
      const request = { version: 1 as const, requestId: randomUUID(), format, includeDeleted: false as const };
      const receipt = await service.create(request);
      assert.deepEqual(await service.create(request), receipt);
      const repository = new SqliteJobRepository(temporary.database, clock);
      const job = repository.claimNext("export", 60_000, now); assert.ok(job?.type === "create_export"); repository.startAttempt(job.id, job.leaseOwner, job.fencingToken);
      assert.equal((await createExportJobExecutor({ database: temporary.database, outputDirectory, clock }).execute(job, new AbortController().signal)).outcome, "succeeded");
      repository.succeed(job.id, job.leaseOwner, job.fencingToken);
      const status = await service.get({ version: 1, exportId: receipt.exportId });
      assert.equal(status.status, "ready");
      if (status.status !== "ready") throw new Error("expected ready export");
      assert.equal(status.path.includes("/"), false);
      const content = readFileSync(join(outputDirectory, status.path, "entries.json"), "utf8");
      assert.equal(content.includes("Visible export body"), true);
      assert.equal(content.includes("DELETED_EXPORT_SECRET"), false);
      const payload = JSON.parse(content) as { version: number; entries: Array<Record<string, unknown>> };
      assert.equal(payload.version, 1);
      assert.equal(payload.entries.length, 1);
      assert.deepEqual(Object.keys(payload.entries[0]!).sort(), ["category", "createdAt", "evidenceQuotes", "id", "mode", "organized", "originalText", "source", "summary", "text", "updatedAt", "versions"]);
      for (const internalName of ["value_json", "text_revision", "artifact_revision", "supersedes_id", "is_current", "created_by", "derivations", "sources"]) {
        assert.equal(content.includes(internalName), false, `must not export internal field ${internalName}`);
      }
      if (format === "markdown") {
        const markdown = readFileSync(join(outputDirectory, status.path, "entries", `${live.entryId}.md`), "utf8");
        assert.match(markdown, /记录入口：桌面端/);
        assert.match(markdown, /记录时间：/);
        assert.doesNotMatch(markdown, /- Type:|- Source:|- Created:/);
      }
      const manifestContent = readFileSync(join(outputDirectory, status.path, "manifest.json"), "utf8");
      assert.equal(createHash("sha256").update(manifestContent).digest("hex"), status.sha256);
      const manifest = JSON.parse(manifestContent);
      assert.equal(manifest.files.find((file: any) => file.path === "entries.json").sha256, createHash("sha256").update(content).digest("hex"));
      assert.equal(manifest.entryCount, 1);
      assert.equal(live.entryId.length > 0, true);
    } finally { temporary.close(); }
  }
});

test("diagnostics export whitelists contract events and fails closed on source failure", async () => {
  const temporary = createTemporaryDatabase({ migrationsDirectory, now: clock.now });
  try {
    const outputDirectory = join(temporary.directory, "diagnostics"); mkdirSync(outputDirectory);
    const service = createDiagnosticsService({ database: temporary.database, clock });
    const receipt = await service.createExport({ version: 1, requestId: randomUUID(), includeDays: 2 });
    const repository = new SqliteJobRepository(temporary.database, clock);
    const job = repository.claimNext("diagnostics", 60_000, now); assert.ok(job?.type === "create_diagnostics_export"); repository.startAttempt(job.id, job.leaseOwner, job.fencingToken);
    const correlationId = randomUUID();
    const executor = createDiagnosticsJobExecutor({ database: temporary.database, outputDirectory, clock, readEvents: () => [
      { timestamp: now, level: "info", event: "worker.completed", correlationId, attempts: 1 },
      { timestamp: now, level: "error", event: "unsafe", correlationId: randomUUID(), rawText: "TEST_API_KEY_SECRET" },
    ] });
    assert.equal((await executor.execute(job, new AbortController().signal)).outcome, "succeeded");
    repository.succeed(job.id, job.leaseOwner, job.fencingToken);
    const status = await service.getExport({ version: 1, diagnosticExportId: receipt.diagnosticExportId });
    assert.equal(status.status, "ready");
    if (status.status !== "ready") throw new Error("expected ready diagnostics");
    const content = readFileSync(join(outputDirectory, status.path, "events.jsonl"), "utf8");
    assert.equal(content.includes("worker.completed"), true);
    assert.equal(content.includes("TEST_API_KEY_SECRET"), false);

    const failed = await service.createExport({ version: 1, requestId: randomUUID(), includeDays: 1 });
    const failedJob = repository.claimNext("diagnostics", 60_000, now); assert.ok(failedJob?.type === "create_diagnostics_export"); repository.startAttempt(failedJob.id, failedJob.leaseOwner, failedJob.fencingToken);
    const result = await createDiagnosticsJobExecutor({ database: temporary.database, outputDirectory, clock, readEvents: () => { throw new Error("log unavailable"); } }).execute(failedJob, new AbortController().signal);
    assert.equal(result.outcome, "failed_final");
    assert.equal((await service.getExport({ version: 1, diagnosticExportId: failed.diagnosticExportId })).status, "failed");

    const canary = await service.createExport({ version: 1, requestId: randomUUID(), includeDays: 1 });
    const canaryJob = repository.claimNext("diagnostics", 60_000, now); assert.ok(canaryJob?.type === "create_diagnostics_export"); repository.startAttempt(canaryJob.id, canaryJob.leaseOwner, canaryJob.fencingToken);
    const secret = "DIAGNOSTIC_CANARY_SECRET";
    const canaryResult = await createDiagnosticsJobExecutor({ database: temporary.database, outputDirectory, clock,
      readEvents: () => [{ timestamp: now, level: "info", event: "provider.call", correlationId: randomUUID(), providerRequestId: secret }], sensitiveValues: () => [secret] }).execute(canaryJob, new AbortController().signal);
    assert.equal(canaryResult.outcome, "failed_final");
    assert.equal((await service.getExport({ version: 1, diagnosticExportId: canary.diagnosticExportId })).status, "failed");
  } finally { temporary.close(); }
});
