import { AiRunMetadataV1Schema, type ErrorCode } from "@paopao/contracts";

export interface GenerateStructuredInput {
  systemPrompt: string;
  userData: string;
  jsonSchema: object;
  schemaVersion: string;
  promptVersion: string;
  timeoutMs: number;
}

export interface GenerateStructuredResult {
  rawText: string;
  parsedJson?: unknown;
  provider: string;
  model: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  providerRequestId?: string;
}

// Mirrors the frozen contracts.md port until @paopao/contracts exports the interface.
export interface AiProviderV1 {
  generateStructured(input: GenerateStructuredInput): Promise<GenerateStructuredResult>;
}

export interface AiAttemptMetadata {
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  providerRequestId?: string;
  errorCode?: ErrorCode;
}

export type AiRunMetadataV1 = ReturnType<typeof AiRunMetadataV1Schema.parse>;

export interface MetadataSource {
  provider: string;
  model: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  providerRequestId?: string;
}

/**
 * Single metadata constructor shared by every provider adapter (OpenAI and
 * Fake) and the processing service, so extraction and insight attempts always
 * emit the frozen audit fields.
 */
export function buildAttemptMetadata(input: GenerateStructuredInput, source: MetadataSource, errorCode?: ErrorCode): AiAttemptMetadata {
  return {
    provider: source.provider,
    model: source.model,
    promptVersion: input.promptVersion,
    schemaVersion: input.schemaVersion,
    latencyMs: source.latencyMs,
    ...(source.inputTokens === undefined ? {} : { inputTokens: source.inputTokens }),
    ...(source.outputTokens === undefined ? {} : { outputTokens: source.outputTokens }),
    ...(source.providerRequestId === undefined ? {} : { providerRequestId: source.providerRequestId }),
    ...(errorCode === undefined ? {} : { errorCode })
  };
}

/**
 * Converts attempt metadata to the frozen `AiRunMetadataV1` record shape
 * (optional fields become nullable). Throws when the shape drifts from the
 * contract, which is an internal invariant failure, not a user-facing error.
 */
export function toAiRunMetadataV1(metadata: AiAttemptMetadata): AiRunMetadataV1 {
  const parsed = AiRunMetadataV1Schema.safeParse({
    provider: metadata.provider,
    model: metadata.model,
    promptVersion: metadata.promptVersion,
    schemaVersion: metadata.schemaVersion,
    latencyMs: metadata.latencyMs,
    inputTokens: metadata.inputTokens ?? null,
    outputTokens: metadata.outputTokens ?? null,
    providerRequestId: metadata.providerRequestId ?? null
  });
  if (!parsed.success) throw new Error("AI attempt metadata does not conform to AiRunMetadataV1");
  return parsed.data;
}

export class AiProviderError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly metadata: Readonly<AiAttemptMetadata>;
  readonly rawText?: string;

  constructor(options: {
    code: ErrorCode;
    retryable: boolean;
    message: string;
    metadata: AiAttemptMetadata;
    cause?: unknown;
    rawText?: string;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "AiProviderError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.metadata = Object.freeze({ ...options.metadata, errorCode: options.code });
    if (options.rawText !== undefined) {
      Object.defineProperty(this, "rawText", {
        value: options.rawText,
        enumerable: false,
        configurable: false,
        writable: false
      });
    }
  }
}
