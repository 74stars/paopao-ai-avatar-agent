import { spawn, type SpawnOptions } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { InsightReplyV1Schema, MemoryAnalysisV1Schema, type ErrorCode } from "@paopao/contracts";
import {
  AiProviderError,
  MAX_AI_INPUT_CODE_POINTS,
  buildAttemptMetadata,
  countWrappedCurrentTextCodePoints,
  type AiProviderV1,
  type GenerateStructuredInput,
  type GenerateStructuredResult
} from "@paopao/infrastructure";

/**
 * Restricted Codex channel provider.
 *
 * `createCodexProvider` drives `codex exec` through an injected spawn-like
 * function. Every run is isolated: a fresh empty directory is passed to `-C`,
 * the JSON Schema is written to a 0600 temp file, and the directory is removed
 * once the call finishes. The provider never reads `~/.codex/auth.json`,
 * `config.toml`, or any credential file itself; Codex resolves its own auth
 * inside the subprocess.
 */
export const CODEX_PROVIDER_ID = "codex" as const;
export const DEFAULT_CODEX_DISCOVERY_TIMEOUT_MS = 15_000;

export type CodexSpawnOptions = Pick<SpawnOptions, "stdio" | "cwd" | "env">;

export interface ChildProcessLike {
  readonly pid?: number;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}

export type SpawnLike = (
  command: string,
  args: readonly string[],
  options?: CodexSpawnOptions
) => ChildProcessLike;

const defaultSpawnLike: SpawnLike = (command, args, options) =>
  spawn(command, args, options ?? {}) as unknown as ChildProcessLike;

export interface CodexProviderOptions {
  spawnLike?: SpawnLike;
  command?: string;
  /** Parent for the isolated temporary directory; defaults to the OS temp dir. */
  workdir?: string;
  profile?: string;
  model?: string;
  reasoningEffort?: string;
  codexHome?: string;
  now?: () => number;
}

export function createCodexProvider(options: CodexProviderOptions): AiProviderV1 {
  return new CodexStructuredProvider(options);
}

export class CodexStructuredProvider implements AiProviderV1 {
  readonly #spawnLike: SpawnLike;
  readonly #command: string;
  readonly #workdir: string | undefined;
  readonly #profile: string | undefined;
  readonly #model: string | undefined;
  readonly #modelLabel: string;
  readonly #reasoningEffort: string | undefined;
  readonly #codexHome: string | undefined;
  readonly #now: () => number;

  constructor(options: CodexProviderOptions) {
    this.#spawnLike = options.spawnLike ?? defaultSpawnLike;
    this.#command = options.command ?? "codex";
    this.#workdir = options.workdir;
    this.#profile = options.profile;
    this.#model = options.model;
    this.#modelLabel = options.model ?? CODEX_PROVIDER_ID;
    this.#reasoningEffort = options.reasoningEffort;
    this.#codexHome = normalizeCodexHome(options.codexHome);
    this.#now = options.now ?? Date.now;
  }

  async generateStructured(input: GenerateStructuredInput): Promise<GenerateStructuredResult> {
    validateStructuredInput(input);
    const startedAt = this.#now();
    const workdir = await mkdtemp(join(this.#workdir ?? tmpdir(), "paopao-codex-"));
    const schemaPath = join(workdir, "output-schema.json");
    let child: ChildProcessLike | undefined;
    try {
      await writeFile(schemaPath, JSON.stringify(input.jsonSchema), { mode: 0o600 });
      try {
        await chmod(schemaPath, 0o600);
      } catch {
        // Best effort; the write mode already applies on POSIX platforms.
      }
      child = this.#spawnLike(
        this.#command,
        buildExecArgs({
          schemaPath,
          workdir,
          profile: this.#profile,
          model: this.#model,
          reasoningEffort: this.#reasoningEffort
        }),
        { stdio: ["pipe", "pipe", "pipe"], env: codexEnvironment(this.#codexHome) }
      );
      return await runCodexExec(child, input, {
        model: this.#modelLabel,
        now: this.#now,
        startedAt
      });
    } finally {
      if (child) child.kill();
      await rm(workdir, { recursive: true, force: true });
    }
  }
}

function buildExecArgs(options: {
  schemaPath: string;
  workdir: string;
  profile?: string;
  model?: string;
  reasoningEffort?: string;
}): string[] {
  const args = [
    "exec",
    "-",
    "--ephemeral",
    "--json",
    "--output-schema",
    options.schemaPath,
    "--sandbox",
    "read-only",
    "--ignore-rules",
    "-c",
    "shell_environment_policy.inherit=none",
    "-C",
    options.workdir,
    "--skip-git-repo-check"
  ];
  if (options.profile !== undefined && options.profile !== "") args.push("--profile", options.profile);
  if (options.model !== undefined && options.model !== "") args.push("--model", options.model);
  if (options.reasoningEffort !== undefined && options.reasoningEffort !== "") {
    args.push("-c", `model_reasoning_effort=${options.reasoningEffort}`);
  }
  return args;
}

function buildPrompt(input: GenerateStructuredInput): string {
  return [
    input.systemPrompt,
    "",
    "Return exactly one JSON object matching the supplied JSON Schema. Do not run commands, edit files, call MCP tools, or browse the web.",
    "",
    "--- USER DATA ---",
    input.userData
  ].join("\n");
}

function validateStructuredInput(input: GenerateStructuredInput): void {
  if (!input.systemPrompt.trim() || !input.userData.trim() || !input.promptVersion.trim() || !input.schemaVersion.trim()) {
    throw new TypeError("Structured generation input contains an empty required field");
  }
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive integer");
  }
  const codePoints = countWrappedCurrentTextCodePoints(input.userData) ?? Array.from(input.userData).length;
  if (codePoints > MAX_AI_INPUT_CODE_POINTS) {
    throw structuredProviderError(input, CODEX_PROVIDER_ID, "AI_INPUT_TOO_LARGE", false, "AI input exceeds the provider limit", 0);
  }
  if (input.schemaVersion !== "memory-analysis.v1" && input.schemaVersion !== "insight-reply.v1") {
    throw structuredProviderError(input, CODEX_PROVIDER_ID, "AI_INVALID_OUTPUT", false, "Unsupported structured output schema", 0);
  }
}

interface ExecContext {
  model: string;
  now: () => number;
  startedAt: number;
}

type StructuredErrorFactory = (
  code: ErrorCode,
  retryable: boolean,
  message: string,
  cause?: unknown,
  rawText?: string
) => AiProviderError;

function runCodexExec(
  child: ChildProcessLike,
  input: GenerateStructuredInput,
  ctx: ExecContext
): Promise<GenerateStructuredResult> {
  return new Promise((resolve, reject) => {
    const { model, now, startedAt } = ctx;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let stdoutEnded = false;
    let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    let rawText: string | undefined;
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;
    let threadId: string | undefined;
    let stderrText = "";

    const fail = (error: AiProviderError): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        child.stdin.end();
      } catch {
        // ignore
      }
      reject(error);
    };

    const succeed = (result: GenerateStructuredResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        child.stdin.end();
      } catch {
        // ignore
      }
      resolve(result);
    };

    const errorFor: StructuredErrorFactory = (code, retryable, message, cause, rawText) =>
      structuredProviderError(input, model, code, retryable, message, elapsed(now(), startedAt), cause, rawText);

    const maybeSettle = (): void => {
      if (settled || !stdoutEnded || exit === null) return;
      if (exit.code !== 0) {
        fail(mapExecExitFailure(stderrText, exit.code ?? -1, errorFor));
        return;
      }
      if (rawText === undefined) {
        fail(errorFor("AI_INVALID_OUTPUT", true, "Codex exec finished without a final agent message"));
        return;
      }
      const parsed = parseAndValidate(rawText, input, model, now, startedAt);
      if (!parsed.ok) {
        fail(parsed.error);
        return;
      }
      succeed({
        rawText,
        parsedJson: parsed.data,
        provider: CODEX_PROVIDER_ID,
        model,
        latencyMs: elapsed(now(), startedAt),
        ...(usage?.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
        ...(usage?.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
        ...(threadId === undefined ? {} : { providerRequestId: threadId })
      });
    };

    timer = setTimeout(() => {
      child.kill();
      fail(errorFor("AI_TIMEOUT", true, "Codex exec request timed out"));
    }, input.timeoutMs);

    const lines = createInterface({ input: child.stdout });

    lines.on("line", (line) => {
      if (settled) return;
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch (cause) {
        child.kill();
        fail(errorFor("AI_INVALID_OUTPUT", true, "Codex exec emitted a non-JSON event line", cause, line));
        return;
      }
      const record = asRecord(event);
      if (record === undefined || typeof record.type !== "string") {
        child.kill();
        fail(errorFor("AI_INVALID_OUTPUT", true, "Codex exec emitted an invalid JSON event", undefined, line));
        return;
      }
      if (hasProhibitedItem(record)) {
        child.kill();
        fail(errorFor("AI_SAFETY_BLOCKED", false, "Codex attempted a prohibited command/file/MCP/web/tool action"));
        return;
      }
      if (record.type === "thread.started" && typeof record.thread_id === "string") {
        threadId = record.thread_id;
      }
      if (record.type === "turn.completed") {
        usage = extractUsage(record.usage);
      }
      const messageText = extractAgentMessageText(record);
      if (messageText !== undefined) rawText = messageText;
      if (record.type === "turn.failed" || record.type === "error") {
        const failureText = extractFailureText(record);
        if (failureText !== undefined) {
          child.kill();
          fail(mapFailureText(failureText, errorFor));
        }
      }
    });

    lines.on("close", () => {
      stdoutEnded = true;
      maybeSettle();
    });

    child.stderr.on("data", (chunk) => {
      stderrText += toText(chunk);
    });

    child.on("error", (error) => {
      const cause = error as NodeJS.ErrnoException;
      if (cause.code === "ENOENT") {
        fail(errorFor("AI_NOT_CONFIGURED", false, "Codex CLI is not installed"));
      } else {
        fail(errorFor("AI_NETWORK_ERROR", true, "Failed to start codex exec", error));
      }
    });

    child.on("close", (code, signal) => {
      exit = { code, signal };
      maybeSettle();
    });

    child.stdin.write(buildPrompt(input));
    child.stdin.end();
  });
}

function parseAndValidate(
  rawText: string,
  input: GenerateStructuredInput,
  model: string,
  now: () => number,
  startedAt: number
): { ok: true; data: unknown } | { ok: false; error: AiProviderError } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (cause) {
    return {
      ok: false,
      error: structuredProviderError(
        input,
        model,
        "AI_INVALID_OUTPUT",
        true,
        "Codex returned malformed JSON",
        elapsed(now(), startedAt),
        cause,
        rawText
      )
    };
  }
  const validated = validateKnownSchema(input.schemaVersion, parsed);
  if (!validated.success) {
    return {
      ok: false,
      error: structuredProviderError(
        input,
        model,
        "AI_INVALID_OUTPUT",
        true,
        "Codex output did not match the requested schema",
        elapsed(now(), startedAt),
        undefined,
        rawText
      )
    };
  }
  return { ok: true, data: validated.data };
}

function validateKnownSchema(schemaVersion: string, parsedJson: unknown):
  | { success: true; data: unknown }
  | { success: false } {
  const parsed = schemaVersion === "memory-analysis.v1"
    ? MemoryAnalysisV1Schema.safeParse(parsedJson)
    : InsightReplyV1Schema.safeParse(parsedJson);
  return parsed.success ? { success: true, data: parsed.data } : { success: false };
}

function structuredProviderError(
  input: GenerateStructuredInput,
  model: string,
  code: ErrorCode,
  retryable: boolean,
  message: string,
  latencyMs: number,
  cause?: unknown,
  rawText?: string
): AiProviderError {
  const metadata = buildAttemptMetadata(input, {
    provider: CODEX_PROVIDER_ID,
    model,
    latencyMs
  });
  return new AiProviderError({
    code,
    retryable,
    message,
    metadata,
    ...(cause === undefined ? {} : { cause }),
    ...(rawText === undefined ? {} : { rawText })
  });
}

function mapFailureText(text: string, errorFor: StructuredErrorFactory): AiProviderError {
  if (isAuthText(text)) return errorFor("AI_AUTH_FAILED", false, "Codex authentication failed");
  if (isSafetyText(text)) return errorFor("AI_SAFETY_BLOCKED", false, "Codex blocked the request for safety");
  if (isRateLimitText(text)) return errorFor("AI_RATE_LIMITED", true, "Codex rate limit reached");
  if (isSchemaText(text)) return errorFor("AI_INVALID_OUTPUT", true, "Codex output did not match the requested schema");
  return errorFor("AI_INVALID_OUTPUT", true, "Codex failed to produce a valid structured response");
}

function mapExecExitFailure(stderrText: string, code: number, errorFor: StructuredErrorFactory): AiProviderError {
  if (isAuthText(stderrText)) return errorFor("AI_AUTH_FAILED", false, "Codex authentication failed");
  if (isSafetyText(stderrText)) return errorFor("AI_SAFETY_BLOCKED", false, "Codex blocked the request for safety");
  if (isRateLimitText(stderrText)) return errorFor("AI_RATE_LIMITED", true, "Codex rate limit reached");
  if (isSchemaText(stderrText)) return errorFor("AI_INVALID_OUTPUT", true, "Codex output did not match the requested schema");
  return errorFor(
    "AI_INVALID_OUTPUT",
    true,
    `Codex exec exited with code ${code} without a valid structured response`,
    undefined,
    stderrText
  );
}

function extractAgentMessageText(event: Record<string, unknown>): string | undefined {
  const item = asRecord(event.item);
  if (item === undefined) return undefined;
  if (item.type !== "agent_message" && item.type !== "assistant_message") return undefined;
  const text = item.text ?? item.content;
  return typeof text === "string" && text.length > 0 ? text : undefined;
}

function extractUsage(value: unknown): { inputTokens?: number; outputTokens?: number } | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const input = safeCount(record.input_tokens);
  const output = safeCount(record.output_tokens);
  if (input === undefined && output === undefined) return undefined;
  return {
    ...(input === undefined ? {} : { inputTokens: input }),
    ...(output === undefined ? {} : { outputTokens: output })
  };
}

function extractFailureText(event: Record<string, unknown>): string | undefined {
  const candidates: string[] = [];
  if (typeof event.message === "string" && event.message.length > 0) candidates.push(event.message);
  if (typeof event.error === "string" && event.error.length > 0) candidates.push(event.error);
  const errorRecord = asRecord(event.error);
  if (errorRecord !== undefined) {
    if (typeof errorRecord.message === "string" && errorRecord.message.length > 0) candidates.push(errorRecord.message);
    if (typeof errorRecord.error === "string" && errorRecord.error.length > 0) candidates.push(errorRecord.error);
    if (typeof errorRecord.type === "string" && errorRecord.type.length > 0) candidates.push(errorRecord.type);
  }
  return candidates.length > 0 ? candidates[0] : undefined;
}

function hasProhibitedItem(event: Record<string, unknown>): boolean {
  const item = asRecord(event.item);
  const candidates = [event.type, item?.type];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && /(command|file|mcp|web|tool)/i.test(candidate)) return true;
  }
  return false;
}

function safeCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function toText(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString("utf8");
  return String(chunk);
}

function elapsed(now: number, startedAt: number): number {
  return Math.max(0, Math.round(now - startedAt));
}

const AUTH_TEXT = /(log\s*in|login|sign\s*in|not\s+authenticated|authentication|unauthorized|api\s*key|401|auth\s*failed)/i;
const RATE_LIMIT_TEXT = /(rate\s*limit|too\s+many\s+requests|429|quota\s*exceeded)/i;
const SAFETY_TEXT = /(safety|content\s*filter|blocked\s+(by|for)|refused\s+(to|for))/i;
const SCHEMA_TEXT = /(schema|validation\s*failed|does\s*not\s*(conform|match)|invalid\s+json|output\s*failed)/i;

function isAuthText(text: string): boolean {
  return AUTH_TEXT.test(text);
}
function isRateLimitText(text: string): boolean {
  return RATE_LIMIT_TEXT.test(text);
}
function isSafetyText(text: string): boolean {
  return SAFETY_TEXT.test(text);
}
function isSchemaText(text: string): boolean {
  return SCHEMA_TEXT.test(text);
}

export interface CodexAccountStatus {
  type: string;
  email?: string | null;
  planType?: string | null;
}

export interface CodexModelInfo {
  id: string;
  displayName?: string;
  description?: string;
  isDefault?: boolean;
  hidden?: boolean;
  defaultReasoningEffort?: string | null;
  supportedReasoningEfforts?: string[];
}

export interface CodexChannelDiscovery {
  version: string;
  account: CodexAccountStatus | null;
  requiresOpenaiAuth: boolean;
  models: CodexModelInfo[];
  latencyMs: number;
}

export interface DiscoverCodexChannelOptions {
  spawnLike?: SpawnLike;
  command?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  now?: () => number;
  clientInfo?: { name: string; version: string };
  profile?: string | null;
  codexHome?: string | null;
}

const DEFAULT_CLIENT_INFO = { name: "paopao-desktop", version: "0.1.0" };

interface DiscoveryContext {
  now: () => number;
  startedAt: number;
}

interface AppServerStatus {
  account: CodexAccountStatus | null;
  requiresOpenaiAuth: boolean;
  models: CodexModelInfo[];
}

/**
 * Discovers the local Codex channel: CLI version plus account and model
 * status from `codex app-server` over stdio JSON-RPC (newline-delimited).
 * Every subprocess is killed on completion, timeout, or caller cancellation.
 */
export async function discoverCodexChannel(options: DiscoverCodexChannelOptions): Promise<CodexChannelDiscovery> {
  const spawnLike = options.spawnLike ?? defaultSpawnLike;
  const command = options.command ?? "codex";
  const timeoutMs = options.timeoutMs ?? DEFAULT_CODEX_DISCOVERY_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = options.signal;
  const onExternalAbort = (): void => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const ctx: DiscoveryContext = { now, startedAt };
  try {
    const childOptions: CodexSpawnOptions = {
      stdio: ["pipe", "pipe", "pipe"],
      env: codexEnvironment(normalizeCodexHome(options.codexHome ?? undefined)),
    };
    const version = await readCodexVersion(spawnLike, command, controller.signal, ctx, childOptions);
    const status = await readAppServerStatus(
      spawnLike,
      command,
      controller.signal,
      ctx,
      options.clientInfo ?? DEFAULT_CLIENT_INFO,
      childOptions,
      normalizeOptionalText(options.profile ?? undefined)
    );
    return {
      version,
      account: status.account,
      requiresOpenaiAuth: status.requiresOpenaiAuth,
      models: status.models,
      latencyMs: elapsed(now(), startedAt)
    };
  } catch (cause) {
    if (controller.signal.aborted) {
      throw discoveryErrorFor(
        ctx,
        "AI_TIMEOUT",
        true,
        externalSignal?.aborted === true ? "Codex channel discovery was cancelled" : "Codex channel discovery timed out",
        cause
      );
    }
    throw cause;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
  }
}

function readCodexVersion(
  spawnLike: SpawnLike,
  command: string,
  signal: AbortSignal,
  ctx: DiscoveryContext,
  childOptions: CodexSpawnOptions
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnLike(command, ["--version"], childOptions);
    let stdoutText = "";
    let stderrText = "";
    let settled = false;

    const fail = (error: AiProviderError): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      child.kill();
      reject(error);
    };
    const done = (version: string): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      child.kill();
      resolve(version);
    };
    const onAbort = (): void => {
      child.kill();
      fail(discoveryErrorFor(ctx, "AI_TIMEOUT", true, "Codex version check was cancelled or timed out"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => {
      stdoutText += toText(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrText += toText(chunk);
    });
    child.on("error", (error) => {
      const cause = error as NodeJS.ErrnoException;
      if (cause.code === "ENOENT") {
        fail(discoveryErrorFor(ctx, "AI_NOT_CONFIGURED", false, "Codex CLI is not installed", error));
      } else {
        fail(discoveryErrorFor(ctx, "AI_NETWORK_ERROR", true, "Failed to start codex --version", error));
      }
    });
    child.on("close", (code) => {
      if (settled) return;
      drainStream(child.stdout, (text) => {
        stdoutText += text;
      });
      drainStream(child.stderr, (text) => {
        stderrText += text;
      });
      const version = parseCodexVersion(`${stdoutText}\n${stderrText}`);
      if (code === 0 && version !== undefined) {
        done(version);
      } else if (code === 0) {
        fail(discoveryErrorFor(ctx, "AI_INVALID_OUTPUT", true, "Could not parse the codex version", undefined, stdoutText));
      } else {
        fail(mapDiscoveryExitFailure(stderrText, ctx, "codex --version"));
      }
    });
  });
}

function readAppServerStatus(
  spawnLike: SpawnLike,
  command: string,
  signal: AbortSignal,
  ctx: DiscoveryContext,
  clientInfo: { name: string; version: string },
  childOptions: CodexSpawnOptions,
  profile?: string
): Promise<AppServerStatus> {
  return new Promise((resolve, reject) => {
    const child = spawnLike(command, profile ? ["--profile", profile, "app-server"] : ["app-server"], childOptions);
    const lines = createInterface({ input: child.stdout });
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: AiProviderError) => void }>();
    let nextId = 0;
    let settled = false;
    let stderrText = "";

    const fail = (error: AiProviderError): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      lines.close();
      child.kill();
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
      reject(error);
    };
    const done = (status: AppServerStatus): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      lines.close();
      child.kill();
      resolve(status);
    };
    const onAbort = (): void => {
      child.kill();
      fail(discoveryErrorFor(ctx, "AI_TIMEOUT", true, "Codex app-server discovery was cancelled or timed out"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    child.stderr.on("data", (chunk) => {
      stderrText += toText(chunk);
    });
    child.on("error", (error) => {
      const cause = error as NodeJS.ErrnoException;
      if (cause.code === "ENOENT") {
        fail(discoveryErrorFor(ctx, "AI_NOT_CONFIGURED", false, "Codex CLI is not installed", error));
      } else {
        fail(discoveryErrorFor(ctx, "AI_NETWORK_ERROR", true, "Failed to start codex app-server", error));
      }
    });
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0 && code !== null) {
        fail(mapDiscoveryExitFailure(stderrText, ctx, "codex app-server"));
      }
    });

    lines.on("line", (line) => {
      if (settled) return;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch (cause) {
        fail(discoveryErrorFor(ctx, "AI_INVALID_OUTPUT", true, "Codex app-server returned invalid JSON", cause, line));
        return;
      }
      const record = asRecord(message);
      if (record === undefined || typeof record.id !== "number") return; // server notification
      const entry = pending.get(record.id);
      if (entry === undefined) return;
      pending.delete(record.id);
      if (record.error !== undefined) {
        entry.reject(mapRpcFailure(record.error, ctx));
      } else {
        entry.resolve(record.result);
      }
    });

    lines.on("close", () => {
      if (settled) return;
      if (pending.size > 0) {
        fail(discoveryErrorFor(ctx, "AI_INVALID_OUTPUT", true, "Codex app-server exited before completing discovery"));
      }
    });

    const rpc = (method: string, params: unknown): Promise<unknown> =>
      new Promise((resolve, reject) => {
        if (settled) {
          reject(discoveryErrorFor(ctx, "AI_INVALID_OUTPUT", true, "Codex app-server closed before the request completed"));
          return;
        }
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      });

    void (async () => {
      try {
        await rpc("initialize", { clientInfo });
        child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
        const accountResult = await rpc("account/read", {});
        const modelResult = await rpc("model/list", {});
        done({ ...normalizeAccountStatus(accountResult), models: normalizeModels(modelResult) });
      } catch (error) {
        if (!settled) {
          fail(error instanceof AiProviderError ? error : discoveryErrorFor(ctx, "AI_INVALID_OUTPUT", true, "Codex app-server discovery failed", error));
        }
      }
    })();
  });
}

function normalizeAccountStatus(result: unknown): { account: CodexAccountStatus | null; requiresOpenaiAuth: boolean } {
  const record = asRecord(result);
  const requiresOpenaiAuth = record?.requiresOpenaiAuth === true;
  const accountRecord = asRecord(record?.account);
  if (accountRecord === undefined) return { account: null, requiresOpenaiAuth };
  return {
    account: {
      type: typeof accountRecord.type === "string" ? accountRecord.type : "unknown",
      ...(typeof accountRecord.email === "string" || accountRecord.email === null ? { email: accountRecord.email } : {}),
      ...(typeof accountRecord.planType === "string" || accountRecord.planType === null ? { planType: accountRecord.planType } : {})
    },
    requiresOpenaiAuth
  };
}

function normalizeModels(result: unknown): CodexModelInfo[] {
  const record = asRecord(result);
  if (!Array.isArray(record?.data)) return [];
  const models: CodexModelInfo[] = [];
  for (const entry of record.data) {
    const item = asRecord(entry);
    if (item === undefined || typeof item.id !== "string") continue;
    models.push({
      id: item.id,
      ...(typeof item.displayName === "string" ? { displayName: item.displayName } : {}),
      ...(typeof item.description === "string" ? { description: item.description } : {}),
      ...(typeof item.isDefault === "boolean" ? { isDefault: item.isDefault } : {}),
      ...(typeof item.hidden === "boolean" ? { hidden: item.hidden } : {}),
      ...(typeof item.defaultReasoningEffort === "string" || item.defaultReasoningEffort === null
        ? { defaultReasoningEffort: item.defaultReasoningEffort }
        : {}),
      ...(Array.isArray(item.supportedReasoningEfforts)
        ? { supportedReasoningEfforts: item.supportedReasoningEfforts.flatMap((value) => {
            if (typeof value === "string") return [value];
            const option = asRecord(value);
            return typeof option?.reasoningEffort === "string" ? [option.reasoningEffort] : [];
          }) }
        : {})
    });
  }
  return models;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeCodexHome(value: string | undefined): string | undefined {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return undefined;
  if (normalized === "~") return homedir();
  if (normalized.startsWith("~/") || normalized.startsWith("~\\")) return join(homedir(), normalized.slice(2));
  return normalized;
}

function codexEnvironment(codexHome?: string): NodeJS.ProcessEnv {
  return codexHome ? { ...process.env, CODEX_HOME: codexHome } : { ...process.env };
}

function mapRpcFailure(error: unknown, ctx: DiscoveryContext): AiProviderError {
  const text = extractMessageText(error);
  if (isAuthText(text)) return discoveryErrorFor(ctx, "AI_AUTH_FAILED", false, "Codex authentication is required");
  if (isRateLimitText(text)) return discoveryErrorFor(ctx, "AI_RATE_LIMITED", true, "Codex rate limit reached");
  return discoveryErrorFor(ctx, "AI_INVALID_OUTPUT", true, "Codex app-server request failed", undefined, text);
}

function mapDiscoveryExitFailure(stderrText: string, ctx: DiscoveryContext, label: string): AiProviderError {
  if (isAuthText(stderrText)) return discoveryErrorFor(ctx, "AI_AUTH_FAILED", false, "Codex authentication failed");
  if (isRateLimitText(stderrText)) return discoveryErrorFor(ctx, "AI_RATE_LIMITED", true, "Codex rate limit reached");
  return discoveryErrorFor(ctx, "AI_INVALID_OUTPUT", true, `${label} exited with an error`, undefined, stderrText);
}

function extractMessageText(value: unknown): string {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  if (record === undefined) return "";
  if (typeof record.message === "string") return record.message;
  if (typeof record.error === "string") return record.error;
  return "";
}

function parseCodexVersion(text: string): string | undefined {
  const match =
    /codex-cli\s+([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)/i.exec(text) ??
    /([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)/.exec(text);
  return match?.[1];
}

function drainStream(stream: Readable, append: (text: string) => void): void {
  let chunk: unknown;
  while ((chunk = stream.read()) !== null) append(toText(chunk));
}

function discoveryErrorFor(
  ctx: DiscoveryContext,
  code: ErrorCode,
  retryable: boolean,
  message: string,
  cause?: unknown,
  rawText?: string
): AiProviderError {
  return new AiProviderError({
    code,
    retryable,
    message,
    metadata: {
      provider: CODEX_PROVIDER_ID,
      model: "discovery",
      promptVersion: "unavailable",
      schemaVersion: "unavailable",
      latencyMs: elapsed(ctx.now(), ctx.startedAt)
    },
    ...(cause === undefined ? {} : { cause }),
    ...(rawText === undefined ? {} : { rawText })
  });
}
