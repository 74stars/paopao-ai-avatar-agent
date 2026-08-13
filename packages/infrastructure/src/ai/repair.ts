import { PromptRegistry } from "./prompt-registry.js";
import type { AiProviderV1, GenerateStructuredInput, GenerateStructuredResult } from "./types.js";

export interface StructuredAttempt<T> {
  readonly input: GenerateStructuredInput;
  readonly result: GenerateStructuredResult;
  readonly value: T | null;
}

export interface RunStructuredWithRepairResult<T> {
  readonly first: StructuredAttempt<T>;
  readonly repair?: StructuredAttempt<T>;
  readonly acceptedFirst: boolean;
}

export interface RunStructuredWithRepairOptions<T> {
  readonly provider: AiProviderV1;
  readonly prompts: PromptRegistry;
  readonly input: GenerateStructuredInput;
  /** Schema validation; null when the candidate does not conform. */
  readonly parse: (candidate: unknown) => T | null;
  /** Optional semantic validation (evidence quotes, citations). */
  readonly accept?: (value: T, result: GenerateStructuredResult) => boolean;
  readonly signal?: AbortSignal;
}

/**
 * Runs one structured generation with exactly one permitted repair retry.
 * Provider errors propagate as AiProviderError; only validation failures are
 * recovered here. Raw invalid text travels in the untrusted-data wrapper and
 * is never logged or persisted by this module.
 */
export async function runStructuredWithRepair<T>(options: RunStructuredWithRepairOptions<T>): Promise<RunStructuredWithRepairResult<T>> {
  const { provider, prompts, input, parse, accept, signal } = options;
  const firstResult = await provider.generateStructured(input);
  if (signal?.aborted) return { first: { input, result: firstResult, value: null }, acceptedFirst: false };
  const firstValue = parseWithFallback(firstResult, parse, accept);
  if (firstValue !== null) return { first: { input, result: firstResult, value: firstValue }, acceptedFirst: true };

  const repairInput = prompts.repairRequest(input, firstResult.rawText);
  const repairResult = await provider.generateStructured(repairInput);
  if (signal?.aborted) {
    return {
      first: { input, result: firstResult, value: null },
      repair: { input: repairInput, result: repairResult, value: null },
      acceptedFirst: false
    };
  }
  const repairValue = parseWithFallback(repairResult, parse, accept);
  return {
    first: { input, result: firstResult, value: null },
    repair: { input: repairInput, result: repairResult, value: repairValue },
    acceptedFirst: false
  };
}

function parseWithFallback<T>(
  result: GenerateStructuredResult,
  parse: (candidate: unknown) => T | null,
  accept?: (value: T, result: GenerateStructuredResult) => boolean
): T | null {
  let candidate = result.parsedJson;
  if (candidate === undefined) {
    try {
      candidate = JSON.parse(result.rawText) as unknown;
    } catch {
      return null;
    }
  }
  const value = parse(candidate);
  if (value === null) return null;
  return accept && !accept(value, result) ? null : value;
}
