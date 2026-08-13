import type {
  CaptureService,
  BindingService,
  ExternalDeliveryService,
  FeishuRecipient,
} from "@paopao/core";
import type {
  DiagnosticEventV1Schema,
  DomainEventV1,
  ErrorCode,
} from "@paopao/contracts";

export type FeishuConnectionStatus =
  | "not_configured"
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export type DiagnosticEventV1 = (typeof DiagnosticEventV1Schema)["_output"];
export type FeishuStatusEvent = Extract<DomainEventV1, { type: "feishu:status" }>;

export interface MainCredentialProviderV1 {
  getFeishuCredential(): Promise<{ appId: string; appSecret: string } | null>;
  clearDecryptedCache(scope: "ai" | "feishu" | "all"): void;
}

export interface FeishuAdapterDependenciesV1 {
  credentialProvider: MainCredentialProviderV1;
  captureService: CaptureService;
  bindingService: BindingService;
  deliveryService: ExternalDeliveryService;
  publicSettingsProvider: {
    getFeishuReplyMode(): Promise<"ack_only" | "insight">;
  };
  subscribeDomainEvents: (handler: (event: DomainEventV1) => void) => () => void;
  logger: { log(event: DiagnosticEventV1): void };
  clock: { now(): string };
}

export interface RawFeishuMessageEvent {
  event_id?: string;
  uuid?: string;
  app_id?: string;
  tenant_key?: string;
  create_time?: string;
  sender?: {
    sender_id?: { open_id?: string };
    sender_type?: string;
    tenant_key?: string;
  };
  message?: {
    message_id?: string;
    create_time?: string;
    chat_id?: string;
    chat_type?: string;
    message_type?: string;
    content?: string;
  };
}

export interface FeishuTransportLifecycle {
  onReady(): void;
  onReconnecting(): void;
  onReconnected(): void;
  onError(error: FeishuTransportError): void;
}

export type FeishuTransportState = "idle" | "connecting" | "connected" | "reconnecting" | "failed";

export interface FeishuTransport {
  start(handler: (event: RawFeishuMessageEvent) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
  state(): FeishuTransportState;
  sendText(input: { recipient: FeishuRecipient; text: string }): Promise<{ messageId: string }>;
}

export interface FeishuTransportFactory {
  create(
    credential: { appId: string; appSecret: string },
    lifecycle: FeishuTransportLifecycle,
  ): FeishuTransport;
}

export class FeishuTransportError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly retryable: boolean,
    readonly outcome: "confirmed_not_sent" | "unknown",
  ) {
    super("Feishu transport operation failed");
    this.name = "FeishuTransportError";
  }
}

export class FeishuAdapterError extends Error {
  constructor(readonly code: ErrorCode, readonly retryable: boolean) {
    super("Feishu adapter operation failed");
    this.name = "FeishuAdapterError";
  }
}

export interface FeishuAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  status(): FeishuConnectionStatus;
  checkConnectionAfterWake(): Promise<void>;
  subscribeStatus(handler: (event: FeishuStatusEvent) => void): () => void;
}

export interface FeishuAdapterOptions {
  transportFactory?: FeishuTransportFactory;
  owner?: string;
  scanIntervalMs?: number;
  replyLeaseMs?: number;
  controlLeaseMs?: number;
  reconnectDelaysMs?: readonly number[];
  reconnectJitterRatio?: number;
  random?: () => number;
}
