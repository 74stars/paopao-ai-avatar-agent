import type { ErrorCode } from "@paopao/contracts";
import { randomUUID } from "node:crypto";

/**
 * Frozen provider error mapping (ADR provider-openai-structured-output-v1,
 * contracts.md 11.1). Both extraction and insight calls share this table so
 * that provider adapters never leak vendor status bodies or raw messages.
 */
export interface FrozenErrorMapping {
  code: ErrorCode;
  retryable: boolean;
  message: string;
}

export const AI_PROVIDER_ERROR_MESSAGES: Readonly<Partial<Record<ErrorCode, string>>> = {
  AI_TIMEOUT: "AI provider request timed out",
  AI_RATE_LIMITED: "AI provider rate limit reached",
  AI_NETWORK_ERROR: "AI provider network request failed",
  AI_AUTH_FAILED: "AI provider authentication failed",
  AI_SAFETY_BLOCKED: "AI provider blocked the request for safety",
  AI_INPUT_TOO_LARGE: "AI input exceeds the provider limit",
  AI_INVALID_OUTPUT: "AI provider output did not match the requested schema"
};

export function sanitizedProviderMessage(code: ErrorCode): string {
  return AI_PROVIDER_ERROR_MESSAGES[code] ?? "AI provider request failed";
}

/**
 * Builds the frozen `SanitizedFailureV1` shape used by extraction and insight
 * job outcomes. Only fixed messages from the mapping table ever reach jobs;
 * provider-specific text is dropped at the adapter boundary.
 */
export function sanitizedFailure(code: ErrorCode, retryable: boolean, message = sanitizedProviderMessage(code)) {
  return { code, retryable, message, correlationId: randomUUID() };
}

/**
 * Maps an HTTP failure to the frozen application error. Vendor text in the
 * response body never survives; only the status and the two vetted vendor
 * markers (`content_filter` / `safety`, `context_length_exceeded`) are used.
 */
export function mapHttpFailure(status: number, providerCode: unknown, providerType: unknown): FrozenErrorMapping {
  if (providerCode === "content_filter" || providerType === "safety") {
    return { code: "AI_SAFETY_BLOCKED", retryable: false, message: sanitizedProviderMessage("AI_SAFETY_BLOCKED") };
  }
  if (status === 401 || status === 403) {
    return { code: "AI_AUTH_FAILED", retryable: false, message: sanitizedProviderMessage("AI_AUTH_FAILED") };
  }
  if (status === 429) {
    return { code: "AI_RATE_LIMITED", retryable: true, message: sanitizedProviderMessage("AI_RATE_LIMITED") };
  }
  if (status >= 500) {
    return { code: "AI_NETWORK_ERROR", retryable: true, message: sanitizedProviderMessage("AI_NETWORK_ERROR") };
  }
  if (status === 400 && providerCode === "context_length_exceeded") {
    return { code: "AI_INPUT_TOO_LARGE", retryable: false, message: sanitizedProviderMessage("AI_INPUT_TOO_LARGE") };
  }
  return { code: "AI_INVALID_OUTPUT", retryable: true, message: sanitizedProviderMessage("AI_INVALID_OUTPUT") };
}
