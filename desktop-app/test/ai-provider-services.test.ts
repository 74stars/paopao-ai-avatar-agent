import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiProviderError, type AiProviderV1 } from "@paopao/infrastructure";
import { createAiProviderServices } from "../electron/ai-provider-services.js";
import { createProviderProfileStore, type ResolvedProviderProfile } from "../electron/provider-profile-store.js";

const DIRECT_ID = "10000000-0000-4000-8000-000000000001";
const CODEX_ID = "10000000-0000-4000-8000-000000000002";
const NOW = "2026-08-11T07:00:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function createStore() {
  const directory = mkdtempSync(join(tmpdir(), "paopao-provider-services-"));
  temporaryDirectories.push(directory);
  return createProviderProfileStore({
    filePath: join(directory, "ai-providers.v2.json"),
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value, "utf8"),
      decryptString: (value: Buffer) => value.toString("utf8"),
    },
    now: () => NOW,
  });
}

function directProfile(credential?: string) {
  return {
    version: 2 as const,
    profile: {
      id: DIRECT_ID,
      kind: "direct" as const,
      name: "Responses Provider",
      providerId: "compatible-api",
      protocol: "openai_responses" as const,
      baseUrl: "https://provider.example.com/v1",
      model: "reasoning-model",
      authMode: "bearer" as const,
      authHeaderName: null,
      structuredOutput: "json_schema" as const,
      timeoutMs: 15_000,
    },
    ...(credential ? { credential } : {}),
  };
}

function codexProfile() {
  return {
    version: 2 as const,
    profile: {
      id: CODEX_ID,
      kind: "codex" as const,
      name: "Codex Work",
      profile: "work",
      model: "gpt-codex",
      reasoningEffort: "high" as const,
      codexHome: "/tmp/codex-home",
    },
  };
}

function successProvider(): AiProviderV1 {
  return {
    generateStructured: vi.fn(async () => ({
      rawText: "{}",
      parsedJson: {},
      provider: "compatible-api",
      model: "reasoning-model",
      latencyMs: 12.4,
    })),
  };
}

function providerError(code: ConstructorParameters<typeof AiProviderError>[0]["code"]): AiProviderError {
  return new AiProviderError({
    code,
    retryable: code !== "AI_AUTH_FAILED",
    message: "sanitized provider failure",
    metadata: {
      provider: "compatible-api",
      model: "reasoning-model",
      promptVersion: "provider-probe/v1",
      schemaVersion: "memory-analysis.v1",
      latencyMs: 23,
    },
  });
}

describe("AI Provider V2 Main services", () => {
  it("saves, activates, lists, and deletes profiles without returning credentials", async () => {
    const store = createStore();
    const worker = { resumeWaiting: vi.fn() };
    const afterSave = vi.fn();
    const afterDelete = vi.fn();
    const services = createAiProviderServices({ store, worker, now: () => NOW, afterSave, afterDelete });

    const savedDirect = await services.save(directProfile("write-only-secret"));
    const savedCodex = await services.save(codexProfile());
    expect(JSON.stringify([savedDirect, savedCodex])).not.toContain("write-only-secret");
    expect(savedDirect.activeProfileId).toBe(DIRECT_ID);
    expect(worker.resumeWaiting).toHaveBeenCalledTimes(2);
    expect(afterSave).toHaveBeenCalledTimes(2);

    const activated = await services.activate(CODEX_ID);
    expect(activated.activeProfileId).toBe(CODEX_ID);
    expect(worker.resumeWaiting).toHaveBeenLastCalledWith("configuration");

    const deleted = await services.delete(CODEX_ID);
    expect(deleted).toEqual({ version: 2, deletedProfileId: CODEX_ID, activeProfileId: null });
    expect(afterDelete).toHaveBeenCalledWith(CODEX_ID);
    expect((await services.list()).profiles).toHaveLength(1);
  });

  it("probes a non-active profile and distinguishes missing credentials", async () => {
    const store = createStore();
    store.save(directProfile());
    store.save(codexProfile());
    store.activate(CODEX_ID);
    const providerFactory = vi.fn((_resolved: ResolvedProviderProfile) => successProvider());
    const services = createAiProviderServices({ store, worker: { resumeWaiting: vi.fn() }, providerFactory, now: () => NOW });

    await expect(services.probe(DIRECT_ID)).resolves.toMatchObject({
      profileId: DIRECT_ID,
      status: "not_configured",
      provider: "compatible-api",
      model: "reasoning-model",
      latencyMs: null,
    });
    expect(providerFactory).not.toHaveBeenCalled();

    store.save(directProfile("provider-secret"));
    await expect(services.probe(DIRECT_ID)).resolves.toMatchObject({ status: "ready", latencyMs: 12 });
    expect(providerFactory).toHaveBeenCalledWith(expect.objectContaining({ profile: expect.objectContaining({ id: DIRECT_ID }) }));
  });

  it.each([
    ["AI_AUTH_FAILED", "auth_failed"],
    ["AI_TIMEOUT", "timeout"],
    ["AI_INVALID_OUTPUT", "invalid_output"],
    ["AI_NETWORK_ERROR", "unavailable"],
  ] as const)("maps %s to the renderer-safe %s probe state", async (code, status) => {
    const store = createStore();
    store.save(directProfile("provider-secret"));
    const services = createAiProviderServices({
      store,
      worker: { resumeWaiting: vi.fn() },
      providerFactory: () => ({ generateStructured: async () => { throw providerError(code); } }),
      now: () => NOW,
    });

    await expect(services.probe(DIRECT_ID)).resolves.toMatchObject({ status, latencyMs: 23, checkedAt: NOW });
  });

  it("forwards Codex Home/profile to discovery and normalizes hidden models", async () => {
    const store = createStore();
    const discoverCodex = vi.fn(async () => ({
      version: "0.144.6",
      account: { type: "chatgpt", email: "reader@example.com", planType: "plus" },
      requiresOpenaiAuth: false,
      latencyMs: 5,
      models: [
        { id: "gpt-codex", displayName: "GPT Codex", isDefault: true, supportedReasoningEfforts: ["medium", "high"] },
        { id: "hidden-model", hidden: true },
      ],
    }));
    const services = createAiProviderServices({ store, worker: { resumeWaiting: vi.fn() }, discoverCodex });

    const result = await services.discoverCodex({ version: 2, codexHome: "/tmp/codex-home", profile: "work" });
    expect(discoverCodex).toHaveBeenCalledWith({ codexHome: "/tmp/codex-home", profile: "work" });
    expect(result).toMatchObject({ installed: true, authenticated: true, cliVersion: "0.144.6", authMode: "chatgpt", provider: "codex", errorCode: null });
    expect(result.models).toEqual([expect.objectContaining({ id: "gpt-codex", supportedReasoningEfforts: ["medium", "high"] })]);
  });

  it("returns structured discovery states for missing and unauthenticated Codex channels", async () => {
    const store = createStore();
    const missing = createAiProviderServices({
      store,
      worker: { resumeWaiting: vi.fn() },
      discoverCodex: async () => { throw providerError("AI_NOT_CONFIGURED"); },
    });
    await expect(missing.discoverCodex({ version: 2 })).resolves.toMatchObject({ installed: false, authenticated: false, errorCode: "CODEX_NOT_INSTALLED" });

    const loggedOut = createAiProviderServices({
      store,
      worker: { resumeWaiting: vi.fn() },
      discoverCodex: async () => ({ version: "0.144.6", account: null, requiresOpenaiAuth: true, models: [], latencyMs: 2 }),
    });
    await expect(loggedOut.discoverCodex({ version: 2 })).resolves.toMatchObject({ installed: true, authenticated: false, errorCode: "CODEX_NOT_AUTHENTICATED" });
  });
});
