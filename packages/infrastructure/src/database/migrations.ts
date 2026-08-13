import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { SqliteDatabase } from "./sqlite.js";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export function loadMigrations(directory: string): Migration[] {
  return readdirSync(directory)
    .filter((file) => /^\d{3}_.+\.sql$/.test(file))
    .sort()
    .map((file) => ({
      version: Number.parseInt(file.slice(0, 3), 10),
      name: basename(file, ".sql"),
      sql: readFileSync(join(directory, file), "utf8"),
    }));
}

export function currentSchemaVersion(database: SqliteDatabase): number {
  const exists = database.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get() as { found?: number } | undefined;
  if (!exists) return 0;
  const row = database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number };
  return row.version;
}

export function runMigrations(database: SqliteDatabase, migrations: readonly Migration[], appliedAt: () => string): number {
  let version = currentSchemaVersion(database);
  for (const migration of migrations) {
    if (migration.version <= version) continue;
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      database.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(migration.version, migration.name, appliedAt());
      database.exec("COMMIT");
      version = migration.version;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  return version;
}

export function validateDatabase(database: SqliteDatabase, expectedVersion: number): void {
  const integrity = database.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") throw new Error("Database integrity check failed");
  const foreignKeys = database.pragma("foreign_key_check") as unknown[];
  if (foreignKeys.length > 0) throw new Error("Database foreign key check failed");
  if (currentSchemaVersion(database) !== expectedVersion) throw new Error("Database schema version mismatch");
  database.prepare("SELECT count(*) AS count FROM entry_search WHERE entry_search MATCH ?").get("trigramcapabilitycheck");
}
