import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimedJobV1 } from "@paopao/contracts";
import type { AiProviderV1, PromptRegistry, SqliteAnalysisUnitOfWork, SqliteInsightUnitOfWork } from "@paopao/infrastructure";

import { createCredentialBackedExecutor } from "../electron/ai-executor.js";
import { createAiCredentialStore, type SafeStorageLike } from "../electron/credential-store.js";

const PROVIDER = "openai" as const;
const MODEL = "gpt-4o-mini-2024-07-18" as const;
const TEST_KEY = "sk-test-executor-0001";

const analyzeJob = {
  type: "analyze_entry",
  id: "40000000-0000-4000-8000-000000000001",
  entryId: "40000000-0000-4000-8000-000000000002",
  attempts: 0,
  maxAttempts: 3,
  leaseOwner: "test-executor",
  leaseExpiresAt: "2026-08-07T00:01:00Z",
  fencingToken: 1,
  payload: { schemaVersion: "analyze-entry-job.v1", entryId: "40000000-0000-4000-8000-000000000002", textRevision: 1 },
} as unknown as ClaimedJobV1;
const insightJob = {
  ...analyzeJob,
  id: "40000000-0000-4000-8000-000000000003",
  type: "generate_insight",
  payload: { schemaVersion: "generate-insight-job.v1", entryId: analyzeJob.entryId, textRevision: 1, analysisDerivationId: "40000000-0000-4000-8000-000000000004" },
} as unknown as ClaimedJobV1;

function createSafeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plainText) => Buffer.from(Array.from(Buffer.from(plainText, "utf8")).reverse()),
    decryptString: (encrypted) => Buffer.from(Array.from(encrypted).reverse()).toString("utf8"),
  };
}

function fakeAnalysis(currentText: string) {
  const evidence = currentText.slice(0, 5);
  return {
    schemaVersion: "memory-analysis.v1" as const,
    classification: { inputType: "thought" as const, confidence: 0.9, evidence },
    summary: { text: "一条测试摘要", confidence: 0.9, evidence: [evidence] },
    entities: { items: [] },
    goals: { items: [] },
    nextActions: { items: [] },
    needsUserReview: false,
  };
}

const fakePrompts = {
  memoryExtraction: () => ({
    systemPrompt: "system",
    userData: "user",
    jsonSchema: {},
    schemaVersion: "memory-analysis.v1",
    promptVersion: "test/v1.0.0",
    timeoutMs: 1000,
  }),
  insightReply: () => ({ systemPrompt: "system", userData: "user", jsonSchema: {}, schemaVersion: "insight-reply.v1", promptVersion: "test/v1.0.0", timeoutMs: 1000 }),
} as unknown as PromptRegistry;

const fakeUnitOfWork = {
  load: () => ({ state: "ready" as const, currentText: "hello 泡泡" }),
  commit: () => "committed" as const,
  auditFailure: () => undefined,
} as unknown as SqliteAnalysisUnitOfWork;

describe("createCredentialBackedExecutor", () => {
  let directory: string;
  let filePath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "paopao-executor-"));
    filePath = join(directory, "credentials.v1.json");
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("reports not configured until credentials are saved", async () => {
    const store = createAiCredentialStore({ filePath, safeStorage: createSafeStorage() });
    const executor = createCredentialBackedExecutor({ store, prompts: fakePrompts, unitOfWork: fakeUnitOfWork });

    await expect(executor.preflight(analyzeJob)).resolves.toMatchObject({ ready: false, reason: "configuration" });
    await expect(executor.execute(analyzeJob, new AbortController().signal)).resolves.toMatchObject({ outcome: "wait", reason: "configuration" });
  });

  it("reuses one provider instance per configuration", async () => {
    const store = createAiCredentialStore({ filePath, safeStorage: createSafeStorage() });
    const instances: Array<{ provider: AiProviderV1; generateStructured: ReturnType<typeof vi.fn> }> = [];
    const providerFactory = (apiKey: string) => {
      const generateStructured = vi.fn(async () => ({
        rawText: "{}",
        parsedJson: fakeAnalysis("hello 泡泡"),
        provider: PROVIDER,
        model: MODEL,
        latencyMs: 1,
      }));
      const provider: AiProviderV1 = { generateStructured };
      instances.push({ provider, generateStructured });
      expect(apiKey).toBe(TEST_KEY);
      return provider;
    };
    const executor = createCredentialBackedExecutor({ store, prompts: fakePrompts, unitOfWork: fakeUnitOfWork, providerFactory });

    store.save({ version: 1, provider: PROVIDER, model: MODEL, apiKey: TEST_KEY });
    await expect(executor.preflight(analyzeJob)).resolves.toEqual({ ready: true });
    await expect(executor.execute(analyzeJob, new AbortController().signal)).resolves.toEqual({ outcome: "succeeded" });
    await expect(executor.execute(analyzeJob, new AbortController().signal)).resolves.toEqual({ outcome: "succeeded" });

    expect(instances).toHaveLength(1);
    expect(instances[0].generateStructured).toHaveBeenCalledTimes(2);
  });

  it("invalidates the old provider instance after delete", async () => {
    const store = createAiCredentialStore({ filePath, safeStorage: createSafeStorage() });
    const instances: Array<{ provider: AiProviderV1; generateStructured: ReturnType<typeof vi.fn> }> = [];
    const providerFactory = (apiKey: string) => {
      const generateStructured = vi.fn(async () => ({
        rawText: "{}",
        parsedJson: fakeAnalysis("hello 泡泡"),
        provider: PROVIDER,
        model: MODEL,
        latencyMs: 1,
      }));
      const provider: AiProviderV1 = { generateStructured };
      instances.push({ provider, generateStructured });
      expect(apiKey).toBe(TEST_KEY);
      return provider;
    };
    const executor = createCredentialBackedExecutor({ store, prompts: fakePrompts, unitOfWork: fakeUnitOfWork, providerFactory });

    store.save({ version: 1, provider: PROVIDER, model: MODEL, apiKey: TEST_KEY });
    await expect(executor.preflight(analyzeJob)).resolves.toEqual({ ready: true });
    await expect(executor.execute(analyzeJob, new AbortController().signal)).resolves.toEqual({ outcome: "succeeded" });
    const first = instances[0];

    store.delete();
    await expect(executor.preflight(analyzeJob)).resolves.toMatchObject({ ready: false, reason: "configuration" });
    await expect(executor.execute(analyzeJob, new AbortController().signal)).resolves.toMatchObject({ outcome: "wait", reason: "configuration" });
    expect(first.generateStructured).toHaveBeenCalledTimes(1);

    store.save({ version: 1, provider: PROVIDER, model: MODEL, apiKey: TEST_KEY });
    await expect(executor.preflight(analyzeJob)).resolves.toEqual({ ready: true });
    await expect(executor.execute(analyzeJob, new AbortController().signal)).resolves.toEqual({ outcome: "succeeded" });

    expect(instances).toHaveLength(2);
    expect(instances[1].provider).not.toBe(first.provider);
    expect(first.generateStructured).toHaveBeenCalledTimes(1);
  });

  it("routes generate_insight through the credential-backed provider and Core executor", async () => {
    const store = createAiCredentialStore({ filePath, safeStorage: createSafeStorage() });
    const publish = vi.fn();
    const commit = vi.fn(() => ({ state: "committed" as const, derivationId: "40000000-0000-4000-8000-000000000005" }));
    const insightUnitOfWork = { load: () => ({ currentText: "新记录", analysis: fakeAnalysis("新记录"), retrievedMemories: [] }), commit, auditFailure: vi.fn() } as unknown as SqliteInsightUnitOfWork;
    const providerFactory = () => ({ generateStructured: vi.fn(async () => ({ rawText: "{}", parsedJson: { schemaVersion: "insight-reply.v1", text: "暂未发现相关记忆", grounding: "no_relevant_memory", citations: [] }, provider: PROVIDER, model: MODEL, latencyMs: 1 })) });
    const executor = createCredentialBackedExecutor({ store, prompts: fakePrompts, unitOfWork: fakeUnitOfWork, providerFactory, insight: { unitOfWork: insightUnitOfWork, events: { publish }, clock: { now: () => "2026-08-07T00:00:00Z" } } });
    store.save({ version: 1, provider: PROVIDER, model: MODEL, apiKey: TEST_KEY });

    await expect(executor.preflight(insightJob)).resolves.toEqual({ ready: true });
    await expect(executor.execute(insightJob, new AbortController().signal)).resolves.toEqual({ outcome: "succeeded" });
    expect(commit).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: "insight:ready", entryId: insightJob.entryId }));
  });
});
