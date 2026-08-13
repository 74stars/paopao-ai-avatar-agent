import { describe, expect, it, vi } from "vitest";
import type { DesktopApiV1, DesktopCoreServicesV1 } from "../electron/ipc.js";
import { createDesktopApi, IPC_CHANNELS, registerPaopaoIpc } from "../electron/ipc.js";

const entryId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";
const correlationId = "00000000-0000-4000-8000-000000000003";
const now = "2026-08-06T08:00:00Z";

class FakeIpcMain {
  handlers = new Map<string, (event: unknown, input: unknown) => unknown>();
  handle(channel: string, listener: (event: unknown, input: unknown) => unknown) { this.handlers.set(channel, listener); }
  removeHandler(channel: string) { this.handlers.delete(channel); }
  invoke(channel: string, input: unknown) {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`Missing handler: ${channel}`);
    return handler({}, input);
  }
}

function createApi(): DesktopApiV1 {
  return {
    capture: { create: vi.fn(async () => ({ ok: true as const, data: { entryId, jobId, status: "stored" as const, deduplicated: false, createdAt: now } })) },
    entries: {
      list: vi.fn(async () => ({ ok: true as const, data: { items: [], nextCursor: null } })),
      get: vi.fn(async () => ({
        ok: true as const,
        data: {
          id: entryId,
          source: "desktop" as const,
          rawText: "原文",
          currentText: "原文",
          textRevisions: [{ revision: 1, text: "原文", createdBy: "system" as const, createdAt: now }],
          status: "stored" as const,
          createdAt: now,
          updatedAt: now,
          memory: null,
          derivations: [],
          sources: [],
          activeJobs: [{ id: jobId, type: "analyze_entry" as const, status: "queued" as const, attempts: 0, nextRunAt: null, lastErrorCode: null }]
        }
      })),
      reviseText: vi.fn(async () => ({ ok: true as const, data: { entryId, textRevision: 2, affectedJobIds: [jobId] } })),
      correct: vi.fn(async () => ({ ok: true as const, data: { entryId, textRevision: 1, derivationId: correlationId, supersedesDerivationId: null, affectedJobIds: [] } })),
      delete: vi.fn(async () => ({ ok: true as const, data: { entryId, deletionJobId: jobId, status: "deleting" as const } })),
    },
    jobs: { retry: vi.fn(async () => ({ ok: true as const, data: { jobId, status: "queued" as const } })) },
    exports: { create: vi.fn(async () => ({ ok: true as const, data: { exportId: jobId, status: "queued" as const } })), get: vi.fn(async () => ({ ok: true as const, data: { exportId: jobId, status: "queued" as const, path: null, sha256: null, errorCode: null } })) },
    diagnostics: { createExport: vi.fn(async () => ({ ok: true as const, data: { diagnosticExportId: jobId, status: "queued" as const } })), getExport: vi.fn(async () => ({ ok: true as const, data: { diagnosticExportId: jobId, status: "queued" as const, path: null, sha256: null, errorCode: null } })) },
    backups: { list: vi.fn(async () => ({ ok: true as const, data: { backups: [] } })), restore: vi.fn(async () => ({ ok: true as const, data: { restoreId: jobId, backupId: entryId, status: "queued" as const } })), status: vi.fn(async () => ({ ok: true as const, data: { restoreId: jobId, backupId: entryId, status: "failed_rolled_back" as const, errorCode: "RESTORE_FAILED" as const, updatedAt: now } })) },
    library: { summary: vi.fn(async () => ({ ok: true as const, data: { total: 0, shelves: [] } })) },
    settings: {
      getPublic: vi.fn(async () => ({ ok: true as const, data: publicSettings() })),
      updatePublic: vi.fn(async () => ({ ok: true as const, data: publicSettings("insight") })),
      saveAiCredential: vi.fn(async () => ({ ok: true as const, data: { configured: true as const, updatedAt: now } })),
      deleteAiCredential: vi.fn(async () => ({ ok: true as const, data: { configured: false as const } })),
      saveFeishuCredential: vi.fn(async () => ({ ok: true as const, data: { configured: true as const, updatedAt: now } })),
      deleteFeishuCredential: vi.fn(async () => ({ ok: true as const, data: { configured: false as const } })),
    },
    aiProviders: {
      list: vi.fn(async () => ({ ok: true as const, data: { version: 2 as const, activeProfileId: null, profiles: [] } })),
      save: vi.fn(async (input) => ({ ok: true as const, data: { version: 2 as const, profile: { ...input.profile, revision: 1, updatedAt: now, credentialConfigured: true }, activeProfileId: input.profile.id } })),
      activate: vi.fn(async (input) => ({ ok: true as const, data: { version: 2 as const, activeProfileId: input.profileId, profiles: [] } })),
      delete: vi.fn(async (input) => ({ ok: true as const, data: { version: 2 as const, deletedProfileId: input.profileId, activeProfileId: null } })),
      probe: vi.fn(async (input) => ({ ok: true as const, data: { version: 2 as const, profileId: input.profileId, status: "ready" as const, provider: "openai", model: "test-model", latencyMs: 10, checkedAt: now } })),
      discoverCodex: vi.fn(async () => ({ ok: true as const, data: { version: 2 as const, installed: false, cliVersion: null, authenticated: false, authMode: null, provider: null, models: [], errorCode: "CODEX_NOT_INSTALLED" as const } })),
    },
    feishu: {
      connect: vi.fn(async () => ({ ok: true as const, data: { status: "connecting" as const } })),
      disconnect: vi.fn(async () => ({ ok: true as const, data: { status: "disconnected" as const } })),
      createBindingCode: vi.fn(async () => ({ ok: true as const, data: { code: "012345", expiresAt: now } })),
      listDeliveryIssues: vi.fn(async () => ({ ok: true as const, data: { items: [], nextCursor: null } })),
      resolveDeliveryIssue: vi.fn(async () => ({ ok: true as const, data: { status: "pending" as const } })),
    }
  };
}

function publicSettings(replyMode: "ack_only" | "insight" = "ack_only") {
  return {
    ai: { configured: false, provider: null, model: null },
    feishu: { configured: true, appIdMasked: "cli_...0001", status: "connected" as const, bound: false, replyMode, deliveryIssueCount: 0 },
    data: { databasePath: "/test/paopao.sqlite", lastBackupAt: null },
  };
}

describe("v1 IPC routes", () => {
  it("maps a desktop request to the frozen Core capture command", async () => {
    const capture = vi.fn(async () => ({ entryId, jobId, status: "stored" as const, deduplicated: false, createdAt: now }));
    const services = {
      capture: { capture },
      entries: {
        list: vi.fn(),
        get: vi.fn(),
        summary: vi.fn()
      }
    } as unknown as DesktopCoreServicesV1;
    const api = createDesktopApi(services, () => new Date(now));

    const result = await api.capture.create({ version: 1, requestId: entryId, rawText: "  保留原文  ", mode: "think" });

    expect(result.ok).toBe(true);
    expect(capture).toHaveBeenCalledWith({
      version: 1,
      requestId: entryId,
      source: "desktop",
      modality: "text",
      rawText: "  保留原文  ",
      mode: "think",
      receivedAt: "2026-08-06T08:00:00.000Z",
      sourceKey: `desktop:${entryId}`
    });
  });

  it("rejects unknown input fields before calling Core", async () => {
    const ipc = new FakeIpcMain();
    const api = createApi();
    registerPaopaoIpc(ipc, api);

    const result = await ipc.invoke(IPC_CHANNELS.captureCreate, { version: 1, requestId: entryId, rawText: "hello", mode: "remember", source: "desktop" });

    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED", retryable: false } });
    expect(api.capture.create).not.toHaveBeenCalled();
  });

  it("returns a schema-validated stored receipt", async () => {
    const ipc = new FakeIpcMain();
    const api = createApi();
    registerPaopaoIpc(ipc, api);

    const result = await ipc.invoke(IPC_CHANNELS.captureCreate, { version: 1, requestId: entryId, rawText: "hello", mode: "remember" });

    expect(result).toEqual({ ok: true, data: { entryId, jobId, status: "stored", deduplicated: false, createdAt: now } });
    expect(api.capture.create).toHaveBeenCalledOnce();
  });

  it("does not pass malformed service output to the Renderer", async () => {
    const ipc = new FakeIpcMain();
    const api = createApi();
    api.library.summary = vi.fn(async () => ({ ok: true, data: { total: -1, shelves: [] } })) as DesktopApiV1["library"]["summary"];
    registerPaopaoIpc(ipc, api);

    const result = await ipc.invoke(IPC_CHANNELS.librarySummary, { version: 1 });

    expect(result).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
  });

  it("preserves error semantics but redacts internal text at the IPC boundary", async () => {
    const ipc = new FakeIpcMain();
    const api = createApi();
    api.entries.list = vi.fn(async () => { throw { code: "DATABASE_UNAVAILABLE", message: "database closed at /private/user-data/paopao.sqlite", retryable: true, correlationId, details: { databasePath: "/private/user-data/paopao.sqlite" } }; });
    registerPaopaoIpc(ipc, api);

    const result = await ipc.invoke(IPC_CHANNELS.entryList, { version: 1 });

    expect(result).toEqual({ ok: false, error: { code: "DATABASE_UNAVAILABLE", message: "请求未能完成。", retryable: true, correlationId } });
    expect(JSON.stringify(result)).not.toContain("paopao.sqlite");
  });

  it("removes every registered handler during shutdown", () => {
    const ipc = new FakeIpcMain();
    const unregister = registerPaopaoIpc(ipc, createApi());
    expect(ipc.handlers.size).toBe(32);
    unregister();
    expect(ipc.handlers.size).toBe(0);
  });

  it("rejects renderer-selected paths for exports and restores", async () => {
    const ipc = new FakeIpcMain();
    const api = createApi();
    registerPaopaoIpc(ipc, api);
    const exportResult = await ipc.invoke(IPC_CHANNELS.exportCreate, { version: 1, requestId: correlationId, format: "json", includeDeleted: false, path: "/tmp/user-selected" });
    const restoreResult = await ipc.invoke(IPC_CHANNELS.backupRestore, { version: 1, requestId: correlationId, backupId: entryId, confirmation: "RESTORE", path: "/tmp/foreign.sqlite" });
    expect(exportResult).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(restoreResult).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(api.exports.create).not.toHaveBeenCalled();
    expect(api.backups.restore).not.toHaveBeenCalled();
  });

  it("preserves a failed restore journal state without reporting success", async () => {
    const ipc = new FakeIpcMain();
    const api = createApi();
    registerPaopaoIpc(ipc, api);
    await expect(ipc.invoke(IPC_CHANNELS.backupStatus, { version: 1, restoreId: jobId })).resolves.toEqual({ ok: true, data: { restoreId: jobId, backupId: entryId, status: "failed_rolled_back", errorCode: "RESTORE_FAILED", updatedAt: now } });
  });

  it("validates and forwards optimistic text revisions", async () => {
    const ipc = new FakeIpcMain();
    const api = createApi();
    registerPaopaoIpc(ipc, api);
    const input = { version: 1, requestId: correlationId, entryId, expectedTextRevision: 1, text: "修改后的原文" } as const;

    await expect(ipc.invoke(IPC_CHANNELS.entryReviseText, input)).resolves.toEqual({ ok: true, data: { entryId, textRevision: 2, affectedJobIds: [jobId] } });
    expect(api.entries.reviseText).toHaveBeenCalledWith(input);
    const invalid = await ipc.invoke(IPC_CHANNELS.entryReviseText, { ...input, expectedTextRevision: 0 });
    expect(invalid).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });

  it("preserves revision conflicts from corrections", async () => {
    const ipc = new FakeIpcMain();
    const api = createApi();
    api.entries.correct = vi.fn(async () => ({ ok: false as const, error: { code: "REVISION_CONFLICT", message: "changed", retryable: false, correlationId } }));
    registerPaopaoIpc(ipc, api);
    const input = { version: 1, requestId: correlationId, entryId, kind: "summary", expectedDerivationId: null, value: { text: "摘要", confidence: 1, evidence: ["原文"] } } as const;

    await expect(ipc.invoke(IPC_CHANNELS.entryCorrect, input)).resolves.toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
  });

  it("validates manual retry requests and responses", async () => {
    const ipc = new FakeIpcMain();
    const api = createApi();
    registerPaopaoIpc(ipc, api);
    await expect(ipc.invoke(IPC_CHANNELS.jobRetry, { version: 1, jobId })).resolves.toEqual({ ok: true, data: { jobId, status: "queued" } });
    expect(api.jobs.retry).toHaveBeenCalledOnce();
    await expect(ipc.invoke(IPC_CHANNELS.jobRetry, { version: 1, jobId: "not-a-uuid" })).resolves.toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });

  it("settings.getPublic returns configuration state without any key", async () => {
    const ipc = new FakeIpcMain();
    const api = createApi();
    registerPaopaoIpc(ipc, api);

    const result = await ipc.invoke(IPC_CHANNELS.settingsGetPublic, { version: 1 });

    expect(result).toEqual({ ok: true, data: publicSettings() });
    expect(api.settings.getPublic).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("apiKey");
  });

  it("settings.saveAiCredential validates the provider/model allowlist before calling the service", async () => {
    const ipc = new FakeIpcMain();
    const api = createApi();
    registerPaopaoIpc(ipc, api);

    const invalidProvider = await ipc.invoke(IPC_CHANNELS.settingsSaveAiCredential, { version: 1, provider: "anthropic", model: "claude", apiKey: "sk-1" });
    const missingKey = await ipc.invoke(IPC_CHANNELS.settingsSaveAiCredential, { version: 1, provider: "openai", model: "gpt-4o-mini-2024-07-18", apiKey: "" });

    expect(invalidProvider).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(missingKey).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(api.settings.saveAiCredential).not.toHaveBeenCalled();
  });

  it("settings.saveAiCredential returns a receipt that never contains the key", async () => {
    const ipc = new FakeIpcMain();
    const api = createApi();
    registerPaopaoIpc(ipc, api);

    const result = await ipc.invoke(IPC_CHANNELS.settingsSaveAiCredential, { version: 1, provider: "openai", model: "gpt-4o-mini-2024-07-18", apiKey: "sk-test-leak-guard" });

    expect(result).toEqual({ ok: true, data: { configured: true, updatedAt: now } });
    expect(JSON.stringify(result)).not.toContain("sk-test-leak-guard");
  });

  it("rejects a malformed service response that tries to include the key", async () => {
    const ipc = new FakeIpcMain();
    const api = createApi();
    api.settings.saveAiCredential = vi.fn(async () => ({ ok: true, data: { configured: true, updatedAt: now, apiKey: "sk-test-leak-guard" } })) as DesktopApiV1["settings"]["saveAiCredential"];
    registerPaopaoIpc(ipc, api);

    const result = await ipc.invoke(IPC_CHANNELS.settingsSaveAiCredential, { version: 1, provider: "openai", model: "gpt-4o-mini-2024-07-18", apiKey: "sk-test-leak-guard" });

    expect(result).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
    expect(JSON.stringify(result)).not.toContain("sk-test-leak-guard");
  });

  it("settings.deleteAiCredential removes the configuration", async () => {
    const ipc = new FakeIpcMain();
    const api = createApi();
    registerPaopaoIpc(ipc, api);

    const result = await ipc.invoke(IPC_CHANNELS.settingsDeleteAiCredential, { version: 1 });

    expect(result).toEqual({ ok: true, data: { configured: false } });
    expect(api.settings.deleteAiCredential).toHaveBeenCalledOnce();
  });

  it("validates V2 Provider profiles and never returns a submitted credential", async () => {
    const ipc = new FakeIpcMain();
    const api = createApi();
    registerPaopaoIpc(ipc, api);
    const input = {
      version: 2,
      credential: "provider-write-only-secret",
      profile: {
        id: entryId,
        kind: "direct",
        name: "OpenAI compatible",
        providerId: "compatible",
        protocol: "openai_responses",
        baseUrl: "https://provider.example.com/v1",
        model: "test-model",
        authMode: "bearer",
        authHeaderName: null,
        structuredOutput: "json_schema",
        timeoutMs: 20_000,
      },
    } as const;

    const result = await ipc.invoke(IPC_CHANNELS.aiProvidersSave, input);
    expect(result).toMatchObject({ ok: true, data: { profile: { id: entryId, credentialConfigured: true } } });
    expect(JSON.stringify(result)).not.toContain(input.credential);
    expect(api.aiProviders.save).toHaveBeenCalledWith(input);

    const invalid = await ipc.invoke(IPC_CHANNELS.aiProvidersSave, { ...input, profile: { ...input.profile, timeoutMs: 999 } });
    expect(invalid).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });

  it("rejects a Provider service response that attempts to echo a credential", async () => {
    const ipc = new FakeIpcMain();
    const api = createApi();
    api.aiProviders.list = vi.fn(async () => ({ ok: true, data: { version: 2, activeProfileId: null, profiles: [], credential: "leaked-secret" } })) as DesktopApiV1["aiProviders"]["list"];
    registerPaopaoIpc(ipc, api);

    const result = await ipc.invoke(IPC_CHANNELS.aiProvidersList, { version: 2 });
    expect(result).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
    expect(JSON.stringify(result)).not.toContain("leaked-secret");
  });

  it("preserves SAFE_STORAGE_UNAVAILABLE thrown by the credential service", async () => {
    const ipc = new FakeIpcMain();
    const api = createApi();
    api.settings.saveAiCredential = vi.fn(async () => { throw { code: "SAFE_STORAGE_UNAVAILABLE", message: "system safe storage unavailable", retryable: false, correlationId }; }) as DesktopApiV1["settings"]["saveAiCredential"];
    registerPaopaoIpc(ipc, api);

    const result = await ipc.invoke(IPC_CHANNELS.settingsSaveAiCredential, { version: 1, provider: "openai", model: "gpt-4o-mini-2024-07-18", apiKey: "sk-1" });

    expect(result).toEqual({ ok: false, error: { code: "SAFE_STORAGE_UNAVAILABLE", message: "请求未能完成。", retryable: false, correlationId } });
  });

  it("exposes only write-only credential commands and public settings reads", () => {
    const api = createApi();
    expect(Object.keys(api.settings).sort()).toEqual(["deleteAiCredential", "deleteFeishuCredential", "getPublic", "saveAiCredential", "saveFeishuCredential", "updatePublic"]);
    // @ts-expect-error renderer API must not expose a key-reading method
    api.settings.readApiKey;
    // @ts-expect-error renderer API must not expose the key itself
    api.settings.getFeishuCredential;
  });

  it("returns write-only Feishu credential receipts without echoing App Secret", async () => {
    const ipc = new FakeIpcMain();
    const api = createApi();
    registerPaopaoIpc(ipc, api);
    const appSecret = "feishu-secret-leak-guard";

    const result = await ipc.invoke(IPC_CHANNELS.settingsSaveFeishuCredential, { version: 1, appId: "cli_test_app", appSecret });

    expect(result).toEqual({ ok: true, data: { configured: true, updatedAt: now } });
    expect(JSON.stringify(result)).not.toContain(appSecret);
    expect(api.settings.saveFeishuCredential).toHaveBeenCalledWith({ version: 1, appId: "cli_test_app", appSecret });
  });

  it("exposes a binding code only from the explicit create route", async () => {
    const ipc = new FakeIpcMain();
    const api = createApi();
    registerPaopaoIpc(ipc, api);

    await expect(ipc.invoke(IPC_CHANNELS.feishuCreateBindingCode, { version: 1 })).resolves.toEqual({ ok: true, data: { code: "012345", expiresAt: now } });
    const publicResult = await ipc.invoke(IPC_CHANNELS.settingsGetPublic, { version: 1 });
    expect(JSON.stringify(publicResult)).not.toContain("012345");
  });

  it("requires the duplicate-risk confirmation before forwarding retry_once", async () => {
    const ipc = new FakeIpcMain();
    const api = createApi();
    registerPaopaoIpc(ipc, api);
    const base = { version: 1, requestId: correlationId, messageKey: "feishu:canonical:message", phase: "ack", action: "retry_once" } as const;

    const rejected = await ipc.invoke(IPC_CHANNELS.feishuResolveDeliveryIssue, { ...base, confirmation: "ASSUME_SENT" });
    expect(rejected).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(api.feishu.resolveDeliveryIssue).not.toHaveBeenCalled();

    await expect(ipc.invoke(IPC_CHANNELS.feishuResolveDeliveryIssue, { ...base, confirmation: "RETRY_MAY_DUPLICATE" })).resolves.toEqual({ ok: true, data: { status: "pending" } });
  });
});
