import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { AnalyzeJobExecutor, createCaptureService } from "../../../core/src/index.js";
import { ProcessingService } from "../../src/ai/processing-service.js";
import { loadDefaultPromptRegistry } from "../../src/ai/prompt-registry.js";
import { FakeAiProvider, type FakeAiProviderStep } from "../../src/ai/testing/fake-ai-provider.js";
import type { AiProviderV1 } from "../../src/ai/types.js";
import { SqliteAnalysisUnitOfWork } from "../../src/database/analysis-unit-of-work.js";
import { SqliteCaptureUnitOfWork } from "../../src/database/capture-unit-of-work.js";
import { createSqliteExternalDeliveryService } from "../../src/database/external-delivery-repository.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../src/database/test-database.js";
import { SqliteJobRepository } from "../../src/scheduler/sqlite-job-repository.js";

const migrationsDirectory = fileURLToPath(new URL("../../src/database/migrations", import.meta.url));
const now = "2026-08-07T00:00:00.000Z";
const clock = { now: () => now };

function validAnalysis(text = "Alice plans to read Dune tomorrow") {
  return {
    schemaVersion: "memory-analysis.v1" as const,
    classification: { inputType: "goal" as const, confidence: 0.9, evidence: "plans to read Dune" },
    summary: { text: "Alice plans to read Dune.", confidence: 0.8, evidence: ["Alice plans to read Dune"] },
    entities: { items: [{ type: "person" as const, name: "Alice", confidence: 0.9, evidence: "Alice" }, { type: "book" as const, name: "Dune", confidence: 0.9, evidence: "Dune" }] },
    goals: { items: [{ title: "Read Dune", confidence: 0.8, evidence: "read Dune" }] },
    nextActions: { items: [{ title: "Start tomorrow", dueHint: "tomorrow", confidence: 0.7, evidence: "tomorrow" }] },
    needsUserReview: false,
  };
}

async function setup(steps: readonly FakeAiProviderStep[], mode: "remember" | "think" = "remember", external = false) {
  const temporary = createTemporaryDatabase({ migrationsDirectory, now: clock.now });
  const capture = createCaptureService({
    unitOfWork: new SqliteCaptureUnitOfWork({ database: temporary.database, clock, ids: { next: randomUUID } }),
    clock, events: { publish() {} },
  });
  const requestId = randomUUID();
  const messageKey = `feishu:${requestId}`;
  const receipt = await capture.capture(external
    ? {
        version: 1, requestId, source: "feishu", modality: "text", rawText: "Alice plans to read Dune tomorrow", mode, receivedAt: now, sourceKey: messageKey,
        externalRef: { provider: "feishu", appId: "app", tenantKey: "tenant", openId: "open", chatId: "chat", chatType: "p2p", messageId: requestId, eventId: requestId, messageKey, eventKey: `event:${requestId}` },
      }
    : { version: 1, requestId, source: "desktop", modality: "text", rawText: "Alice plans to read Dune tomorrow", mode, receivedAt: now, sourceKey: `desktop:${requestId}` });
  const repository = new SqliteJobRepository(temporary.database, clock);
  const job = repository.claimNext("analysis-worker", 60_000, now);
  assert.ok(job?.type === "analyze_entry");
  assert.equal(repository.startAttempt(job.id, job.leaseOwner, job.fencingToken), true);
  const provider = new FakeAiProvider(steps);
  const processing = new ProcessingService({ provider, prompts: loadDefaultPromptRegistry(), unitOfWork: new SqliteAnalysisUnitOfWork({ database: temporary.database, now: clock.now }) });
  return { temporary, receipt, repository, job, provider, executor: new AnalyzeJobExecutor(processing) };
}

function close(temporary: TemporaryDatabase): void { temporary.close(); }

test("analyze success writes one atomic current read model with evidence sources and FTS", async () => {
  const context = await setup([{ outcome: "success", parsedJson: validAnalysis() }]);
  try {
    assert.deepEqual(await context.executor.execute(context.job, new AbortController().signal), { outcome: "succeeded" });
    assert.equal(context.repository.succeed(context.job.id, context.job.leaseOwner, context.job.fencingToken), true);
    const count = (table: string) => (context.temporary.database.prepare(`SELECT count(*) count FROM ${table}`).get() as { count: number }).count;
    assert.equal(count("ai_runs"), 1);
    assert.equal(count("derivations"), 5);
    assert.equal(count("memories"), 1);
    assert.equal(count("artifact_sources"), 8);
    assert.equal(count("entry_search"), 1);
    assert.equal((context.temporary.database.prepare("SELECT status FROM entries WHERE id=?").get(context.receipt.entryId) as { status: string }).status, "ready");
  } finally { close(context.temporary); }
});

for (const [name, code] of [["timeout", "AI_TIMEOUT"], ["429", "AI_RATE_LIMITED"]] as const) {
  test(`analyze ${name} is audited and returned as retryable`, async () => {
    const context = await setup([{ outcome: "error", code, retryable: true }]);
    try {
      const result = await context.executor.execute(context.job, new AbortController().signal);
      assert.equal(result.outcome, "retry");
      if (result.outcome === "retry") assert.equal(result.error.code, code);
      assert.equal((context.temporary.database.prepare("SELECT error_code FROM ai_runs").get() as { error_code: string }).error_code, code);
    } finally { close(context.temporary); }
  });
}

test("invalid output receives exactly one repair and commits the repaired result", async () => {
  const context = await setup([{ outcome: "success", rawText: "not json" }, { outcome: "success", parsedJson: validAnalysis() }]);
  try {
    assert.equal((await context.executor.execute(context.job, new AbortController().signal)).outcome, "succeeded");
    assert.equal(context.provider.calls.length, 2);
    assert.equal((context.temporary.database.prepare("SELECT count(*) count FROM ai_runs").get() as { count: number }).count, 2);
  } finally { close(context.temporary); }
});

test("Feishu think analysis closes result delivery when review prevents an insight job", async () => {
  const review = validAnalysis();
  review.needsUserReview = true;
  const context = await setup([{ outcome: "success", parsedJson: review }], "think", true);
  try {
    assert.deepEqual(await context.executor.execute(context.job, new AbortController().signal), { outcome: "succeeded" });
    assert.equal(context.repository.succeed(context.job.id, context.job.leaseOwner, context.job.fencingToken), true);
    const delivery = context.temporary.database.prepare(`
      SELECT result_status, result_derivation_id, result_last_error_code FROM external_messages WHERE entry_id = ?
    `).get(context.receipt.entryId) as { result_status: string; result_derivation_id: string | null; result_last_error_code: string };
    assert.deepEqual(delivery, { result_status: "result_failed_final", result_derivation_id: null, result_last_error_code: "AI_INVALID_OUTPUT" });
    assert.equal((context.temporary.database.prepare("SELECT count(*) count FROM jobs WHERE type='generate_insight'").get() as { count: number }).count, 0);
    const deliveryService = createSqliteExternalDeliveryService({ database: context.temporary.database, clock });
    const issue = (await deliveryService.listIssues({ limit: 10 })).items[0]!;
    assert.equal(issue.phase, "result");
    assert.equal(issue.manualRetryAvailable, false);
    await assert.rejects(
      deliveryService.resolveIssue({ version: 1, requestId: randomUUID(), messageKey: issue.messageKey, phase: "result", action: "retry_once", confirmation: "RETRY_MAY_DUPLICATE" }),
      (error: unknown) => (error as { code?: string }).code === "DELIVERY_FAILED_FINAL",
    );
    assert.equal((context.temporary.database.prepare("SELECT result_status FROM external_messages WHERE entry_id=?").get(context.receipt.entryId) as { result_status: string }).result_status, "result_failed_final");
    assert.deepEqual(await deliveryService.resolveIssue({ version: 1, requestId: randomUUID(), messageKey: issue.messageKey, phase: "result", action: "assume_sent", confirmation: "ASSUME_SENT" }), { status: "sent_assumed" });
  } finally { close(context.temporary); }
});

test("invalid repair fails final after two calls and cannot write derivations", async () => {
  const context = await setup([{ outcome: "success", rawText: "not json" }, { outcome: "success", parsedJson: { schemaVersion: "memory-analysis.v1" } }]);
  try {
    const result = await context.executor.execute(context.job, new AbortController().signal);
    assert.equal(result.outcome, "failed_final");
    if (result.outcome === "failed_final") assert.equal(result.error.code, "AI_INVALID_OUTPUT");
    if (result.outcome === "failed_final") assert.equal(context.repository.failFinal(context.job.id, context.job.leaseOwner, context.job.fencingToken, result.error), true);
    assert.equal(context.provider.calls.length, 2);
    assert.equal((context.temporary.database.prepare("SELECT count(*) count FROM derivations").get() as { count: number }).count, 0);
    assert.equal((context.temporary.database.prepare("SELECT status FROM entries WHERE id=?").get(context.receipt.entryId) as { status: string }).status, "needs_review");
  } finally { close(context.temporary); }
});

test("Feishu think analysis final failure closes the persistent result ledger", async () => {
  const context = await setup([
    { outcome: "success", rawText: "not json" },
    { outcome: "success", parsedJson: { schemaVersion: "memory-analysis.v1" } },
  ], "think", true);
  try {
    const result = await context.executor.execute(context.job, new AbortController().signal);
    assert.equal(result.outcome, "failed_final");
    if (result.outcome !== "failed_final") throw new Error("expected final analysis failure");
    assert.equal(context.repository.failFinal(context.job.id, context.job.leaseOwner, context.job.fencingToken, result.error), true);
    const delivery = context.temporary.database.prepare(`
      SELECT result_status, result_derivation_id, result_last_error_code FROM external_messages WHERE entry_id = ?
    `).get(context.receipt.entryId) as { result_status: string; result_derivation_id: string | null; result_last_error_code: string };
    assert.deepEqual(delivery, { result_status: "result_failed_final", result_derivation_id: null, result_last_error_code: "AI_INVALID_OUTPUT" });
  } finally { close(context.temporary); }
});

test("evidence outside current text is invalid and repair is attempted only once", async () => {
  const invalid = validAnalysis();
  invalid.summary.evidence = ["invented quote"];
  const context = await setup([{ outcome: "success", parsedJson: invalid }, { outcome: "success", parsedJson: invalid }]);
  try {
    assert.equal((await context.executor.execute(context.job, new AbortController().signal)).outcome, "failed_final");
    assert.equal(context.provider.calls.length, 2);
  } finally { close(context.temporary); }
});

test("revision race rejects the late model result without any derived write", async () => {
  const context = await setup([]);
  try {
    const base = new FakeAiProvider([{ outcome: "success", parsedJson: validAnalysis() }]);
    const racingProvider: AiProviderV1 = { generateStructured: async (input) => {
      const result = await base.generateStructured(input);
      context.temporary.database.prepare("INSERT INTO entry_text_revisions(entry_id,revision,text,checksum,created_by,operation_key,created_at) VALUES (?,2,?,'checksum','user',?,?)")
        .run(context.receipt.entryId, "new revision", `revision:${randomUUID()}`, now);
      context.temporary.database.prepare("UPDATE entries SET current_text_revision=2,status='stored' WHERE id=?").run(context.receipt.entryId);
      return result;
    } };
    const service = new ProcessingService({ provider: racingProvider, prompts: loadDefaultPromptRegistry(), unitOfWork: new SqliteAnalysisUnitOfWork({ database: context.temporary.database, now: clock.now }) });
    const result = await new AnalyzeJobExecutor(service).execute(context.job, new AbortController().signal);
    assert.equal(result.outcome, "succeeded");
    assert.equal(context.repository.succeed(context.job.id, context.job.leaseOwner, context.job.fencingToken), true);
    assert.equal((context.temporary.database.prepare("SELECT status FROM entries WHERE id=?").get(context.receipt.entryId) as { status: string }).status, "stored");
    assert.equal((context.temporary.database.prepare("SELECT count(*) count FROM ai_runs").get() as { count: number }).count, 0);
    assert.equal((context.temporary.database.prepare("SELECT count(*) count FROM derivations").get() as { count: number }).count, 0);
  } finally { close(context.temporary); }
});

for (const race of ["fencing", "deletion"] as const) {
  test(`${race} race rejects the late model result`, async () => {
    const context = await setup([]);
    try {
      const base = new FakeAiProvider([{ outcome: "success", parsedJson: validAnalysis() }]);
      const provider: AiProviderV1 = { generateStructured: async (input) => {
        const result = await base.generateStructured(input);
        if (race === "fencing") context.temporary.database.prepare("UPDATE jobs SET fencing_token=fencing_token+1 WHERE id=?").run(context.job.id);
        else context.temporary.database.prepare("UPDATE entries SET status='deleting' WHERE id=?").run(context.receipt.entryId);
        return result;
      } };
      const service = new ProcessingService({ provider, prompts: loadDefaultPromptRegistry(), unitOfWork: new SqliteAnalysisUnitOfWork({ database: context.temporary.database, now: clock.now }) });
      const result = await new AnalyzeJobExecutor(service).execute(context.job, new AbortController().signal);
      assert.equal(result.outcome, "succeeded");
      assert.equal((context.temporary.database.prepare("SELECT count(*) count FROM derivations").get() as { count: number }).count, 0);
      assert.equal((context.temporary.database.prepare("SELECT count(*) count FROM ai_runs").get() as { count: number }).count, 0);
    } finally { close(context.temporary); }
  });
}
