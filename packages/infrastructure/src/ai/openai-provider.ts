import {
  AI_MODEL_ID,
  AI_PROVIDER_ID,
  InsightReplyV1Schema,
  MemoryAnalysisV1Schema,
  type AiStructuredOutputModeV2,
  type ErrorCode
} from "@paopao/contracts";
import { mapHttpFailure } from "./error-mapping.js";
import { MAX_AI_INPUT_CODE_POINTS, countWrappedCurrentTextCodePoints } from "./prompt-registry.js";
import {
  AiProviderError,
  buildAttemptMetadata,
  type AiProviderV1,
  type GenerateStructuredInput,
  type GenerateStructuredResult
} from "./types.js";

export const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_DEFAULT_MODEL = AI_MODEL_ID;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type OpenAiProtocol = "openai_responses" | "openai_chat_completions";

export interface DirectProviderAuth {
  /** HTTP header name; defaults to "Authorization". */
  readonly header?: string;
  /** Literal header value; when set, replaces scheme + apiKey. */
  readonly value?: string;
  /** Static prefix applied to apiKey; defaults to "Bearer"; "" sends the key raw. */
  readonly scheme?: string;
}

export interface DirectProviderOptions {
  /** Wire protocol; defaults to "openai_chat_completions". */
  readonly protocol?: OpenAiProtocol;
  /** Provider label recorded in results and metadata; defaults to AI_PROVIDER_ID. */
  readonly providerId?: string;
  /** API base URL; defaults to https://api.openai.com/v1 (trailing slashes are stripped). */
  readonly baseUrl?: string;
  /** Model id sent to the provider; defaults to AI_MODEL_ID. */
  readonly model?: string;
  /** API key; required unless auth.value is provided. */
  readonly apiKey?: string;
  /** Auth header overrides; defaults to `Authorization: Bearer <apiKey>`. */
  /** null disables authentication for loopback/local providers. */
  readonly auth?: DirectProviderAuth | null;
  /** Structured output request strategy; defaults to native JSON Schema. */
  readonly structuredOutput?: AiStructuredOutputModeV2;
  /** Optional provider-level maximum request timeout in ms (caps input.timeoutMs). */
  readonly timeoutMs?: number;
  /** Optional sampling temperature. Omitted by default for broad model compatibility. */
  readonly temperature?: number;
  readonly fetch?: FetchLike;
  readonly now?: () => number;
}

/** Options accepted by the legacy createOpenAiProvider entry point. */
export interface OpenAiProviderOptions {
  apiKey: string;
  fetch?: FetchLike;
  now?: () => number;
}

interface ProviderBody {
  id?: unknown;
  request_id?: unknown;
  error?: { code?: unknown; type?: unknown };
  choices?: Array<{
    finish_reason?: unknown;
    message?: { content?: unknown; refusal?: unknown };
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    input_tokens?: unknown;
    output_tokens?: unknown;
  };
  status?: unknown;
  incomplete_details?: { reason?: unknown };
  output_text?: unknown;
  output?: Array<{
    type?: unknown;
    content?: Array<{ type?: unknown; text?: unknown; refusal?: unknown }>;
  }>;
}

interface ExtractedOutput {
  readonly safetyBlocked: boolean;
  readonly incomplete: boolean;
  readonly rawText?: string;
  readonly inputTokens?: unknown;
  readonly outputTokens?: unknown;
}

const MAX_RESPONSE_CODE_UNITS = 2_000_000;

/**
 * Config-driven Direct OpenAI provider adapter. Supports the Responses and
 * Chat Completions wire protocols with configurable base URL, model, provider
 * label, auth header, and provider-level timeout cap.
 */
export function createDirectProvider(options: DirectProviderOptions): AiProviderV1 {
  return new DirectOpenAiProvider(options);
}

/**
 * Legacy entry point, kept for compatibility. Delegates to the Direct adapter
 * with the pinned OpenAI Chat Completions defaults.
 */
export function createOpenAiProvider(options: OpenAiProviderOptions): AiProviderV1 {
  return new OpenAiStructuredProvider(options);
}

export class DirectOpenAiProvider implements AiProviderV1 {
  readonly #protocol: OpenAiProtocol;
  readonly #providerId: string;
  readonly #model: string;
  readonly #endpointUrl: string;
  readonly #auth: ResolvedAuth | null;
  readonly #structuredOutput: AiStructuredOutputModeV2;
  readonly #maxTimeoutMs: number | undefined;
  readonly #temperature: number | undefined;
  readonly #fetch: FetchLike;
  readonly #now: () => number;

  constructor(options: DirectProviderOptions) {
    const protocol = normalizeProtocol(options.protocol);
    const providerId = normalizeProviderId(options.providerId);
    const model = normalizeModel(options.model);
    const endpointUrl = resolveEndpoint(normalizeBaseUrl(options.baseUrl), protocol);
    const auth = resolveAuth(options, providerId, model);
    this.#protocol = protocol;
    this.#providerId = providerId;
    this.#model = model;
    this.#endpointUrl = endpointUrl;
    this.#auth = auth;
    this.#structuredOutput = options.structuredOutput ?? "json_schema";
    this.#maxTimeoutMs = normalizeTimeoutMs(options.timeoutMs);
    this.#temperature = normalizeTemperature(options.temperature);
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  async generateStructured(input: GenerateStructuredInput): Promise<GenerateStructuredResult> {
    validateInput(input);
    const startedAt = this.#now();
    const effectiveTimeoutMs = Math.min(input.timeoutMs, this.#maxTimeoutMs ?? input.timeoutMs);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), effectiveTimeoutMs);
    let response: Response;
    let rawBody: string;

    try {
      response = await this.#fetch(this.#endpointUrl, {
        method: "POST",
        headers: {
          ...(this.#auth ? { [this.#auth.header]: this.#auth.value } : {}),
          "content-type": "application/json"
        },
        body: JSON.stringify(
          this.#protocol === "openai_responses"
            ? buildResponsesBody(input, this.#model, this.#structuredOutput, this.#temperature)
            : buildChatCompletionsBody(input, this.#model, this.#structuredOutput, this.#temperature)
        ),
        signal: abort.signal
      });
      rawBody = await response.text();
    } catch (cause) {
      const latencyMs = elapsed(this.#now(), startedAt);
      if (abort.signal.aborted) {
        throw this.#providerError("AI_TIMEOUT", true, "AI provider request timed out", input, latencyMs, undefined, cause);
      }
      throw this.#providerError("AI_NETWORK_ERROR", true, "AI provider network request failed", input, latencyMs, undefined, cause);
    } finally {
      clearTimeout(timer);
    }

    const latencyMs = elapsed(this.#now(), startedAt);
    const providerRequestId = safeRequestId(response.headers.get("x-request-id"));
    if (rawBody.length > MAX_RESPONSE_CODE_UNITS) {
      throw this.#providerError("AI_INVALID_OUTPUT", true, "AI provider response was too large", input, latencyMs, providerRequestId);
    }

    const body = parseProviderBody(rawBody);
    const resolvedRequestId = providerRequestId ?? safeRequestId(body?.request_id) ?? safeRequestId(body?.id);

    if (!response.ok) {
      const mapped = mapHttpFailure(response.status, body?.error?.code, body?.error?.type);
      throw this.#providerError(mapped.code, mapped.retryable, mapped.message, input, latencyMs, resolvedRequestId);
    }

    const output = this.#protocol === "openai_responses"
      ? extractResponsesOutput(body)
      : extractChatCompletionsOutput(body);
    if (output.safetyBlocked) {
      throw this.#providerError("AI_SAFETY_BLOCKED", false, "AI provider blocked the request for safety", input, latencyMs, resolvedRequestId);
    }
    if (output.incomplete) {
      throw this.#providerError("AI_INVALID_OUTPUT", true, "AI provider did not complete the structured response", input, latencyMs, resolvedRequestId);
    }
    if (typeof output.rawText !== "string" || !output.rawText.trim()) {
      throw this.#providerError("AI_INVALID_OUTPUT", true, "AI provider returned no structured content", input, latencyMs, resolvedRequestId);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(output.rawText);
    } catch (cause) {
      throw this.#providerError(
        "AI_INVALID_OUTPUT",
        true,
        "AI provider returned malformed JSON",
        input,
        latencyMs,
        resolvedRequestId,
        cause,
        output.rawText
      );
    }

    const validated = validateKnownSchema(input.schemaVersion, parsedJson);
    if (!validated.success) {
      throw this.#providerError(
        "AI_INVALID_OUTPUT",
        true,
        "AI provider output did not match the requested schema",
        input,
        latencyMs,
        resolvedRequestId,
        undefined,
        output.rawText
      );
    }

    return {
      rawText: output.rawText,
      parsedJson: validated.data,
      provider: this.#providerId,
      model: this.#model,
      latencyMs,
      inputTokens: safeTokenCount(output.inputTokens),
      outputTokens: safeTokenCount(output.outputTokens),
      providerRequestId: resolvedRequestId
    };
  }

  #providerError(
    code: ErrorCode,
    retryable: boolean,
    message: string,
    input: GenerateStructuredInput,
    latencyMs: number,
    providerRequestId?: string,
    cause?: unknown,
    rawText?: string
  ): AiProviderError {
    const metadata = buildAttemptMetadata(input, {
      provider: this.#providerId,
      model: this.#model,
      latencyMs,
      ...(providerRequestId === undefined ? {} : { providerRequestId })
    });
    return new AiProviderError({ code, retryable, message, metadata, cause, rawText });
  }
}

/**
 * Legacy class kept so existing imports keep compiling. Equivalent to the
 * Direct adapter pinned to OpenAI Chat Completions.
 */
export class OpenAiStructuredProvider extends DirectOpenAiProvider {
  constructor(options: OpenAiProviderOptions) {
    super({
      protocol: "openai_chat_completions",
      providerId: AI_PROVIDER_ID,
      baseUrl: OPENAI_DEFAULT_BASE_URL,
      model: AI_MODEL_ID,
      apiKey: options.apiKey,
      temperature: 0,
      fetch: options.fetch,
      now: options.now
    });
  }
}

function buildChatCompletionsBody(input: GenerateStructuredInput, model: string, mode: AiStructuredOutputModeV2, temperature?: number): object {
  const systemPrompt = promptForStructuredMode(input, mode);
  return {
    model,
    ...(temperature === undefined ? {} : { temperature }),
    store: false,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: input.userData }
    ],
    ...(mode === "prompt_json" ? {} : {
      response_format: mode === "json_object"
        ? { type: "json_object" }
        : {
            type: "json_schema",
            json_schema: {
              name: schemaName(input.schemaVersion),
              strict: true,
              schema: input.jsonSchema
            }
          }
    })
  };
}

function buildResponsesBody(input: GenerateStructuredInput, model: string, mode: AiStructuredOutputModeV2, temperature?: number): object {
  const systemPrompt = promptForStructuredMode(input, mode);
  return {
    model,
    ...(temperature === undefined ? {} : { temperature }),
    store: false,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: input.userData }
    ],
    ...(mode === "prompt_json" ? {} : {
      text: {
        format: mode === "json_object"
          ? { type: "json_object" }
          : {
              type: "json_schema",
              name: schemaName(input.schemaVersion),
              strict: true,
              schema: input.jsonSchema
            }
      }
    })
  };
}

function promptForStructuredMode(input: GenerateStructuredInput, mode: AiStructuredOutputModeV2): string {
  if (mode === "json_schema") return input.systemPrompt;
  return `${input.systemPrompt}\n\nRequired JSON Schema:\n${JSON.stringify(input.jsonSchema)}`;
}

function extractChatCompletionsOutput(body: ProviderBody | undefined): ExtractedOutput {
  const choice = body?.choices?.[0];
  if (choice?.finish_reason === "content_filter" || hasRefusal(choice?.message?.refusal)) {
    return { safetyBlocked: true, incomplete: false };
  }
  if (choice?.finish_reason !== "stop") {
    return { safetyBlocked: false, incomplete: true };
  }
  const content = choice?.message?.content;
  return {
    safetyBlocked: false,
    incomplete: false,
    rawText: typeof content === "string" ? content : undefined,
    inputTokens: body?.usage?.prompt_tokens,
    outputTokens: body?.usage?.completion_tokens
  };
}

function extractResponsesOutput(body: ProviderBody | undefined): ExtractedOutput {
  if (hasResponsesRefusal(body)) {
    return { safetyBlocked: true, incomplete: false };
  }
  const status = body?.status;
  if (status === "incomplete") {
    if (body?.incomplete_details?.reason === "content_filter") {
      return { safetyBlocked: true, incomplete: false };
    }
    return { safetyBlocked: false, incomplete: true };
  }
  if (status !== undefined && status !== "completed") {
    return { safetyBlocked: false, incomplete: true };
  }
  return {
    safetyBlocked: false,
    incomplete: false,
    rawText: extractResponsesText(body),
    inputTokens: body?.usage?.input_tokens,
    outputTokens: body?.usage?.output_tokens
  };
}

function extractResponsesText(body: ProviderBody | undefined): string | undefined {
  if (typeof body?.output_text === "string" && body.output_text.trim()) {
    return body.output_text;
  }
  for (const item of body?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const part of Array.isArray(item.content) ? item.content : []) {
      if (part && typeof part === "object" && typeof part.text === "string" && part.text.trim()) {
        return part.text;
      }
    }
  }
  return undefined;
}

function hasResponsesRefusal(body: ProviderBody | undefined): boolean {
  for (const item of body?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const part of Array.isArray(item.content) ? item.content : []) {
      if (part && typeof part === "object" && part.type === "refusal" && hasRefusal(part.refusal)) {
        return true;
      }
    }
  }
  return false;
}

function normalizeProtocol(protocol: OpenAiProtocol | undefined): OpenAiProtocol {
  if (protocol === undefined) return "openai_chat_completions";
  if (protocol === "openai_responses" || protocol === "openai_chat_completions") return protocol;
  throw new TypeError(`Unsupported OpenAI protocol: ${String(protocol)}`);
}

function normalizeProviderId(providerId: string | undefined): string {
  const value = (providerId ?? AI_PROVIDER_ID).trim();
  if (!value) throw new TypeError("providerId must be a non-empty string");
  if (Array.from(value).length > 100) throw new TypeError("providerId must be at most 100 code points");
  return value;
}

function normalizeModel(model: string | undefined): string {
  const value = (model ?? AI_MODEL_ID).trim();
  if (!value) throw new TypeError("model must be a non-empty string");
  if (Array.from(value).length > 200) throw new TypeError("model must be at most 200 code points");
  return value;
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const raw = (baseUrl ?? OPENAI_DEFAULT_BASE_URL).trim();
  if (!raw) throw new TypeError("baseUrl must be a non-empty http(s) URL");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError("baseUrl must be a valid http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("baseUrl must be an http(s) URL");
  }
  return raw.replace(/\/+$/, "");
}

function resolveEndpoint(baseUrl: string, protocol: OpenAiProtocol): string {
  return protocol === "openai_responses" ? `${baseUrl}/responses` : `${baseUrl}/chat/completions`;
}

interface ResolvedAuth {
  readonly header: string;
  readonly value: string;
}

function resolveAuth(options: DirectProviderOptions, providerId: string, model: string): ResolvedAuth | null {
  if (options.auth === null) return null;
  const header = (options.auth?.header ?? "Authorization").trim();
  if (!/^[!#$%&'*+.^_`|~0-9a-zA-Z-]+$/.test(header)) {
    throw new TypeError("auth.header must be a valid HTTP header name");
  }
  const explicitValue = options.auth?.value;
  if (explicitValue !== undefined && explicitValue.trim() !== "") {
    return { header, value: explicitValue };
  }
  const apiKey = (options.apiKey ?? "").trim();
  if (!apiKey) throw createConfigurationError(providerId, model);
  const scheme = options.auth?.scheme ?? "Bearer";
  return { header, value: scheme === "" ? apiKey : `${scheme} ${apiKey}` };
}

function normalizeTimeoutMs(timeoutMs: number | undefined): number | undefined {
  if (timeoutMs === undefined) return undefined;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive integer");
  }
  return timeoutMs;
}

function normalizeTemperature(temperature: number | undefined): number | undefined {
  if (temperature === undefined) return undefined;
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new TypeError("temperature must be between 0 and 2");
  }
  return temperature;
}

function validateInput(input: GenerateStructuredInput): void {
  if (!input.systemPrompt.trim() || !input.userData.trim() || !input.promptVersion.trim() || !input.schemaVersion.trim()) {
    throw new TypeError("Structured generation input contains an empty required field");
  }
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive integer");
  }
  const inputCodePoints = countWrappedCurrentTextCodePoints(input.userData) ?? Array.from(input.userData).length;
  if (inputCodePoints > MAX_AI_INPUT_CODE_POINTS) {
    throw providerError("AI_INPUT_TOO_LARGE", false, "AI input exceeds the provider limit", input, 0);
  }
  if (input.schemaVersion !== "memory-analysis.v1" && input.schemaVersion !== "insight-reply.v1") {
    throw providerError("AI_INVALID_OUTPUT", false, "Unsupported structured output schema", input, 0);
  }
}

function validateKnownSchema(schemaVersion: string, parsedJson: unknown):
  | { success: true; data: unknown }
  | { success: false } {
  const parsed = schemaVersion === "memory-analysis.v1"
    ? MemoryAnalysisV1Schema.safeParse(parsedJson)
    : InsightReplyV1Schema.safeParse(parsedJson);
  return parsed.success ? { success: true, data: parsed.data } : { success: false };
}

function providerError(
  code: ErrorCode,
  retryable: boolean,
  message: string,
  input: GenerateStructuredInput,
  latencyMs: number
): AiProviderError {
  const metadata = buildAttemptMetadata(input, {
    provider: AI_PROVIDER_ID,
    model: AI_MODEL_ID,
    latencyMs
  });
  return new AiProviderError({ code, retryable, message, metadata });
}

function createConfigurationError(providerId: string, model: string): AiProviderError {
  return new AiProviderError({
    code: "AI_NOT_CONFIGURED",
    retryable: false,
    message: "AI provider credential is not configured",
    metadata: {
      provider: providerId,
      model,
      promptVersion: "unavailable",
      schemaVersion: "unavailable",
      latencyMs: 0
    }
  });
}

function parseProviderBody(rawBody: string): ProviderBody | undefined {
  try {
    const body = JSON.parse(rawBody) as unknown;
    return typeof body === "object" && body !== null ? body as ProviderBody : undefined;
  } catch {
    return undefined;
  }
}

function schemaName(schemaVersion: string): string {
  if (schemaVersion === "memory-analysis.v1") return "paopao_memory_analysis_v1";
  if (schemaVersion === "insight-reply.v1") return "paopao_insight_reply_v1";
  return "paopao_structured_output";
}

function safeTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function safeRequestId(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 300 ? value : undefined;
}

function hasRefusal(value: unknown): boolean {
  return typeof value === "string" ? value.length > 0 : value !== undefined && value !== null;
}

function elapsed(now: number, startedAt: number): number {
  return Math.max(0, Math.round(now - startedAt));
}
