import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { InsightReplyV1 } from "@paopao/contracts";
import { AnalyzeJobExecutor, createCaptureService, createInsightJobExecutor, type DomainEventPublisher } from "../../../core/src/index.js";
import { InsightProcessingService } from "../../src/ai/insight-service.js";
import { ProcessingService } from "../../src/ai/processing-service.js";
import { loadDefaultPromptRegistry } from "../../src/ai/prompt-registry.js";
import { FakeAiProvider, type FakeAiProviderStep } from "../../src/ai/testing/fake-ai-provider.js";
import type { AiProviderV1 } from "../../src/ai/types.js";
import { SqliteAnalysisUnitOfWork } from "../../src/database/analysis-unit-of-work.js";
import { SqliteCaptureUnitOfWork } from "../../src/database/capture-unit-of-work.js";
import { createEntryGovernanceService } from "../../src/database/entry-governance-service.js";
import { createEntryQueryService } from "../../src/database/entry-query.js";
import { createSqliteExternalDeliveryService } from "../../src/database/external-delivery-repository.js";
import { SqliteInsightUnitOfWork, SqliteRetrievalService } from "../../src/database/insight-unit-of-work.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../src/database/test-database.js";
import { SqliteJobRepository } from "../../src/scheduler/sqlite-job-repository.js";

const migrationsDirectory = fileURLToPath(new URL("../../src/database/migrations", import.meta.url));
const now = "2026-08-07T00:00:00.000Z";
const clock = { now: () => now };

function analysis(text: string) {
  return {
    schemaVersion: "memory-analysis.v1" as const,
    classification: { inputType: "thought" as const, confidence: 0.9, evidence: text },
    summary: { text, confidence: 0.9, evidence: [text] },
    entities: { items: [] }, goals: { items: [] }, nextActions: { items: [] }, needsUserReview: false,
  };
}

async function captureAndAnalyze(temporary: TemporaryDatabase, repository: SqliteJobRepository, text: string, mode: "remember" | "think", external = false) {
  const capture = createCaptureService({
    unitOfWork: new SqliteCaptureUnitOfWork({ database: temporary.database, clock, ids: { next: randomUUID } }),
    clock, events: { publish() {} },
  });
  const requestId = randomUUID();
  const messageKey = `feishu:${requestId}`;
  const receipt = await capture.capture(external
    ? {
        version: 1, requestId, source: "feishu", modality: "text", rawText: text, mode, receivedAt: now, sourceKey: messageKey,
        externalRef: { provider: "feishu", appId: "app", tenantKey: "tenant", openId: "open", chatId: "chat", chatType: "p2p", messageId: requestId, eventId: requestId, messageKey, eventKey: `event:${requestId}` },
      }
    : { version: 1, requestId, source: "desktop", modality: "text", rawText: text, mode, receivedAt: now, sourceKey: `desktop:${requestId}` });
  const job = repository.claimNext("analysis-worker", 60_000, now);
  assert.ok(job?.type === "analyze_entry");
  assert.equal(repository.startAttempt(job.id, job.leaseOwner, job.fencingToken), true);
  const service = new ProcessingService({
    provider: new FakeAiProvider([{ outcome: "success", parsedJson: analysis(text) }]),
    prompts: loadDefaultPromptRegistry(),
    unitOfWork: new SqliteAnalysisUnitOfWork({ database: temporary.database, now: clock.now }),
  });
  assert.deepEqual(await new AnalyzeJobExecutor(service).execute(job, new AbortController().signal), { outcome: "succeeded" });
  assert.equal(repository.succeed(job.id, job.leaseOwner, job.fencingToken), true);
  return receipt;
}

function setup() {
  const temporary = createTemporaryDatabase({ migrationsDirectory, now: clock.now });
  return { temporary, repository: new SqliteJobRepository(temporary.database, clock) };
}

test("think analysis atomically enqueues insight and grounded insight commits with exact recalled citation", async () => {
  const context = setup();
  try {
    await captureAndAnalyze(context.temporary, context.repository, "Dune reading notes", "remember");
    await captureAndAnalyze(context.temporary, context.repository, "Dune character notes", "remember");
    const current = await captureAndAnalyze(context.temporary, context.repository, "More Dune reading notes", "think", true);
    const job = context.repository.claimNext("insight-worker", 60_000, now);
    assert.ok(job?.type === "generate_insight");
    assert.equal(context.repository.startAttempt(job.id, job.leaseOwner, job.fencingToken), true);
    const unitOfWork = new SqliteInsightUnitOfWork({ database: context.temporary.database, now: clock.now });
    const loaded = unitOfWork.load(job);
    assert.ok(loaded);
    assert.equal(loaded.retrievedMemories.length, 2);
    assert.equal(loaded.retrievedMemories.every((memory) => memory.entryId !== current.entryId), true);
    const reply: InsightReplyV1 = {
      schemaVersion: "insight-reply.v1", text: "Your earlier Dune notes may help.", grounding: "grounded",
      citations: loaded.retrievedMemories.map(({ memoryId, entryId, evidenceQuote }) => ({ memoryId, entryId, evidenceQuote })),
    };
    const provider = new FakeAiProvider([{ outcome: "success", parsedJson: reply }]);
    const processing = new InsightProcessingService({ provider, prompts: loadDefaultPromptRegistry(), load: unitOfWork.load });
    const events: unknown[] = [];
    const executor = createInsightJobExecutor({ processing, unitOfWork, clock, events: { publish(event) { events.push(event); } } });
    assert.deepEqual(await executor.execute(job, new AbortController().signal), { outcome: "succeeded" });
    const derivation = context.temporary.database.prepare("SELECT id, value_json FROM derivations WHERE entry_id=? AND kind='insight_reply' AND is_current=1").get(current.entryId) as { id: string; value_json: string };
    assert.equal(JSON.parse(derivation.value_json).grounding, "grounded");
    const deliveryRow = context.temporary.database.prepare(`
      SELECT message_key, result_status, result_derivation_id FROM external_messages WHERE entry_id = ?
    `).get(current.entryId) as { message_key: string; result_status: string; result_derivation_id: string | null };
    assert.equal(deliveryRow.result_status, "result_pending");
    assert.equal(deliveryRow.result_derivation_id, derivation.id);
    const resultClaim = await createSqliteExternalDeliveryService({ database: context.temporary.database, clock }).claimReply({
      provider: "feishu", messageKey: deliveryRow.message_key, phase: "result", owner: "result-sender", leaseMs: 10_000, now,
    });
    assert.equal(resultClaim.decision, "send");
    if (resultClaim.decision !== "send") throw new Error("expected result delivery");
    assert.equal(resultClaim.delivery.derivationId, derivation.id);
    assert.deepEqual(resultClaim.delivery.payload, { kind: "insight", reply });
    const sources = context.temporary.database.prepare(`
      SELECT artifact_type, artifact_id, entry_id, quote FROM artifact_sources
      WHERE artifact_type='derivation' AND artifact_id=? ORDER BY entry_id, quote
    `).all(derivation.id) as Array<{ artifact_type: string; artifact_id: string; entry_id: string; quote: string }>;
    assert.deepEqual(sources, reply.citations.map((citation) => ({
      artifact_type: "derivation", artifact_id: derivation.id, entry_id: citation.entryId, quote: citation.evidenceQuote,
    })).sort((left, right) => left.entry_id.localeCompare(right.entry_id) || left.quote.localeCompare(right.quote)));
    assert.deepEqual(unitOfWork.commit(job, reply, {
      provider: "fake", model: "fake-model", promptVersion: "insight-reply/v1.0.0", schemaVersion: "insight-reply.v1", latencyMs: 1,
    }), { state: "already_committed" });
    assert.equal((context.temporary.database.prepare(`
      SELECT count(*) AS count FROM artifact_sources WHERE artifact_type='derivation' AND artifact_id=?
    `).get(derivation.id) as { count: number }).count, reply.citations.length);
    assert.equal(context.repository.succeed(job.id, job.leaseOwner, job.fencingToken), true);
    const detail = createEntryQueryService(context.temporary.database).get(current.entryId);
    assert.equal(detail.derivations.some((item) => item.id === derivation.id && item.kind === "insight_reply"), true);
    assert.deepEqual(detail.sources.filter((source) => source.artifactId === derivation.id), reply.citations.map((citation) => ({
      artifactType: "derivation" as const, artifactId: derivation.id, entryId: citation.entryId, quote: citation.evidenceQuote,
    })).sort((left, right) => left.entryId.localeCompare(right.entryId) || left.quote.localeCompare(right.quote)));
    assert.deepEqual(events, [{ version: 1, type: "insight:ready", entryId: current.entryId, derivationId: derivation.id, occurredAt: now }]);
    assert.equal((context.temporary.database.prepare("SELECT status FROM entries WHERE id=?").get(current.entryId) as { status: string }).status, "ready");
  } finally { context.temporary.close(); }
});

test("manual analyze retry reopens only the empty AI result and allows analysis plus insight to create a claimable snapshot", async () => {
  const context = setup();
  try {
    const capture = createCaptureService({
      unitOfWork: new SqliteCaptureUnitOfWork({ database: context.temporary.database, clock, ids: { next: randomUUID } }),
      clock,
      events: { publish() {} },
    });
    const requestId = randomUUID();
    const messageKey = `feishu:${requestId}`;
    const receipt = await capture.capture({
      version: 1, requestId, source: "feishu", modality: "text", rawText: "Retry analysis memory", mode: "think", receivedAt: now, sourceKey: messageKey,
      externalRef: { provider: "feishu", appId: "app", tenantKey: "tenant", openId: "open", chatId: "chat", chatType: "p2p", messageId: requestId, eventId: requestId, messageKey, eventKey: `event:${requestId}` },
    });
    const failed = context.repository.claimNext("analysis-failed", 60_000, now);
    assert.ok(failed?.type === "analyze_entry");
    assert.equal(context.repository.startAttempt(failed.id, failed.leaseOwner, failed.fencingToken), true);
    const failure = { code: "AI_INVALID_OUTPUT" as const, retryable: false, message: "invalid", correlationId: randomUUID() };
    assert.equal(context.repository.failFinal(failed.id, failed.leaseOwner, failed.fencingToken, failure), true);
    assert.equal((context.temporary.database.prepare("SELECT result_status FROM external_messages WHERE entry_id=?").get(receipt.entryId) as { result_status: string }).result_status, "result_failed_final");

    const governance = createEntryGovernanceService({ database: context.temporary.database, clock });
    assert.deepEqual(await governance.retryJob({ version: 1, jobId: failed.id }), { jobId: failed.id, status: "queued" });
    const reopened = context.temporary.database.prepare(`
      SELECT result_status,result_derivation_id,result_last_error_code FROM external_messages WHERE entry_id=?
    `).get(receipt.entryId);
    assert.deepEqual(reopened, { result_status: "result_waiting", result_derivation_id: null, result_last_error_code: null });

    const analysisJob = context.repository.claimNext("analysis-retry", 60_000, now);
    assert.ok(analysisJob?.type === "analyze_entry");
    assert.equal(context.repository.startAttempt(analysisJob.id, analysisJob.leaseOwner, analysisJob.fencingToken), true);
    const processing = new ProcessingService({
      provider: new FakeAiProvider([{ outcome: "success", parsedJson: analysis("Retry analysis memory") }]),
      prompts: loadDefaultPromptRegistry(),
      unitOfWork: new SqliteAnalysisUnitOfWork({ database: context.temporary.database, now: clock.now }),
    });
    assert.equal((await new AnalyzeJobExecutor(processing).execute(analysisJob, new AbortController().signal)).outcome, "succeeded");
    assert.equal(context.repository.succeed(analysisJob.id, analysisJob.leaseOwner, analysisJob.fencingToken), true);

    const insightJob = context.repository.claimNext("insight-after-analysis-retry", 60_000, now);
    assert.ok(insightJob?.type === "generate_insight");
    assert.equal(context.repository.startAttempt(insightJob.id, insightJob.leaseOwner, insightJob.fencingToken), true);
    const unitOfWork = new SqliteInsightUnitOfWork({ database: context.temporary.database, now: clock.now });
    const reply: InsightReplyV1 = { schemaVersion: "insight-reply.v1", text: "No related memory yet.", grounding: "no_relevant_memory", citations: [] };
    const insightProcessing = new InsightProcessingService({ provider: new FakeAiProvider([{ outcome: "success", parsedJson: reply }]), prompts: loadDefaultPromptRegistry(), load: unitOfWork.load });
    assert.equal((await createInsightJobExecutor({ processing: insightProcessing, unitOfWork, clock, events: { publish() {} } }).execute(insightJob, new AbortController().signal)).outcome, "succeeded");
    assert.equal(context.repository.succeed(insightJob.id, insightJob.leaseOwner, insightJob.fencingToken), true);
    const delivery = createSqliteExternalDeliveryService({ database: context.temporary.database, clock });
    const claim = await delivery.claimReply({ provider: "feishu", messageKey, phase: "result", owner: "result-after-analysis-retry", leaseMs: 10_000, now });
    assert.equal(claim.decision, "send");
    if (claim.decision !== "send") throw new Error("expected result claim after analysis retry");
    assert.deepEqual(claim.delivery.payload, { kind: "insight", reply });
  } finally { context.temporary.close(); }
});

test("manual insight retry reopens its empty result and commit fixes the exact payload used by claimReply", async () => {
  const context = setup();
  try {
    const receipt = await captureAndAnalyze(context.temporary, context.repository, "Retry insight memory", "think", true);
    const failed = context.repository.claimNext("insight-failed", 60_000, now);
    assert.ok(failed?.type === "generate_insight");
    assert.equal(context.repository.startAttempt(failed.id, failed.leaseOwner, failed.fencingToken), true);
    const failure = { code: "AI_INVALID_OUTPUT" as const, retryable: false, message: "invalid", correlationId: randomUUID() };
    assert.equal(context.repository.failFinal(failed.id, failed.leaseOwner, failed.fencingToken, failure), true);
    const failedLedger = context.temporary.database.prepare(`
      SELECT message_key,result_status,result_derivation_id FROM external_messages WHERE entry_id=?
    `).get(receipt.entryId) as { message_key: string; result_status: string; result_derivation_id: string | null };
    assert.deepEqual({ status: failedLedger.result_status, derivationId: failedLedger.result_derivation_id }, { status: "result_failed_final", derivationId: null });

    const governance = createEntryGovernanceService({ database: context.temporary.database, clock });
    assert.deepEqual(await governance.retryJob({ version: 1, jobId: failed.id }), { jobId: failed.id, status: "queued" });
    assert.equal((context.temporary.database.prepare("SELECT result_status FROM external_messages WHERE entry_id=?").get(receipt.entryId) as { result_status: string }).result_status, "result_waiting");
    const retried = context.repository.claimNext("insight-retry", 60_000, now);
    assert.ok(retried?.type === "generate_insight");
    assert.equal(context.repository.startAttempt(retried.id, retried.leaseOwner, retried.fencingToken), true);
    const unitOfWork = new SqliteInsightUnitOfWork({ database: context.temporary.database, now: clock.now });
    const reply: InsightReplyV1 = { schemaVersion: "insight-reply.v1", text: "No related memory yet.", grounding: "no_relevant_memory", citations: [] };
    const processing = new InsightProcessingService({ provider: new FakeAiProvider([{ outcome: "success", parsedJson: reply }]), prompts: loadDefaultPromptRegistry(), load: unitOfWork.load });
    assert.equal((await createInsightJobExecutor({ processing, unitOfWork, clock, events: { publish() {} } }).execute(retried, new AbortController().signal)).outcome, "succeeded");
    assert.equal(context.repository.succeed(retried.id, retried.leaseOwner, retried.fencingToken), true);
    const delivery = createSqliteExternalDeliveryService({ database: context.temporary.database, clock });
    const claim = await delivery.claimReply({ provider: "feishu", messageKey: failedLedger.message_key, phase: "result", owner: "result-after-insight-retry", leaseMs: 10_000, now });
    assert.equal(claim.decision, "send");
    if (claim.decision !== "send") throw new Error("expected result claim after insight retry");
    assert.deepEqual(claim.delivery.payload, { kind: "insight", reply });
  } finally { context.temporary.close(); }
});

test("FTS recall returns at most eight and excludes current, deleting, and non-ready entries", async () => {
  const context = setup();
  try {
    const receipts = [];
    for (let index = 0; index < 11; index += 1) {
      receipts.push(await captureAndAnalyze(context.temporary, context.repository, `Shared Dune memory number ${index}`, "remember"));
    }
    context.temporary.database.prepare("UPDATE entries SET status='deleting' WHERE id=?").run(receipts[1].entryId);
    context.temporary.database.prepare("UPDATE entries SET status='needs_review' WHERE id=?").run(receipts[2].entryId);
    const recalled = new SqliteRetrievalService(context.temporary.database).recall(receipts[0].entryId, "Shared Dune memory");
    assert.equal(recalled.length, 8);
    assert.equal(recalled.some((item) => item.entryId === receipts[0].entryId), false);
    assert.equal(recalled.some((item) => item.entryId === receipts[1].entryId), false);
    assert.equal(recalled.some((item) => item.entryId === receipts[2].entryId), false);
  } finally { context.temporary.close(); }
});

test("no_relevant_memory is valid and an invalid citation fails without changing ready entry", async () => {
  for (const scenario of ["empty", "invalid"] as const) {
    const context = setup();
    try {
      const current = await captureAndAnalyze(context.temporary, context.repository, "Unique solitary reflection", "think", scenario === "invalid");
      const job = context.repository.claimNext("insight-worker", 60_000, now);
      assert.ok(job?.type === "generate_insight");
      assert.equal(context.repository.startAttempt(job.id, job.leaseOwner, job.fencingToken), true);
      const unitOfWork = new SqliteInsightUnitOfWork({ database: context.temporary.database, now: clock.now });
      const reply = scenario === "empty"
        ? { schemaVersion: "insight-reply.v1", text: "No related memory yet.", grounding: "no_relevant_memory", citations: [] }
        : { schemaVersion: "insight-reply.v1", text: "Fabricated link.", grounding: "grounded", citations: [{ memoryId: randomUUID(), entryId: randomUUID(), evidenceQuote: "invented" }] };
      const provider = new FakeAiProvider(scenario === "empty" ? [{ outcome: "success", parsedJson: reply }] : [{ outcome: "success", parsedJson: reply }, { outcome: "success", parsedJson: reply }]);
      const processing = new InsightProcessingService({ provider, prompts: loadDefaultPromptRegistry(), load: unitOfWork.load });
      const executor = createInsightJobExecutor({ processing, unitOfWork, clock, events: { publish() {} } });
      const result = await executor.execute(job, new AbortController().signal);
      assert.equal(result.outcome, scenario === "empty" ? "succeeded" : "failed_final");
      if (result.outcome === "failed_final") assert.equal(context.repository.failFinal(job.id, job.leaseOwner, job.fencingToken, result.error), true);
      const insight = context.temporary.database.prepare("SELECT id FROM derivations WHERE entry_id=? AND kind='insight_reply'").get(current.entryId) as { id: string } | undefined;
      if (scenario === "empty") {
        assert.ok(insight);
        assert.equal((context.temporary.database.prepare(`
          SELECT count(*) AS count FROM artifact_sources WHERE artifact_type='derivation' AND artifact_id=?
        `).get(insight.id) as { count: number }).count, 0);
      } else {
        assert.equal(insight, undefined);
        const delivery = context.temporary.database.prepare(`
          SELECT result_status, result_derivation_id, result_last_error_code FROM external_messages WHERE entry_id = ?
        `).get(current.entryId) as { result_status: string; result_derivation_id: string | null; result_last_error_code: string };
        assert.deepEqual(delivery, { result_status: "result_failed_final", result_derivation_id: null, result_last_error_code: "AI_INVALID_OUTPUT" });
      }
      assert.equal((context.temporary.database.prepare("SELECT status FROM entries WHERE id=?").get(current.entryId) as { status: string }).status, "ready");
    } finally { context.temporary.close(); }
  }
});

test("insight revision race discards late output and cannot replace ready analysis", async () => {
  const context = setup();
  try {
    const current = await captureAndAnalyze(context.temporary, context.repository, "Revision race topic", "think");
    const job = context.repository.claimNext("insight-worker", 60_000, now);
    assert.ok(job?.type === "generate_insight");
    assert.equal(context.repository.startAttempt(job.id, job.leaseOwner, job.fencingToken), true);
    const unitOfWork = new SqliteInsightUnitOfWork({ database: context.temporary.database, now: clock.now });
    const base = new FakeAiProvider([{ outcome: "success", parsedJson: { schemaVersion: "insight-reply.v1", text: "No match.", grounding: "no_relevant_memory", citations: [] } }]);
    const provider: AiProviderV1 = { generateStructured: async (input) => {
      const result = await base.generateStructured(input);
      context.temporary.database.prepare("INSERT INTO entry_text_revisions(entry_id,revision,text,checksum,created_by,operation_key,created_at) VALUES (?,2,'revised','checksum','user',?,?)")
        .run(current.entryId, `revision:${randomUUID()}`, now);
      context.temporary.database.prepare("UPDATE entries SET current_text_revision=2 WHERE id=?").run(current.entryId);
      return result;
    } };
    const processing = new InsightProcessingService({ provider, prompts: loadDefaultPromptRegistry(), load: unitOfWork.load });
    const executor = createInsightJobExecutor({ processing, unitOfWork, clock, events: { publish() { throw new Error("must not publish"); } } });
    assert.deepEqual(await executor.execute(job, new AbortController().signal), { outcome: "succeeded" });
    assert.equal((context.temporary.database.prepare("SELECT count(*) count FROM derivations WHERE kind='insight_reply'").get() as { count: number }).count, 0);
  } finally { context.temporary.close(); }
});
