import assert from "node:assert/strict";
import test from "node:test";
import type { CaptureCommandV1, DiagnosticEventV1Schema, DomainEventV1 } from "@paopao/contracts";
import type {
  BindingService,
  ClaimedExternalDelivery,
  ControlKind,
  ExternalDeliveryService,
} from "@paopao/core";
import {
  classifyFeishuFailure,
  createFeishuAdapter,
  FeishuAdapterError,
  FeishuTransportError,
  type FeishuAdapterDependenciesV1,
  type FeishuTransport,
  type FeishuTransportFactory,
  type FeishuTransportLifecycle,
  type RawFeishuMessageEvent,
} from "../src/index.js";

const NOW = "2026-08-08T00:00:00.000Z";
type DiagnosticEvent = (typeof DiagnosticEventV1Schema)["_output"];

function rawEvent(input: {
  eventId?: string;
  messageId?: string;
  text?: string;
  chatType?: "p2p" | "group";
  messageType?: string;
} = {}): RawFeishuMessageEvent {
  return {
    event_id: input.eventId ?? "evt-1",
    app_id: "cli-app",
    tenant_key: "tenant-1",
    sender: { sender_type: "user", sender_id: { open_id: "ou-1" } },
    message: {
      message_id: input.messageId ?? "om-1",
      create_time: "1786147200000",
      chat_id: "oc-1",
      chat_type: input.chatType ?? "p2p",
      message_type: input.messageType ?? "text",
      content: input.messageType && input.messageType !== "text" ? "{}" : JSON.stringify({ text: input.text ?? "synthetic note" }),
    },
  };
}

class FakeTransport implements FeishuTransport {
  handler: ((event: RawFeishuMessageEvent) => Promise<void>) | null = null;
  stopped = false;
  currentState: ReturnType<FeishuTransport["state"]> = "idle";
  sent: Array<{ text: string; chatType: string }> = [];
  sendFailure: FeishuTransportError | null = null;
  startFailure: FeishuTransportError | null = null;

  constructor(readonly lifecycle: FeishuTransportLifecycle) {}

  async start(handler: (event: RawFeishuMessageEvent) => Promise<void>): Promise<void> {
    if (this.startFailure) throw this.startFailure;
    this.handler = handler;
    this.currentState = "connected";
    this.lifecycle.onReady();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.handler = null;
    this.currentState = "idle";
  }

  state() { return this.currentState; }

  async sendText(input: Parameters<FeishuTransport["sendText"]>[0]): Promise<{ messageId: string }> {
    if (this.sendFailure) throw this.sendFailure;
    this.sent.push({ text: input.text, chatType: input.recipient.chatType });
    return { messageId: `reply-${this.sent.length}` };
  }

  emit(event: RawFeishuMessageEvent): Promise<void> {
    return this.handler?.(event) ?? Promise.resolve();
  }
}

class FakeTransportFactory implements FeishuTransportFactory {
  transports: FakeTransport[] = [];
  startFailures: FeishuTransportError[] = [];
  sendFailures: Array<FeishuTransportError | null> = [];

  create(_credential: { appId: string; appSecret: string }, lifecycle: FeishuTransportLifecycle): FeishuTransport {
    const transport = new FakeTransport(lifecycle);
    transport.startFailure = this.startFailures.shift() ?? null;
    transport.sendFailure = this.sendFailures.shift() ?? null;
    this.transports.push(transport);
    return transport;
  }
}

class BlockingStartTransport extends FakeTransport {
  #rejectStart: ((error: Error) => void) | null = null;

  override start(handler: (event: RawFeishuMessageEvent) => Promise<void>): Promise<void> {
    this.handler = handler;
    this.currentState = "connecting";
    return new Promise((_resolve, reject) => { this.#rejectStart = reject; });
  }

  override async stop(): Promise<void> {
    this.stopped = true;
    this.handler = null;
    this.currentState = "idle";
    this.#rejectStart?.(new Error("connection stopped"));
    this.#rejectStart = null;
  }
}

class BlockingStartFactory extends FakeTransportFactory {
  override create(_credential: { appId: string; appSecret: string }, lifecycle: FeishuTransportLifecycle): FeishuTransport {
    const transport = new BlockingStartTransport(lifecycle);
    this.transports.push(transport);
    return transport;
  }
}

class DelayedReadyTransport extends FakeTransport {
  #resolveStart: (() => void) | null = null;

  override start(handler: (event: RawFeishuMessageEvent) => Promise<void>): Promise<void> {
    this.handler = handler;
    this.currentState = "connecting";
    return new Promise((resolve) => { this.#resolveStart = resolve; });
  }

  signalReady(): void {
    this.currentState = "connected";
    this.lifecycle.onReady();
    this.#resolveStart?.();
    this.#resolveStart = null;
  }

  override async stop(): Promise<void> {
    this.stopped = true;
    this.handler = null;
    this.currentState = "idle";
    this.#resolveStart?.();
    this.#resolveStart = null;
  }
}

class DelayedReadyFactory extends FakeTransportFactory {
  override create(_credential: { appId: string; appSecret: string }, lifecycle: FeishuTransportLifecycle): FeishuTransport {
    const transport = new DelayedReadyTransport(lifecycle);
    this.transports.push(transport);
    return transport;
  }
}

class PrematureResolveTransport extends FakeTransport {
  override async start(handler: (event: RawFeishuMessageEvent) => Promise<void>): Promise<void> {
    this.handler = handler;
    this.currentState = "connecting";
  }
}

class PrematureResolveFactory extends FakeTransportFactory {
  override create(_credential: { appId: string; appSecret: string }, lifecycle: FeishuTransportLifecycle): FeishuTransport {
    const transport = new PrematureResolveTransport(lifecycle);
    this.transports.push(transport);
    return transport;
  }
}

interface MockState {
  captureCalls: CaptureCommandV1[];
  uniqueEntries: Set<string>;
  controlClaims: Array<{ eventKey: string; messageKey: string; controlKind: ControlKind }>;
  controlCompletions: Array<Record<string, unknown>>;
  consumeCalls: Array<Record<string, unknown>>;
  unbindCalls: Array<Record<string, unknown>>;
  recoverCalls: number;
  order: string[];
  completes: Array<Record<string, unknown>>;
  failures: Array<Record<string, unknown>>;
  logs: DiagnosticEvent[];
  clearScopes: string[];
  unsubscribeCalls: number;
}

function delivery(messageKey: string, phase: "ack" | "result" = "ack", payload: ClaimedExternalDelivery["payload"] = { kind: "capture_ack" }): ClaimedExternalDelivery {
  return {
    messageKey,
    entryId: "00000000-0000-4000-8000-000000000010",
    phase,
    attempts: 1,
    owner: "owner-test",
    fencingToken: 7,
    recipient: {
      appId: "cli-app",
      tenantKey: "tenant-1",
      openId: "ou-1",
      chatId: "oc-1",
      chatType: "p2p",
      messageId: "om-1",
    },
    derivationId: null,
    payload,
  };
}

function setup(input: {
  bound?: boolean;
  replyMode?: "ack_only" | "insight";
  credential?: { appId: string; appSecret: string } | null;
  due?: ClaimedExternalDelivery[];
  completeReplyResult?: boolean;
  capture?: (command: CaptureCommandV1) => Promise<void>;
  transportFactory?: FakeTransportFactory;
  listDue?: () => Promise<Array<{ messageKey: string; entryId: string | null; phase: "ack" | "result"; attempts: number }>>;
  claimFailures?: ReadonlySet<string>;
  consumeCode?: (command: Record<string, unknown>, call: number) => Promise<{ bound: true }>;
  claimControl?: (command: { eventKey: string; messageKey: string; controlKind: ControlKind }) => Promise<{ decision: "process" | "skip"; fencingToken: number | null }>;
} = {}) {
  const state: MockState = {
    captureCalls: [], uniqueEntries: new Set(), controlClaims: [], controlCompletions: [],
    consumeCalls: [], unbindCalls: [], recoverCalls: 0, order: [], completes: [], failures: [],
    logs: [], clearScopes: [], unsubscribeCalls: 0,
  };
  const claimedControls = new Set<string>();
  const due = [...(input.due ?? [])];
  const transportFactory = input.transportFactory ?? new FakeTransportFactory();
  let domainHandler: ((event: DomainEventV1) => void) | null = null;

  const bindingService: BindingService = {
    async createCode() { return { code: "123456", expiresAt: NOW }; },
    async isBound() { return input.bound ?? true; },
    async hasActiveBinding() { return input.bound ?? true; },
    async consumeCode(command) {
      state.consumeCalls.push(command);
      return input.consumeCode ? input.consumeCode(command, state.consumeCalls.length) : { bound: true };
    },
    async unbind(command) { state.unbindCalls.push(command); },
  };

  const deliveryService = {
    async listDue() {
      state.order.push("list");
      if (input.listDue) return input.listDue();
      return due.map((item) => ({ messageKey: item.messageKey, entryId: item.entryId, phase: item.phase, attempts: item.attempts }));
    },
    async claimReply(command: { messageKey: string; phase: "ack" | "result" }) {
      if (input.claimFailures?.has(command.messageKey)) throw new Error("synthetic damaged ledger");
      const index = due.findIndex((item) => item.messageKey === command.messageKey && item.phase === command.phase);
      if (index < 0) return { decision: "skip" as const, delivery: null };
      const [item] = due.splice(index, 1);
      return { decision: "send" as const, delivery: item };
    },
    async renewReplyLease() { return true; },
    async completeReply(command: Record<string, unknown>) {
      state.completes.push(command);
      return input.completeReplyResult ?? true;
    },
    async failReply(command: Record<string, unknown>) { state.failures.push(command); return true; },
    async claimControlEvent(command: { eventKey: string; messageKey: string; controlKind: ControlKind }) {
      state.controlClaims.push(command);
      if (input.claimControl) return input.claimControl(command);
      if (claimedControls.has(command.messageKey)) return { decision: "skip" as const, fencingToken: null };
      claimedControls.add(command.messageKey);
      return { decision: "process" as const, fencingToken: 11 };
    },
    async completeControlEvent(command: Record<string, unknown>) { state.controlCompletions.push(command); return true; },
    async listIssues() { return { items: [], nextCursor: null }; },
    async countIssues() { return 0; },
    async resolveIssue() { return { status: "pending" as const }; },
    async recoverStaleClaims() {
      state.order.push("recover");
      state.recoverCalls += 1;
      return { controlsReleased: 0, repliesMarkedAmbiguous: 0 };
    },
  } as ExternalDeliveryService;

  const dependencies: FeishuAdapterDependenciesV1 = {
    credentialProvider: {
      async getFeishuCredential() { return input.credential === undefined ? { appId: "cli-app", appSecret: "sdk-secret" } : input.credential; },
      clearDecryptedCache(scope) { state.clearScopes.push(scope); },
    },
    captureService: {
      async capture(command) {
        state.captureCalls.push(command);
        if (input.capture) await input.capture(command);
        const deduplicated = state.uniqueEntries.has(command.sourceKey);
        state.uniqueEntries.add(command.sourceKey);
        return {
          entryId: "00000000-0000-4000-8000-000000000010",
          jobId: "00000000-0000-4000-8000-000000000011",
          status: "stored",
          deduplicated,
          createdAt: NOW,
        };
      },
    },
    bindingService,
    deliveryService,
    publicSettingsProvider: { async getFeishuReplyMode() { return input.replyMode ?? "ack_only"; } },
    subscribeDomainEvents(handler) {
      domainHandler = handler;
      return () => { state.unsubscribeCalls += 1; domainHandler = null; };
    },
    logger: { log(event) { state.logs.push(event); } },
    clock: { now() { return NOW; } },
  };

  const adapter = createFeishuAdapter(dependencies, {
    transportFactory,
    owner: "owner-test",
    scanIntervalMs: 5,
    reconnectDelaysMs: [1],
    reconnectJitterRatio: 0,
  });
  return {
    adapter,
    state,
    transportFactory,
    emitDomain: (event: DomainEventV1) => domainHandler?.(event),
    enqueueDue: (item: ClaimedExternalDelivery) => due.push(item),
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

test("connect, wake recreation, status subscription and graceful disconnect are deterministic", async () => {
  const { adapter, state, transportFactory } = setup();
  const statuses: string[] = [];
  const unsubscribe = adapter.subscribeStatus((event) => statuses.push(event.status));
  await adapter.connect();
  assert.equal(adapter.status(), "connected");
  assert.equal(transportFactory.transports.length, 1);

  await adapter.checkConnectionAfterWake();
  assert.equal(transportFactory.transports.length, 2);
  assert.equal(transportFactory.transports[0]?.stopped, true);
  assert.equal(adapter.status(), "connected");

  unsubscribe();
  await adapter.disconnect();
  assert.deepEqual(state.clearScopes, ["feishu"]);
  assert.equal(state.unsubscribeCalls, 1);
  assert.ok(statuses.includes("connecting"));
  assert.ok(statuses.includes("reconnecting"));
  assert.ok(!statuses.includes("disconnected"));
});

test("disconnect aborts a pending connection before awaiting its completion", async () => {
  const transportFactory = new BlockingStartFactory();
  const { adapter, state } = setup({ transportFactory });
  const connecting = adapter.connect().catch(() => undefined);
  await waitFor(() => transportFactory.transports.length === 1);
  await adapter.disconnect();
  await connecting;
  assert.equal(transportFactory.transports[0]?.stopped, true);
  assert.deepEqual(state.clearScopes, ["feishu"]);
  assert.equal(adapter.status(), "disconnected");
});

test("Adapter connect and intake wait for real transport readiness", async () => {
  const transportFactory = new DelayedReadyFactory();
  const { adapter, state } = setup({ transportFactory });
  let settled = false;
  const connecting = adapter.connect().finally(() => { settled = true; });
  await waitFor(() => transportFactory.transports.length === 1);
  const transport = transportFactory.transports[0] as DelayedReadyTransport;
  assert.equal(adapter.status(), "connecting");
  assert.equal(settled, false);
  await transport.emit(rawEvent());
  assert.equal(state.captureCalls.length, 0);

  transport.signalReady();
  await connecting;
  assert.equal(adapter.status(), "connected");
  assert.equal(settled, true);
  await adapter.disconnect();
});

test("Adapter rejects a transport that resolves start without connected state", async () => {
  const transportFactory = new PrematureResolveFactory();
  const { adapter } = setup({ transportFactory });
  await assert.rejects(adapter.connect(), (error: unknown) => {
    assert.ok(error instanceof FeishuAdapterError);
    assert.equal(error.code, "FEISHU_NOT_CONNECTED");
    return true;
  });
  assert.notEqual(adapter.status(), "connected");
  await adapter.disconnect();
});

test("wake recreation drops the old SDK client before reporting removed credentials", async () => {
  const setupOptions: { credential: { appId: string; appSecret: string } | null } = {
    credential: { appId: "cli-app", appSecret: "sdk-secret" },
  };
  const { adapter, transportFactory } = setup(setupOptions);
  await adapter.connect();
  setupOptions.credential = null;
  await assert.rejects(adapter.checkConnectionAfterWake(), FeishuAdapterError);
  assert.equal(transportFactory.transports[0]?.stopped, true);
  assert.equal(adapter.status(), "not_configured");
  await adapter.disconnect();
});

test("not configured is a stable, redacted connect error", async () => {
  const { adapter } = setup({ credential: null });
  await assert.rejects(adapter.connect(), (error: unknown) => {
    assert.ok(error instanceof FeishuAdapterError);
    assert.equal(error.code, "FEISHU_NOT_CONFIGURED");
    assert.equal(error.message, "Feishu adapter operation failed");
    return true;
  });
  assert.equal(adapter.status(), "not_configured");
  await adapter.disconnect();
});

test("terminal network failure uses jittered reconnect and recovers", async () => {
  const factory = new FakeTransportFactory();
  factory.startFailures.push(new FeishuTransportError("NETWORK_OFFLINE", true, "confirmed_not_sent"));
  const { adapter } = setup({ transportFactory: factory });
  await assert.rejects(adapter.connect(), FeishuAdapterError);
  await waitFor(() => adapter.status() === "connected");
  assert.equal(factory.transports.length, 2);
  await adapter.disconnect();
});

test("control messages are claimed before binding and same message replay executes once", async () => {
  const { adapter, state, transportFactory } = setup();
  await adapter.connect();
  const transport = transportFactory.transports[0]!;
  await Promise.all([
    transport.emit(rawEvent({ eventId: "evt-bind-1", messageId: "om-bind", text: "/bind 123456" })),
    transport.emit(rawEvent({ eventId: "evt-bind-2", messageId: "om-bind", text: "/bind 123456" })),
  ]);
  await adapter.disconnect();

  assert.equal(state.controlClaims.length, 2);
  assert.equal(state.consumeCalls.length, 1);
  assert.equal(state.controlCompletions.length, 1);
  assert.equal(state.controlCompletions[0]?.fencingToken, 11);
  assert.match(String(state.consumeCalls[0]?.operationKey), /^control:feishu:sha256\(.+\):bind$/);
  assert.equal(state.captureCalls.length, 0);
});

test("control crash leaves no completion and an expired-lease replay completes with new fencing", async () => {
  let claimNumber = 0;
  const { adapter, state, transportFactory } = setup({
    claimControl: async () => ({ decision: "process", fencingToken: ++claimNumber }),
    consumeCode: async (_command, call) => {
      if (call === 1) throw new Error("synthetic crash after claim");
      return { bound: true };
    },
  });
  await adapter.connect();
  const transport = transportFactory.transports[0]!;
  await assert.rejects(
    transport.emit(rawEvent({ eventId: "evt-crash", messageId: "om-control-crash", text: "/bind 123456" })),
    /synthetic crash/,
  );
  await waitFor(() => state.consumeCalls.length === 1);
  assert.equal(state.controlCompletions.length, 0);
  await transport.emit(rawEvent({ eventId: "evt-replay", messageId: "om-control-crash", text: "/bind 123456" }));
  await waitFor(() => state.controlCompletions.length === 1);
  assert.equal(state.consumeCalls[0]?.operationKey, state.consumeCalls[1]?.operationKey);
  assert.equal(state.controlCompletions[0]?.fencingToken, 2);
  await adapter.disconnect();
});

test("unbind, help, group, non-text and unbound text never enter Capture", async () => {
  const { adapter, state, transportFactory } = setup({ bound: false });
  await adapter.connect();
  const transport = transportFactory.transports[0]!;
  await Promise.all([
    transport.emit(rawEvent({ eventId: "evt-unbind", messageId: "om-unbind", text: "/unbind" })),
    transport.emit(rawEvent({ eventId: "evt-help", messageId: "om-help", text: "/help" })),
    transport.emit(rawEvent({ eventId: "evt-group", messageId: "om-group", chatType: "group" })),
    transport.emit(rawEvent({ eventId: "evt-image", messageId: "om-image", messageType: "image" })),
    transport.emit(rawEvent({ eventId: "evt-plain", messageId: "om-plain", text: "unbound text" })),
  ]);
  await adapter.disconnect();

  assert.equal(state.captureCalls.length, 0);
  assert.equal(state.unbindCalls.length, 1);
  assert.deepEqual(state.controlClaims.map((claim) => claim.controlKind).sort(), [
    "binding_required", "help", "p2p_only", "unbind", "unsupported_message",
  ].sort());
});

test("same message under different events reuses one Capture source key and insight selects think", async () => {
  const { adapter, state, transportFactory } = setup({ replyMode: "insight" });
  await adapter.connect();
  const transport = transportFactory.transports[0]!;
  await Promise.all([
    transport.emit(rawEvent({ eventId: "evt-a", messageId: "om-same" })),
    transport.emit(rawEvent({ eventId: "evt-b", messageId: "om-same" })),
  ]);
  await adapter.disconnect();

  assert.equal(state.captureCalls.length, 2);
  assert.equal(state.uniqueEntries.size, 1);
  assert.equal(state.captureCalls[0]?.sourceKey, state.captureCalls[1]?.sourceKey);
  assert.notEqual(state.captureCalls[0]?.externalRef?.eventKey, state.captureCalls[1]?.externalRef?.eventKey);
  assert.ok(state.captureCalls.every((call) => call.mode === "think"));
});

test("Capture failure does not manufacture a saved acknowledgement", async () => {
  const { adapter, state, transportFactory } = setup({
    capture: async () => { throw new Error("synthetic database failure with raw-marker"); },
  });
  await adapter.connect();
  const transport = transportFactory.transports[0]!;
  await assert.rejects(transport.emit(rawEvent({ text: "raw-marker" })), /synthetic database failure/);
  await adapter.disconnect();
  assert.equal(transport.sent.length, 0);
  assert.equal(state.completes.length, 0);
  assert.ok(!JSON.stringify(state.logs).includes("raw-marker"));
});

test("scanner recovers first, sends only claim payload and completes with owner plus fencing", async () => {
  const item = delivery("message-ack");
  const { adapter, state, transportFactory } = setup({ due: [item] });
  await adapter.connect();
  await waitFor(() => state.completes.length === 1);
  const transport = transportFactory.transports[0]!;

  assert.deepEqual(state.order.slice(0, 2), ["recover", "list"]);
  assert.equal(transport.sent[0]?.text, "已保存。");
  assert.equal(state.completes[0]?.owner, "owner-test");
  assert.equal(state.completes[0]?.fencingToken, 7);
  await adapter.disconnect();
});

test("one damaged delivery ledger does not block later due replies", async () => {
  const damaged = delivery("message-damaged");
  const healthy = delivery("message-healthy");
  const { adapter, state, transportFactory } = setup({
    due: [damaged, healthy],
    claimFailures: new Set([damaged.messageKey]),
  });
  await adapter.connect();
  await waitFor(() => state.completes.length === 1);

  assert.equal(state.completes[0]?.messageKey, healthy.messageKey);
  assert.equal(transportFactory.transports[0]?.sent.length, 1);
  assert.ok(state.logs.some((event) => event.event === "feishu.delivery.item_failed"));
  assert.ok(!JSON.stringify(state.logs).includes("synthetic damaged ledger"));
  await adapter.disconnect();
});

test("result delivery renders the insight snapshot returned by claimReply", async () => {
  const item = delivery("message-result", "result", {
    kind: "insight",
    reply: {
      schemaVersion: "insight-reply.v1",
      text: "A concise synthetic insight.",
      grounding: "grounded",
      citations: [{
        memoryId: "00000000-0000-4000-8000-000000000020",
        entryId: "00000000-0000-4000-8000-000000000021",
        evidenceQuote: "Synthetic supporting evidence.",
      }],
      nextAction: { title: "Take one small step." },
    },
  });
  item.derivationId = "00000000-0000-4000-8000-000000000022";
  const { adapter, state, transportFactory } = setup({ due: [item] });
  await adapter.connect();
  await waitFor(() => state.completes.length === 1);
  assert.equal(transportFactory.transports[0]?.sent[0]?.text,
    "A concise synthetic insight.\n下一步：Take one small step.\n来源：\n- Synthetic supporting evidence.");
  assert.equal(state.completes[0]?.phase, "result");
  await adapter.disconnect();
});

test("15-second-equivalent periodic scan recovers durable due work without a domain event", async () => {
  const { adapter, state, enqueueDue } = setup();
  await adapter.connect();
  await waitFor(() => state.recoverCalls >= 1);
  enqueueDue(delivery("message-periodic"));
  await waitFor(() => state.completes.length === 1);
  assert.ok(state.recoverCalls >= 2);
  await adapter.disconnect();
});

test("startup, periodic and insight scan triggers stay single-flight", async () => {
  let active = 0;
  let maximumActive = 0;
  let calls = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const { adapter, emitDomain } = setup({
    listDue: async () => {
      calls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await blocked;
      active -= 1;
      return [];
    },
  });
  await adapter.connect();
  await waitFor(() => calls === 1);
  emitDomain({
    version: 1,
    type: "insight:ready",
    entryId: "00000000-0000-4000-8000-000000000010",
    derivationId: "00000000-0000-4000-8000-000000000012",
    occurredAt: NOW,
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(calls, 1);
  assert.equal(maximumActive, 1);
  release();
  await adapter.disconnect();
});

test("confirmed-not-sent and unknown outcomes are persisted; no in-memory delivery retry occurs", async () => {
  for (const failure of [
    new FeishuTransportError("NETWORK_OFFLINE", true, "confirmed_not_sent"),
    new FeishuTransportError("FEISHU_NOT_CONNECTED", true, "unknown"),
  ]) {
    const transportFactory = new FakeTransportFactory();
    transportFactory.sendFailures.push(failure);
    const { adapter, state } = setup({ due: [delivery(`message-${failure.outcome}`)], transportFactory });
    await adapter.connect();
    await waitFor(() => state.failures.length === 1);
    assert.equal(state.failures[0]?.outcome, failure.outcome);
    assert.equal((state.failures[0]?.error as { code: string }).code, failure.code);
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(state.failures.length, 1);
    await adapter.disconnect();
  }
});

test("HTTP 5xx send failure persists unknown so Core makes the delivery ambiguous", async () => {
  const transportFactory = new FakeTransportFactory();
  transportFactory.sendFailures.push(classifyFeishuFailure({ response: { status: 503 } }));
  const { adapter, state } = setup({ due: [delivery("message-http-503")], transportFactory });
  await adapter.connect();
  await waitFor(() => state.failures.length === 1);
  assert.equal(state.failures[0]?.outcome, "unknown");
  assert.equal((state.failures[0]?.error as { retryable: boolean }).retryable, true);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(state.failures.length, 1);
  await adapter.disconnect();
});

test("late reply completion is discarded and logged without recipient or body", async () => {
  const { adapter, state } = setup({ due: [delivery("message-late")], completeReplyResult: false });
  await adapter.connect();
  await waitFor(() => state.completes.length === 1);
  assert.ok(state.logs.some((event) => event.event === "feishu.delivery.late_completion"));
  const serialized = JSON.stringify(state.logs);
  assert.ok(!serialized.includes("ou-1"));
  assert.ok(!serialized.includes("synthetic note"));
  assert.ok(!serialized.includes("sdk-secret"));
  await adapter.disconnect();
});

test("disconnect stops intake then waits for an in-flight Capture before clearing credentials", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const { adapter, state, transportFactory } = setup({ capture: async () => blocked });
  await adapter.connect();
  const transport = transportFactory.transports[0]!;
  const processing = transport.emit(rawEvent());
  await waitFor(() => state.captureCalls.length === 1);
  let disconnected = false;
  const stopping = adapter.disconnect().then(() => { disconnected = true; });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(transport.stopped, true);
  assert.equal(disconnected, false);
  assert.equal(state.clearScopes.length, 0);
  release();
  await processing;
  await stopping;
  assert.deepEqual(state.clearScopes, ["feishu"]);
});
