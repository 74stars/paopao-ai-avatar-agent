import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./database.js";
import type { SqliteDatabase } from "./sqlite.js";

export interface TemporaryDatabase {
  database: SqliteDatabase;
  databasePath: string;
  directory: string;
  close(): void;
}

export function createTemporaryDatabase(options: { migrationsDirectory: string; now?: () => string }): TemporaryDatabase {
  const directory = mkdtempSync(join(tmpdir(), "paopao-db-test-"));
  const databasePath = join(directory, "db", "paopao.sqlite");
  const database = openDatabase({ databasePath, migrationsDirectory: options.migrationsDirectory, now: options.now });
  let closed = false;
  return {
    database,
    databasePath,
    directory,
    close() {
      if (closed) return;
      closed = true;
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
