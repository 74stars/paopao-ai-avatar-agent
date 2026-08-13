import assert from "node:assert/strict";
import test from "node:test";
import type { AiProviderV1, GenerateStructuredInput } from "../../src/ai/index.js";
import { AiProviderError } from "../../src/ai/index.js";
import { FakeAiProvider } from "../../src/ai/testing/index.js";

const input: GenerateStructuredInput = {
  systemPrompt: "system",
  userData: "untrusted data",
  jsonSchema: { type: "object" },
  schemaVersion: "memory-analysis.v1",
  promptVersion: "memory-extraction/v1.0.0",
  timeoutMs: 20_000
};

test("deterministic fake shares AiProviderV1 and replays queued outcomes", async () => {
  const fake: AiProviderV1 = new FakeAiProvider([
    { outcome: "success", parsedJson: { fixture: true }, inputTokens: 4, outputTokens: 2 },
    { outcome: "error", code: "AI_RATE_LIMITED", retryable: true }
  ]);

  const result = await fake.generateStructured(input);
  assert.deepEqual(result.parsedJson, { fixture: true });
  assert.equal(result.providerRequestId, "fake-request-1");

  await assert.rejects(
    fake.generateStructured(input),
    (error) => error instanceof AiProviderError
      && error.code === "AI_RATE_LIMITED"
      && error.retryable
      && error.metadata.providerRequestId === "fake-request-2"
  );
});

test("fake can return malformed raw output for the one-repair path", async () => {
  const fake = new FakeAiProvider([{ outcome: "success", rawText: "{malformed" }]);
  const result = await fake.generateStructured(input);
  assert.equal(result.rawText, "{malformed");
  assert.equal(result.parsedJson, undefined);
});
