import { createRequire } from "node:module";

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqliteStatement {
  run(...parameters: unknown[]): RunResult;
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
}

export interface SqliteDatabase {
  exec(sql: string): this;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  prepare(sql: string): SqliteStatement;
  close(): void;
  backup(destinationFile: string): Promise<unknown>;
}

type DatabaseConstructor = new (path: string, options?: { readonly?: boolean; fileMustExist?: boolean; timeout?: number }) => SqliteDatabase;

const require = createRequire(import.meta.url);
const BetterSqlite3 = require("better-sqlite3") as DatabaseConstructor;

export function openSqlite(path: string, options?: { readonly?: boolean; fileMustExist?: boolean; timeout?: number }): SqliteDatabase {
  return new BetterSqlite3(path, options);
}

export function configureDatabase(database: SqliteDatabase, busyTimeoutMs = 5_000): void {
  database.pragma("foreign_keys = ON");
  database.pragma("secure_delete = ON");
  database.pragma(`busy_timeout = ${busyTimeoutMs}`);
  database.pragma("journal_mode = WAL");
}

export function checkpointDatabase(database: SqliteDatabase): void {
  database.pragma("wal_checkpoint(TRUNCATE)");
}
