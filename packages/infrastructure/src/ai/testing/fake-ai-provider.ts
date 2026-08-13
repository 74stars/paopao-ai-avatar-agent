import type { ErrorCode } from "@paopao/contracts";
import { AiProviderError, buildAttemptMetadata, type AiProviderV1, type GenerateStructuredInput, type GenerateStructuredResult } from "../types.js";

export type FakeAiProviderStep =
  | {
      outcome: "success";
      parsedJson?: unknown;
      rawText?: string;
      inputTokens?: number;
      outputTokens?: number;
      providerRequestId?: string;
    }
  | {
      outcome: "error";
      code: ErrorCode;
      retryable: boolean;
      rawText?: string;
      providerRequestId?: string;
    };

export class FakeAiProvider implements AiProviderV1 {
  readonly calls: GenerateStructuredInput[] = [];
  readonly #steps: FakeAiProviderStep[];

  constructor(steps: readonly FakeAiProviderStep[]) {
    this.#steps = steps.map((step) => ({ ...step }));
  }

  async generateStructured(input: GenerateStructuredInput): Promise<GenerateStructuredResult> {
    this.calls.push(input);
    const step = this.#steps.shift();
    if (!step) throw new Error("FakeAiProvider has no remaining step");
    const requestIndex = this.calls.length;
    const providerRequestId = step.providerRequestId ?? `fake-request-${requestIndex}`;

    if (step.outcome === "error") {
      throw new AiProviderError({
        code: step.code,
        retryable: step.retryable,
        message: `Deterministic fake failure: ${step.code}`,
        metadata: buildAttemptMetadata(input, {
          provider: "fake",
          model: "fake-structured-v1",
          latencyMs: 1,
          providerRequestId
        }),
        rawText: step.rawText
      });
    }

    const rawText = step.rawText ?? JSON.stringify(step.parsedJson);
    return {
      rawText,
      parsedJson: step.parsedJson,
      provider: "fake",
      model: "fake-structured-v1",
      latencyMs: 1,
      inputTokens: step.inputTokens ?? 1,
      outputTokens: step.outputTokens ?? 1,
      providerRequestId
    };
  }
}
