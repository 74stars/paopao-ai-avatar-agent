import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createCaptureService, type BindingCrypto } from "../../../core/src/index.js";
import { createSqliteBindingService } from "../../src/database/binding-repository.js";
import { SqliteCaptureUnitOfWork } from "../../src/database/capture-unit-of-work.js";
import { createEntryDeletionService, createPurgeEntryJobExecutor } from "../../src/database/deletion-service.js";
import { createSqliteExternalDeliveryService } from "../../src/database/external-delivery-repository.js";
import { createTemporaryDatabase } from "../../src/database/test-database.js";
import { SqliteJobRepository } from "../../src/scheduler/sqlite-job-repository.js";

const migrationsDirectory = fileURLToPath(new URL("../../src/database/migrations", import.meta.url));

function digest(code: string, salt: string): string {
  return createHash("sha256").update(`${salt}\0${code}`).digest("hex");
}

function deterministicCrypto(codes: string[]): BindingCrypto {
  let index = 0;
  return {
    generateCode: () => codes[index++]!,
    generateSalt: () => `salt-${index}`,
    hash: digest,
    verify: (code, salt, expected) => digest(code, salt) === expected,
  };
}

test("binding codes are one-time salted hashes with transactional consumption, actor rate limiting, rebind, and idempotent unbind", async () => {
  let now = "2026-08-08T00:00:00.000Z";
  const clock = { now: () => now };
  const temporary = createTemporaryDatabase({ migrationsDirectory, now: clock.now });
  try {
    const service = createSqliteBindingService({
      database: temporary.database,
      clock,
      crypto: deterministicCrypto(["123456", "654321", "111111"]),
    });
    const first = await service.createCode();
    assert.deepEqual(first, { code: "123456", expiresAt: "2026-08-08T00:10:00.000Z" });
    const stored = temporary.database.prepare("SELECT salt, code_hash FROM binding_codes").get() as { salt: string; code_hash: string };
    assert.notEqual(stored.code_hash, first.code);
    assert.equal(JSON.stringify(stored).includes(first.code), false);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await assert.rejects(
        service.consumeCode({ operationKey: `invalid-${attempt}`, code: "000000", appId: "app", tenantKey: "tenant", openId: "attacker" }),
        (error: unknown) => (error as { code?: string }).code === "BINDING_CODE_INVALID",
      );
      if (attempt === 0) {
        await assert.rejects(
          service.consumeCode({ operationKey: "invalid-0", code: "000000", appId: "app", tenantKey: "tenant", openId: "attacker" }),
          (error: unknown) => (error as { code?: string }).code === "BINDING_CODE_INVALID",
        );
        await assert.rejects(
          service.consumeCode({ operationKey: "invalid-0", code: "000001", appId: "app", tenantKey: "tenant", openId: "attacker" }),
          (error: unknown) => (error as { code?: string }).code === "BINDING_CODE_INVALID",
        );
        assert.equal((temporary.database.prepare("SELECT count(*) count FROM binding_attempts WHERE open_id='attacker'").get() as { count: number }).count, 1);
      }
    }
    await assert.rejects(
      service.consumeCode({ operationKey: "limited", code: first.code, appId: "app", tenantKey: "tenant", openId: "attacker" }),
      (error: unknown) => (error as { code?: string }).code === "BINDING_RATE_LIMITED",
    );
    await assert.rejects(
      service.consumeCode({ operationKey: "limited", code: first.code, appId: "app", tenantKey: "tenant", openId: "attacker" }),
      (error: unknown) => (error as { code?: string }).code === "BINDING_RATE_LIMITED",
    );
    assert.equal((temporary.database.prepare("SELECT count(*) count FROM binding_attempts WHERE open_id='attacker'").get() as { count: number }).count, 5);

    const identityA = { appId: "app", tenantKey: "tenant", openId: "open-a" };
    await Promise.all([
      service.consumeCode({ operationKey: "bind-a", code: first.code, ...identityA }),
      assert.rejects(
        service.consumeCode({ operationKey: "bind-racer", code: first.code, appId: "app", tenantKey: "tenant", openId: "open-racer" }),
        (error: unknown) => (error as { code?: string }).code === "BINDING_CODE_CONSUMED",
      ),
    ]);
    await assert.rejects(
      service.consumeCode({ operationKey: "bind-racer", code: first.code, appId: "app", tenantKey: "tenant", openId: "open-racer" }),
      (error: unknown) => (error as { code?: string }).code === "BINDING_CODE_CONSUMED",
    );
    assert.equal((temporary.database.prepare("SELECT count(*) count FROM binding_attempts WHERE open_id='open-racer'").get() as { count: number }).count, 1);
    assert.deepEqual(await service.consumeCode({ operationKey: "bind-a", code: first.code, ...identityA }), { bound: true });
    await assert.rejects(
      service.consumeCode({ operationKey: "bind-a", code: "999999", ...identityA }),
      (error: unknown) => (error as { code?: string }).code === "BINDING_CODE_INVALID",
    );
    assert.equal(await service.isBound(identityA), true);
    assert.equal(await service.hasActiveBinding(), true);

    const replacement = await service.createCode();
    const identityB = { appId: "app", tenantKey: "tenant-2", openId: "open-b" };
    await service.consumeCode({ operationKey: "bind-b", code: replacement.code, ...identityB });
    assert.equal(await service.isBound(identityA), false);
    assert.equal(await service.isBound(identityB), true);
    await service.unbind({ operationKey: "unbind-b", ...identityB });
    await service.unbind({ operationKey: "unbind-b", ...identityB });
    assert.equal(await service.hasActiveBinding(), false);

    const expiring = await service.createCode(1_000);
    now = "2026-08-08T00:00:02.000Z";
    await assert.rejects(
      service.consumeCode({ operationKey: "expired", code: expiring.code, appId: "app", tenantKey: "tenant", openId: "open-c" }),
      (error: unknown) => (error as { code?: string }).code === "BINDING_CODE_EXPIRED",
    );
    await assert.rejects(
      service.consumeCode({ operationKey: "expired", code: expiring.code, appId: "app", tenantKey: "tenant", openId: "open-c" }),
      (error: unknown) => (error as { code?: string }).code === "BINDING_CODE_EXPIRED",
    );
    assert.equal((temporary.database.prepare("SELECT count(*) count FROM binding_attempts WHERE open_id='open-c'").get() as { count: number }).count, 1);
    const outcomes = temporary.database.prepare(`
      SELECT operation_key, outcome, code_salt, code_hash FROM binding_operations
      WHERE operation_key IN ('invalid-0','limited','bind-racer','expired') ORDER BY operation_key
    `).all() as Array<{ operation_key: string; outcome: string; code_salt: string; code_hash: string }>;
    assert.deepEqual(outcomes.map(({ operation_key, outcome }) => ({ operation_key, outcome })), [
      { operation_key: "bind-racer", outcome: "BINDING_CODE_CONSUMED" },
      { operation_key: "expired", outcome: "BINDING_CODE_EXPIRED" },
      { operation_key: "invalid-0", outcome: "BINDING_CODE_INVALID" },
      { operation_key: "limited", outcome: "BINDING_RATE_LIMITED" },
    ]);
    assert.equal(outcomes.some((row) => row.code_hash === first.code || row.code_salt === first.code), false);
    now = "2026-08-08T00:20:00.000Z";
    await assert.rejects(
      service.consumeCode({ operationKey: "limited", code: first.code, appId: "app", tenantKey: "tenant", openId: "attacker" }),
      (error: unknown) => (error as { code?: string }).code === "BINDING_RATE_LIMITED",
    );
    assert.equal((temporary.database.prepare("SELECT count(*) count FROM binding_attempts WHERE open_id='attacker'").get() as { count: number }).count, 5);
  } finally {
    temporary.close();
  }
});

function feishuCommand(eventKey: string, messageKey: string, mode: "remember" | "think" = "remember") {
  const requestId = randomUUID();
  return {
    version: 1 as const,
    requestId,
    source: "feishu" as const,
    modality: "text" as const,
    rawText: "private capture body",
    mode,
    receivedAt: "2026-08-08T00:00:00.000Z",
    sourceKey: messageKey,
    externalRef: {
      provider: "feishu" as const,
      appId: "app",
      tenantKey: "tenant",
      openId: "open",
      chatId: "chat",
      chatType: "p2p" as const,
      messageId: "message-id",
      eventId: eventKey,
      messageKey,
      eventKey,
    },
  };
}

test("capture ledger deduplicates event and message keys while reply claims fence stale senders and persist recovery", async () => {
  let now = "2026-08-08T00:00:00.000Z";
  const clock = { now: () => now };
  const temporary = createTemporaryDatabase({ migrationsDirectory, now: clock.now });
  try {
    const capture = createCaptureService({
      unitOfWork: new SqliteCaptureUnitOfWork({ database: temporary.database, clock }),
      clock,
      events: { publish() {} },
    });
    const delivery = createSqliteExternalDeliveryService({ database: temporary.database, clock });
    const first = await capture.capture(feishuCommand("event-1", "message-1"));
    const replay = await capture.capture(feishuCommand("event-2", "message-1"));
    assert.equal(replay.entryId, first.entryId);
    assert.equal(replay.deduplicated, true);
    assert.equal((temporary.database.prepare("SELECT count(*) AS count FROM entries").get() as { count: number }).count, 1);
    assert.equal((temporary.database.prepare("SELECT count(*) AS count FROM processed_events").get() as { count: number }).count, 2);
    assert.equal((temporary.database.prepare("SELECT count(*) AS count FROM external_messages").get() as { count: number }).count, 1);

    assert.deepEqual(await delivery.listDue({ now, limit: 50 }), [{ messageKey: "message-1", entryId: first.entryId, phase: "ack", attempts: 0 }]);
    const claim = await delivery.claimReply({ provider: "feishu", messageKey: "message-1", phase: "ack", owner: "sender-a", leaseMs: 10_000, now });
    assert.equal(claim.decision, "send");
    if (claim.decision !== "send") throw new Error("expected send claim");
    assert.deepEqual(claim.delivery.payload, { kind: "capture_ack" });
    assert.equal((await delivery.claimReply({ provider: "feishu", messageKey: "message-1", phase: "ack", owner: "sender-b", leaseMs: 10_000, now })).decision, "skip");
    assert.equal(await delivery.failReply({
      provider: "feishu", messageKey: "message-1", phase: "ack", owner: claim.delivery.owner,
      fencingToken: claim.delivery.fencingToken, outcome: "confirmed_not_sent", now,
      error: { code: "NETWORK_OFFLINE", retryable: true, message: "offline", correlationId: randomUUID() },
    }), true);
    assert.deepEqual(await delivery.listDue({ now, limit: 50 }), []);
    now = "2026-08-08T00:00:05.000Z";
    assert.equal((await delivery.listDue({ now, limit: 50 })).length, 1);
    const retry = await delivery.claimReply({ provider: "feishu", messageKey: "message-1", phase: "ack", owner: "sender-b", leaseMs: 10_000, now });
    assert.equal(retry.decision, "send");
    if (retry.decision !== "send") throw new Error("expected retry claim");
    assert.equal(await delivery.completeReply({ provider: "feishu", messageKey: "message-1", phase: "ack", owner: claim.delivery.owner, fencingToken: claim.delivery.fencingToken, externalReplyId: "late" }), false);
    assert.equal(await delivery.failReply({
      provider: "feishu", messageKey: "message-1", phase: "ack", owner: retry.delivery.owner,
      fencingToken: retry.delivery.fencingToken, outcome: "unknown", now,
      error: { code: "AI_TIMEOUT", retryable: true, message: "unknown", correlationId: randomUUID() },
    }), true);
    const issues = await delivery.listIssues({ limit: 50 });
    assert.equal(issues.items.length, 1);
    assert.deepEqual(Object.keys(issues.items[0]!).sort(), ["attempts", "entryId", "errorCode", "manualRetryAvailable", "messageKey", "phase", "status", "updatedAt"].sort());
    assert.equal(JSON.stringify(issues).includes("private capture body"), false);
    assert.equal(JSON.stringify(issues).includes("open"), false);
    assert.equal(await delivery.countIssues(), 1);

    const requestId = randomUUID();
    assert.deepEqual(await delivery.resolveIssue({ version: 1, requestId, messageKey: "message-1", phase: "ack", action: "retry_once", confirmation: "RETRY_MAY_DUPLICATE" }), { status: "pending" });
    assert.deepEqual(await delivery.resolveIssue({ version: 1, requestId, messageKey: "message-1", phase: "ack", action: "retry_once", confirmation: "RETRY_MAY_DUPLICATE" }), { status: "pending" });
    const manual = await delivery.claimReply({ provider: "feishu", messageKey: "message-1", phase: "ack", owner: "manual", leaseMs: 10_000, now });
    assert.equal(manual.decision, "send");
    if (manual.decision !== "send") throw new Error("expected manual claim");
    assert.equal(await delivery.failReply({
      provider: "feishu", messageKey: "message-1", phase: "ack", owner: manual.delivery.owner,
      fencingToken: manual.delivery.fencingToken, outcome: "confirmed_not_sent", now,
      error: { code: "NETWORK_OFFLINE", retryable: true, message: "offline", correlationId: randomUUID() },
    }), true);
    await assert.rejects(
      delivery.resolveIssue({ version: 1, requestId: randomUUID(), messageKey: "message-1", phase: "ack", action: "retry_once", confirmation: "RETRY_MAY_DUPLICATE" }),
      (error: unknown) => (error as { code?: string }).code === "DELIVERY_FAILED_FINAL",
    );
    assert.deepEqual(await delivery.resolveIssue({ version: 1, requestId: randomUUID(), messageKey: "message-1", phase: "ack", action: "assume_sent", confirmation: "ASSUME_SENT" }), { status: "sent_assumed" });
    assert.equal(await delivery.countIssues(), 0);

    await capture.capture(feishuCommand("event-retries", "message-retries"));
    const delays = [5_000, 30_000, 120_000, 600_000] as const;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const current = await delivery.claimReply({ provider: "feishu", messageKey: "message-retries", phase: "ack", owner: `retry-${attempt}`, leaseMs: 10_000, now });
      assert.equal(current.decision, "send");
      if (current.decision !== "send") throw new Error("expected automatic retry claim");
      assert.equal(current.delivery.attempts, attempt);
      assert.equal(await delivery.failReply({
        provider: "feishu", messageKey: "message-retries", phase: "ack", owner: current.delivery.owner,
        fencingToken: current.delivery.fencingToken, outcome: "confirmed_not_sent", now,
        error: { code: "NETWORK_OFFLINE", retryable: true, message: "offline", correlationId: randomUUID() },
      }), true);
      const state = temporary.database.prepare("SELECT ack_status, ack_next_run_at FROM external_messages WHERE message_key = 'message-retries'").get() as { ack_status: string; ack_next_run_at: string | null };
      if (attempt < 5) {
        assert.equal(state.ack_status, "ack_retry_wait");
        const expected = new Date(Date.parse(now) + delays[attempt - 1]!).toISOString();
        assert.equal(state.ack_next_run_at, expected);
        now = expected;
      } else {
        assert.deepEqual(state, { ack_status: "ack_failed_final", ack_next_run_at: null });
      }
    }
  } finally {
    temporary.close();
  }
});

test("control claims are canonical per message and expired control/reply leases recover with fencing", async () => {
  let now = "2026-08-08T00:00:00.000Z";
  const clock = { now: () => now };
  const temporary = createTemporaryDatabase({ migrationsDirectory, now: clock.now });
  try {
    const delivery = createSqliteExternalDeliveryService({ database: temporary.database, clock });
    const recipient = { appId: "app", tenantKey: "tenant", openId: "open", chatId: "chat", chatType: "p2p" as const, messageId: "control-message" };
    const first = await delivery.claimControlEvent({ provider: "feishu", eventKey: "control-event-1", messageKey: "control-message", controlKind: "help", recipient, owner: "control-a", leaseMs: 1_000, now });
    assert.equal(first.decision, "process");
    assert.equal((await delivery.claimControlEvent({ provider: "feishu", eventKey: "control-event-2", messageKey: "control-message", controlKind: "help", recipient, owner: "control-b", leaseMs: 1_000, now })).decision, "skip");
    now = "2026-08-08T00:00:02.000Z";
    assert.deepEqual(await delivery.recoverStaleClaims({ now, providerSupportsIdempotentSend: false }), { controlsReleased: 1, repliesMarkedAmbiguous: 0 });
    assert.equal(await delivery.completeControlEvent({ provider: "feishu", eventKey: "control-event-1", messageKey: "control-message", owner: "control-a", fencingToken: first.fencingToken!, outcome: "ignored", replyCode: "help" }), false);
    const reclaimed = await delivery.claimControlEvent({ provider: "feishu", eventKey: "control-event-2", messageKey: "control-message", controlKind: "help", recipient, owner: "control-b", leaseMs: 1_000, now });
    assert.equal(reclaimed.decision, "process");
    assert.equal(await delivery.completeControlEvent({ provider: "feishu", eventKey: "control-event-2", messageKey: "control-message", owner: "control-b", fencingToken: reclaimed.fencingToken!, outcome: "ignored", replyCode: "help" }), true);
    const completedReplay = await delivery.claimControlEvent({ provider: "feishu", eventKey: "control-event-3", messageKey: "control-message", controlKind: "help", recipient, owner: "control-c", leaseMs: 1_000, now });
    assert.deepEqual(completedReplay, { decision: "skip", fencingToken: null });
    const completedEvents = temporary.database.prepare(`
      SELECT event_key, status, outcome, processed_at FROM processed_events
      WHERE message_key='control-message' ORDER BY event_key
    `).all() as Array<{ event_key: string; status: string; outcome: string; processed_at: string }>;
    assert.equal(completedEvents.length, 3);
    assert.equal(completedEvents.every((event) => event.status === "completed" && event.outcome === "ignored"), true);
    assert.equal(new Set(completedEvents.map((event) => event.processed_at)).size, 1);
    const due = await delivery.listDue({ now, limit: 50 });
    assert.deepEqual(due, [{ messageKey: "control-message", entryId: null, phase: "ack", attempts: 0 }]);
    const reply = await delivery.claimReply({ provider: "feishu", messageKey: "control-message", phase: "ack", owner: "reply-a", leaseMs: 1_000, now });
    assert.equal(reply.decision, "send");
    if (reply.decision !== "send") throw new Error("expected control reply");
    assert.deepEqual(reply.delivery.payload, { kind: "control", replyCode: "help" });
    now = "2026-08-08T00:00:04.000Z";
    assert.deepEqual(await delivery.recoverStaleClaims({ now, providerSupportsIdempotentSend: false }), { controlsReleased: 0, repliesMarkedAmbiguous: 1 });
    assert.equal(await delivery.completeReply({ provider: "feishu", messageKey: "control-message", phase: "ack", owner: "reply-a", fencingToken: reply.delivery.fencingToken, externalReplyId: "late" }), false);
    assert.equal((await delivery.listIssues({ limit: 50 })).items[0]?.status, "ambiguous");
    assert.equal((temporary.database.prepare("SELECT count(*) count FROM entries").get() as { count: number }).count, 0);
    assert.equal((temporary.database.prepare("SELECT count(*) count FROM processed_events WHERE status='completed'").get() as { count: number }).count, 3);

    const safeRecipient = { ...recipient, messageId: "safe-message" };
    const safeControl = await delivery.claimControlEvent({ provider: "feishu", eventKey: "safe-event", messageKey: "safe-message", controlKind: "help", recipient: safeRecipient, owner: "safe-control", leaseMs: 1_000, now });
    assert.equal(safeControl.decision, "process");
    assert.equal(await delivery.completeControlEvent({ provider: "feishu", eventKey: "safe-event", messageKey: "safe-message", owner: "safe-control", fencingToken: safeControl.fencingToken!, outcome: "ignored", replyCode: "help" }), true);
    const safeReply = await delivery.claimReply({ provider: "feishu", messageKey: "safe-message", phase: "ack", owner: "safe-reply", leaseMs: 1_000, now });
    assert.equal(safeReply.decision, "send");
    if (safeReply.decision !== "send") throw new Error("expected safe reply claim");
    now = new Date(Date.parse(now) + 2_000).toISOString();
    assert.deepEqual(await delivery.recoverStaleClaims({ now, providerSupportsIdempotentSend: true }), { controlsReleased: 0, repliesMarkedAmbiguous: 0 });
    assert.equal((await delivery.listDue({ now, limit: 50 })).some((item) => item.messageKey === "safe-message"), true);
    assert.equal(await delivery.completeReply({ provider: "feishu", messageKey: "safe-message", phase: "ack", owner: safeReply.delivery.owner, fencingToken: safeReply.delivery.fencingToken, externalReplyId: "late" }), false);
  } finally {
    temporary.close();
  }
});

test("deletion immediately purges external routing and fences an in-flight reply before the purge job runs", async () => {
  const now = "2026-08-08T00:00:00.000Z";
  const clock = { now: () => now };
  const temporary = createTemporaryDatabase({ migrationsDirectory, now: clock.now });
  try {
    const capture = createCaptureService({
      unitOfWork: new SqliteCaptureUnitOfWork({ database: temporary.database, clock }),
      clock,
      events: { publish() {} },
    });
    const receipt = await capture.capture(feishuCommand("delete-event", "delete-message"));
    const delivery = createSqliteExternalDeliveryService({ database: temporary.database, clock });
    const claimed = await delivery.claimReply({ provider: "feishu", messageKey: "delete-message", phase: "ack", owner: "delete-race", leaseMs: 10_000, now });
    assert.equal(claimed.decision, "send");
    if (claimed.decision !== "send") throw new Error("expected delete race claim");
    await createEntryDeletionService({ database: temporary.database, clock }).delete({
      version: 1, requestId: randomUUID(), entryId: receipt.entryId, expectedTextRevision: 1, confirmation: "DELETE",
    });
    assert.equal(await delivery.completeReply({ provider: "feishu", messageKey: "delete-message", phase: "ack", owner: claimed.delivery.owner, fencingToken: claimed.delivery.fencingToken, externalReplyId: "late" }), false);
    const row = temporary.database.prepare(`
      SELECT recipient_json, result_derivation_id, ack_status, result_status FROM external_messages WHERE message_key = 'delete-message'
    `).get() as { recipient_json: string | null; result_derivation_id: string | null; ack_status: string; result_status: string };
    assert.deepEqual(row, { recipient_json: null, result_derivation_id: null, ack_status: "ignored_purged", result_status: "ignored_purged" });
    assert.deepEqual(await delivery.listDue({ now, limit: 50 }), []);
    const jobsBeforeDeletingReplay = (temporary.database.prepare("SELECT count(*) count FROM jobs").get() as { count: number }).count;
    const deletingSameEvent = await capture.capture(feishuCommand("delete-event", "delete-message"));
    const deletingNewEvent = await capture.capture(feishuCommand("delete-event-2", "delete-message"));
    assert.equal(deletingSameEvent.entryId, receipt.entryId);
    assert.equal(deletingNewEvent.entryId, receipt.entryId);
    assert.equal(deletingSameEvent.jobId, receipt.jobId);
    assert.equal(deletingNewEvent.deduplicated, true);
    assert.equal((temporary.database.prepare("SELECT count(*) count FROM jobs").get() as { count: number }).count, jobsBeforeDeletingReplay);

    const repository = new SqliteJobRepository(temporary.database, clock);
    const purge = repository.claimNext("purge", 60_000, now);
    assert.ok(purge?.type === "purge_entry");
    assert.equal(repository.startAttempt(purge.id, purge.leaseOwner, purge.fencingToken), true);
    assert.equal((await createPurgeEntryJobExecutor({ database: temporary.database, clock }).execute(purge, new AbortController().signal)).outcome, "succeeded");
    assert.equal(repository.succeed(purge.id, purge.leaseOwner, purge.fencingToken), true);
    const jobsBeforePurgedReplay = (temporary.database.prepare("SELECT count(*) count FROM jobs").get() as { count: number }).count;
    const purgedNewEvent = await capture.capture(feishuCommand("delete-event-3", "delete-message"));
    assert.equal(purgedNewEvent.entryId, receipt.entryId);
    assert.equal(purgedNewEvent.jobId, receipt.jobId);
    assert.equal((temporary.database.prepare("SELECT count(*) count FROM jobs").get() as { count: number }).count, jobsBeforePurgedReplay);
    assert.equal((temporary.database.prepare("SELECT count(*) count FROM external_messages WHERE message_key='delete-message'").get() as { count: number }).count, 1);
    assert.equal((temporary.database.prepare("SELECT count(*) count FROM processed_events WHERE message_key='delete-message' AND status='completed'").get() as { count: number }).count, 3);
    assert.deepEqual(temporary.database.prepare("SELECT status,raw_text FROM entries WHERE id=?").get(receipt.entryId), { status: "purged", raw_text: null });
    assert.equal((temporary.database.prepare("SELECT count(*) count FROM entry_text_revisions WHERE entry_id=?").get(receipt.entryId) as { count: number }).count, 0);
    assert.deepEqual(await delivery.listDue({ now, limit: 50 }), []);
  } finally {
    temporary.close();
  }
});
