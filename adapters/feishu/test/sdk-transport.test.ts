import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyFeishuFailure,
  createOfficialFeishuTransportFactory,
  FeishuTransportError,
  type FeishuTransportLifecycle,
  type RawFeishuMessageEvent,
} from "../src/index.js";

const APP_ID = "cli_0123456789abcdef";

class FakeCache {}

class FakeDispatcher {
  static instances: FakeDispatcher[] = [];
  handles: Record<string, (event: RawFeishuMessageEvent) => Promise<void>> = {};
  constructor(_options: unknown) { FakeDispatcher.instances.push(this); }
  register(handles: Record<string, (event: RawFeishuMessageEvent) => Promise<void>>) {
    this.handles = handles;
    return this;
  }
}

class FakeWsClient {
  static instances: FakeWsClient[] = [];
  static autoReady = true;
  dispatcher: FakeDispatcher | null = null;
  closed = false;
  startCalls = 0;
  connectionState: "idle" | "connecting" | "connected" | "failed" = "idle";
  constructor(readonly options: Record<string, unknown>) { FakeWsClient.instances.push(this); }
  async start(input: { eventDispatcher: FakeDispatcher }) {
    this.startCalls += 1;
    this.dispatcher = input.eventDispatcher;
    this.connectionState = "connecting";
    if (FakeWsClient.autoReady) this.triggerReady();
  }
  triggerReady() {
    this.connectionState = "connected";
    (this.options.onReady as () => void)();
  }
  triggerError(error: Error) {
    this.connectionState = "failed";
    (this.options.onError as (error: Error) => void)(error);
  }
  close() { this.closed = true; this.connectionState = "idle"; }
  getConnectionStatus() {
    return { state: this.connectionState, reconnectAttempts: 0 };
  }
}

class FakeClient {
  static instances: FakeClient[] = [];
  static response: Promise<Record<string, unknown>> = Promise.resolve({ code: 0, data: { message_id: "reply-1" } });
  calls: unknown[] = [];
  readonly im = {
    message: {
      create: (input: unknown) => {
        this.calls.push(input);
        return FakeClient.response;
      },
    },
  };
  constructor(readonly options: Record<string, unknown>) { FakeClient.instances.push(this); }
}

const fakeSdk = {
  Client: FakeClient,
  DefaultCache: FakeCache,
  EventDispatcher: FakeDispatcher,
  LoggerLevel: { error: 1 },
  WSClient: FakeWsClient,
};

function lifecycle(): FeishuTransportLifecycle & { events: string[] } {
  const events: string[] = [];
  return {
    events,
    onReady() { events.push("ready"); },
    onReconnecting() { events.push("reconnecting"); },
    onReconnected() { events.push("reconnected"); },
    onError() { events.push("error"); },
  };
}

function reset(): void {
  FakeClient.instances = [];
  FakeWsClient.instances = [];
  FakeDispatcher.instances = [];
  FakeWsClient.autoReady = true;
  FakeClient.response = Promise.resolve({ code: 0, data: { message_id: "reply-1" } });
}

test("official transport uses WSClient/EventDispatcher and sends through the SDK client", async () => {
  reset();
  const hooks = lifecycle();
  const factory = createOfficialFeishuTransportFactory(fakeSdk as never, { sendTimeoutMs: 50 });
  const transport = factory.create({ appId: APP_ID, appSecret: "sdk-secret" }, hooks);
  const received: RawFeishuMessageEvent[] = [];
  await transport.start(async (event) => { received.push(event); });

  assert.deepEqual(hooks.events, ["ready"]);
  assert.equal(FakeWsClient.instances[0]?.options.autoReconnect, true);
  assert.equal(FakeWsClient.instances[0]?.options.handshakeTimeoutMs, 10_000);
  assert.deepEqual(FakeWsClient.instances[0]?.options.wsConfig, { pingTimeout: 15 });

  await FakeDispatcher.instances[0]?.handles["im.message.receive_v1"]?.({ event_id: "evt-1" });
  assert.equal(received[0]?.event_id, "evt-1");

  const result = await transport.sendText({
    recipient: {
      appId: APP_ID, tenantKey: "tenant-1", openId: "ou-1", chatId: "oc-1",
      chatType: "p2p", messageId: "om-1",
    },
    text: "fixed reply",
  });
  assert.equal(result.messageId, "reply-1");
  assert.deepEqual(FakeClient.instances[0]?.calls[0], {
    params: { receive_id_type: "open_id" },
    data: {
      receive_id: "ou-1",
      msg_type: "text",
      content: JSON.stringify({ text: "fixed reply" }),
    },
  });

  await transport.stop();
  assert.equal(FakeWsClient.instances[0]?.closed, true);
  assert.equal(transport.state(), "idle");
});

test("official send timeout is unknown and absorbs a late provider resolution", async () => {
  reset();
  let resolveProvider!: (value: Record<string, unknown>) => void;
  FakeClient.response = new Promise((resolve) => { resolveProvider = resolve; });
  const transport = createOfficialFeishuTransportFactory(fakeSdk as never, { sendTimeoutMs: 50 })
    .create({ appId: APP_ID, appSecret: "sdk-secret" }, lifecycle());
  await transport.start(async () => undefined);

  await assert.rejects(transport.sendText({
    recipient: {
      appId: APP_ID, tenantKey: "tenant-1", openId: "ou-1", chatId: "oc-1",
      chatType: "p2p", messageId: "om-1",
    },
    text: "fixed reply",
  }), (error: unknown) => {
    assert.ok(error instanceof FeishuTransportError);
    assert.equal(error.outcome, "unknown");
    assert.equal(error.code, "FEISHU_NOT_CONNECTED");
    return true;
  });

  resolveProvider({ code: 0, data: { message_id: "late-reply" } });
  await new Promise((resolve) => setTimeout(resolve, 10));
  await transport.stop();
});

test("official dispatcher does not settle before the business handler", async () => {
  reset();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const transport = createOfficialFeishuTransportFactory(fakeSdk as never)
    .create({ appId: APP_ID, appSecret: "sdk-secret" }, lifecycle());
  await transport.start(async () => blocked);

  let settled = false;
  const dispatched = FakeDispatcher.instances[0]!.handles["im.message.receive_v1"]!({ event_id: "evt-blocked" })
    .finally(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  release();
  await dispatched;
  assert.equal(settled, true);
  await transport.stop();
});

test("official dispatcher propagates business handler rejection for platform retry", async () => {
  reset();
  const transport = createOfficialFeishuTransportFactory(fakeSdk as never)
    .create({ appId: APP_ID, appSecret: "sdk-secret" }, lifecycle());
  await transport.start(async () => { throw new Error("synthetic persistence failure"); });

  await assert.rejects(
    FakeDispatcher.instances[0]!.handles["im.message.receive_v1"]!({ event_id: "evt-failed" }),
    /synthetic persistence failure/,
  );
  await transport.stop();
});

test("SDK start resolution alone does not settle transport readiness", async () => {
  reset();
  FakeWsClient.autoReady = false;
  const transport = createOfficialFeishuTransportFactory(fakeSdk as never, { readinessTimeoutMs: 100 })
    .create({ appId: APP_ID, appSecret: "sdk-secret" }, lifecycle());
  let settled = false;
  const starting = transport.start(async () => undefined).finally(() => { settled = true; });
  await Promise.resolve();
  assert.equal(FakeWsClient.instances[0]?.startCalls, 1);
  assert.equal(settled, false);
  assert.equal(transport.state(), "connecting");

  FakeWsClient.instances[0]?.triggerReady();
  await starting;
  assert.equal(settled, true);
  assert.equal(transport.state(), "connected");
  await transport.stop();
});

test("invalid official app id fails auth validation without starting WSClient", async () => {
  reset();
  const transport = createOfficialFeishuTransportFactory(fakeSdk as never)
    .create({ appId: "invalid-app-id", appSecret: "sdk-secret" }, lifecycle());
  await assert.rejects(transport.start(async () => undefined), (error: unknown) => {
    assert.ok(error instanceof FeishuTransportError);
    assert.equal(error.code, "FEISHU_AUTH_FAILED");
    assert.equal(error.retryable, false);
    return true;
  });
  assert.equal(FakeWsClient.instances[0]?.startCalls, 0);
  assert.notEqual(transport.state(), "connected");
  await transport.stop();
});

test("terminal WS error rejects pending readiness with stable classification", async () => {
  reset();
  FakeWsClient.autoReady = false;
  const hooks = lifecycle();
  const transport = createOfficialFeishuTransportFactory(fakeSdk as never, { readinessTimeoutMs: 100 })
    .create({ appId: APP_ID, appSecret: "sdk-secret" }, hooks);
  const starting = transport.start(async () => undefined);
  await Promise.resolve();
  const networkError = new Error("network unavailable") as Error & { code: string };
  networkError.code = "ENOTFOUND";
  FakeWsClient.instances[0]?.triggerError(networkError);
  await assert.rejects(starting, (error: unknown) => {
    assert.ok(error instanceof FeishuTransportError);
    assert.equal(error.code, "NETWORK_OFFLINE");
    assert.equal(error.retryable, true);
    return true;
  });
  assert.ok(hooks.events.includes("error"));
  await transport.stop();
});

test("official pullConnectConfig credential failure rejects readiness as terminal auth", async () => {
  reset();
  FakeWsClient.autoReady = false;
  const transport = createOfficialFeishuTransportFactory(fakeSdk as never, { readinessTimeoutMs: 100 })
    .create({ appId: APP_ID, appSecret: "wrong-secret" }, lifecycle());
  const starting = transport.start(async () => undefined);
  await Promise.resolve();
  FakeWsClient.instances[0]?.triggerError(
    new Error("pullConnectConfig failed: code=10003, msg=invalid app credential"),
  );
  await assert.rejects(starting, (error: unknown) => {
    assert.ok(error instanceof FeishuTransportError);
    assert.equal(error.code, "FEISHU_AUTH_FAILED");
    assert.equal(error.retryable, false);
    assert.equal(error.outcome, "confirmed_not_sent");
    return true;
  });
  await transport.stop();
});

test("readiness timeout closes the socket and rejects as retryable not-connected", async () => {
  reset();
  FakeWsClient.autoReady = false;
  const transport = createOfficialFeishuTransportFactory(fakeSdk as never, { readinessTimeoutMs: 50 })
    .create({ appId: APP_ID, appSecret: "sdk-secret" }, lifecycle());
  await assert.rejects(transport.start(async () => undefined), (error: unknown) => {
    assert.ok(error instanceof FeishuTransportError);
    assert.equal(error.code, "FEISHU_NOT_CONNECTED");
    assert.equal(error.retryable, true);
    return true;
  });
  assert.equal(FakeWsClient.instances[0]?.closed, true);
  assert.notEqual(transport.state(), "connected");
  await transport.stop();
});

test("stop immediately aborts pending readiness", async () => {
  reset();
  FakeWsClient.autoReady = false;
  const transport = createOfficialFeishuTransportFactory(fakeSdk as never, { readinessTimeoutMs: 10_000 })
    .create({ appId: APP_ID, appSecret: "sdk-secret" }, lifecycle());
  const starting = transport.start(async () => undefined);
  await Promise.resolve();
  await transport.stop();
  await assert.rejects(starting, FeishuTransportError);
  assert.equal(transport.state(), "idle");
});

test("SDK failures map to stable redacted auth, permission, network and ambiguity outcomes", () => {
  const auth = classifyFeishuFailure({ response: { status: 401 } });
  assert.equal(auth.code, "FEISHU_AUTH_FAILED");
  assert.equal(auth.retryable, false);
  assert.equal(auth.outcome, "confirmed_not_sent");
  assert.equal(classifyFeishuFailure({ response: { status: 403 } }).code, "FEISHU_PERMISSION_DENIED");
  const offline = classifyFeishuFailure({ code: "ENOTFOUND" });
  assert.equal(offline.code, "NETWORK_OFFLINE");
  assert.equal(offline.retryable, true);
  assert.equal(offline.outcome, "confirmed_not_sent");
  const timeout = classifyFeishuFailure({ code: "ETIMEDOUT" });
  assert.equal(timeout.code, "FEISHU_NOT_CONNECTED");
  assert.equal(timeout.retryable, true);
  assert.equal(timeout.outcome, "unknown");

  const rateLimited = classifyFeishuFailure({ response: { status: 429 } });
  assert.equal(rateLimited.outcome, "confirmed_not_sent");
  const gatewayFailure = classifyFeishuFailure({ response: { status: 503 } });
  assert.equal(gatewayFailure.code, "FEISHU_NOT_CONNECTED");
  assert.equal(gatewayFailure.retryable, true);
  assert.equal(gatewayFailure.outcome, "unknown");
});
