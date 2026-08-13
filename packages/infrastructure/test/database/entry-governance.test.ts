import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { AnalyzeJobExecutor, createCaptureService } from "../../../core/src/index.js";
import { ProcessingService } from "../../src/ai/processing-service.js";
import { loadDefaultPromptRegistry } from "../../src/ai/prompt-registry.js";
import { FakeAiProvider } from "../../src/ai/testing/fake-ai-provider.js";
import { SqliteAnalysisUnitOfWork } from "../../src/database/analysis-unit-of-work.js";
import { SqliteCaptureUnitOfWork } from "../../src/database/capture-unit-of-work.js";
import { createEntryGovernanceService, GovernanceError } from "../../src/database/entry-governance-service.js";
import { createTemporaryDatabase } from "../../src/database/test-database.js";
import { SqliteJobRepository } from "../../src/scheduler/sqlite-job-repository.js";

const migrationsDirectory = fileURLToPath(new URL("../../src/database/migrations", import.meta.url));
const now = "2026-08-07T00:00:00.000Z";
const clock = { now: () => now };
const text = "Alice plans to read Dune tomorrow";

function validAnalysis() {
  return {
    schemaVersion: "memory-analysis.v1" as const,
    classification: { inputType: "goal" as const, confidence: 0.9, evidence: "plans to read Dune" },
    summary: { text: "Alice plans to read Dune.", confidence: 0.8, evidence: ["Alice plans to read Dune"] },
    entities: { items: [{ type: "person" as const, name: "Alice", confidence: 0.9, evidence: "Alice" }] },
    goals: { items: [{ title: "Read Dune", confidence: 0.8, evidence: "read Dune" }] },
    nextActions: { items: [{ title: "Start tomorrow", dueHint: "tomorrow", confidence: 0.7, evidence: "tomorrow" }] },
    needsUserReview: false,
  };
}

async function setup(mode: "remember" | "think" = "remember", external = false) {
  const temporary = createTemporaryDatabase({ migrationsDirectory, now: clock.now });
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
  const repository = new SqliteJobRepository(temporary.database, clock);
  const job = repository.claimNext("analysis", 60_000, now);
  assert.ok(job?.type === "analyze_entry");
  repository.startAttempt(job.id, job.leaseOwner, job.fencingToken);
  const processing = new ProcessingService({
    provider: new FakeAiProvider([{ outcome: "success", parsedJson: validAnalysis() }]), prompts: loadDefaultPromptRegistry(),
    unitOfWork: new SqliteAnalysisUnitOfWork({ database: temporary.database, now: clock.now }),
  });
  assert.equal((await new AnalyzeJobExecutor(processing).execute(job, new AbortController().signal)).outcome, "succeeded");
  repository.succeed(job.id, job.leaseOwner, job.fencingToken);
  const events: unknown[] = [];
  const service = createEntryGovernanceService({ database: temporary.database, clock, events: { publish(event) { events.push(event); } } });
  return { temporary, receipt, repository, analysisJobId: job.id, service, events };
}

test("text revision cancels active AI, creates one analyze job, refreshes FTS, and replays exactly", async () => {
  const context = await setup("think");
  try {
    const request = { version: 1 as const, requestId: randomUUID(), entryId: context.receipt.entryId, expectedTextRevision: 1, text: "Alice now plans to read Foundation" };
    const first = await context.service.reviseText(request);
    const replay = await context.service.reviseText(request);
    assert.deepEqual(replay, first);
    assert.equal(first.textRevision, 2);
    const jobs = context.temporary.database.prepare("SELECT id,type,status,payload_json FROM jobs WHERE entry_id=? ORDER BY created_at,id").all(context.receipt.entryId) as Array<{ id: string; type: string; status: string; payload_json: string }>;
    assert.equal(jobs.filter((job) => job.type === "analyze_entry").length, 2);
    assert.equal(jobs.some((job) => job.type === "generate_insight" && job.status === "cancelled"), true);
    const newJob = jobs.find((job) => JSON.parse(job.payload_json).textRevision === 2)!;
    assert.equal(newJob.status, "queued");
    assert.equal(first.affectedJobIds.includes(newJob.id), true);
    const search = context.temporary.database.prepare("SELECT current_text,summary FROM entry_search WHERE entry_id=?").get(context.receipt.entryId) as { current_text: string; summary: string };
    assert.deepEqual(search, { current_text: request.text, summary: "" });
    assert.equal((context.temporary.database.prepare("SELECT count(*) count FROM governance_operations").get() as { count: number }).count, 1);
    await assert.rejects(() => context.service.reviseText({ ...request, requestId: randomUUID() }), (error: unknown) => error instanceof GovernanceError && error.code === "REVISION_CONFLICT");
  } finally { context.temporary.close(); }
});

test("all editable derivations use optimistic concurrency and synchronize Memory and FTS without a provider", async () => {
  const context = await setup();
  try {
    const initial = context.temporary.database.prepare("SELECT kind,id FROM derivations WHERE entry_id=? AND is_current=1").all(context.receipt.entryId) as Array<{ kind: string; id: string }>;
    const ids = new Map(initial.map((row) => [row.kind, row.id]));
    const corrections = [
      { kind: "classification" as const, value: { inputType: "diary" as const, confidence: 0.7, evidence: "Alice" } },
      { kind: "summary" as const, value: { text: "Alice will read Dune tomorrow.", confidence: 0.95, evidence: ["Alice", "Dune tomorrow"] } },
      { kind: "entities" as const, value: { items: [{ type: "book" as const, name: "Dune", confidence: 1, evidence: "Dune" }] } },
      { kind: "goals" as const, value: { items: [{ title: "Finish Dune", confidence: 0.8, evidence: "read Dune" }] } },
      { kind: "next_actions" as const, value: { items: [{ title: "Read tomorrow", dueHint: "tomorrow", confidence: 0.9, evidence: "tomorrow" }] } },
    ];
    for (const correction of corrections) {
      const request = { version: 1 as const, requestId: randomUUID(), entryId: context.receipt.entryId, kind: correction.kind, expectedDerivationId: ids.get(correction.kind)!, value: correction.value } as any;
      const receipt = await context.service.correct(request);
      assert.deepEqual(await context.service.correct(request), receipt);
      ids.set(correction.kind, receipt.derivationId);
    }
    const memory = context.temporary.database.prepare("SELECT memory_type,summary FROM memories WHERE entry_id=?").get(context.receipt.entryId) as { memory_type: string; summary: string };
    assert.deepEqual(memory, { memory_type: "diary", summary: "Alice will read Dune tomorrow." });
    const search = context.temporary.database.prepare("SELECT summary,entities,goals,actions FROM entry_search WHERE entry_id=?").get(context.receipt.entryId) as Record<string, string>;
    assert.deepEqual(search, { summary: "Alice will read Dune tomorrow.", entities: "Dune", goals: "Finish Dune", actions: "Read tomorrow" });
    assert.equal((context.temporary.database.prepare("SELECT count(*) count FROM derivations WHERE created_by='user'").get() as { count: number }).count, 5);
    await assert.rejects(() => context.service.correct({ version: 1, requestId: randomUUID(), entryId: context.receipt.entryId, kind: "summary", expectedDerivationId: initial.find((row) => row.kind === "summary")!.id, value: corrections[1].value }),
      (error: unknown) => error instanceof GovernanceError && error.code === "REVISION_CONFLICT");
  } finally { context.temporary.close(); }
});

test("correction cancels a waiting Feishu insight and closes its non-retryable result issue", async () => {
  const context = await setup("think", true);
  try {
    const summary = context.temporary.database.prepare(`
      SELECT id FROM derivations WHERE entry_id=? AND kind='summary' AND is_current=1
    `).get(context.receipt.entryId) as { id: string };
    await context.service.correct({
      version: 1,
      requestId: randomUUID(),
      entryId: context.receipt.entryId,
      kind: "summary",
      expectedDerivationId: summary.id,
      value: { text: "Alice will read Dune tomorrow.", confidence: 0.95, evidence: ["Alice", "Dune tomorrow"] },
    });
    const insightJob = context.temporary.database.prepare(`
      SELECT status FROM jobs WHERE entry_id=? AND type='generate_insight'
    `).get(context.receipt.entryId) as { status: string };
    assert.equal(insightJob.status, "cancelled");
    const external = context.temporary.database.prepare(`
      SELECT result_status, result_derivation_id, result_lease_owner, result_last_error_code
      FROM external_messages WHERE entry_id=?
    `).get(context.receipt.entryId) as { result_status: string; result_derivation_id: string | null; result_lease_owner: string | null; result_last_error_code: string };
    assert.deepEqual(external, {
      result_status: "result_failed_final",
      result_derivation_id: null,
      result_lease_owner: null,
      result_last_error_code: "AI_INVALID_OUTPUT",
    });
  } finally { context.temporary.close(); }
});

test("manual retry resets a failed job once and repeated retry is idempotent", async () => {
  const context = await setup();
  try {
    context.temporary.database.prepare("UPDATE jobs SET status='failed_final',attempts=5,last_error_code='AI_INVALID_OUTPUT' WHERE id=?").run(context.analysisJobId);
    context.temporary.database.prepare("UPDATE entries SET status='needs_review',last_error_code='AI_INVALID_OUTPUT' WHERE id=?").run(context.receipt.entryId);
    const request = { version: 1 as const, jobId: context.analysisJobId };
    assert.deepEqual(await context.service.retryJob(request), { jobId: context.analysisJobId, status: "queued" });
    assert.deepEqual(await context.service.retryJob(request), { jobId: context.analysisJobId, status: "queued" });
    const job = context.temporary.database.prepare("SELECT status,attempts,last_error_code FROM jobs WHERE id=?").get(context.analysisJobId) as { status: string; attempts: number; last_error_code: string | null };
    assert.deepEqual(job, { status: "queued", attempts: 0, last_error_code: null });
    assert.equal((context.temporary.database.prepare("SELECT status FROM entries WHERE id=?").get(context.receipt.entryId) as { status: string }).status, "stored");
    context.temporary.database.prepare("UPDATE jobs SET status='succeeded' WHERE id=?").run(context.analysisJobId);
    await assert.rejects(() => context.service.retryJob(request), (error: unknown) => error instanceof GovernanceError && error.code === "JOB_NOT_RETRYABLE");
  } finally { context.temporary.close(); }
});
