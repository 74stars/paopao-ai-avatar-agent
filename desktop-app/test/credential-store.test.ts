import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMainComposition } from "../electron/composition.js";
import { createAiCredentialStore, createMainCredentialStore, type SafeStorageLike } from "../electron/credential-store.js";

const TEST_KEY = "sk-test-credential-store-0001";
const PROVIDER = "openai" as const;
const MODEL = "gpt-4o-mini-2024-07-18" as const;

function createSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText) => Buffer.from(Array.from(Buffer.from(plainText, "utf8")).reverse()),
    decryptString: (encrypted) => Buffer.from(Array.from(encrypted).reverse()).toString("utf8"),
  };
}

describe("createAiCredentialStore", () => {
  let directory: string;
  let filePath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "paopao-credential-"));
    filePath = join(directory, "secrets", "credentials.v1.json");
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("status exposes only isConfigured/provider/model and never the key", () => {
    const store = createAiCredentialStore({ filePath, safeStorage: createSafeStorage() });
    expect(store.status()).toEqual({ version: 1, isConfigured: false, provider: null, model: null });

    store.save({ version: 1, provider: PROVIDER, model: MODEL, apiKey: TEST_KEY });
    const status = store.status();
    expect(status).toEqual({ version: 1, isConfigured: true, provider: PROVIDER, model: MODEL });
    expect(JSON.stringify(status)).not.toContain(TEST_KEY);
  });

  it("persists ciphertext atomically and reloads from disk", () => {
    const store = createAiCredentialStore({ filePath, safeStorage: createSafeStorage() });
    store.save({ version: 1, provider: PROVIDER, model: MODEL, apiKey: TEST_KEY });

    expect(existsSync(`${filePath}.tmp`)).toBe(false);
    const onDisk = readFileSync(filePath, "utf8");
    expect(onDisk).not.toContain(TEST_KEY);
    expect(onDisk).toContain(`"provider":"${PROVIDER}"`);

    const reopened = createAiCredentialStore({ filePath, safeStorage: createSafeStorage() });
    expect(reopened.status().isConfigured).toBe(true);
    expect(reopened.readApiKey()).toBe(TEST_KEY);
    expect(reopened.status()).not.toHaveProperty("apiKey");
  });

  it("delete removes the credential and invalidates the read surface", () => {
    const store = createAiCredentialStore({ filePath, safeStorage: createSafeStorage() });
    store.save({ version: 1, provider: PROVIDER, model: MODEL, apiKey: TEST_KEY });
    expect(store.readApiKey()).toBe(TEST_KEY);

    const status = store.delete();
    expect(status).toEqual({ version: 1, isConfigured: false, provider: null, model: null });
    expect(existsSync(filePath)).toBe(false);
    expect(store.readApiKey()).toBeNull();
  });

  it("fails closed when encryption is unavailable", () => {
    const store = createAiCredentialStore({ filePath, safeStorage: createSafeStorage(false) });
    expect(() => store.save({ version: 1, provider: PROVIDER, model: MODEL, apiKey: TEST_KEY }))
      .toThrowError(expect.objectContaining({ code: "SAFE_STORAGE_UNAVAILABLE" }));
    expect(store.status().isConfigured).toBe(false);
    expect(store.readApiKey()).toBeNull();
  });

  it("fails closed when a credential file exists but encryption is unavailable", () => {
    const available = createAiCredentialStore({ filePath, safeStorage: createSafeStorage() });
    available.save({ version: 1, provider: PROVIDER, model: MODEL, apiKey: TEST_KEY });

    const unavailable = createAiCredentialStore({ filePath, safeStorage: createSafeStorage(false) });
    expect(unavailable.status().isConfigured).toBe(false);
    expect(unavailable.readApiKey()).toBeNull();
  });

  it("fails closed on a corrupt credential file", () => {
    mkdirSync(join(directory, "secrets"), { recursive: true });
    writeFileSync(filePath, "{ not valid json");
    const store = createAiCredentialStore({ filePath, safeStorage: createSafeStorage() });
    expect(store.status()).toEqual({ version: 1, isConfigured: false, provider: null, model: null });
    expect(store.readApiKey()).toBeNull();
  });

  it("bumps generation on save and delete so cached providers can be invalidated", () => {
    const store = createAiCredentialStore({ filePath, safeStorage: createSafeStorage() });
    const initial = store.generation();
    store.save({ version: 1, provider: PROVIDER, model: MODEL, apiKey: TEST_KEY });
    expect(store.generation()).toBe(initial + 1);
    store.delete();
    expect(store.generation()).toBe(initial + 2);
  });
});

describe("Wave 3 main credential facade", () => {
  let directory: string;
  let credentialsPath: string;
  let publicSettingsPath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "paopao-main-credential-"));
    credentialsPath = join(directory, "secrets", "credentials.v1.json");
    publicSettingsPath = join(directory, "settings", "public.v1.json");
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it("encrypts the Feishu secret, exposes only a masked App ID, and can clear its decrypted cache", async () => {
    const store = createMainCredentialStore({ filePath: credentialsPath, publicSettingsPath, safeStorage: createSafeStorage(), now: () => "2026-08-08T01:02:03Z" });
    const receipt = store.saveFeishu({ version: 1, appId: "cli_a1b2c3d4e5f6", appSecret: "feishu-secret-test-only" });

    expect(receipt).toEqual({ configured: true, updatedAt: "2026-08-08T01:02:03Z" });
    expect(store.feishuStatus()).toEqual({ isConfigured: true, appIdMasked: "cli_...e5f6" });
    expect(readFileSync(credentialsPath, "utf8")).not.toContain("feishu-secret-test-only");
    expect(readFileSync(publicSettingsPath, "utf8")).not.toContain("feishu-secret-test-only");
    await expect(store.getFeishuCredential()).resolves.toEqual({ appId: "cli_a1b2c3d4e5f6", appSecret: "feishu-secret-test-only" });
    expect(store.readFeishuAppSecret()).toBe("feishu-secret-test-only");
    store.clearDecryptedCache("feishu");
    await expect(store.getFeishuCredential()).resolves.toEqual({ appId: "cli_a1b2c3d4e5f6", appSecret: "feishu-secret-test-only" });

    expect(store.deleteFeishu()).toEqual({ configured: false });
    expect(store.readFeishuAppSecret()).toBeNull();
    await expect(store.getFeishuCredential()).resolves.toBeNull();
    expect(store.feishuStatus()).toEqual({ isConfigured: false, appIdMasked: null });
  });

  it("keeps AI and Feishu credentials isolated when either scope is deleted", async () => {
    const store = createMainCredentialStore({ filePath: credentialsPath, publicSettingsPath, safeStorage: createSafeStorage() });
    store.save({ version: 1, provider: PROVIDER, model: MODEL, apiKey: TEST_KEY });
    store.saveFeishu({ version: 1, appId: "cli_isolated_app", appSecret: "isolated-secret" });

    store.delete();
    expect(store.readApiKey()).toBeNull();
    await expect(store.getFeishuCredential()).resolves.toMatchObject({ appId: "cli_isolated_app", appSecret: "isolated-secret" });
    expect(existsSync(credentialsPath)).toBe(true);

    store.save({ version: 1, provider: PROVIDER, model: MODEL, apiKey: TEST_KEY });
    store.deleteFeishu();
    expect(store.readApiKey()).toBe(TEST_KEY);
    await expect(store.getFeishuCredential()).resolves.toBeNull();
  });

  it("defaults to ack_only and persists only an explicit insight selection", async () => {
    const store = createMainCredentialStore({ filePath: credentialsPath, publicSettingsPath, safeStorage: createSafeStorage() });
    await expect(store.getFeishuReplyMode()).resolves.toBe("ack_only");
    store.updateFeishuReplyMode("insight");
    const reopened = createMainCredentialStore({ filePath: credentialsPath, publicSettingsPath, safeStorage: createSafeStorage() });
    await expect(reopened.getFeishuReplyMode()).resolves.toBe("insight");
  });

  it("refuses Feishu credential writes when safeStorage is unavailable", () => {
    const store = createMainCredentialStore({ filePath: credentialsPath, publicSettingsPath, safeStorage: createSafeStorage(false) });
    expect(() => store.saveFeishu({ version: 1, appId: "cli_no_storage", appSecret: "must-not-persist" }))
      .toThrowError(expect.objectContaining({ code: "SAFE_STORAGE_UNAVAILABLE" }));
    expect(existsSync(credentialsPath)).toBe(false);
  });
});

describe("credential store integration: no test key outside the encrypted store", () => {
  it("keeps the key out of SQLite, logs, events and renderer-facing status", async () => {
    const directory = mkdtempSync(join(tmpdir(), "paopao-credential-integration-"));
    const databasePath = join(directory, "db", "paopao.sqlite");
    const credentialsPath = join(directory, "secrets", "credentials.v1.json");
    const published: unknown[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const composition = await createMainComposition({
        databasePath,
        migrationsDirectory: join(process.cwd(), "..", "packages", "infrastructure", "src", "database", "migrations"),
        promptsDirectory: join(process.cwd(), "..", "prompts"),
        credentialsPath,
        safeStorage: createSafeStorage(),
        publish: { publish: (event) => { published.push(event); } },
        now: () => "2026-08-07T00:00:00Z",
      });

      const saved = await composition.services.aiConfig.save({ version: 1, provider: PROVIDER, model: MODEL, apiKey: TEST_KEY });
      expect(saved.isConfigured).toBe(true);
      expect(JSON.stringify(saved)).not.toContain(TEST_KEY);
      await expect(composition.services.aiProviders!.list()).resolves.toMatchObject({
        profiles: [{ kind: "direct", providerId: PROVIDER, model: MODEL, credentialConfigured: true }],
      });
      expect(readFileSync(composition.providerProfilesPath, "utf8")).not.toContain(TEST_KEY);

      await composition.services.capture.capture({
        version: 1,
        requestId: "30000000-0000-4000-8000-000000000001",
        source: "desktop",
        modality: "text",
        rawText: "这是一条测试记忆，用于验证凭据不进入 SQLite。",
        mode: "remember",
        receivedAt: "2026-08-07T00:00:00Z",
        sourceKey: "desktop:30000000-0000-4000-8000-000000000001",
      });

      for (const file of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
        if (existsSync(file)) expect(readFileSync(file).includes(TEST_KEY)).toBe(false);
      }
      expect(readFileSync(credentialsPath, "utf8")).not.toContain(TEST_KEY);
      expect(JSON.stringify(published)).not.toContain(TEST_KEY);
      expect(logSpy.mock.calls.flat().join(" ")).not.toContain(TEST_KEY);
      expect(errorSpy.mock.calls.flat().join(" ")).not.toContain(TEST_KEY);

      const status = await composition.services.aiConfig.status();
      expect(status).not.toHaveProperty("apiKey");
      expect(JSON.stringify(status)).not.toContain(TEST_KEY);

      await composition.close();
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
