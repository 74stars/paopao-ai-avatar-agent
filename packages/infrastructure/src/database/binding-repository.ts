import { randomUUID } from "node:crypto";
import {
  BindingError,
  createBindingService,
  type BindingCodeRecord,
  type BindingCrypto,
  type BindingIdentity,
  type BindingRepository,
  type BindingService,
  type Clock,
  type IdGenerator,
} from "@paopao/core";
import type { SqliteDatabase } from "./sqlite.js";

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1_000;
const MAX_FAILED_ATTEMPTS = 5;

interface BindingOperationRow {
  kind: "bind" | "unbind";
  outcome: string;
  app_id: string | null;
  tenant_key: string | null;
  open_id: string | null;
  code_salt: string | null;
  code_hash: string | null;
}

interface BindingCodeRow {
  id: string;
  salt: string;
  code_hash: string;
  expires_at: string;
  consumed_at: string | null;
}

export class SqliteBindingRepository implements BindingRepository {
  constructor(private readonly database: SqliteDatabase, private readonly nextId: () => string = randomUUID) {}

  replaceActiveCode(record: BindingCodeRecord): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("UPDATE binding_codes SET consumed_at = ? WHERE consumed_at IS NULL").run(record.createdAt);
      this.database.prepare(`
        INSERT INTO binding_codes(id, salt, code_hash, expires_at, consumed_at, failed_attempts, next_attempt_at, created_at)
        VALUES (?, ?, ?, ?, NULL, 0, NULL, ?)
      `).run(record.id, record.salt, record.codeHash, record.expiresAt, record.createdAt);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  isBound(identity: BindingIdentity): boolean {
    return this.database.prepare(`
      SELECT 1 AS found FROM feishu_bindings
      WHERE app_id = ? AND tenant_key = ? AND open_id = ? AND active = 1
    `).get(identity.appId, identity.tenantKey, identity.openId) !== undefined;
  }

  hasActiveBinding(): boolean {
    return this.database.prepare("SELECT 1 AS found FROM feishu_bindings WHERE active = 1 LIMIT 1").get() !== undefined;
  }

  consumeCode(input: BindingIdentity & {
    operationKey: string;
    code: string;
    operationCodeSalt: string;
    operationCodeHash: string;
    now: string;
    verifyCode: (code: string, salt: string, expectedHash: string) => boolean;
  }): { bound: true } {
    let transactionOpen = true;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const operation = this.#operation(input.operationKey);
      if (operation) {
        this.#assertOperation(operation, "bind", input, input.code, input.verifyCode);
        this.database.exec("COMMIT");
        transactionOpen = false;
        return this.#replayConsumeOutcome(operation.outcome);
      }

      const windowStart = new Date(Date.parse(input.now) - RATE_LIMIT_WINDOW_MS).toISOString();
      this.database.prepare("DELETE FROM binding_attempts WHERE attempted_at < ?").run(windowStart);
      const failures = this.database.prepare(`
        SELECT count(*) AS count FROM binding_attempts
        WHERE app_id = ? AND open_id = ? AND attempted_at >= ?
      `).get(input.appId, input.openId, windowStart) as { count: number };
      if (failures.count >= MAX_FAILED_ATTEMPTS) {
        this.#recordConsumeOperation(input, "BINDING_RATE_LIMITED");
        this.database.exec("COMMIT");
        transactionOpen = false;
        throw new BindingError("BINDING_RATE_LIMITED", "Too many failed binding attempts", true);
      }

      const matched = this.#findCode(input.code, input.verifyCode);
      const codeError = !matched
        ? this.#recordFailedAttempt(input, "BINDING_CODE_INVALID", "The binding code is invalid")
        : matched.consumed_at !== null
          ? this.#recordFailedAttempt(input, "BINDING_CODE_CONSUMED", "The binding code has already been consumed")
          : matched.expires_at <= input.now
            ? this.#recordFailedAttempt(input, "BINDING_CODE_EXPIRED", "The binding code has expired")
            : null;
      if (codeError) {
        this.#recordConsumeOperation(input, codeError.code);
        this.database.exec("COMMIT");
        transactionOpen = false;
        throw codeError;
      }
      if (!matched) throw new Error("Binding code verification invariant failed");

      this.database.prepare("UPDATE feishu_bindings SET active = 0, unbound_at = ? WHERE active = 1").run(input.now);
      const existing = this.database.prepare(`
        SELECT id FROM feishu_bindings WHERE app_id = ? AND tenant_key = ? AND open_id = ?
      `).get(input.appId, input.tenantKey, input.openId) as { id: string } | undefined;
      const bindingId = existing?.id ?? this.nextId();
      if (existing) {
        this.database.prepare(`
          UPDATE feishu_bindings SET active = 1, bound_at = ?, unbound_at = NULL WHERE id = ?
        `).run(input.now, bindingId);
      } else {
        this.database.prepare(`
          INSERT INTO feishu_bindings(id, singleton_scope, app_id, tenant_key, open_id, active, bound_at, unbound_at)
          VALUES (?, 1, ?, ?, ?, 1, ?, NULL)
        `).run(bindingId, input.appId, input.tenantKey, input.openId, input.now);
      }
      this.database.prepare("UPDATE binding_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL").run(input.now, matched.id);
      this.database.prepare("DELETE FROM binding_attempts WHERE app_id = ? AND open_id = ?").run(input.appId, input.openId);
      this.database.prepare(`
        INSERT INTO binding_operations(
          operation_key, kind, outcome, binding_id, created_at, app_id, tenant_key, open_id, code_salt, code_hash
        ) VALUES (?, 'bind', 'bound', ?, ?, ?, ?, ?, ?, ?)
      `).run(input.operationKey, bindingId, input.now, input.appId, input.tenantKey, input.openId, input.operationCodeSalt, input.operationCodeHash);
      this.database.exec("COMMIT");
      transactionOpen = false;
      return { bound: true };
    } catch (error) {
      if (transactionOpen) this.database.exec("ROLLBACK");
      throw error;
    }
  }

  unbind(input: BindingIdentity & { operationKey: string; now: string }): void {
    let transactionOpen = true;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const operation = this.#operation(input.operationKey);
      if (operation) {
        this.#assertOperation(operation, "unbind", input);
        this.database.exec("COMMIT");
        transactionOpen = false;
        return;
      }
      const binding = this.database.prepare(`
        SELECT id FROM feishu_bindings
        WHERE app_id = ? AND tenant_key = ? AND open_id = ?
      `).get(input.appId, input.tenantKey, input.openId) as { id: string } | undefined;
      if (binding) {
        this.database.prepare("UPDATE feishu_bindings SET active = 0, unbound_at = ? WHERE id = ? AND active = 1")
          .run(input.now, binding.id);
      }
      this.database.prepare(`
        INSERT INTO binding_operations(operation_key, kind, outcome, binding_id, created_at, app_id, tenant_key, open_id)
        VALUES (?, 'unbind', 'unbound', ?, ?, ?, ?, ?)
      `).run(input.operationKey, binding?.id ?? null, input.now, input.appId, input.tenantKey, input.openId);
      this.database.exec("COMMIT");
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen) this.database.exec("ROLLBACK");
      throw error;
    }
  }

  #operation(operationKey: string): BindingOperationRow | undefined {
    return this.database.prepare(`
      SELECT kind, outcome, app_id, tenant_key, open_id, code_salt, code_hash
      FROM binding_operations WHERE operation_key = ?
    `).get(operationKey) as BindingOperationRow | undefined;
  }

  #assertOperation(
    operation: BindingOperationRow,
    kind: "bind" | "unbind",
    identity: BindingIdentity,
    code?: string,
    verifyCode?: (code: string, salt: string, expectedHash: string) => boolean,
  ): void {
    if (operation.kind !== kind || operation.app_id !== identity.appId || operation.tenant_key !== identity.tenantKey || operation.open_id !== identity.openId) {
      throw new BindingError("BINDING_CODE_INVALID", "Binding operation key was reused with different input");
    }
    if (kind === "bind" && operation.code_salt !== null && operation.code_hash !== null
      && (code === undefined || verifyCode === undefined || !verifyCode(code, operation.code_salt, operation.code_hash))) {
      throw new BindingError("BINDING_CODE_INVALID", "Binding operation key was reused with different input");
    }
  }

  #findCode(code: string, verify: (code: string, salt: string, expectedHash: string) => boolean): BindingCodeRow | undefined {
    if (!/^\d{6}$/.test(code)) return undefined;
    const rows = this.database.prepare(`
      SELECT id, salt, code_hash, expires_at, consumed_at
      FROM binding_codes ORDER BY created_at DESC, rowid DESC
    `).all() as BindingCodeRow[];
    return rows.find((row) => verify(code, row.salt, row.code_hash));
  }

  #recordFailedAttempt(input: BindingIdentity & { now: string }, code: "BINDING_CODE_INVALID" | "BINDING_CODE_EXPIRED" | "BINDING_CODE_CONSUMED", message: string): BindingError {
    this.database.prepare("INSERT INTO binding_attempts(app_id, open_id, attempted_at) VALUES (?, ?, ?)")
      .run(input.appId, input.openId, input.now);
    return new BindingError(code, message);
  }

  #recordConsumeOperation(
    input: BindingIdentity & { operationKey: string; operationCodeSalt: string; operationCodeHash: string; now: string },
    outcome: "BINDING_CODE_INVALID" | "BINDING_CODE_EXPIRED" | "BINDING_CODE_CONSUMED" | "BINDING_RATE_LIMITED",
  ): void {
    this.database.prepare(`
      INSERT INTO binding_operations(
        operation_key, kind, outcome, binding_id, created_at, app_id, tenant_key, open_id, code_salt, code_hash
      ) VALUES (?, 'bind', ?, NULL, ?, ?, ?, ?, ?, ?)
    `).run(input.operationKey, outcome, input.now, input.appId, input.tenantKey, input.openId, input.operationCodeSalt, input.operationCodeHash);
  }

  #replayConsumeOutcome(outcome: string): { bound: true } {
    if (outcome === "bound") return { bound: true };
    if (outcome === "BINDING_CODE_INVALID" || outcome === "BINDING_CODE_EXPIRED" || outcome === "BINDING_CODE_CONSUMED" || outcome === "BINDING_RATE_LIMITED") {
      const message = outcome === "BINDING_RATE_LIMITED" ? "Too many failed binding attempts" : "Binding operation previously failed";
      throw new BindingError(outcome, message, outcome === "BINDING_RATE_LIMITED");
    }
    throw new BindingError("BINDING_CODE_INVALID", "Binding operation has an invalid stored outcome");
  }
}

export function createSqliteBindingService(options: {
  database: SqliteDatabase;
  clock: Clock;
  ids?: IdGenerator;
  crypto?: BindingCrypto;
}): BindingService {
  const ids = options.ids ?? { next: randomUUID };
  return createBindingService({
    repository: new SqliteBindingRepository(options.database, () => ids.next()),
    clock: options.clock,
    ids,
    ...(options.crypto ? { crypto: options.crypto } : {}),
  });
}
