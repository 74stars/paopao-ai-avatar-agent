import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProviderProfileStore } from "../electron/provider-profile-store.js";

const directories: string[] = [];
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
  decryptString: (value: Buffer) => value.toString("utf8").replace(/^encrypted:/, ""),
};

function createStore() {
  const directory = mkdtempSync(join(tmpdir(), "paopao-provider-store-"));
  directories.push(directory);
  const filePath = join(directory, "ai-providers.v2.json");
  const store = createProviderProfileStore({
    filePath,
    safeStorage,
    now: (() => {
      let second = 0;
      return () => `2026-08-11T00:00:0${second++}.000Z`;
    })(),
  });
  return { store, filePath };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("ProviderProfileStore", () => {
  it("stores encrypted direct credentials and exposes only a redacted public projection", () => {
    const { store, filePath } = createStore();
    const id = "10000000-0000-4000-8000-000000000001";
    const saved = store.save({
      version: 2,
      credential: "provider-secret",
      profile: {
        id,
        kind: "direct",
        name: "Office proxy",
        providerId: "office",
        protocol: "openai_responses",
        baseUrl: "https://proxy.example.com/v1/",
        model: "model-a",
        authMode: "bearer",
        authHeaderName: null,
        structuredOutput: "json_schema",
        timeoutMs: 30_000,
      },
    });

    expect(saved).toMatchObject({ id, baseUrl: "https://proxy.example.com/v1", credentialConfigured: true, revision: 1 });
    expect(JSON.stringify(store.list())).not.toContain("provider-secret");
    expect(readFileSync(filePath, "utf8")).not.toContain('"provider-secret"');
    expect(store.resolveActive()).toMatchObject({ credential: "provider-secret", generation: 1 });
    expect(store.sensitiveValues()).toEqual(["provider-secret"]);
  });

  it("preserves a credential on config-only update and removes it for no-auth profiles", () => {
    const { store } = createStore();
    const id = "10000000-0000-4000-8000-000000000002";
    const base = {
      id,
      kind: "direct" as const,
      name: "Local",
      providerId: "local",
      protocol: "openai_chat_completions" as const,
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "local-model",
      authMode: "bearer" as const,
      authHeaderName: null,
      structuredOutput: "json_schema" as const,
      timeoutMs: 20_000,
    };
    store.save({ version: 2, profile: base, credential: "local-secret" });
    expect(store.save({ version: 2, profile: { ...base, name: "Local updated" } })).toMatchObject({ revision: 2, credentialConfigured: true });
    expect(store.resolveActive()?.credential).toBe("local-secret");
    expect(store.save({ version: 2, profile: { ...base, authMode: "none" } })).toMatchObject({ revision: 3, credentialConfigured: true });
    expect(store.resolveActive()?.credential).toBeNull();
    expect(store.sensitiveValues()).toEqual([]);
  });

  it("invalidates a stored credential when the endpoint or authentication boundary changes", () => {
    const { store } = createStore();
    const base = {
      id: "10000000-0000-4000-8000-000000000008",
      kind: "direct" as const,
      name: "Remote",
      providerId: "remote",
      protocol: "openai_responses" as const,
      baseUrl: "https://one.example.com/v1",
      model: "model",
      authMode: "bearer" as const,
      authHeaderName: null,
      structuredOutput: "json_schema" as const,
      timeoutMs: 20_000,
    };
    store.save({ version: 2, profile: base, credential: "endpoint-secret" });
    expect(store.save({ version: 2, profile: { ...base, baseUrl: "https://two.example.com/v1" } })).toMatchObject({ credentialConfigured: false });
    expect(store.resolveActive()).toBeNull();
    expect(store.sensitiveValues()).toEqual([]);
    expect(store.save({ version: 2, profile: { ...base, baseUrl: "https://two.example.com/v1" }, credential: "replacement-secret" })).toMatchObject({ credentialConfigured: true });
    expect(store.resolveActive()?.credential).toBe("replacement-secret");
  });

  it("supports Codex profiles without storing a credential", () => {
    const { store } = createStore();
    const id = "10000000-0000-4000-8000-000000000003";
    store.save({
      version: 2,
      profile: { id, kind: "codex", name: "Codex current", profile: null, model: null, reasoningEffort: null, codexHome: null },
    });
    expect(store.resolveActive()).toMatchObject({ profile: { id, kind: "codex", credentialConfigured: true }, credential: null });
  });

  it("normalizes Codex fields and rejects profile traversal or relative homes", () => {
    const { store } = createStore();
    const base = {
      id: "10000000-0000-4000-8000-000000000009",
      kind: "codex" as const,
      name: "  Codex work  ",
      profile: "  work-profile  ",
      model: "  gpt-codex  ",
      reasoningEffort: "high" as const,
      codexHome: "  ~/.codex-work  ",
    };
    expect(store.save({ version: 2, profile: base })).toMatchObject({
      name: "Codex work",
      profile: "work-profile",
      model: "gpt-codex",
      codexHome: "~/.codex-work",
    });
    expect(() => store.save({ version: 2, profile: { ...base, profile: "../../other" } })).toThrow();
    expect(() => store.save({ version: 2, profile: { ...base, codexHome: "relative/codex" } })).toThrow();
  });

  it("migrates the legacy OpenAI key once and keeps the fixed compatibility profile active", () => {
    const { store } = createStore();
    expect(store.migrateLegacy({ provider: "openai", model: "gpt-4o-mini-2024-07-18", apiKey: "legacy-key" })).toBe(true);
    expect(store.migrateLegacy({ provider: "openai", model: "ignored", apiKey: "ignored" })).toBe(false);
    expect(store.list()).toMatchObject({
      activeProfileId: "00000000-0000-4000-8000-000000000001",
      profiles: [{ kind: "direct", protocol: "openai_chat_completions", credentialConfigured: true }],
    });
    expect(store.resolveActive()?.credential).toBe("legacy-key");
  });

  it("rejects unsafe URLs and authentication header names", () => {
    const { store } = createStore();
    const profile = {
      id: "10000000-0000-4000-8000-000000000004",
      kind: "direct" as const,
      name: "Unsafe",
      providerId: "unsafe",
      protocol: "openai_responses" as const,
      model: "model",
      authMode: "bearer" as const,
      authHeaderName: null,
      structuredOutput: "json_schema" as const,
      timeoutMs: 30_000,
    };
    expect(() => store.save({ version: 2, profile: { ...profile, baseUrl: "http://example.com/v1" }, credential: "x" })).toThrow();
    expect(() => store.save({ version: 2, profile: { ...profile, baseUrl: "https://user:pass@example.com/v1" }, credential: "x" })).toThrow();
    expect(() => store.save({
      version: 2,
      profile: { ...profile, baseUrl: "https://example.com/v1", authMode: "api_key_header", authHeaderName: "Authorization" },
      credential: "x",
    })).toThrow();
  });

  it("invalidates generation on activation and deletion", () => {
    const { store } = createStore();
    for (const [index, name] of ["One", "Two"].entries()) {
      store.save({
        version: 2,
        profile: {
          id: `10000000-0000-4000-8000-00000000000${index + 5}`,
          kind: "codex",
          name,
          profile: null,
          model: null,
          reasoningEffort: null,
          codexHome: null,
        },
      });
    }
    store.activate("10000000-0000-4000-8000-000000000006");
    expect(store.resolveActive()?.profile.name).toBe("Two");
    expect(store.generation()).toBe(3);
    store.delete("10000000-0000-4000-8000-000000000006");
    expect(store.resolveActive()).toBeNull();
    expect(store.generation()).toBe(4);
  });
});
