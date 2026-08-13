import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createFeishuAdapter,
  createOfficialFeishuTransportFactory,
  FeishuTransportError,
  feishuEventKey,
  feishuMessageKey,
  type FeishuTransport,
  type FeishuTransportFactory,
  type FeishuTransportLifecycle,
  type RawFeishuMessageEvent,
} from "../../adapters/feishu/src/index.js";
import { createCaptureService, type CaptureService } from "../../packages/core/src/index.js";
import {
  SqliteCaptureUnitOfWork,
  createSqliteBindingService,
  createSqliteExternalDeliveryService,
  openDatabase,
  type SqliteDatabase,
} from "../../packages/infrastructure/src/index.js";

const migrationsDirectory = join(process.cwd(), "packages", "infrastructure", "src", "database", "migrations");
const initialNow = "2026-08-08T00:00:00.000Z";
const syntheticAppId = "cli_0123456789abcdef";

function createDatabase(now: () => string): { database: SqliteDatabase; databasePath: string; directory: string } {
  const directory = mkdtempSync(join(tmpdir(), "paopao-wave3-g3-"));
  const databasePath = join(directory, "db", "paopao.sqlite");
  return {
    database: openDatabase({ databasePath, migrationsDirectory, now }),
    databasePath,
    directory,
  };
}

function rawTextEvent(eventId: string, messageId: string, text = "synthetic durable capture"): RawFeishuMessageEvent {
  return {
    event_id: eventId,
    app_id: syntheticAppId,
    tenant_key: "tenant-synthetic",
    sender: {
      sender_type: "user",
      sender_id: { open_id: "open-synthetic" },
    },
    message: {
      message_id: messageId,
      create_time: "1786147200000",
      chat_id: "chat-synthetic",
      chat_type: "p2p",
      message_type: "text",
      content: JSON.stringify({ text }),
    },
  };
}

function externalCapture(eventId: string, messageId: string) {
  const messageKey = feishuMessageKey(syntheticAppId, "tenant-synthetic", messageId);
  const eventKey = feishuEventKey(syntheticAppId, eventId);
  return {
    version: 1 as const,
    requestId: "10000000-0000-4000-8000-000000000001",
    source: "feishu" as const,
    modality: "text" as const,
    rawText: "synthetic restart capture",
    mode: "remember" as const,
    receivedAt: initialNow,
    sourceKey: messageKey,
    externalRef: {
      provider: "feishu" as const,
      appId: syntheticAppId,
      tenantKey: "tenant-synthetic",
      openId: "open-synthetic",
      chatId: "chat-synthetic",
      chatType: "p2p" as const,
      messageId,
      eventId,
      messageKey,
      eventKey,
    },
  };
}

class FakeCache {}

class FakeDispatcher {
  static latest: FakeDispatcher | null = null;
  handles: Record<string, (event: RawFeishuMessageEvent) => unknown> = {};

  constructor(_options: unknown) {
    FakeDispatcher.latest = this;
  }

  register(handles: Record<string, (event: RawFeishuMessageEvent) => unknown>) {
    this.handles = handles;
    return this;
  }
}

class FakeWsClient {
  closed = false;

  constructor(readonly options: Record<string, unknown>) {}

  async start(_input: { eventDispatcher: FakeDispatcher }) {
    (this.options.onReady as () => void)();
  }

  close() {
    this.closed = true;
  }

  getConnectionStatus() {
    return { state: this.closed ? "idle" : "connected", reconnectAttempts: 0 };
  }
}

class FakeClient {
  static calls: unknown[] = [];
  readonly im = {
    message: {
      create: async (input: unknown) => {
        FakeClient.calls.push(input);
        return { code: 0, data: { message_id: `reply-${FakeClient.calls.length}` } };
      },
    },
  };

  constructor(_options: unknown) {}
}

const fakeOfficialSdk = {
  Client: FakeClient,
  DefaultCache: FakeCache,
  EventDispatcher: FakeDispatcher,
  LoggerLevel: { error: 1 },
  WSClient: FakeWsClient,
};

test("official SDK acknowledgement waits for Adapter and SQLite commit, then message replay stays idempotent", async () => {
  let now = initialNow;
  const clock = { now: () => now };
  const temporary = createDatabase(clock.now);
  let releaseCapture!: () => void;
  const captureGate = new Promise<void>((resolve) => { releaseCapture = resolve; });
  let captureStarted = false;

  try {
    const binding = createSqliteBindingService({ database: temporary.database, clock });
    const code = await binding.createCode();
    await binding.consumeCode({
      operationKey: "test:prebind",
      code: code.code,
      appId: syntheticAppId,
      tenantKey: "tenant-synthetic",
      openId: "open-synthetic",
    });
    const baseCapture = createCaptureService({
      unitOfWork: new SqliteCaptureUnitOfWork({ database: temporary.database, clock }),
      clock,
      events: { publish() {} },
    });
    const captureService: CaptureService = {
      async capture(command) {
        captureStarted = true;
        await captureGate;
        return baseCapture.capture(command);
      },
    };
    const delivery = createSqliteExternalDeliveryService({ database: temporary.database, clock });
    FakeClient.calls = [];
    FakeDispatcher.latest = null;
    const adapter = createFeishuAdapter({
      credentialProvider: {
        async getFeishuCredential() {
          return { appId: syntheticAppId, appSecret: "synthetic-secret-never-logged" };
        },
        clearDecryptedCache() {},
      },
      captureService,
      bindingService: binding,
      deliveryService: delivery,
      publicSettingsProvider: { async getFeishuReplyMode() { return "ack_only" as const; } },
      subscribeDomainEvents: () => () => undefined,
      logger: { log() {} },
      clock,
    }, {
      transportFactory: createOfficialFeishuTransportFactory(fakeOfficialSdk as never, { sendTimeoutMs: 100 }),
      scanIntervalMs: 5,
      reconnectJitterRatio: 0,
    });

    try {
      await adapter.connect();
      const sdkHandler = FakeDispatcher.latest?.handles["im.message.receive_v1"];
      assert.ok(sdkHandler, "official EventDispatcher handler must be registered");
      const providerAcknowledgement = sdkHandler(rawTextEvent("event-await-1", "message-await"));
      assert.ok(providerAcknowledgement && typeof (providerAcknowledgement as Promise<unknown>).then === "function",
        "the SDK handler must return the durable processing promise");
      await waitFor(() => captureStarted);

      let acknowledged = false;
      void (providerAcknowledgement as Promise<unknown>).then(() => { acknowledged = true; });
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(acknowledged, false, "the provider must not be acknowledged before Capture commits");

      releaseCapture();
      await providerAcknowledgement;
      await waitFor(() => FakeClient.calls.length === 1);

      const replayAcknowledgement = sdkHandler(rawTextEvent("event-await-2", "message-await"));
      assert.ok(replayAcknowledgement && typeof (replayAcknowledgement as Promise<unknown>).then === "function");
      await replayAcknowledgement;
      await new Promise((resolve) => setTimeout(resolve, 15));

      assert.equal((temporary.database.prepare("SELECT count(*) AS count FROM entries").get() as { count: number }).count, 1);
      assert.equal((temporary.database.prepare("SELECT count(*) AS count FROM processed_events").get() as { count: number }).count, 2);
      assert.equal(FakeClient.calls.length, 1, "replayed message must not receive a second acknowledgement");
    } finally {
      releaseCapture();
      await adapter.disconnect();
    }
  } finally {
    temporary.database.close();
    rmSync(temporary.directory, { recursive: true, force: true });
    void now;
  }
});

class QueueTransport implements FeishuTransport {
  sent = 0;
  currentState: ReturnType<FeishuTransport["state"]> = "idle";

  constructor(
    private readonly lifecycle: FeishuTransportLifecycle,
    private readonly failures: FeishuTransportError[],
  ) {}

  async start(_handler: (event: RawFeishuMessageEvent) => void): Promise<void> {
    this.currentState = "connected";
    this.lifecycle.onReady();
  }

  async stop(): Promise<void> {
    this.currentState = "idle";
  }

  state() {
    return this.currentState;
  }

  async sendText(): Promise<{ messageId: string }> {
    this.sent += 1;
    const failure = this.failures.shift();
    if (failure) throw failure;
    return { messageId: `synthetic-reply-${this.sent}` };
  }
}

class QueueTransportFactory implements FeishuTransportFactory {
  transports: QueueTransport[] = [];

  constructor(private readonly failures: FeishuTransportError[]) {}

  create(_credential: { appId: string; appSecret: string }, lifecycle: FeishuTransportLifecycle): FeishuTransport {
    const transport = new QueueTransport(lifecycle, this.failures);
    this.transports.push(transport);
    return transport;
  }
}

test("stale sending becomes ambiguous after database restart and manual retry budget survives another restart", async () => {
  let now = initialNow;
  const clock = { now: () => now };
  const temporary = createDatabase(clock.now);
  const command = externalCapture("event-restart", "message-restart");
  let database = temporary.database;

  try {
    const capture = createCaptureService({
      unitOfWork: new SqliteCaptureUnitOfWork({ database, clock }),
      clock,
      events: { publish() {} },
    });
    const receipt = await capture.capture(command);
    const beforeRestart = createSqliteExternalDeliveryService({ database, clock });
    const abandoned = await beforeRestart.claimReply({
      provider: "feishu",
      messageKey: command.sourceKey,
      phase: "ack",
      owner: "crashed-owner",
      leaseMs: 1_000,
      now,
    });
    assert.equal(abandoned.decision, "send");
    database.close();

    now = "2026-08-08T00:00:02.000Z";
    database = openDatabase({ databasePath: temporary.databasePath, migrationsDirectory, now: clock.now });
    const binding = createSqliteBindingService({ database, clock });
    const delivery = createSqliteExternalDeliveryService({ database, clock });
    const transportFactory = new QueueTransportFactory([
      new FeishuTransportError("NETWORK_OFFLINE", true, "confirmed_not_sent"),
    ]);
    const adapter = createFeishuAdapter({
      credentialProvider: {
        async getFeishuCredential() {
          return { appId: syntheticAppId, appSecret: "synthetic-secret-never-logged" };
        },
        clearDecryptedCache() {},
      },
      captureService: { async capture() { throw new Error("not used"); } },
      bindingService: binding,
      deliveryService: delivery,
      publicSettingsProvider: { async getFeishuReplyMode() { return "ack_only" as const; } },
      subscribeDomainEvents: () => () => undefined,
      logger: { log() {} },
      clock,
    }, {
      transportFactory,
      scanIntervalMs: 5,
      reconnectJitterRatio: 0,
    });

    await adapter.connect();
    await waitFor(async () => (await delivery.listIssues({ limit: 10 })).items.length === 1);
    assert.equal(transportFactory.transports[0]?.sent, 0, "ambiguous stale send must not be repeated automatically");

    await delivery.resolveIssue({
      version: 1,
      requestId: "20000000-0000-4000-8000-000000000001",
      messageKey: command.sourceKey,
      phase: "ack",
      action: "retry_once",
      confirmation: "RETRY_MAY_DUPLICATE",
    });
    await waitFor(async () => {
      const issue = (await delivery.listIssues({ limit: 10 })).items[0];
      return issue?.status === "failed_final" && issue.manualRetryAvailable === false;
    });
    assert.equal(transportFactory.transports[0]?.sent, 1, "manual retry grants exactly one send attempt");
    await adapter.disconnect();
    database.close();

    database = openDatabase({ databasePath: temporary.databasePath, migrationsDirectory, now: clock.now });
    const reopenedDelivery = createSqliteExternalDeliveryService({ database, clock });
    await assert.rejects(
      reopenedDelivery.resolveIssue({
        version: 1,
        requestId: "20000000-0000-4000-8000-000000000002",
        messageKey: command.sourceKey,
        phase: "ack",
        action: "retry_once",
        confirmation: "RETRY_MAY_DUPLICATE",
      }),
      (error: unknown) => (error as { code?: string }).code === "DELIVERY_FAILED_FINAL",
    );
    assert.deepEqual(await reopenedDelivery.resolveIssue({
      version: 1,
      requestId: "20000000-0000-4000-8000-000000000003",
      messageKey: command.sourceKey,
      phase: "ack",
      action: "assume_sent",
      confirmation: "ASSUME_SENT",
    }), { status: "sent_assumed" });
    assert.equal((await reopenedDelivery.listIssues({ limit: 10 })).items.length, 0);
    assert.equal((database.prepare("SELECT count(*) AS count FROM entries WHERE id = ?").get(receipt.entryId) as { count: number }).count, 1);
  } finally {
    try { database.close(); } catch { /* Already closed by a restart boundary. */ }
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for Wave 3 condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
