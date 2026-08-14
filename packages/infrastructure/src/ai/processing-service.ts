import { MemoryAnalysisV1Schema, validateAnalysisEvidence, validateMemoryAnalysisUserVisibleContent, type ClaimedJobV1, type ErrorCode, type MemoryAnalysisV1 } from "@paopao/contracts";
import type { JobExecutionResult, JobPreflight } from "@paopao/core";
import type { SqliteAnalysisUnitOfWork } from "../database/analysis-unit-of-work.js";
import { sanitizedFailure, sanitizedProviderMessage } from "./error-mapping.js";
import { DEFAULT_AI_TIMEOUT_MS, PromptRegistry } from "./prompt-registry.js";
import { runStructuredWithRepair } from "./repair.js";
import { AiProviderError, buildAttemptMetadata, toAiRunMetadataV1, type AiAttemptMetadata, type AiProviderV1, type GenerateStructuredInput, type GenerateStructuredResult } from "./types.js";

const INVALID_OUTPUT_MESSAGE = "The model output did not match the analysis schema or cite the current text";
type AnalyzeJobV1 = Extract<ClaimedJobV1, { type: "analyze_entry" }>;

export class ProcessingService {
  readonly #provider: AiProviderV1;
  readonly #prompts: PromptRegistry;
  readonly #unitOfWork: SqliteAnalysisUnitOfWork;
  readonly #configured: () => boolean;
  readonly #timeoutMs: number;

  constructor(dependencies: {
    provider: AiProviderV1;
    prompts: PromptRegistry;
    unitOfWork: SqliteAnalysisUnitOfWork;
    configured?: () => boolean;
    timeoutMs?: number;
  }) {
    this.#provider = dependencies.provider;
    this.#prompts = dependencies.prompts;
    this.#unitOfWork = dependencies.unitOfWork;
    this.#configured = dependencies.configured ?? (() => true);
    this.#timeoutMs = dependencies.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
  }

  async preflight(_job: AnalyzeJobV1): Promise<JobPreflight> {
    if (this.#configured()) return { ready: true };
    return { ready: false, reason: "configuration", error: sanitizedFailure("AI_NOT_CONFIGURED", true) };
  }

  async process(job: AnalyzeJobV1, signal: AbortSignal): Promise<JobExecutionResult> {
    const snapshot = this.#unitOfWork.load(job);
    if (snapshot.state === "already_committed") return { outcome: "succeeded" };
    if (snapshot.state === "stale" || snapshot.currentText === undefined) return discardedResult();
    if (signal.aborted) return discardedResult();

    const currentText = snapshot.currentText;
    const initialInput = this.#prompts.memoryExtraction(currentText, this.#timeoutMs);
    let outcome;
    try {
      outcome = await runStructuredWithRepair({
        provider: this.#provider,
        prompts: this.#prompts,
        input: initialInput,
        parse: parseAnalysis,
        accept: (analysis) => validateAnalysisEvidence(currentText, analysis) && validateMemoryAnalysisUserVisibleContent(analysis),
        signal
      });
    } catch (error) {
      return this.#providerFailure(job, error);
    }

    if (!outcome.acceptedFirst) {
      this.#unitOfWork.auditFailure(job, { ...metadata(outcome.first.result, outcome.first.input), errorCode: "AI_INVALID_OUTPUT" });
    }
    if (signal.aborted) return discardedResult();

    if (outcome.acceptedFirst) {
      return this.#commit(job, outcome.first.result, outcome.first.input, outcome.first.value as MemoryAnalysisV1);
    }
    if (outcome.repair && outcome.repair.value !== null) {
      return this.#commit(job, outcome.repair.result, outcome.repair.input, outcome.repair.value);
    }
    if (outcome.repair) {
      this.#unitOfWork.auditFailure(job, { ...metadata(outcome.repair.result, outcome.repair.input), errorCode: "AI_INVALID_OUTPUT" });
    }
    return { outcome: "failed_final", error: sanitizedFailure("AI_INVALID_OUTPUT", false, INVALID_OUTPUT_MESSAGE) };
  }

  #commit(job: AnalyzeJobV1, result: GenerateStructuredResult, input: GenerateStructuredInput, output: MemoryAnalysisV1): JobExecutionResult {
    const attemptMetadata = metadata(result, input);
    toAiRunMetadataV1(attemptMetadata);
    const committed = this.#unitOfWork.commit({ job, output, metadata: attemptMetadata });
    return committed === "stale" ? discardedResult() : { outcome: "succeeded" };
  }

  #providerFailure(job: AnalyzeJobV1, error: unknown): JobExecutionResult {
    if (!(error instanceof AiProviderError)) {
      return { outcome: "failed_final", error: sanitizedFailure("AI_FAILED_FINAL", false, "Unexpected AI provider failure") };
    }
    this.#unitOfWork.auditFailure(job, error.metadata);
    const sanitized = sanitizedFailure(error.code, error.retryable, sanitizedProviderMessage(error.code));
    if (error.code === "NETWORK_OFFLINE") return { outcome: "wait", reason: "network", error: sanitized };
    if (error.code === "AI_NOT_CONFIGURED") return { outcome: "wait", reason: "configuration", error: sanitized };
    return error.retryable ? { outcome: "retry", error: sanitized } : { outcome: "failed_final", error: sanitized };
  }
}

function parseAnalysis(candidate: unknown): MemoryAnalysisV1 | null {
  const parsed = MemoryAnalysisV1Schema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function metadata(result: GenerateStructuredResult, input: GenerateStructuredInput): AiAttemptMetadata {
  return buildAttemptMetadata(input, {
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
    ...(result.inputTokens === undefined ? {} : { inputTokens: result.inputTokens }),
    ...(result.outputTokens === undefined ? {} : { outputTokens: result.outputTokens }),
    ...(result.providerRequestId === undefined ? {} : { providerRequestId: result.providerRequestId })
  });
}

function discardedResult(): JobExecutionResult {
  return { outcome: "succeeded" };
}
