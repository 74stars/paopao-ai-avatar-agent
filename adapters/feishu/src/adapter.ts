import { randomUUID } from "node:crypto";
import type { DomainEventV1, ErrorCode } from "@paopao/contracts";
import { BindingError, type ControlKind, type ControlOutcome, type ControlReplyCode } from "@paopao/core";
import {
  controlKindForMessage,
  normalizeFeishuEvent,
  parseCommand,
  toCaptureCommand,
  type NormalizedFeishuMessage,
} from "./message.js";
import { renderDeliveryText } from "./reply.js";
import { classifyFeishuFailure, createOfficialFeishuTransportFactory } from "./sdk-transport.js";
import {
  FeishuAdapterError,
  FeishuTransportError,
  type FeishuAdapter,
  type FeishuAdapterDependenciesV1,
  type FeishuAdapterOptions,
  type FeishuConnectionStatus,
  type FeishuStatusEvent,
  type FeishuTransport,
  type RawFeishuMessageEvent,
} from "./types.js";

const DEFAULT_SCAN_INTERVAL_MS = 15_000;
const DEFAULT_REPLY_LEASE_MS = 60_000;
const DEFAULT_CONTROL_LEASE_MS = 30_000;
const DEFAULT_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000] as const;

function isBindingError(error: unknown): error is BindingError {
  return error instanceof BindingError ||
    error !== null && typeof error === "object" &&
    ["BINDING_CODE_INVALID", "BINDING_CODE_EXPIRED", "BINDING_CODE_CONSUMED", "BINDING_RATE_LIMITED"]
      .includes(String((error as { code?: unknown }).code));
}

function connectionError(error: unknown): FeishuAdapterError {
  if (error instanceof FeishuAdapterError) return error;
  const classified = classifyFeishuFailure(error);
  return new FeishuAdapterError(classified.code, classified.retryable);
}

export function createFeishuAdapter(
  dependencies: FeishuAdapterDependenciesV1,
  options: FeishuAdapterOptions = {},
): FeishuAdapter {
  const transportFactory = options.transportFactory ?? createOfficialFeishuTransportFactory();
  const owner = options.owner ?? `feishu-${randomUUID()}`;
  const scanIntervalMs = options.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS;
  const replyLeaseMs = options.replyLeaseMs ?? DEFAULT_REPLY_LEASE_MS;
  const controlLeaseMs = options.controlLeaseMs ?? DEFAULT_CONTROL_LEASE_MS;
  const reconnectDelaysMs = options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;
  const reconnectJitterRatio = options.reconnectJitterRatio ?? 0.2;
  const random = options.random ?? Math.random;

  let currentStatus: FeishuConnectionStatus = "disconnected";
  let currentErrorCode: ErrorCode | undefined;
  let desiredConnected = false;
  let accepting = false;
  let transport: FeishuTransport | null = null;
  let transportGeneration = 0;
  let connectionPromise: Promise<void> | null = null;
  let scanPromise: Promise<void> | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let scanTimer: ReturnType<typeof setInterval> | null = null;
  let unsubscribeDomainEvents: (() => void) | null = null;
  const inFlight = new Set<Promise<void>>();
  const statusHandlers = new Set<(event: FeishuStatusEvent) => void>();

  function log(
    level: "debug" | "info" | "warn" | "error",
    event: string,
    extra: { errorCode?: ErrorCode; attempts?: number; latencyMs?: number } = {},
  ): void {
    dependencies.logger.log({
      timestamp: dependencies.clock.now(),
      level,
      event,
      correlationId: randomUUID(),
      provider: "feishu",
      ...extra,
    });
  }

  function emitStatus(status: FeishuConnectionStatus, errorCode?: ErrorCode): void {
    if (currentStatus === status && currentErrorCode === errorCode) return;
    currentStatus = status;
    currentErrorCode = errorCode;
    const statusEvent: FeishuStatusEvent = {
      version: 1,
      type: "feishu:status",
      status,
      ...(errorCode ? { errorCode } : {}),
      occurredAt: dependencies.clock.now(),
    };
    for (const handler of [...statusHandlers]) {
      try {
        handler(statusEvent);
      } catch {
        // A status subscriber is a refresh hint and cannot own Adapter lifecycle.
      }
    }
  }

  function track(work: Promise<void>): void {
    const guarded = work.catch(() => undefined).finally(() => inFlight.delete(guarded));
    inFlight.add(guarded);
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function clearScanTimer(): void {
    if (scanTimer) clearInterval(scanTimer);
    scanTimer = null;
  }

  function ensureSubscriptions(): void {
    if (!unsubscribeDomainEvents) {
      unsubscribeDomainEvents = dependencies.subscribeDomainEvents((event: DomainEventV1) => {
        if (event.type === "insight:ready") void requestScan();
      });
    }
    if (!scanTimer) {
      scanTimer = setInterval(() => void requestScan(), scanIntervalMs);
      scanTimer.unref?.();
    }
  }

  function connected(): void {
    if (!desiredConnected) return;
    accepting = true;
    reconnectAttempt = 0;
    clearReconnectTimer();
    emitStatus("connected");
    ensureSubscriptions();
    void requestScan();
  }

  function scheduleReconnect(error: FeishuTransportError): void {
    if (!desiredConnected || !error.retryable || reconnectTimer) return;
    const index = Math.min(reconnectAttempt, Math.max(0, reconnectDelaysMs.length - 1));
    const baseDelay = reconnectDelaysMs[index] ?? 60_000;
    reconnectAttempt += 1;
    const jitter = 1 + (random() * 2 - 1) * reconnectJitterRatio;
    const delay = Math.max(0, Math.round(baseDelay * jitter));
    emitStatus("reconnecting", error.code);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void beginConnection(true).catch(() => undefined);
    }, delay);
    reconnectTimer.unref?.();
  }

  function onTransportError(error: FeishuTransportError, generation: number): void {
    if (!desiredConnected || generation !== transportGeneration) return;
    accepting = false;
    emitStatus("error", error.code);
    log("error", "feishu.connection.failed", { errorCode: error.code, attempts: reconnectAttempt + 1 });
    scheduleReconnect(error);
  }

  async function openConnection(reconnecting: boolean): Promise<void> {
    emitStatus(reconnecting ? "reconnecting" : "connecting");
    accepting = false;
    const generation = ++transportGeneration;
    const previous = transport;
    transport = null;
    if (previous) await previous.stop();

    let credential: Awaited<ReturnType<typeof dependencies.credentialProvider.getFeishuCredential>>;
    try {
      credential = await dependencies.credentialProvider.getFeishuCredential();
    } catch (error) {
      const code = error !== null && typeof error === "object" &&
        (error as { code?: unknown }).code === "SAFE_STORAGE_UNAVAILABLE"
        ? "SAFE_STORAGE_UNAVAILABLE"
        : "INTERNAL_ERROR";
      emitStatus("error", code);
      log("error", "feishu.credential.unavailable", { errorCode: code });
      throw new FeishuAdapterError(code, false);
    }
    if (!credential) {
      emitStatus("not_configured", "FEISHU_NOT_CONFIGURED");
      throw new FeishuAdapterError("FEISHU_NOT_CONFIGURED", false);
    }
    const next = transportFactory.create(credential, {
      onReady() {
        if (generation === transportGeneration) connected();
      },
      onReconnecting() {
        if (desiredConnected && generation === transportGeneration) {
          accepting = false;
          emitStatus("reconnecting");
        }
      },
      onReconnected() {
        if (generation === transportGeneration) connected();
      },
      onError(error) {
        onTransportError(error, generation);
      },
    });
    transport = next;
    accepting = false;

    try {
      await next.start((event) => {
        if (!accepting || generation !== transportGeneration) return Promise.resolve();
        const business = processRawEvent(event, credential.appId).catch((error) => {
          const mapped = connectionError(error);
          log("error", "feishu.event.failed", { errorCode: mapped.code });
          throw error;
        });
        track(business);
        return business;
      });
      if (!desiredConnected || generation !== transportGeneration) {
        accepting = false;
        await next.stop();
        if (transport === next) transport = null;
        return;
      }
      if (next.state() !== "connected") {
        throw new FeishuTransportError("FEISHU_NOT_CONNECTED", true, "confirmed_not_sent");
      }
      log("info", reconnecting ? "feishu.connection.reconnected" : "feishu.connection.connected");
    } catch (error) {
      accepting = false;
      if (transport === next) transport = null;
      await next.stop().catch(() => undefined);
      const classified = error instanceof FeishuTransportError ? error : classifyFeishuFailure(error);
      emitStatus("error", classified.code);
      log("error", "feishu.connection.failed", { errorCode: classified.code, attempts: reconnectAttempt + 1 });
      scheduleReconnect(classified);
      throw new FeishuAdapterError(classified.code, classified.retryable);
    }
  }

  function beginConnection(reconnecting: boolean): Promise<void> {
    if (connectionPromise) return connectionPromise;
    const started = openConnection(reconnecting).finally(() => {
      if (connectionPromise === started) connectionPromise = null;
    });
    connectionPromise = started;
    return started;
  }

  async function completeControl(
    message: NormalizedFeishuMessage,
    kind: ControlKind,
    fencingToken: number,
  ): Promise<void> {
    let outcome: ControlOutcome;
    let replyCode: ControlReplyCode;
    const operationKey = `control:${message.messageKey}:${kind}`;

    if (kind === "bind") {
      const command = message.text === null ? null : parseCommand(message.text);
      try {
        await dependencies.bindingService.consumeCode({
          operationKey,
          code: command?.kind === "bind" ? command.code : "",
          appId: message.appId,
          tenantKey: message.tenantKey,
          openId: message.openId,
        });
        outcome = "bound";
        replyCode = "bound";
      } catch (error) {
        if (!isBindingError(error)) throw error;
        outcome = "rejected";
        replyCode = "binding_error";
      }
    } else if (kind === "unbind") {
      await dependencies.bindingService.unbind({
        operationKey,
        appId: message.appId,
        tenantKey: message.tenantKey,
        openId: message.openId,
      });
      outcome = "unbound";
      replyCode = "unbound";
    } else if (kind === "binding_required") {
      outcome = "rejected";
      replyCode = "binding_required";
    } else {
      outcome = "ignored";
      replyCode = kind;
    }

    const completed = await dependencies.deliveryService.completeControlEvent({
      provider: "feishu",
      eventKey: message.eventKey,
      messageKey: message.messageKey,
      owner,
      fencingToken,
      outcome,
      replyCode,
    });
    if (!completed) {
      log("warn", "feishu.control.late_completion");
      return;
    }
    void requestScan();
  }

  async function processControl(message: NormalizedFeishuMessage, kind: ControlKind): Promise<void> {
    const claim = await dependencies.deliveryService.claimControlEvent({
      provider: "feishu",
      eventKey: message.eventKey,
      messageKey: message.messageKey,
      controlKind: kind,
      recipient: message.recipient,
      owner,
      leaseMs: controlLeaseMs,
      now: dependencies.clock.now(),
    });
    if (claim.decision !== "process" || claim.fencingToken === null) {
      log("debug", "feishu.control.duplicate");
      return;
    }
    await completeControl(message, kind, claim.fencingToken);
  }

  async function processRawEvent(raw: RawFeishuMessageEvent, appId: string): Promise<void> {
    if (!accepting) return;
    const message = normalizeFeishuEvent(raw, appId, dependencies.clock.now());
    if (!message) {
      log("warn", "feishu.event.invalid", { errorCode: "VALIDATION_FAILED" });
      return;
    }
    if (message.senderType && message.senderType !== "user") {
      log("debug", "feishu.event.non_user_ignored");
      return;
    }

    const immediateControl = controlKindForMessage(message);
    if (immediateControl) {
      await processControl(message, immediateControl);
      return;
    }

    const isBound = await dependencies.bindingService.isBound({
      appId: message.appId,
      tenantKey: message.tenantKey,
      openId: message.openId,
    });
    if (!isBound) {
      await processControl(message, "binding_required");
      return;
    }

    const replyMode = await dependencies.publicSettingsProvider.getFeishuReplyMode();
    const captureMode = replyMode === "insight" ? "think" : "remember";
    await dependencies.captureService.capture(toCaptureCommand(message, captureMode, randomUUID()));
    void requestScan();
  }

  async function failClaimedDelivery(
    delivery: Awaited<ReturnType<typeof dependencies.deliveryService.claimReply>> & { decision: "send" },
    failure: FeishuTransportError,
  ): Promise<void> {
    const correlationId = randomUUID();
    const accepted = await dependencies.deliveryService.failReply({
      provider: "feishu",
      messageKey: delivery.delivery.messageKey,
      phase: delivery.delivery.phase,
      owner: delivery.delivery.owner,
      fencingToken: delivery.delivery.fencingToken,
      outcome: failure.outcome,
      error: {
        code: failure.code,
        retryable: failure.retryable,
        message: "Feishu delivery failed",
        correlationId,
      },
      now: dependencies.clock.now(),
    });
    if (!accepted) log("warn", "feishu.delivery.late_failure");
    log(failure.retryable ? "warn" : "error", "feishu.delivery.failed", {
      errorCode: failure.code,
      attempts: delivery.delivery.attempts,
    });
  }

  async function sendDue(messageKey: string, phase: "ack" | "result"): Promise<void> {
    const currentTransport = transport;
    if (!currentTransport || currentStatus !== "connected") return;
    const claim = await dependencies.deliveryService.claimReply({
      provider: "feishu",
      messageKey,
      phase,
      owner,
      leaseMs: replyLeaseMs,
      now: dependencies.clock.now(),
    });
    if (claim.decision !== "send") return;

    if (transport !== currentTransport || currentStatus !== "connected") {
      await failClaimedDelivery(claim, new FeishuTransportError("FEISHU_NOT_CONNECTED", true, "confirmed_not_sent"));
      return;
    }

    let externalReplyId: string;
    try {
      const sent = await currentTransport.sendText({
        recipient: claim.delivery.recipient,
        text: renderDeliveryText(claim.delivery),
      });
      externalReplyId = sent.messageId;
    } catch (error) {
      await failClaimedDelivery(claim, error instanceof FeishuTransportError ? error : classifyFeishuFailure(error));
      return;
    }

    try {
      const completed = await dependencies.deliveryService.completeReply({
        provider: "feishu",
        messageKey: claim.delivery.messageKey,
        phase: claim.delivery.phase,
        owner: claim.delivery.owner,
        fencingToken: claim.delivery.fencingToken,
        externalReplyId,
      });
      if (!completed) log("warn", "feishu.delivery.late_completion");
    } catch {
      // The provider accepted the send. Leaving the claim in sending makes recovery mark it ambiguous.
      log("error", "feishu.delivery.completion_unknown", { errorCode: "DELIVERY_AMBIGUOUS" });
    }
  }

  async function scanDue(): Promise<void> {
    if (!desiredConnected || currentStatus !== "connected") return;
    const recovered = await dependencies.deliveryService.recoverStaleClaims({
      now: dependencies.clock.now(),
      providerSupportsIdempotentSend: false,
    });
    if (recovered.repliesMarkedAmbiguous > 0) {
      log("warn", "feishu.delivery.stale_ambiguous", {
        errorCode: "DELIVERY_AMBIGUOUS",
        attempts: recovered.repliesMarkedAmbiguous,
      });
    }

    while (desiredConnected && currentStatus === "connected") {
      const due = await dependencies.deliveryService.listDue({ now: dependencies.clock.now(), limit: 50 });
      for (const item of due) {
        if (!desiredConnected || currentStatus !== "connected") return;
        try {
          await sendDue(item.messageKey, item.phase);
        } catch {
          // One damaged ledger row must not block unrelated durable replies.
          log("error", "feishu.delivery.item_failed", { errorCode: "INTERNAL_ERROR" });
        }
      }
      if (due.length < 50) return;
    }
  }

  function requestScan(): Promise<void> {
    if (scanPromise) return scanPromise;
    const started = scanDue()
      .catch((error) => {
        const mapped = connectionError(error);
        log("error", "feishu.delivery.scan_failed", { errorCode: mapped.code });
      })
      .finally(() => {
        if (scanPromise === started) scanPromise = null;
      });
    scanPromise = started;
    track(started);
    return started;
  }

  return {
    async connect(): Promise<void> {
      desiredConnected = true;
      clearReconnectTimer();
      if (currentStatus === "connected" && transport?.state() === "connected") {
        void requestScan();
        return;
      }
      await beginConnection(currentStatus !== "disconnected" && currentStatus !== "not_configured");
    },

    async disconnect(): Promise<void> {
      desiredConnected = false;
      accepting = false;
      ++transportGeneration;
      clearReconnectTimer();
      clearScanTimer();
      unsubscribeDomainEvents?.();
      unsubscribeDomainEvents = null;

      const activeTransport = transport;
      transport = null;
      await activeTransport?.stop().catch(() => undefined);
      await connectionPromise?.catch(() => undefined);
      await Promise.allSettled([...inFlight]);
      dependencies.credentialProvider.clearDecryptedCache("feishu");
      emitStatus("disconnected");
      log("info", "feishu.connection.disconnected");
    },

    status(): FeishuConnectionStatus {
      return currentStatus;
    },

    async checkConnectionAfterWake(): Promise<void> {
      if (!desiredConnected) return;
      if (connectionPromise) await connectionPromise.catch(() => undefined);
      if (!desiredConnected) return;
      emitStatus("reconnecting");
      await beginConnection(true);
    },

    subscribeStatus(handler: (event: FeishuStatusEvent) => void): () => void {
      statusHandlers.add(handler);
      return () => statusHandlers.delete(handler);
    },
  };
}
