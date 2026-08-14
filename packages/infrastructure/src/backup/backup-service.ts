import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  BackupRestoreRequestV1Schema,
  BackupRestoreStatusV1Schema,
  BackupSummaryV1Schema,
  type BackupRestoreStatusV1,
} from "@paopao/contracts";
import type { DomainEventPublisher } from "@paopao/core";
import { currentSchemaVersion } from "../database/migrations.js";
import { checkpointDatabase, openSqlite, type SqliteDatabase } from "../database/sqlite.js";

export type BackupReason = "startup" | "pre_migration" | "pre_restore" | "post_purge";
export type BackupSummary = ReturnType<typeof BackupSummaryV1Schema.parse>;
export type BackupRestoreRequest = ReturnType<typeof BackupRestoreRequestV1Schema.parse>;

export interface RestoreLifecyclePort {
  quiesceForRestore(): Promise<void>;
  resumeAfterDatabaseOpen(outcome: "restored" | "rolled_back"): Promise<void>;
  remainUnavailable(errorCode: "RESTORE_FAILED"): Promise<void>;
}

export interface BackupService {
  list(): Promise<{ backups: BackupSummary[] }>;
  restore(command: BackupRestoreRequest): Promise<{ restoreId: string; backupId: string; status: "queued" }>;
  status(restoreId: string): Promise<BackupRestoreStatusV1>;
}

interface BackupManifest extends BackupSummary {
  version: 1;
  databaseFile: string;
}

interface RestoreRecord {
  restoreId: string;
  backupId: string;
  status: "queued" | "validating" | "quiescing" | "replacing" | "reopening" | "succeeded" | "failed_invalid" | "failed_rolled_back" | "failed_unavailable";
  errorCode: null | "BACKUP_INVALID" | "RESTORE_FAILED";
  updatedAt: string;
  requestId: string;
  rollbackPath?: string;
  candidatePath?: string;
}

interface RestoreJournal {
  version: 1;
  activeRestoreId: string | null;
  operations: Record<string, RestoreRecord>;
}

const FINAL_RESTORE_STATES = new Set(["succeeded", "failed_invalid", "failed_rolled_back", "failed_unavailable"]);
export const CURRENT_DATABASE_SCHEMA_VERSION = 3;
export const MINIMUM_DATABASE_SCHEMA_VERSION = 1;

export class BackupNotFoundError extends Error {
  readonly code = "NOT_FOUND";

  constructor() {
    super("Backup was not found");
  }
}

export class BackupInvalidError extends Error {
  readonly code = "BACKUP_INVALID";

  constructor() {
    super("Backup validation failed");
  }
}

export function createBackupService(dependencies: {
  databasePath: string;
  backupsDirectory: string;
  restoreDirectory: string;
  lifecycle: RestoreLifecyclePort;
  clock: { now(): string };
  currentSchemaVersion?: number;
  minimumSchemaVersion?: number;
  ids?: { next(): string };
  events?: DomainEventPublisher;
}): BackupService & {
  create(reason: BackupReason): Promise<BackupSummary>;
  createStartupIfDue(): Promise<BackupSummary | null>;
  replaceAfterPurge(): Promise<BackupSummary>;
  restoreAfterMigrationFailure(backupId: string): Promise<void>;
  recoverInterrupted(): Promise<void>;
} {
  return new FileBackupService(dependencies);
}

class FileBackupService implements BackupService {
  readonly #databasePath: string;
  readonly #backupsDirectory: string;
  readonly #restoreDirectory: string;
  readonly #journalPath: string;
  readonly #lifecycle: RestoreLifecyclePort;
  readonly #clock: { now(): string };
  readonly #currentVersion: number;
  readonly #minimumVersion: number;
  readonly #ids: { next(): string };
  readonly #events?: DomainEventPublisher;

  constructor(dependencies: {
    databasePath: string;
    backupsDirectory: string;
    restoreDirectory: string;
    lifecycle: RestoreLifecyclePort;
    clock: { now(): string };
    currentSchemaVersion?: number;
    minimumSchemaVersion?: number;
    ids?: { next(): string };
    events?: DomainEventPublisher;
  }) {
    this.#databasePath = resolve(dependencies.databasePath);
    this.#backupsDirectory = resolve(dependencies.backupsDirectory);
    this.#restoreDirectory = resolve(dependencies.restoreDirectory);
    this.#journalPath = join(this.#restoreDirectory, "restore-state.v1.json");
    this.#lifecycle = dependencies.lifecycle;
    this.#clock = dependencies.clock;
    this.#currentVersion = dependencies.currentSchemaVersion ?? CURRENT_DATABASE_SCHEMA_VERSION;
    this.#minimumVersion = dependencies.minimumSchemaVersion ?? MINIMUM_DATABASE_SCHEMA_VERSION;
    this.#ids = dependencies.ids ?? { next: randomUUID };
    this.#events = dependencies.events;
    mkdirSync(this.#backupsDirectory, { recursive: true });
    mkdirSync(this.#restoreDirectory, { recursive: true });
  }

  async list(): Promise<{ backups: BackupSummary[] }> {
    return { backups: this.#manifests().map(({ databaseFile: _databaseFile, version: _version, ...summary }) => summary).slice(0, 7) };
  }

  async create(reason: BackupReason): Promise<BackupSummary> {
    if (!existsSync(this.#databasePath)) throw new Error("Database does not exist");
    const backupId = this.#ids.next();
    const databaseFile = `${backupId}.sqlite`;
    const destination = join(this.#backupsDirectory, databaseFile);
    const source = openSqlite(this.#databasePath, { fileMustExist: true });
    try {
      checkpointDatabase(source);
      await source.backup(destination);
    } catch (error) {
      this.#removeDatabaseFiles(destination);
      throw error;
    } finally {
      source.close();
    }
    const manifestPath = join(this.#backupsDirectory, `${backupId}.manifest.json`);
    let manifest: BackupManifest;
    try {
      manifest = {
        version: 1,
        backupId,
        createdAt: this.#clock.now(),
        reason,
        databaseSchemaVersion: this.#readVersion(destination),
        sizeBytes: statSync(destination).size,
        sha256: sha256File(destination),
        databaseFile,
      };
      this.#writeJsonAtomic(manifestPath, manifest);
      this.#prune();
    } catch (error) {
      this.#removeDatabaseFiles(destination);
      rmSync(manifestPath, { force: true });
      throw error;
    }
    const { databaseFile: _databaseFile, version: _version, ...summary } = manifest;
    return summary;
  }

  async createStartupIfDue(): Promise<BackupSummary | null> {
    const latest = this.#manifests()[0];
    if (latest && Date.parse(this.#clock.now()) - Date.parse(latest.createdAt) < 86_400_000) return null;
    return this.create("startup");
  }

  async replaceAfterPurge(): Promise<BackupSummary> {
    const replacement = await this.create("post_purge");
    for (const manifest of this.#manifests()) {
      if (manifest.backupId === replacement.backupId) continue;
      const databasePath = resolve(this.#backupsDirectory, manifest.databaseFile);
      if (dirname(databasePath) !== this.#backupsDirectory) continue;
      this.#removeDatabaseFiles(databasePath);
      rmSync(join(this.#backupsDirectory, `${manifest.backupId}.manifest.json`), { force: true });
    }
    return replacement;
  }

  async restoreAfterMigrationFailure(backupId: string): Promise<void> {
    const manifest = this.#manifestById(backupId);
    if (!manifest) throw new BackupNotFoundError();
    const source = this.#safeBackupPath(manifest);
    if (sha256File(source) !== manifest.sha256) throw new BackupInvalidError();
    this.#validateCompatibleBackup(source, manifest.databaseSchemaVersion);
    const temporary = join(this.#restoreDirectory, `${backupId}.migration-rollback.sqlite`);
    this.#removeDatabaseFiles(temporary);
    try {
      copyFileSync(source, temporary);
      this.#moveDatabaseFiles(temporary, this.#databasePath);
    } finally {
      this.#removeDatabaseFiles(temporary);
    }
  }

  async restore(input: BackupRestoreRequest): Promise<{ restoreId: string; backupId: string; status: "queued" }> {
    const command = BackupRestoreRequestV1Schema.parse(input);
    const manifest = this.#manifestById(command.backupId);
    if (!manifest) throw new BackupNotFoundError();
    const journal = this.#readJournal();
    const repeated = Object.values(journal.operations).find((record) => record.requestId === command.requestId);
    if (repeated) return { restoreId: repeated.restoreId, backupId: repeated.backupId, status: "queued" };
    if (journal.activeRestoreId) throw new Error("A restore operation is already active");
    const restoreId = this.#ids.next();
    const record: RestoreRecord = {
      restoreId,
      backupId: command.backupId,
      requestId: command.requestId,
      status: "queued",
      errorCode: null,
      updatedAt: this.#clock.now(),
    };
    journal.activeRestoreId = restoreId;
    journal.operations[restoreId] = record;
    this.#writeJournal(journal);
    await this.#publishRestoreProgress(record);
    queueMicrotask(() => void this.#runRestore(restoreId, manifest));
    return { restoreId, backupId: command.backupId, status: "queued" };
  }

  async status(restoreId: string): Promise<BackupRestoreStatusV1> {
    const record = this.#readJournal().operations[restoreId];
    if (!record) throw new Error("Restore operation was not found");
    const { requestId: _requestId, rollbackPath: _rollbackPath, candidatePath: _candidatePath, ...status } = record;
    return BackupRestoreStatusV1Schema.parse(status);
  }

  async recoverInterrupted(): Promise<void> {
    const journal = this.#readJournal();
    const restoreId = journal.activeRestoreId;
    if (!restoreId) return;
    const record = journal.operations[restoreId];
    if (!record || FINAL_RESTORE_STATES.has(record.status)) {
      journal.activeRestoreId = null;
      this.#writeJournal(journal);
      return;
    }
    try {
      if (record.rollbackPath && existsSync(record.rollbackPath)) {
        this.#assertRestoreArtifact(record.rollbackPath, restoreId, "rollback");
        this.#moveDatabaseFiles(record.rollbackPath, this.#databasePath);
      }
      this.#validateFile(this.#databasePath);
      await this.#lifecycle.resumeAfterDatabaseOpen("rolled_back");
      await this.#updateRestore(restoreId, "failed_rolled_back", "RESTORE_FAILED", { active: false });
    } catch {
      await this.#lifecycle.remainUnavailable("RESTORE_FAILED");
      await this.#updateRestore(restoreId, "failed_unavailable", "RESTORE_FAILED", { active: false });
    } finally {
      if (record.candidatePath) {
        this.#assertRestoreArtifact(record.candidatePath, restoreId, "candidate");
        this.#removeDatabaseFiles(record.candidatePath);
      }
    }
  }

  async #runRestore(restoreId: string, manifest: BackupManifest): Promise<void> {
    const candidatePath = join(this.#restoreDirectory, `${restoreId}.candidate.sqlite`);
    const rollbackPath = join(this.#restoreDirectory, `${restoreId}.rollback.sqlite`);
    let quiesced = false;
    try {
      await this.#updateRestore(restoreId, "validating", null, { candidatePath });
      const backupPath = this.#safeBackupPath(manifest);
      copyFileSync(backupPath, candidatePath);
      if (sha256File(candidatePath) !== manifest.sha256) throw new BackupInvalidError();
      this.#validateFile(candidatePath, true);

      await this.#updateRestore(restoreId, "quiescing", null, { candidatePath, rollbackPath });
      await this.#lifecycle.quiesceForRestore();
      quiesced = true;
      await this.create("pre_restore");

      await this.#updateRestore(restoreId, "replacing", null, { candidatePath, rollbackPath });
      this.#moveDatabaseFiles(this.#databasePath, rollbackPath);
      this.#moveDatabaseFiles(candidatePath, this.#databasePath);
      await this.#updateRestore(restoreId, "reopening", null, { rollbackPath });
      this.#validateFile(this.#databasePath);
      await this.#lifecycle.resumeAfterDatabaseOpen("restored");
      await this.#updateRestore(restoreId, "succeeded", null, { active: false });
      this.#removeDatabaseFiles(rollbackPath);
    } catch (error) {
      if (error instanceof BackupInvalidError || error instanceof BackupNotFoundError) {
        await this.#updateRestore(restoreId, "failed_invalid", "BACKUP_INVALID", { active: false });
        return;
      }
      if (!quiesced) {
        await this.#updateRestore(restoreId, "failed_rolled_back", "RESTORE_FAILED", { active: false });
        return;
      }
      try {
        if (existsSync(rollbackPath)) {
          this.#moveDatabaseFiles(rollbackPath, this.#databasePath);
        }
        this.#validateFile(this.#databasePath);
        await this.#lifecycle.resumeAfterDatabaseOpen("rolled_back");
        await this.#updateRestore(restoreId, "failed_rolled_back", "RESTORE_FAILED", { active: false });
      } catch {
        await this.#lifecycle.remainUnavailable("RESTORE_FAILED");
        await this.#updateRestore(restoreId, "failed_unavailable", "RESTORE_FAILED", { active: false });
      }
    } finally {
      this.#removeDatabaseFiles(candidatePath);
    }
  }

  #validateFile(path: string, removeSidecarsAfterClose = false): void {
    if (!existsSync(path)) throw new BackupInvalidError();
    let database: SqliteDatabase | undefined;
    try {
      database = openSqlite(path, { readonly: true, fileMustExist: true });
      database.pragma("foreign_keys = ON");
      if (database.pragma("integrity_check", { simple: true }) !== "ok") throw new BackupInvalidError();
      if ((database.pragma("foreign_key_check") as unknown[]).length > 0) throw new BackupInvalidError();
      const version = currentSchemaVersion(database);
      if (version < this.#minimumVersion || version > this.#currentVersion) throw new BackupInvalidError();
    } finally {
      try {
        database?.close();
      } finally {
        if (removeSidecarsAfterClose) this.#removeDatabaseSidecars(path);
      }
    }
  }

  #validateCompatibleBackup(path: string, expectedVersion: number): void {
    let database: SqliteDatabase | undefined;
    try {
      database = openSqlite(path, { readonly: true, fileMustExist: true });
      database.pragma("foreign_keys = ON");
      if (database.pragma("integrity_check", { simple: true }) !== "ok") throw new BackupInvalidError();
      if ((database.pragma("foreign_key_check") as unknown[]).length > 0) throw new BackupInvalidError();
      if (currentSchemaVersion(database) !== expectedVersion || expectedVersion > this.#currentVersion) throw new BackupInvalidError();
    } finally {
      try {
        database?.close();
      } finally {
        this.#removeDatabaseSidecars(path);
      }
    }
  }

  #readVersion(path: string): number {
    let database: SqliteDatabase | undefined;
    try {
      database = openSqlite(path, { readonly: true, fileMustExist: true });
      return currentSchemaVersion(database);
    } finally {
      try {
        database?.close();
      } finally {
        this.#removeDatabaseSidecars(path);
      }
    }
  }

  #manifestById(backupId: string): BackupManifest | undefined {
    return this.#manifests().find((manifest) => manifest.backupId === backupId);
  }

  #manifests(): BackupManifest[] {
    return readdirSync(this.#backupsDirectory)
      .filter((file) => file.endsWith(".manifest.json"))
      .flatMap((file) => {
        try {
          const parsed = JSON.parse(readFileSync(join(this.#backupsDirectory, file), "utf8")) as unknown;
          const manifest = parsed as BackupManifest;
          const { databaseFile: _databaseFile, version: _version, ...summary } = manifest;
          BackupSummaryV1Schema.parse(summary);
          if (
            manifest.version !== 1 ||
            file !== `${manifest.backupId}.manifest.json` ||
            manifest.databaseFile !== `${manifest.backupId}.sqlite` ||
            basename(manifest.databaseFile) !== manifest.databaseFile
          ) return [];
          return [manifest];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  #safeBackupPath(manifest: BackupManifest): string {
    const path = resolve(this.#backupsDirectory, manifest.databaseFile);
    if (dirname(path) !== this.#backupsDirectory || !existsSync(path)) throw new BackupNotFoundError();
    return path;
  }

  #prune(): void {
    for (const manifest of this.#manifests().slice(7)) {
      const databasePath = resolve(this.#backupsDirectory, manifest.databaseFile);
      if (dirname(databasePath) !== this.#backupsDirectory) continue;
      this.#removeDatabaseFiles(databasePath);
      rmSync(join(this.#backupsDirectory, `${manifest.backupId}.manifest.json`), { force: true });
    }
  }

  #removeDatabaseFiles(path: string): void {
    rmSync(path, { force: true });
    this.#removeDatabaseSidecars(path);
  }

  #removeDatabaseSidecars(path: string): void {
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }

  #moveDatabaseFiles(source: string, destination: string): void {
    this.#removeDatabaseFiles(destination);
    renameSync(source, destination);
    for (const suffix of ["-wal", "-shm"]) {
      const sourceSidecar = `${source}${suffix}`;
      if (existsSync(sourceSidecar)) renameSync(sourceSidecar, `${destination}${suffix}`);
    }
  }

  #assertRestoreArtifact(path: string, restoreId: string, kind: "rollback" | "candidate"): void {
    const expected = join(this.#restoreDirectory, `${restoreId}.${kind}.sqlite`);
    if (resolve(path) !== expected) throw new Error("Restore journal contains an invalid artifact path");
  }

  #readJournal(): RestoreJournal {
    if (!existsSync(this.#journalPath)) return { version: 1, activeRestoreId: null, operations: {} };
    const parsed = JSON.parse(readFileSync(this.#journalPath, "utf8")) as RestoreJournal;
    if (parsed.version !== 1 || typeof parsed.operations !== "object") throw new Error("Restore journal is invalid");
    return parsed;
  }

  #writeJournal(journal: RestoreJournal): void {
    const records = Object.values(journal.operations).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 20);
    journal.operations = Object.fromEntries(records.map((record) => [record.restoreId, record]));
    this.#writeJsonAtomic(this.#journalPath, journal);
  }

  async #updateRestore(
    restoreId: string,
    status: RestoreRecord["status"],
    errorCode: RestoreRecord["errorCode"],
    extra: { active?: boolean; rollbackPath?: string; candidatePath?: string } = {},
  ): Promise<void> {
    const journal = this.#readJournal();
    const current = journal.operations[restoreId];
    if (!current) throw new Error("Restore operation was not found");
    const { active: _active, ...persistedExtra } = extra;
    const updated = { ...current, ...persistedExtra, status, errorCode, updatedAt: this.#clock.now() };
    journal.operations[restoreId] = updated;
    if (extra.active === false) journal.activeRestoreId = null;
    this.#writeJournal(journal);
    await this.#publishRestoreProgress(updated);
  }

  async #publishRestoreProgress(record: RestoreRecord): Promise<void> {
    try {
      await this.#events?.publish({ version: 1, type: "backup:restore-progress", restoreId: record.restoreId, status: record.status, occurredAt: record.updatedAt });
    } catch {
      // Restore state is persisted authority; progress events only invalidate readers.
    }
  }

  #writeJsonAtomic(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, path);
  }
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
