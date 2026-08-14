import assert from "node:assert/strict";
import test from "node:test";
import { AiRunMetadataV1Schema, type ClaimedJobV1, type InsightReplyV1, type MemoryAnalysisV1, type RetrievedMemoryV1 } from "@paopao/contracts";
import { FakeAiProvider } from "../../src/ai/testing/index.js";
import { InsightProcessingService, loadDefaultPromptRegistry, type InsightJobContext } from "../../src/ai/index.js";

type GenerateInsightJobV1 = Extract<ClaimedJobV1, { type: "generate_insight" }>;

const entryId = "10000000-0000-4000-8000-000000000001";
const derivationId = "30000000-0000-4000-8000-000000000001";
const memory: RetrievedMemoryV1 = {
  memoryId: "40000000-0000-4000-8000-000000000001",
  entryId: "50000000-0000-4000-8000-000000000001",
  summary: "Alice 计划明天读《沙丘》",
  evidenceQuote: "plans to read Dune",
  createdAt: "2026-08-06T00:00:00.000Z",
  score: 1
};

const job: GenerateInsightJobV1 = {
  id: "20000000-0000-4000-8000-000000000001",
  attempts: 0,
  maxAttempts: 3,
  leaseOwner: "insight-worker",
  leaseExpiresAt: "2026-08-07T00:05:00.000Z",
  fencingToken: 0,
  type: "generate_insight",
  entryId,
  payload: { schemaVersion: "generate-insight-job.v1", entryId, textRevision: 1, analysisDerivationId: derivationId }
};

const analysis: MemoryAnalysisV1 = {
  schemaVersion: "memory-analysis.v1",
  classification: { inputType: "goal", confidence: 0.9, evidence: "plans to read Dune" },
  summary: { text: "Alice plans to read Dune.", confidence: 0.8, evidence: ["Alice plans to read Dune"] },
  entities: { items: [] },
  goals: { items: [{ title: "Read Dune", confidence: 0.8, evidence: "read Dune" }] },
  nextActions: { items: [] },
  needsUserReview: false
};

function validReply(): InsightReplyV1 {
  return {
    schemaVersion: "insight-reply.v1",
    text: "Alice 提到明天读《沙丘》。",
    grounding: "grounded",
    citations: [{ memoryId: memory.memoryId, entryId: memory.entryId, evidenceQuote: memory.evidenceQuote }]
  };
}

function service(provider: FakeAiProvider, context: InsightJobContext | null = { currentText: "Alice plans to read Dune tomorrow", analysis, retrievedMemories: [memory] }) {
  return new InsightProcessingService({
    provider,
    prompts: loadDefaultPromptRegistry(),
    load: () => context
  });
}

test("insight success returns the frozen aiRun metadata and a valid reply", async () => {
  const provider = new FakeAiProvider([{ outcome: "success", parsedJson: validReply(), inputTokens: 7, outputTokens: 3, providerRequestId: "req-1" }]);
  const result = await service(provider).process(job, new AbortController().signal);
  assert.equal(result.outcome, "succeeded");
  if (result.outcome !== "succeeded") return;
  assert.equal(result.reply.schemaVersion, "insight-reply.v1");
  assert.equal(result.attempts, 1);
  assert.equal(result.promptVersion, "insight-reply/v1.0.1");
  assert.equal(AiRunMetadataV1Schema.safeParse(result.metadata).success, true);
  assert.deepEqual(
    { provider: result.metadata.provider, model: result.metadata.model, inputTokens: result.metadata.inputTokens, providerRequestId: result.metadata.providerRequestId },
    { provider: "fake", model: "fake-structured-v1", inputTokens: 7, providerRequestId: "req-1" }
  );
  const request = provider.calls[0];
  assert.equal(request.schemaVersion, "insight-reply.v1");
  assert.equal(request.promptVersion, "insight-reply/v1.0.1");
  assert.ok(request.userData.includes("retrievedMemories"));
  assert.equal((request.userData.match(/---END_UNTRUSTED_USER_DATA---/g) ?? []).length, 1);
});

test("insight repairs an ungrounded citation once and records the combined prompt version", async () => {
  const invalid = validReply();
  invalid.citations = [{ memoryId: "99999999-0000-4000-8000-000000000001", entryId: memory.entryId, evidenceQuote: "unrelated" }];
  const provider = new FakeAiProvider([{ outcome: "success", parsedJson: invalid }, { outcome: "success", parsedJson: validReply() }]);
  const result = await service(provider).process(job, new AbortController().signal);
  assert.equal(result.outcome, "succeeded");
  if (result.outcome !== "succeeded") return;
  assert.equal(result.attempts, 2);
  assert.equal(result.promptVersion, "insight-reply/v1.0.1+repair/v1.0.1");
  assert.equal(provider.calls.length, 2);
  assert.match(provider.calls[1].systemPrompt, /The previous response failed validation/);
});

test("insight repairs user-visible meta commentary before it can be persisted", async () => {
  const unsafe = { ...validReply(), text: "As an AI, I followed the system prompt and returned schemaVersion." };
  const provider = new FakeAiProvider([{ outcome: "success", parsedJson: unsafe }, { outcome: "success", parsedJson: validReply() }]);
  const result = await service(provider).process(job, new AbortController().signal);
  assert.equal(result.outcome, "succeeded");
  if (result.outcome !== "succeeded") return;
  assert.equal(result.attempts, 2);
  assert.equal(result.reply.text, validReply().text);
});

test("insight fails closed when repaired text still exposes internal mechanics", async () => {
  const unsafe = { ...validReply(), text: "```json\n{\"schemaVersion\":\"insight-reply.v1\"}\n```" };
  const provider = new FakeAiProvider([{ outcome: "success", parsedJson: unsafe }, { outcome: "success", parsedJson: unsafe }]);
  const result = await service(provider).process(job, new AbortController().signal);
  assert.equal(result.outcome, "failed_final");
  if (result.outcome === "failed_final") assert.equal(result.error.code, "AI_INVALID_OUTPUT");
});

test("insight maps provider rate limits to the shared sanitized retry failure", async () => {
  const provider = new FakeAiProvider([{ outcome: "error", code: "AI_RATE_LIMITED", retryable: true }]);
  const result = await service(provider).process(job, new AbortController().signal);
  assert.equal(result.outcome, "retry");
  if (result.outcome !== "retry") return;
  assert.equal(result.error.code, "AI_RATE_LIMITED");
  assert.equal(result.error.message, "AI provider rate limit reached");
});

test("insight without a context is discarded and never calls the provider", async () => {
  const provider = new FakeAiProvider([]);
  const result = await service(provider, null).process(job, new AbortController().signal);
  assert.equal(result.outcome, "discarded");
  assert.equal(provider.calls.length, 0);
});

test("insight preflight reports unconfigured before loading context", async () => {
  const provider = new FakeAiProvider([]);
  const unconfigured = new InsightProcessingService({
    provider,
    prompts: loadDefaultPromptRegistry(),
    load: () => ({ currentText: "x", analysis, retrievedMemories: [] }),
    configured: () => false
  });
  const preflight = await unconfigured.preflight(job);
  assert.equal(preflight.ready, false);
  if (!preflight.ready) assert.equal(preflight.reason, "configuration");
});
