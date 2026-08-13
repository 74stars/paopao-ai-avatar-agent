import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { configureDatabase, openSqlite, type SqliteDatabase } from "./sqlite.js";
import { currentSchemaVersion, loadMigrations, runMigrations, validateDatabase } from "./migrations.js";

export interface OpenDatabaseOptions {
  databasePath: string;
  migrationsDirectory: string;
  now?: () => string;
  busyTimeoutMs?: number;
}

export function openDatabase(options: OpenDatabaseOptions): SqliteDatabase {
  mkdirSync(dirname(options.databasePath), { recursive: true });
  const database = openSqlite(options.databasePath, { timeout: options.busyTimeoutMs ?? 5_000 });
  try {
    configureDatabase(database, options.busyTimeoutMs);
    const migrations = loadMigrations(options.migrationsDirectory);
    const version = runMigrations(database, migrations, options.now ?? (() => new Date().toISOString()));
    validateDatabase(database, version);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export interface MigrationBackupPort {
  create(reason: "pre_migration"): Promise<{ backupId: string }>;
  restoreAfterMigrationFailure(backupId: string): Promise<void>;
}

export async function initializeDatabase(options: OpenDatabaseOptions & { migrationBackup?: MigrationBackupPort }): Promise<SqliteDatabase> {
  const migrations = loadMigrations(options.migrationsDirectory);
  const targetVersion = migrations.at(-1)?.version ?? 0;
  let backupId: string | undefined;
  if (options.migrationBackup && existsSync(options.databasePath) && statSync(options.databasePath).size > 0) {
    const existing = openSqlite(options.databasePath, { readonly: true, fileMustExist: true });
    try {
      if (currentSchemaVersion(existing) < targetVersion) backupId = (await options.migrationBackup.create("pre_migration")).backupId;
    } finally {
      existing.close();
    }
  }
  try {
    return openDatabase(options);
  } catch (error) {
    if (backupId && options.migrationBackup) await options.migrationBackup.restoreAfterMigrationFailure(backupId);
    throw error;
  }
}
