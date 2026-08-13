import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createCaptureService, PersistentWorker, type DomainEventPublisher, type JobExecutor } from "../../../core/src/index.js";
import { SqliteCaptureUnitOfWork } from "../../src/database/capture-unit-of-work.js";
import { openDatabase } from "../../src/database/database.js";
import { createTemporaryDatabase } from "../../src/database/test-database.js";
import { SqliteJobRepository } from "../../src/scheduler/sqlite-job-repository.js";

const migrationsDirectory = fileURLToPath(new URL("../../src/database/migrations", import.meta.url));
const ids = [
  "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004",
  "00000000-0000-4000-8000-000000000005", "00000000-0000-4000-8000-000000000006",
  "00000000-0000-4000-8000-000000000007", "00000000-0000-4000-8000-000000000008",
  "00000000-0000-4000-8000-000000000009", "00000000-0000-4000-8000-000000000010",
  "00000000-0000-4000-8000-000000000011", "00000000-0000-4000-8000-000000000012",
];
let idIndex = 0;
let now = "2026-08-06T00:00:00.000Z";
const clock = { now: () => now };
const temporary = createTemporaryDatabase({ migrationsDirectory, now: clock.now });
const competingDatabase = openDatabase({ databasePath: temporary.databasePath, migrationsDirectory, now: clock.now });
const events: unknown[] = [];
const publisher: DomainEventPublisher = { publish: (event) => { events.push(event); } };

try {
  assert.equal(temporary.database.pragma("foreign_keys", { simple: true }), 1);
  assert.equal(temporary.database.pragma("secure_delete", { simple: true }), 1);
  assert.equal(temporary.database.pragma("journal_mode", { simple: true }), "wal");
  assert.equal((temporary.database.prepare("SELECT count(*) AS count FROM schema_migrations").get() as { count: number }).count, 3);

  const unitOfWork = new SqliteCaptureUnitOfWork({ database: temporary.database, clock, ids: { next: () => ids[idIndex++] } });
  const service = createCaptureService({ unitOfWork, events: publisher, clock });
  const command = {
    version: 1 as const,
    requestId: "10000000-0000-4000-8000-000000000001",
    source: "desktop" as const,
    modality: "text" as const,
    rawText: "  原样保存\n",
    mode: "remember" as const,
    receivedAt: now,
    sourceKey: "desktop:10000000-0000-4000-8000-000000000001",
  };
  const first = await service.capture(command);
  const duplicate = await service.capture(command);
  assert.equal(first.deduplicated, false);
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.entryId, first.entryId);
  assert.equal(events.length, 1);
  const entry = temporary.database.prepare("SELECT raw_text FROM entries WHERE id = ?").get(first.entryId) as { raw_text: string };
  assert.equal(entry.raw_text, command.rawText);
  assert.equal((temporary.database.prepare("SELECT count(*) AS count FROM jobs").get() as { count: number }).count, 1);

  const second = await service.capture({ ...command, requestId: "10000000-0000-4000-8000-000000000002", sourceKey: "desktop:10000000-0000-4000-8000-000000000002" });
  assert.notEqual(second.entryId, first.entryId);
  assert.equal((temporary.database.prepare("SELECT count(*) AS count FROM entries").get() as { count: number }).count, 2);

  const failing = new SqliteCaptureUnitOfWork({
    database: temporary.database,
    clock,
    ids: { next: () => ids[idIndex++] },
    failAfter: (stage) => { if (stage === "revision") throw new Error("injected"); },
  });
  assert.throws(() => failing.capture({ ...command, requestId: "10000000-0000-4000-8000-000000000003", sourceKey: "desktop:10000000-0000-4000-8000-000000000003" }), /injected/);
  assert.equal((temporary.database.prepare("SELECT count(*) AS count FROM entries").get() as { count: number }).count, 2);

  const repositoryA = new SqliteJobRepository(temporary.database, clock);
  const repositoryB = new SqliteJobRepository(competingDatabase, clock);
  const claimed = repositoryA.claimNext("worker-a", 1_000, now);
  assert.ok(claimed);
  assert.equal(repositoryB.claimNext("worker-b", 1_000, now)?.id, second.jobId);
  assert.equal(repositoryB.claimNext("worker-b", 1_000, now), null);
  assert.equal(repositoryA.startAttempt(claimed.id, "worker-a", claimed.fencingToken), true);
  now = "2026-08-06T00:00:02.000Z";
  assert.equal(repositoryA.recoverExpired(now), 2);
  assert.equal(repositoryA.succeed(claimed.id, "worker-a", claimed.fencingToken), false);
  const reclaimed = repositoryB.claimNext("worker-b", 10_000, now);
  assert.equal(reclaimed?.id, claimed.id);
  assert.ok(reclaimed && reclaimed.fencingToken > claimed.fencingToken);

  assert.ok(reclaimed);
  const retryError = { code: "AI_RATE_LIMITED" as const, retryable: true, message: "Provider temporarily unavailable", correlationId: "20000000-0000-4000-8000-000000000001" };
  const executor: JobExecutor = {
    preflight: async () => ({ ready: true }),
    execute: async () => ({ outcome: "retry", error: retryError }),
  };
  repositoryB.retryLater(reclaimed.id, "worker-b", reclaimed.fencingToken, now, retryError);
  const worker = new PersistentWorker({ repository: repositoryA, executor, clock, events: publisher, options: { workerId: "worker-c", leaseMs: 10_000, jitter: (value) => value } });
  assert.equal(await worker.runOnce(), true);
  const retryRow = temporary.database.prepare("SELECT status, attempts, next_run_at FROM jobs WHERE id = ?").get(reclaimed.id) as { status: string; attempts: number; next_run_at: string };
  assert.equal(retryRow.status, "retry_wait");
  assert.equal(retryRow.attempts, 2);
  assert.equal(retryRow.next_run_at, "2026-08-06T00:05:02.000Z");

  await assert.rejects(service.capture({ ...command, sourceKey: "desktop:forged" }));
  const messageKey = "feishu:sha256-message-key";
  const feishu = {
    version: 1 as const,
    requestId: "10000000-0000-4000-8000-000000000010",
    source: "feishu" as const,
    modality: "text" as const,
    rawText: "飞书原文",
    mode: "think" as const,
    receivedAt: now,
    sourceKey: messageKey,
    externalRef: {
      provider: "feishu" as const,
      appId: "app",
      tenantKey: "tenant",
      openId: "open",
      chatId: "chat",
      chatType: "p2p" as const,
      messageId: "message",
      eventId: "event-1",
      messageKey,
      eventKey: "feishu:event-key-1",
    },
  };
  const feishuFirst = await service.capture(feishu);
  const feishuReplay = await service.capture({
    ...feishu,
    requestId: "10000000-0000-4000-8000-000000000011",
    externalRef: { ...feishu.externalRef, eventId: "event-2", eventKey: "feishu:event-key-2" },
  });
  assert.equal(feishuReplay.deduplicated, true);
  assert.equal(feishuReplay.entryId, feishuFirst.entryId);
  assert.equal((temporary.database.prepare("SELECT count(*) AS count FROM processed_events WHERE message_key = ?").get(messageKey) as { count: number }).count, 2);
  const external = temporary.database.prepare("SELECT ack_status, result_status FROM external_messages WHERE message_key = ?").get(messageKey) as { ack_status: string; result_status: string };
  assert.deepEqual(external, { ack_status: "ack_pending", result_status: "result_waiting" });
  await assert.rejects(service.capture({
    ...feishu,
    requestId: "10000000-0000-4000-8000-000000000013",
    sourceKey: "feishu:different-message-key",
    externalRef: { ...feishu.externalRef, messageKey: "feishu:different-message-key" },
  }), /event key is already bound/);

  const failingEventsService = createCaptureService({
    unitOfWork,
    clock,
    events: { publish: () => { throw new Error("event bus unavailable"); } },
  });
  const storedDespiteEventFailure = await failingEventsService.capture({
    ...command,
    requestId: "10000000-0000-4000-8000-000000000012",
    sourceKey: "desktop:10000000-0000-4000-8000-000000000012",
    receivedAt: now,
  });
  assert.equal(storedDespiteEventFailure.status, "stored");

  const throwingExecutor: JobExecutor = {
    preflight: async () => ({ ready: true }),
    execute: async () => { throw new Error("unexpected provider adapter failure"); },
  };
  const resilientWorker = new PersistentWorker({
    repository: repositoryA,
    executor: throwingExecutor,
    clock,
    events: { publish: () => { throw new Error("event bus unavailable"); } },
    options: {
      workerId: "worker-d",
      leaseMs: 10_000,
      unexpectedFailure: () => ({ code: "INTERNAL_ERROR", retryable: false, message: "Unexpected job execution failure", correlationId: "20000000-0000-4000-8000-000000000002" }),
    },
  });
  assert.equal(await resilientWorker.runOnce(), true);
  assert.equal((temporary.database.prepare("SELECT status FROM jobs WHERE id = ?").get(second.jobId) as { status: string }).status, "failed_final");

  const offline = { code: "NETWORK_OFFLINE" as const, retryable: true, message: "Network is offline", correlationId: "20000000-0000-4000-8000-000000000003" };
  const waitingWorker = new PersistentWorker({
    repository: repositoryA,
    executor: { preflight: async () => ({ ready: false, reason: "network", error: offline }), execute: async () => ({ outcome: "succeeded" }) },
    clock,
    events: publisher,
    options: { workerId: "worker-e", leaseMs: 10_000 },
  });
  assert.equal(await waitingWorker.runOnce(), true);
  const waitingJob = temporary.database.prepare("SELECT id, attempts FROM jobs WHERE status = 'waiting_for_network'").get() as { id: string; attempts: number };
  assert.equal(waitingJob.attempts, 0);
  assert.equal(waitingWorker.resumeWaiting("network"), 1);

  temporary.database.prepare("UPDATE jobs SET attempts = 4 WHERE id = ?").run(waitingJob.id);
  const maxAttemptWorker = new PersistentWorker({
    repository: repositoryA,
    executor,
    clock,
    events: publisher,
    options: { workerId: "worker-f", leaseMs: 10_000, jitter: (value) => value },
  });
  assert.equal(await maxAttemptWorker.runOnce(), true);
  const exhausted = temporary.database.prepare("SELECT status, attempts FROM jobs WHERE id = ?").get(waitingJob.id) as { status: string; attempts: number };
  assert.deepEqual(exhausted, { status: "failed_final", attempts: 5 });

  let releaseExecution!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const release = new Promise<void>((resolve) => { releaseExecution = resolve; });
  const drainingWorker = new PersistentWorker({
    repository: repositoryA,
    executor: {
      preflight: async () => ({ ready: true }),
      execute: async () => { markStarted(); await release; return { outcome: "succeeded" }; },
    },
    clock,
    events: publisher,
    options: { workerId: "worker-g", leaseMs: 10_000 },
  });
  const running = drainingWorker.runOnce();
  await started;
  let stopped = false;
  const stopping = drainingWorker.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  releaseExecution();
  await Promise.all([running, stopping]);
  assert.equal(stopped, true);

  console.log("capture/worker integration passed");
} finally {
  competingDatabase.close();
  temporary.close();
}
