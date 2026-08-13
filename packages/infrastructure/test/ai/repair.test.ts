import assert from "node:assert/strict";
import test from "node:test";
import { MemoryAnalysisV1Schema, validateAnalysisEvidence, type MemoryAnalysisV1 } from "@paopao/contracts";
import { FakeAiProvider, type FakeAiProviderStep } from "../../src/ai/testing/index.js";
import { loadDefaultPromptRegistry, runStructuredWithRepair, AiProviderError, type GenerateStructuredInput } from "../../src/ai/index.js";

function analysis(text = "Alice plans to read Dune tomorrow"): MemoryAnalysisV1 {
  return {
    schemaVersion: "memory-analysis.v1",
    classification: { inputType: "goal", confidence: 0.9, evidence: "plans to read Dune" },
    summary: { text: "Alice plans to read Dune.", confidence: 0.8, evidence: ["Alice plans to read Dune"] },
    entities: { items: [{ type: "person", name: "Alice", confidence: 0.9, evidence: "Alice" }, { type: "book", name: "Dune", confidence: 0.9, evidence: "Dune" }] },
    goals: { items: [{ title: "Read Dune", confidence: 0.8, evidence: "read Dune" }] },
    nextActions: { items: [{ title: "Start tomorrow", dueHint: "tomorrow", confidence: 0.7, evidence: "tomorrow" }] },
    needsUserReview: false
  };
}

const prompts = loadDefaultPromptRegistry();
const input = prompts.memoryExtraction("Alice plans to read Dune tomorrow", 1_000);

test("accepts the first attempt without a repair when valid", async () => {
  const provider = new FakeAiProvider([{ outcome: "success", parsedJson: analysis() }]);
  const outcome = await runStructuredWithRepair({
    provider,
    prompts,
    input,
    parse: parseAnalysis
  });
  assert.equal(outcome.acceptedFirst, true);
  assert.equal(outcome.repair, undefined);
  assert.equal(outcome.first.value?.summary.text, "Alice plans to read Dune.");
  assert.equal(provider.calls.length, 1);
});

test("repairs malformed raw JSON exactly once through the registry prompt", async () => {
  const provider = new FakeAiProvider([
    { outcome: "success", rawText: "{not json" },
    { outcome: "success", parsedJson: analysis() }
  ]);
  const outcome = await runStructuredWithRepair({
    provider,
    prompts,
    input,
    parse: parseAnalysis
  });
  assert.equal(outcome.acceptedFirst, false);
  assert.equal(outcome.first.value, null);
  assert.ok(outcome.repair);
  assert.equal(outcome.repair.value?.schemaVersion, "memory-analysis.v1");
  assert.equal(provider.calls.length, 2);

  const repairInput = provider.calls[1];
  assert.equal(repairInput.promptVersion, "memory-extraction/v1.0.0+repair/v1.0.0");
  assert.equal(repairInput.schemaVersion, "memory-analysis.v1");
  assert.equal(repairInput.timeoutMs, input.timeoutMs);
  assert.match(repairInput.systemPrompt, /The previous response failed validation/);
  assert.ok(repairInput.userData.includes("invalidOutput"));
  assert.equal((repairInput.userData.match(/---END_UNTRUSTED_USER_DATA---/g) ?? []).length, 1);
});

test("semantic evidence validation can trigger the single repair", async () => {
  const invalid = analysis();
  invalid.summary.evidence = ["invented quote"];
  const provider = new FakeAiProvider([
    { outcome: "success", parsedJson: invalid },
    { outcome: "success", parsedJson: analysis() }
  ]);
  const outcome = await runStructuredWithRepair({
    provider,
    prompts,
    input,
    parse: parseAnalysis,
    accept: (value) => validateAnalysisEvidence("Alice plans to read Dune tomorrow", value)
  });
  assert.equal(outcome.acceptedFirst, false);
  assert.equal(outcome.repair?.value?.schemaVersion, "memory-analysis.v1");
});

test("rejects the repair and exposes both attempts when still invalid", async () => {
  const provider = new FakeAiProvider([
    { outcome: "success", parsedJson: { schemaVersion: "memory-analysis.v1" } },
    { outcome: "success", rawText: "still broken" }
  ]);
  const outcome = await runStructuredWithRepair({
    provider,
    prompts,
    input,
    parse: parseAnalysis
  });
  assert.equal(outcome.acceptedFirst, false);
  assert.equal(outcome.first.value, null);
  assert.equal(outcome.repair?.value, null);
  assert.equal(provider.calls.length, 2);
});

test("propagates provider errors without consuming the repair slot", async () => {
  const steps: FakeAiProviderStep[] = [
    { outcome: "error", code: "AI_RATE_LIMITED", retryable: true }
  ];
  const provider = new FakeAiProvider(steps);
  await assert.rejects(
    runStructuredWithRepair({
      provider,
      prompts,
      input,
      parse: () => null
    }),
    (error) => error instanceof AiProviderError && error.code === "AI_RATE_LIMITED" && error.retryable
  );
  assert.equal(provider.calls.length, 1);
});

test("abort after an invalid first attempt skips the repair call", async () => {
  const signal = new AbortController();
  signal.abort();
  const provider = new FakeAiProvider([{ outcome: "success", rawText: "{broken" }]);
  const outcome = await runStructuredWithRepair({
    provider,
    prompts,
    input,
    parse: parseAnalysis,
    signal: signal.signal
  });
  assert.equal(outcome.acceptedFirst, false);
  assert.equal(outcome.repair, undefined);
  assert.equal(provider.calls.length, 1);
});

function parseAnalysis(candidate: unknown): MemoryAnalysisV1 | null {
  const parsed = MemoryAnalysisV1Schema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
