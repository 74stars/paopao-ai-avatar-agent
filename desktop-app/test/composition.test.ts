import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAiConfigServices, createMainComposition, governanceCall } from "../electron/composition.js";
import type { AiCredentialStore } from "../electron/credential-store.js";
import { currentSchemaVersion, GovernanceError, openSqlite } from "@paopao/infrastructure";
import { CaptureUnavailableDuringRestoreError } from "@paopao/infrastructure";
import type { DomainEventV1 } from "@paopao/contracts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function createSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  };
}

function createCompositionOptions(directory: string, now: () => string, migrationsDirectory = join(process.cwd(), "..", "packages", "infrastructure", "src", "database", "migrations")) {
  return {
    databasePath: join(directory, "db", "paopao.sqlite"),
    migrationsDirectory,
    promptsDirectory: join(process.cwd(), "..", "prompts"),
    credentialsPath: join(directory, "secrets", "credentials.v1.json"),
    safeStorage: createSafeStorage(),
    publish: { publish: vi.fn() },
    now,
  };
}

function createCaptureCommand(sequence: string, rawText: string) {
  return {
    version: 1 as const,
    requestId: `30000000-0000-4000-8000-0000000000${sequence}`,
    source: "desktop" as const,
    modality: "text" as const,
    rawText,
    mode: "remember" as const,
    receivedAt: "2026-08-07T00:00:00.000Z",
    sourceKey: `desktop:30000000-0000-4000-8000-0000000000${sequence}`,
  };
}

function createFakeAdapterFactory(calls: string[], options: { leakCredentialOnConnect?: boolean } = {}) {
  return ((dependencies: Parameters<NonNullable<Parameters<typeof createMainComposition>[0]["adapterFactory"]>>[0]) => {
    let status = "disconnected" as const | "connected";
    const handlers = new Set<(event: Extract<DomainEventV1, { type: "feishu:status" }>) => void>();
    const emit = () => {
      const event = { version: 1 as const, type: "feishu:status" as const, status, occurredAt: "2026-08-07T00:00:00.000Z" };
      for (const handler of handlers) handler(event);
    };
    return {
      async connect() {
        calls.push("adapter:connect");
        if (options.leakCredentialOnConnect) {
          const credential = await dependencies.credentialProvider.getFeishuCredential();
          if (credential) dependencies.logger.log({
            timestamp: "2026-08-07T00:00:00.000Z",
            level: "error",
            event: credential.appSecret,
            correlationId: "20000000-0000-4000-8000-000000000001",
            provider: "feishu",
          });
        }
        status = "connected";
        emit();
      },
      async disconnect() { calls.push("adapter:disconnect"); status = "disconnected"; emit(); dependencies.credentialProvider.clearDecryptedCache("feishu"); },
      status: () => status,
      async checkConnectionAfterWake() { calls.push("adapter:wake"); },
      subscribeStatus(handler: (event: Extract<DomainEventV1, { type: "feishu:status" }>) => void) { handlers.add(handler); return () => handlers.delete(handler); },
    };
  }) as NonNullable<Parameters<typeof createMainComposition>[0]["adapterFactory"]>;
}

describe("AI configuration composition", () => {
  it("resumes configuration-waiting jobs after save", async () => {
    const configured = { version: 1 as const, isConfigured: true, provider: "openai", model: "gpt-4o-mini-2024-07-18" };
    const store = { save: vi.fn(() => configured) } as unknown as AiCredentialStore;
    const worker = { resumeWaiting: vi.fn(() => 2) };
    const services = createAiConfigServices(store, worker);
    await expect(services.save({ version: 1, provider: "openai", model: "gpt-4o-mini-2024-07-18", apiKey: "test-key" })).resolves.toEqual(configured);
    expect(worker.resumeWaiting).toHaveBeenCalledWith("configuration");
  });
  it("does not resume when save fails", async () => {
    const store = { save: vi.fn(() => { throw new Error("save failed"); }) } as unknown as AiCredentialStore;
    const worker = { resumeWaiting: vi.fn() };
    const services = createAiConfigServices(store, worker);
    await expect(services.save({ version: 1, provider: "openai", model: "gpt-4o-mini-2024-07-18", apiKey: "test-key" })).rejects.toThrow("save failed");
    expect(worker.resumeWaiting).not.toHaveBeenCalled();
  });
});

describe("AI Provider V2 composition migration", () => {
  it("does not resurrect a deleted legacy profile after restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "paopao-provider-migration-"));
    temporaryDirectories.push(directory);
    const options = createCompositionOptions(directory, () => "2026-08-11T00:00:00.000Z");
    const first = await createMainComposition(options);
    await first.services.aiConfig.save({ version: 1, provider: "openai", model: "gpt-4o-mini-2024-07-18", apiKey: "legacy-provider-secret" });
    const migrated = await first.services.aiProviders!.list();
    expect(migrated.profiles).toHaveLength(1);
    await first.services.aiProviders!.delete(migrated.profiles[0]!.id);
    await expect(first.services.aiConfig.status()).resolves.toMatchObject({ isConfigured: false });
    await first.close();

    const reopened = await createMainComposition(options);
    await expect(reopened.services.aiProviders!.list()).resolves.toMatchObject({ activeProfileId: null, profiles: [] });
    await reopened.close();
  });
});

describe("governance composition", () => {
  it("preserves stable conflict codes as a renderer-safe AppError", async () => {
    await expect(governanceCall(async () => { throw new GovernanceError("REVISION_CONFLICT", "changed"); })).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
      message: "changed",
      retryable: false,
      correlationId: expect.any(String),
    });
  });
  it("maps the restore capture gate to DATABASE_UNAVAILABLE", async () => {
    await expect(governanceCall(async () => { throw new CaptureUnavailableDuringRestoreError(); })).rejects.toMatchObject({ code: "DATABASE_UNAVAILABLE", retryable: true });
  });
});

describe("Wave 3 Feishu desktop composition", () => {
  it("owns credential, binding, reply-mode, wake, and adapter lifecycle wiring", async () => {
    const directory = mkdtempSync(join(tmpdir(), "paopao-composition-feishu-"));
    temporaryDirectories.push(directory);
    const calls: string[] = [];
    const published: DomainEventV1[] = [];
    const composition = await createMainComposition({
      ...createCompositionOptions(directory, () => "2026-08-07T00:00:00.000Z"),
      adapterFactory: createFakeAdapterFactory(calls),
      publish: { publish: (event: DomainEventV1) => { published.push(event); } },
    });

    await expect(composition.services.settings!.getPublic()).resolves.toMatchObject({
      feishu: { configured: false, status: "not_configured", bound: false, replyMode: "ack_only", deliveryIssueCount: 0 },
    });
    await expect(composition.services.settings!.saveFeishuCredential({ version: 1, appId: "cli_wave3_test_app", appSecret: "wave3-secret" })).resolves.toEqual({ configured: true, updatedAt: "2026-08-07T00:00:00.000Z" });
    await expect(composition.services.settings!.getPublic()).resolves.toMatchObject({ feishu: { configured: true, appIdMasked: "cli_..._app" } });

    await composition.start();
    await composition.checkConnectionAfterWake();
    expect(calls).toContain("adapter:connect");
    expect(calls).toContain("adapter:wake");
    expect(published).toContainEqual(expect.objectContaining({ type: "feishu:status", status: "connected" }));

    const code = await composition.services.feishu!.createBindingCode();
    expect(code.code).toMatch(/^\d{6}$/);
    expect(new Date(code.expiresAt).getTime()).toBe(new Date("2026-08-07T00:10:00.000Z").getTime());
    const updated = await composition.services.settings!.updatePublic({ version: 1, feishuReplyMode: "insight" });
    expect(updated.feishu.replyMode).toBe("insight");

    await composition.services.settings!.deleteFeishuCredential();
    await expect(composition.services.settings!.getPublic()).resolves.toMatchObject({ feishu: { configured: false, appIdMasked: null } });
    await composition.close();
    expect(calls.filter((call) => call === "adapter:disconnect").length).toBeGreaterThanOrEqual(3);
  });

  it("includes the Feishu App Secret in the Main-only diagnostics canary", async () => {
    const directory = mkdtempSync(join(tmpdir(), "paopao-composition-feishu-canary-"));
    temporaryDirectories.push(directory);
    const composition = await createMainComposition({
      ...createCompositionOptions(directory, () => "2026-08-07T00:00:00.000Z"),
      adapterFactory: createFakeAdapterFactory([], { leakCredentialOnConnect: true }),
    });
    await composition.services.settings!.saveFeishuCredential({ version: 1, appId: "cli_canary_test", appSecret: "synthetic-feishu-canary-secret" });
    await composition.start();

    const receipt = await composition.services.diagnostics!.create({ version: 1, requestId: "20000000-0000-4000-8000-000000000002", includeDays: 1 });
    let status = await composition.services.diagnostics!.get({ version: 1, diagnosticExportId: receipt.diagnosticExportId });
    for (let attempt = 0; attempt < 100 && status.status !== "ready" && status.status !== "failed"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      status = await composition.services.diagnostics!.get({ version: 1, diagnosticExportId: receipt.diagnosticExportId });
    }

    expect(status).toMatchObject({ status: "failed", errorCode: "DIAGNOSTICS_EXPORT_FAILED", path: null });
    await composition.close();
  });
});

describe("backup lifecycle composition", () => {
  it("creates a startup backup on first launch and only repeats it after 24 hours", async () => {
    const directory = mkdtempSync(join(tmpdir(), "paopao-composition-backup-"));
    temporaryDirectories.push(directory);
    let currentTime = "2026-08-07T00:00:00.000Z";
    const options = createCompositionOptions(directory, () => currentTime);

    const first = await createMainComposition(options);
    expect((await first.services.backups.list()).backups).toMatchObject([{ reason: "startup", createdAt: currentTime }]);
    await first.close();

    currentTime = "2026-08-07T23:59:59.999Z";
    const beforeDue = await createMainComposition(options);
    expect((await beforeDue.services.backups.list()).backups).toHaveLength(1);
    await beforeDue.close();

    currentTime = "2026-08-08T00:00:00.000Z";
    const afterDue = await createMainComposition(options);
    const backups = (await afterDue.services.backups.list()).backups;
    expect(backups).toHaveLength(2);
    expect(backups.map((backup) => backup.reason)).toEqual(["startup", "startup"]);
    await afterDue.close();
  });

  it("rolls back an interrupted restore before exposing the recovered runtime", async () => {
    const directory = mkdtempSync(join(tmpdir(), "paopao-composition-recovery-"));
    temporaryDirectories.push(directory);
    const now = () => "2026-08-07T00:00:00.000Z";
    const options = createCompositionOptions(directory, now);
    const first = await createMainComposition(options);
    await first.services.capture.capture(createCaptureCommand("01", "must survive recovery"));
    await first.close();

    const restoreId = "50000000-0000-4000-8000-000000000001";
    const restoreDirectory = join(directory, "db", "restore");
    const rollbackPath = join(restoreDirectory, `${restoreId}.rollback.sqlite`);
    mkdirSync(restoreDirectory, { recursive: true });
    copyFileSync(options.databasePath, rollbackPath);

    const modified = await createMainComposition(options);
    await modified.services.capture.capture(createCaptureCommand("02", "must be rolled back"));
    await modified.close();
    writeFileSync(join(restoreDirectory, "restore-state.v1.json"), `${JSON.stringify({
      version: 1,
      activeRestoreId: restoreId,
      operations: {
        [restoreId]: {
          restoreId,
          backupId: "50000000-0000-4000-8000-000000000099",
          requestId: restoreId,
          status: "reopening",
          errorCode: null,
          updatedAt: now(),
          rollbackPath,
        },
      },
    }, null, 2)}\n`);

    const recovered = await createMainComposition(options);
    const entries = await recovered.services.entries.list({ version: 1, limit: 10 });
    expect(entries.items).toHaveLength(1);
    await expect(recovered.services.entries.get(entries.items[0]!.id)).resolves.toMatchObject({ rawText: "must survive recovery" });
    await expect(recovered.services.backups.status(restoreId)).resolves.toMatchObject({ status: "failed_rolled_back", errorCode: "RESTORE_FAILED" });
    await recovered.close();
  });

  it("uses the backup service as the migration backup port", async () => {
    const directory = mkdtempSync(join(tmpdir(), "paopao-composition-migration-"));
    temporaryDirectories.push(directory);
    const now = () => "2026-08-07T00:00:00.000Z";
    const options = createCompositionOptions(directory, now);
    const first = await createMainComposition(options);
    await first.services.capture.capture(createCaptureCommand("03", "preserved before migration"));
    expect((await first.services.backups.list()).backups[0]?.databaseSchemaVersion).toBe(3);
    await first.close();

    const migrationsDirectory = join(directory, "migrations");
    mkdirSync(migrationsDirectory, { recursive: true });
    const initialMigration = join(options.migrationsDirectory, "001_initial.sql");
    const wave3Migration = join(options.migrationsDirectory, "002_wave3_binding_delivery.sql");
    const bindingOutcomeMigration = join(options.migrationsDirectory, "003_binding_operation_outcomes.sql");
    writeFileSync(join(migrationsDirectory, "001_initial.sql"), readFileSync(initialMigration));
    writeFileSync(join(migrationsDirectory, "002_wave3_binding_delivery.sql"), readFileSync(wave3Migration));
    writeFileSync(join(migrationsDirectory, "003_binding_operation_outcomes.sql"), readFileSync(bindingOutcomeMigration));
    writeFileSync(join(migrationsDirectory, "004_composition_test.sql"), "CREATE TABLE composition_migration_probe(id TEXT PRIMARY KEY);\n");

    const migrated = await createMainComposition({ ...options, migrationsDirectory });
    const backups = (await migrated.services.backups.list()).backups;
    expect(backups.map((backup) => backup.reason).sort()).toEqual(["pre_migration", "startup"]);
    expect(backups.every((backup) => backup.databaseSchemaVersion === 3)).toBe(true);
    expect((await migrated.services.entries.summary()).total).toBe(1);
    await migrated.close();
    const database = openSqlite(options.databasePath, { readonly: true, fileMustExist: true });
    try {
      expect(currentSchemaVersion(database)).toBe(4);
    } finally {
      database.close();
    }
  });
});
