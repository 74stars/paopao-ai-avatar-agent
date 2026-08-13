import { InsightReplyV1Schema, validateInsightReplyAgainstMemories, type ClaimedJobV1, type InsightReplyV1, type MemoryAnalysisV1, type RetrievedMemoryV1 } from "@paopao/contracts";
import type { JobExecutionResult, JobPreflight, SanitizedFailureV1 } from "@paopao/core";
import { sanitizedFailure, sanitizedProviderMessage } from "./error-mapping.js";
import { DEFAULT_AI_TIMEOUT_MS, PromptRegistry } from "./prompt-registry.js";
import { runStructuredWithRepair } from "./repair.js";
import { AiProviderError, buildAttemptMetadata, toAiRunMetadataV1, type AiProviderV1, type AiRunMetadataV1, type GenerateStructuredInput, type GenerateStructuredResult } from "./types.js";

const INVALID_OUTPUT_MESSAGE = "The model output did not match the insight schema or cite the supplied memories";
type GenerateInsightJobV1 = Extract<ClaimedJobV1, { type: "generate_insight" }>;

export interface InsightJobContext {
  readonly currentText: string;
  readonly analysis: MemoryAnalysisV1;
  readonly retrievedMemories: readonly RetrievedMemoryV1[];
}

export type InsightProcessingResult =
  | { outcome: "succeeded"; reply: InsightReplyV1; metadata: AiRunMetadataV1; promptVersion: string; attempts: number }
  | { outcome: "discarded" }
  | { outcome: "retry"; error: SanitizedFailureV1 }
  | { outcome: "wait"; reason: "network" | "configuration"; error: SanitizedFailureV1 }
  | { outcome: "failed_final"; error: SanitizedFailureV1 };

export class InsightProcessingService {
  readonly #provider: AiProviderV1;
  readonly #prompts: PromptRegistry;
  readonly #load: (job: GenerateInsightJobV1) => InsightJobContext | null;
  readonly #configured: () => boolean;
  readonly #timeoutMs: number;

  constructor(dependencies: {
    provider: AiProviderV1;
    prompts: PromptRegistry;
    load: (job: GenerateInsightJobV1) => InsightJobContext | null;
    configured?: () => boolean;
    timeoutMs?: number;
  }) {
    this.#provider = dependencies.provider;
    this.#prompts = dependencies.prompts;
    this.#load = dependencies.load;
    this.#configured = dependencies.configured ?? (() => true);
    this.#timeoutMs = dependencies.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
  }

  async preflight(job: GenerateInsightJobV1): Promise<JobPreflight> {
    if (!this.#configured()) {
      return { ready: false, reason: "configuration", error: sanitizedFailure("AI_NOT_CONFIGURED", true) };
    }
    if (this.#load(job) !== null) return { ready: true };
    return { ready: false, reason: "configuration", error: sanitizedFailure("AI_NOT_CONFIGURED", true, "Insight context is unavailable") };
  }

  async process(job: GenerateInsightJobV1, signal: AbortSignal): Promise<InsightProcessingResult> {
    const context = this.#load(job);
    if (!context || signal.aborted) return { outcome: "discarded" };

    const initialInput = this.#prompts.insightReply({
      currentText: context.currentText,
      analysis: context.analysis,
      retrievedMemories: context.retrievedMemories,
      timeoutMs: this.#timeoutMs
    });
    let outcome;
    try {
      outcome = await runStructuredWithRepair({
        provider: this.#provider,
        prompts: this.#prompts,
        input: initialInput,
        parse: parseInsightReply,
        accept: (reply) => validateInsightReplyAgainstMemories(reply, context.retrievedMemories),
        signal
      });
    } catch (error) {
      return this.#providerFailure(error);
    }

    if (signal.aborted) return { outcome: "discarded" };
    if (outcome.acceptedFirst) {
      return succeeded(outcome.first.value as InsightReplyV1, outcome.first.result, outcome.first.input, 1);
    }
    if (outcome.repair && outcome.repair.value !== null) {
      return succeeded(outcome.repair.value, outcome.repair.result, outcome.repair.input, 2);
    }
    return { outcome: "failed_final", error: sanitizedFailure("AI_INVALID_OUTPUT", false, INVALID_OUTPUT_MESSAGE) };
  }

  #providerFailure(error: unknown): InsightProcessingResult {
    if (!(error instanceof AiProviderError)) {
      return { outcome: "failed_final", error: sanitizedFailure("AI_FAILED_FINAL", false, "Unexpected AI provider failure") };
    }
    const sanitized = sanitizedFailure(error.code, error.retryable, sanitizedProviderMessage(error.code));
    if (error.code === "NETWORK_OFFLINE") return { outcome: "wait", reason: "network", error: sanitized };
    if (error.code === "AI_NOT_CONFIGURED") return { outcome: "wait", reason: "configuration", error: sanitized };
    return error.retryable ? { outcome: "retry", error: sanitized } : { outcome: "failed_final", error: sanitized };
  }
}

function parseInsightReply(candidate: unknown): InsightReplyV1 | null {
  const parsed = InsightReplyV1Schema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function succeeded(reply: InsightReplyV1, result: GenerateStructuredResult, input: GenerateStructuredInput, attempts: number): InsightProcessingResult {
  const metadata = toAiRunMetadataV1(attemptMetadata(result, input));
  return {
    outcome: "succeeded",
    reply,
    metadata,
    promptVersion: input.promptVersion,
    attempts
  };
}

function attemptMetadata(result: GenerateStructuredResult, input: GenerateStructuredInput) {
  return buildAttemptMetadata(input, {
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
    ...(result.inputTokens === undefined ? {} : { inputTokens: result.inputTokens }),
    ...(result.outputTokens === undefined ? {} : { outputTokens: result.outputTokens }),
    ...(result.providerRequestId === undefined ? {} : { providerRequestId: result.providerRequestId })
  });
}
