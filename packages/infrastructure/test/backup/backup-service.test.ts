import assert from "node:assert/strict";
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBackupService, BackupNotFoundError, type RestoreLifecyclePort } from "../../src/backup/backup-service.js";
import { initializeDatabase, openDatabase } from "../../src/database/database.js";
import type { SqliteDatabase } from "../../src/database/sqlite.js";

const root = mkdtempSync(join(tmpdir(), "paopao-backup-test-"));
const databasePath = join(root, "db", "paopao.sqlite");
const backupsDirectory = join(root, "backups");
const restoreDirectory = join(root, "restore");
const migrationsDirectory = fileURLToPath(new URL("../../src/database/migrations", import.meta.url));
let now = "2026-08-06T00:00:00.000Z";
let database: SqliteDatabase | undefined = openDatabase({ databasePath, migrationsDirectory, now: () => now });
let failRestoredReopen = false;
let unavailable = false;

const lifecycle: RestoreLifecyclePort = {
  async quiesceForRestore() {
    database?.close();
    database = undefined;
  },
  async resumeAfterDatabaseOpen(outcome) {
    database = openDatabase({ databasePath, migrationsDirectory, now: () => now });
    if (outcome === "restored" && failRestoredReopen) {
      database.close();
      database = undefined;
      failRestoredReopen = false;
      throw new Error("injected reopen failure");
    }
  },
  async remainUnavailable() {
    unavailable = true;
  },
};

const service = createBackupService({ databasePath, backupsDirectory, restoreDirectory, lifecycle, clock: { now: () => now } });

async function waitForFinal(restoreId: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const status = await service.status(restoreId);
    if (["succeeded", "failed_invalid", "failed_rolled_back", "failed_unavailable"].includes(status.status)) return status;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("restore did not finish");
}

function setMarker(value: string): void {
  database?.prepare(`
    INSERT INTO settings(key, value_json, updated_at) VALUES ('marker', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(JSON.stringify(value), now);
}

function getMarker(): string {
  const row = database?.prepare("SELECT value_json FROM settings WHERE key = 'marker'").get() as { value_json: string };
  return JSON.parse(row.value_json) as string;
}

try {
  setMarker("snapshot");
  const first = await service.createStartupIfDue();
  assert.ok(first);
  assert.equal(first.databaseSchemaVersion, 3);
  assert.equal(await service.createStartupIfDue(), null);
  setMarker("live");

  const restore = await service.restore({ version: 1, requestId: "30000000-0000-4000-8000-000000000001", backupId: first.backupId, confirmation: "RESTORE" });
  assert.equal((await waitForFinal(restore.restoreId)).status, "succeeded");
  assert.equal(getMarker(), "snapshot");

  setMarker("must-survive-rollback");
  const rollbackTarget = await service.create("pre_migration");
  setMarker("newer-live-value");
  failRestoredReopen = true;
  const failedRestore = await service.restore({ version: 1, requestId: "30000000-0000-4000-8000-000000000002", backupId: rollbackTarget.backupId, confirmation: "RESTORE" });
  assert.equal((await waitForFinal(failedRestore.restoreId)).status, "failed_rolled_back");
  assert.equal(getMarker(), "newer-live-value");
  assert.equal(unavailable, false);

  const corrupt = await service.create("pre_migration");
  appendFileSync(join(backupsDirectory, `${corrupt.backupId}.sqlite`), "corrupt");
  const corruptRestore = await service.restore({ version: 1, requestId: "30000000-0000-4000-8000-000000000003", backupId: corrupt.backupId, confirmation: "RESTORE" });
  assert.equal((await waitForFinal(corruptRestore.restoreId)).status, "failed_invalid");
  assert.equal(getMarker(), "newer-live-value");

  await assert.rejects(
    service.restore({ version: 1, requestId: "30000000-0000-4000-8000-000000000004", backupId: "40000000-0000-4000-8000-000000000099", confirmation: "RESTORE" }),
    BackupNotFoundError,
  );

  now = "2026-08-07T01:00:00.000Z";
  assert.ok(await service.createStartupIfDue());
  for (let index = 0; index < 8; index += 1) {
    now = new Date(Date.parse(now) + 1_000).toISOString();
    await service.create("pre_migration");
  }
  assert.equal((await service.list()).backups.length, 7);
  assertNoSqliteSidecars(backupsDirectory);

  const brokenMigrations = join(root, "broken-migrations");
  mkdirSync(brokenMigrations);
  copyFileSync(join(migrationsDirectory, "001_initial.sql"), join(brokenMigrations, "001_initial.sql"));
  copyFileSync(join(migrationsDirectory, "002_wave3_binding_delivery.sql"), join(brokenMigrations, "002_wave3_binding_delivery.sql"));
  copyFileSync(join(migrationsDirectory, "003_binding_operation_outcomes.sql"), join(brokenMigrations, "003_binding_operation_outcomes.sql"));
  writeFileSync(join(brokenMigrations, "004_broken.sql"), "CREATE TABLE should_rollback(id TEXT);\nTHIS IS NOT SQL;\n");
  database?.close();
  database = undefined;
  await assert.rejects(initializeDatabase({ databasePath, migrationsDirectory: brokenMigrations, now: () => now, migrationBackup: service }));
  database = openDatabase({ databasePath, migrationsDirectory, now: () => now });
  assert.equal(getMarker(), "newer-live-value");
  assert.equal(temporaryTableExists(database, "should_rollback"), false);

  setMarker("before-crash");
  database.close();
  database = undefined;
  const crashedRestoreId = "50000000-0000-4000-8000-000000000001";
  const crashedRollback = join(restoreDirectory, `${crashedRestoreId}.rollback.sqlite`);
  copyFileSync(databasePath, crashedRollback);
  database = openDatabase({ databasePath, migrationsDirectory, now: () => now });
  setMarker("partially-restored");
  database.close();
  database = undefined;
  writeInterruptedJournal(crashedRestoreId, crashedRollback);
  await service.recoverInterrupted();
  assert.equal((await service.status(crashedRestoreId)).status, "failed_rolled_back");
  assert.equal(getMarker(), "before-crash");

  database?.close();
  database = undefined;
  const unavailableRestoreId = "50000000-0000-4000-8000-000000000002";
  const corruptRollback = join(restoreDirectory, `${unavailableRestoreId}.rollback.sqlite`);
  writeFileSync(corruptRollback, "not a sqlite database");
  writeInterruptedJournal(unavailableRestoreId, corruptRollback);
  await service.recoverInterrupted();
  assert.equal((await service.status(unavailableRestoreId)).status, "failed_unavailable");
  assert.equal(unavailable, true);
  assertNoSqliteSidecars(backupsDirectory);
  assertNoSqliteSidecars(restoreDirectory);
  assert.equal(readdirSync(restoreDirectory).some((file) => /\.(?:candidate|rollback|migration-rollback)\.sqlite(?:-(?:wal|shm))?$/.test(file)), false);

  console.log("backup/restore integration passed");
} finally {
  database?.close();
  rmSync(root, { recursive: true, force: true });
}

function temporaryTableExists(connection: SqliteDatabase, name: string): boolean {
  return Boolean(connection.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function assertNoSqliteSidecars(directory: string): void {
  assert.deepEqual(readdirSync(directory).filter((file) => file.endsWith(".sqlite-wal") || file.endsWith(".sqlite-shm")), []);
}

function writeInterruptedJournal(restoreId: string, rollbackPath: string): void {
  const journalPath = join(restoreDirectory, "restore-state.v1.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { version: 1; activeRestoreId: string | null; operations: Record<string, unknown> };
  journal.activeRestoreId = restoreId;
  journal.operations[restoreId] = {
    restoreId,
    backupId: "50000000-0000-4000-8000-000000000099",
    requestId: restoreId,
    status: "reopening",
    errorCode: null,
    updatedAt: now,
    rollbackPath,
  };
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
}
