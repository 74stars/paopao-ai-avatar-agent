import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createBackupService } from "../../src/backup/backup-service.js";
import { createCaptureService } from "../../../core/src/index.js";
import { SqliteAnalysisUnitOfWork } from "../../src/database/analysis-unit-of-work.js";
import { SqliteCaptureUnitOfWork } from "../../src/database/capture-unit-of-work.js";
import { createEntryDeletionService, createPurgeEntryJobExecutor } from "../../src/database/deletion-service.js";
import type { SqliteDatabase } from "../../src/database/sqlite.js";
import { createTemporaryDatabase } from "../../src/database/test-database.js";
import { SqliteJobRepository } from "../../src/scheduler/sqlite-job-repository.js";

const migrationsDirectory = fileURLToPath(new URL("../../src/database/migrations", import.meta.url));
const now = "2026-08-07T00:00:00.000Z";
const clock = { now: () => now };

function insertReadyEntry(database: SqliteDatabase, entryId: string, text: string): void {
  database.prepare(`
    INSERT INTO entries(id,source,source_key,modality,raw_text,raw_checksum,capture_mode,status,current_text_revision,created_at,updated_at)
    VALUES (?,'desktop',?,'text',?,'checksum','remember','ready',1,?,?)
  `).run(entryId, `desktop:${entryId}`, text, now, now);
  database.prepare(`
    INSERT INTO entry_text_revisions(entry_id,revision,text,checksum,created_by,operation_key,created_at)
    VALUES (?,1,?,'checksum','user',?,?)
  `).run(entryId, text, `capture:${entryId}:revision:1`, now);
}

function insertDerivation(database: SqliteDatabase, derivationId: string, entryId: string, kind: "classification" | "summary" | "insight_reply"): void {
  database.prepare(`
    INSERT INTO derivations(id,entry_id,kind,value_json,text_revision,artifact_revision,is_current,created_by,prompt_version,schema_version,operation_key,created_at)
    VALUES (?,?,?,'{}',1,1,1,'ai','test/v1',?,?,?)
  `).run(derivationId, entryId, kind, kind === "insight_reply" ? "insight-reply.v1" : "memory-analysis.v1", `test:${derivationId}`, now);
}

async function purgeEntry(database: SqliteDatabase, repository: SqliteJobRepository, entryId: string): Promise<void> {
  const deletion = createEntryDeletionService({ database, clock });
  await deletion.delete({ version: 1, requestId: randomUUID(), entryId, expectedTextRevision: 1, confirmation: "DELETE" });
  const job = repository.claimNext("purge", 60_000, now);
  assert.ok(job?.type === "purge_entry");
  assert.equal(job.entryId, entryId);
  assert.equal(repository.startAttempt(job.id, job.leaseOwner, job.fencingToken), true);
  assert.equal((await createPurgeEntryJobExecutor({ database, clock }).execute(job, new AbortController().signal)).outcome, "succeeded");
  assert.equal(repository.succeed(job.id, job.leaseOwner, job.fencingToken), true);
}

test("two-phase purge fences in-flight AI and removes text from SQL, FTS, WAL, and retained backups", async () => {
  const temporary = createTemporaryDatabase({ migrationsDirectory, now: clock.now });
  const backupDirectory = join(temporary.directory, "backups");
  const restoreDirectory = join(temporary.directory, "restore");
  mkdirSync(backupDirectory); mkdirSync(restoreDirectory);
  const backup = createBackupService({ databasePath: temporary.databasePath, backupsDirectory: backupDirectory, restoreDirectory,
    lifecycle: { async quiesceForRestore() {}, async resumeAfterDatabaseOpen() {}, async remainUnavailable() {} }, clock, currentSchemaVersion: 3 });
  try {
    const secret = "PURGE_SECRET_7f9c2b1d";
    const capture = createCaptureService({ unitOfWork: new SqliteCaptureUnitOfWork({ database: temporary.database, clock, ids: { next: randomUUID } }), clock, events: { publish() {} } });
    const requestId = randomUUID();
    const receipt = await capture.capture({ version: 1, requestId, source: "desktop", modality: "text", rawText: secret, mode: "remember", receivedAt: now, sourceKey: `desktop:${requestId}` });
    const oldBackup = await backup.create("startup");
    assert.equal(readFileSync(join(backupDirectory, `${oldBackup.backupId}.sqlite`)).includes(Buffer.from(secret)), true);
    const repository = new SqliteJobRepository(temporary.database, clock);
    const analyze = repository.claimNext("analysis", 60_000, now);
    assert.ok(analyze?.type === "analyze_entry");
    repository.startAttempt(analyze.id, analyze.leaseOwner, analyze.fencingToken);
    const deletion = createEntryDeletionService({ database: temporary.database, clock });
    const request = { version: 1 as const, requestId: randomUUID(), entryId: receipt.entryId, expectedTextRevision: 1, confirmation: "DELETE" as const };
    const deleted = await deletion.delete(request);
    assert.deepEqual(await deletion.delete(request), deleted);
    const stale = new SqliteAnalysisUnitOfWork({ database: temporary.database, now: clock.now }).commit({ job: analyze, output: {
      schemaVersion: "memory-analysis.v1", classification: { inputType: "other", confidence: 1, evidence: secret }, summary: { text: secret, confidence: 1, evidence: [secret] },
      entities: { items: [] }, goals: { items: [] }, nextActions: { items: [] }, needsUserReview: false,
    }, metadata: { provider: "fake", model: "fake", promptVersion: "v1", schemaVersion: "memory-analysis.v1", latencyMs: 1 } });
    assert.equal(stale, "stale");
    const purge = repository.claimNext("purge", 60_000, now);
    assert.ok(purge?.type === "purge_entry");
    repository.startAttempt(purge.id, purge.leaseOwner, purge.fencingToken);
    const executor = createPurgeEntryJobExecutor({ database: temporary.database, clock, afterPurge: async () => { await backup.replaceAfterPurge(); } });
    assert.equal((await executor.execute(purge, new AbortController().signal)).outcome, "succeeded");
    repository.succeed(purge.id, purge.leaseOwner, purge.fencingToken);
    const entry = temporary.database.prepare("SELECT status,raw_text FROM entries WHERE id=?").get(receipt.entryId) as { status: string; raw_text: string | null };
    assert.deepEqual(entry, { status: "purged", raw_text: null });
    for (const table of ["entry_text_revisions", "derivations", "memories", "artifact_sources", "ai_runs", "entry_search"]) {
      assert.equal((temporary.database.prepare(`SELECT count(*) count FROM ${table} WHERE entry_id=?`).get(receipt.entryId) as { count: number }).count, 0);
    }
    assert.equal(existsSync(join(backupDirectory, `${oldBackup.backupId}.sqlite`)), false);
    const retained = await backup.list();
    assert.equal(retained.backups.length, 1);
    assert.equal(retained.backups[0].reason, "post_purge");
    temporary.database.pragma("wal_checkpoint(TRUNCATE)");
    assert.equal(readFileSync(temporary.databasePath).includes(Buffer.from(secret)), false);
    const wal = `${temporary.databasePath}-wal`;
    if (existsSync(wal)) assert.equal(readFileSync(wal).includes(Buffer.from(secret)), false);
    for (const directory of [backupDirectory, restoreDirectory]) {
      const files = readdirSync(directory);
      assert.equal(files.some((file) => file.endsWith(".sqlite-wal") || file.endsWith(".sqlite-shm")), false);
      for (const file of files) {
        assert.equal(readFileSync(join(directory, file)).includes(Buffer.from(secret)), false, `${file} retained purged text`);
      }
    }
  } finally { temporary.close(); }
});

test("purge removes sources by artifact ownership and by cited entry without leaving cross-entry orphans", async () => {
  const temporary = createTemporaryDatabase({ migrationsDirectory, now: clock.now });
  try {
    const entryA = randomUUID();
    const entryB = randomUUID();
    const entryC = randomUUID();
    insertReadyEntry(temporary.database, entryA, "A insight owner");
    insertReadyEntry(temporary.database, entryB, "B cited evidence");
    insertReadyEntry(temporary.database, entryC, "C insight owner");

    const insightA = randomUUID();
    const classificationA = randomUUID();
    const summaryA = randomUUID();
    const memoryA = randomUUID();
    const insightC = randomUUID();
    insertDerivation(temporary.database, insightA, entryA, "insight_reply");
    insertDerivation(temporary.database, classificationA, entryA, "classification");
    insertDerivation(temporary.database, summaryA, entryA, "summary");
    insertDerivation(temporary.database, insightC, entryC, "insight_reply");
    temporary.database.prepare(`
      INSERT INTO memories(id,entry_id,memory_type,summary,confidence,classification_derivation_id,summary_derivation_id,updated_at)
      VALUES (?,?,'thought','A memory',1,?,?,?)
    `).run(memoryA, entryA, classificationA, summaryA, now);
    const insertSource = temporary.database.prepare(`
      INSERT INTO artifact_sources(artifact_type,artifact_id,entry_id,quote,created_at) VALUES (?,?,?,?,?)
    `);
    insertSource.run("derivation", insightA, entryB, "B evidence for A", now);
    insertSource.run("memory", memoryA, entryB, "B evidence for A memory", now);
    insertSource.run("derivation", insightC, entryB, "B evidence for C", now);

    const repository = new SqliteJobRepository(temporary.database, clock);
    await purgeEntry(temporary.database, repository, entryA);
    assert.equal((temporary.database.prepare("SELECT count(*) AS count FROM artifact_sources WHERE artifact_id IN (?,?)").get(insightA, memoryA) as { count: number }).count, 0);
    assert.equal((temporary.database.prepare("SELECT count(*) AS count FROM artifact_sources WHERE artifact_id=? AND entry_id=?").get(insightC, entryB) as { count: number }).count, 1);

    await purgeEntry(temporary.database, repository, entryB);
    assert.equal((temporary.database.prepare("SELECT count(*) AS count FROM artifact_sources WHERE artifact_id=? AND entry_id=?").get(insightC, entryB) as { count: number }).count, 0);
    assert.equal((temporary.database.prepare("SELECT count(*) AS count FROM derivations WHERE id=? AND entry_id=?").get(insightC, entryC) as { count: number }).count, 1);
  } finally { temporary.close(); }
});
