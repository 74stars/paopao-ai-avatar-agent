import * as Lark from "@larksuiteoapi/node-sdk";
import type { ErrorCode } from "@paopao/contracts";
import type {
  FeishuTransport,
  FeishuTransportError,
  FeishuTransportFactory,
  FeishuTransportLifecycle,
  RawFeishuMessageEvent,
} from "./types.js";
import { FeishuTransportError as TransportError } from "./types.js";

const AUTH_CODES = new Set([10003, 99991661, 99991663, 99991664, 99991668]);
const PERMISSION_CODES = new Set([230002, 230027, 99991672, 99991679]);
const RATE_LIMIT_CODES = new Set([99991400]);
const CONFIRMED_NETWORK_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH"]);
const UNKNOWN_NETWORK_CODES = new Set([
  "ETIMEDOUT",
  "ECONNABORTED",
  "ECONNRESET",
  "EPIPE",
  "ERR_CANCELED",
  "ERR_NETWORK",
]);

type OfficialSdk = Pick<
  typeof Lark,
  "Client" | "DefaultCache" | "EventDispatcher" | "LoggerLevel" | "WSClient"
>;

export interface OfficialFeishuTransportOptions {
  sendTimeoutMs?: number;
  readinessTimeoutMs?: number;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" ? (value as UnknownRecord) : null;
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function sdkConnectPlatformCode(error: unknown): number | null {
  const message = string(record(error)?.message);
  if (!message) return null;
  const match = /^pullConnectConfig failed:\s*code=(\d+),\s*msg=/.exec(message);
  if (!match?.[1]) return null;
  const code = Number(match[1]);
  return Number.isSafeInteger(code) ? code : null;
}

function errorFacts(error: unknown): { status: number | null; platformCode: number | null; networkCode: string | null } {
  const outer = record(error);
  const response = record(outer?.response);
  const responseData = record(response?.data);
  return {
    status: numeric(response?.status) ?? numeric(outer?.status),
    platformCode:
      numeric(outer?.platformCode) ?? numeric(responseData?.code) ??
      (typeof outer?.code === "number" ? outer.code : null) ?? sdkConnectPlatformCode(error),
    networkCode: string(outer?.code) ?? string(record(outer?.cause)?.code),
  };
}

export function classifyFeishuFailure(error: unknown): FeishuTransportError {
  if (error instanceof TransportError) return error;
  const { status, platformCode, networkCode } = errorFacts(error);

  if (status === 401 || (platformCode !== null && AUTH_CODES.has(platformCode))) {
    return new TransportError("FEISHU_AUTH_FAILED", false, "confirmed_not_sent");
  }
  if (status === 403 || (platformCode !== null && PERMISSION_CODES.has(platformCode))) {
    return new TransportError("FEISHU_PERMISSION_DENIED", false, "confirmed_not_sent");
  }
  if (status === 429 || platformCode !== null && RATE_LIMIT_CODES.has(platformCode)) {
    return new TransportError("FEISHU_NOT_CONNECTED", true, "confirmed_not_sent");
  }
  if (status !== null && status >= 500) {
    // A failed gateway response does not prove a POST was not committed upstream.
    return new TransportError("FEISHU_NOT_CONNECTED", true, "unknown");
  }
  if (networkCode && CONFIRMED_NETWORK_CODES.has(networkCode)) {
    return new TransportError("NETWORK_OFFLINE", true, "confirmed_not_sent");
  }
  if (networkCode && UNKNOWN_NETWORK_CODES.has(networkCode)) {
    return new TransportError("FEISHU_NOT_CONNECTED", true, "unknown");
  }
  if (platformCode !== null && platformCode !== 0) {
    return new TransportError("INTERNAL_ERROR", false, "confirmed_not_sent");
  }
  return new TransportError("FEISHU_NOT_CONNECTED", true, "unknown");
}

const silentSdkLogger: Lark.Logger = {
  error() {},
  warn() {},
  info() {},
  debug() {},
  trace() {},
};

class OfficialFeishuTransport implements FeishuTransport {
  readonly #sdk: OfficialSdk;
  #client: InstanceType<OfficialSdk["Client"]> | null;
  #wsClient: InstanceType<OfficialSdk["WSClient"]> | null;
  #handler: ((event: RawFeishuMessageEvent) => Promise<void>) | null = null;
  #stopped = false;
  readonly #sendTimeoutMs: number;
  readonly #readinessTimeoutMs: number;
  readonly #validAppId: boolean;
  #readiness: { resolve(): void; reject(error: FeishuTransportError): void } | null = null;
  #readinessTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    sdk: OfficialSdk,
    credential: { appId: string; appSecret: string },
    lifecycle: FeishuTransportLifecycle,
    options: OfficialFeishuTransportOptions,
  ) {
    this.#sdk = sdk;
    this.#sendTimeoutMs = options.sendTimeoutMs ?? 45_000;
    this.#readinessTimeoutMs = options.readinessTimeoutMs ?? 15_000;
    this.#validAppId = /^cli_[0-9a-fA-F]{16}$/.test(credential.appId);
    const cache = new sdk.DefaultCache();
    this.#client = new sdk.Client({
      appId: credential.appId,
      appSecret: credential.appSecret,
      cache,
      logger: silentSdkLogger,
      loggerLevel: sdk.LoggerLevel.error,
      source: "paopao-desktop",
    });
    this.#wsClient = new sdk.WSClient({
      appId: credential.appId,
      appSecret: credential.appSecret,
      autoReconnect: true,
      handshakeTimeoutMs: 10_000,
      wsConfig: { pingTimeout: 15 },
      logger: silentSdkLogger,
      loggerLevel: sdk.LoggerLevel.error,
      source: "paopao-desktop",
      onReady: () => {
        lifecycle.onReady();
        this.#resolveReadiness();
      },
      onReconnecting: () => lifecycle.onReconnecting(),
      onReconnected: () => {
        lifecycle.onReconnected();
        this.#resolveReadiness();
      },
      onError: (error) => {
        const classified = classifyFeishuFailure(error);
        this.#rejectReadiness(classified);
        lifecycle.onError(classified);
      },
    });
  }

  #resolveReadiness(): void {
    if (!this.#readiness) return;
    if (this.#readinessTimer) clearTimeout(this.#readinessTimer);
    this.#readinessTimer = null;
    const readiness = this.#readiness;
    this.#readiness = null;
    readiness.resolve();
  }

  #rejectReadiness(error: FeishuTransportError): void {
    if (!this.#readiness) return;
    if (this.#readinessTimer) clearTimeout(this.#readinessTimer);
    this.#readinessTimer = null;
    const readiness = this.#readiness;
    this.#readiness = null;
    readiness.reject(error);
  }

  #waitUntilReady(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.#readiness = { resolve, reject };
      this.#readinessTimer = setTimeout(() => {
        const timeout = new TransportError("FEISHU_NOT_CONNECTED", true, "confirmed_not_sent");
        this.#rejectReadiness(timeout);
        this.#wsClient?.close({ force: true });
      }, this.#readinessTimeoutMs);
      // NOTE: the readiness and send timers must stay ref'd. Under Node 22 the test
      // runner and short-lived processes can drain the event loop while only
      // unref'd timers are pending, which cancels readiness/send guarantees.
    });
  }

  async start(handler: (event: RawFeishuMessageEvent) => Promise<void>): Promise<void> {
    if (this.#stopped || !this.#wsClient) throw new TransportError("FEISHU_NOT_CONNECTED", true, "confirmed_not_sent");
    if (!this.#validAppId) throw new TransportError("FEISHU_AUTH_FAILED", false, "confirmed_not_sent");
    this.#handler = handler;
    const dispatcher = new this.#sdk.EventDispatcher({
      logger: silentSdkLogger,
      loggerLevel: this.#sdk.LoggerLevel.error,
    }).register({
      "im.message.receive_v1": (event) => Promise.resolve(this.#handler?.(event)),
    });
    const readiness = this.#waitUntilReady();
    try {
      await this.#wsClient.start({ eventDispatcher: dispatcher });
    } catch (error) {
      this.#rejectReadiness(classifyFeishuFailure(error));
    }
    await readiness;
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#handler = null;
    this.#rejectReadiness(new TransportError("FEISHU_NOT_CONNECTED", true, "confirmed_not_sent"));
    this.#wsClient?.close({ force: false });
    this.#wsClient = null;
    this.#client = null;
  }

  state(): ReturnType<FeishuTransport["state"]> {
    return this.#wsClient?.getConnectionStatus().state ?? "idle";
  }

  async sendText(input: Parameters<FeishuTransport["sendText"]>[0]): Promise<{ messageId: string }> {
    if (this.#stopped || !this.#client) throw new TransportError("FEISHU_NOT_CONNECTED", true, "confirmed_not_sent");
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      const request = this.#client.im.message.create({
        params: {
          receive_id_type: input.recipient.chatType === "p2p" ? "open_id" : "chat_id",
        },
        data: {
          receive_id: input.recipient.chatType === "p2p" ? input.recipient.openId : input.recipient.chatId,
          msg_type: "text",
          content: JSON.stringify({ text: input.text }),
        },
      });
      const timeoutFailure = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new TransportError("FEISHU_NOT_CONNECTED", true, "unknown"));
        }, this.#sendTimeoutMs);
      });
      // Promise.race installs handlers on the provider promise, so a late provider
      // resolve/reject after our timeout is absorbed while the ledger stays ambiguous.
      const response = await Promise.race([request, timeoutFailure]);
      if (response.code !== undefined && response.code !== 0) {
        throw classifyFeishuFailure({ platformCode: response.code });
      }
      const messageId = response.data?.message_id;
      if (!messageId) throw new TransportError("FEISHU_NOT_CONNECTED", true, "unknown");
      return { messageId };
    } catch (error) {
      throw classifyFeishuFailure(error);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

export function createOfficialFeishuTransportFactory(
  sdk: OfficialSdk = Lark,
  options: OfficialFeishuTransportOptions = {},
): FeishuTransportFactory {
  return {
    create(credential, lifecycle) {
      return new OfficialFeishuTransport(sdk, credential, lifecycle, options);
    },
  };
}

export function connectionErrorCode(error: unknown): ErrorCode {
  return classifyFeishuFailure(error).code;
}
