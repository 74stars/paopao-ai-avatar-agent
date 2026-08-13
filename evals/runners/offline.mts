#!/usr/bin/env node
// Offline pipeline evals: drives Capture -> analyze -> ready and insight with a
// deterministic FakeAiProvider over synthetic fixtures. Never contacts a
// provider, never touches credentials. The report only carries ids, counts and
// metrics; any sample text, rawText or prompt echo fails the hard gate.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  MemoryAnalysisV1Schema,
  validateAnalysisEvidence,
  validateInsightReplyAgainstMemories,
  type ClaimedJobV1,
  type InsightReplyV1,
  type MemoryAnalysisV1,
  type RetrievedMemoryV1
} from "@paopao/contracts";
import { createCaptureService } from "@paopao/core";
import { FakeAiProvider } from "../../packages/infrastructure/src/ai/testing/index.js";
import {
  InsightProcessingService,
  ProcessingService,
  loadDefaultPromptRegistry
} from "../../packages/infrastructure/src/ai/index.js";
import {
  SqliteAnalysisUnitOfWork,
  SqliteCaptureUnitOfWork,
  SqliteEntryQueryService,
  createTemporaryDatabase
} from "../../packages/infrastructure/src/database/index.js";
import { SqliteJobRepository } from "../../packages/infrastructure/src/scheduler/index.js";

const NOW = "2026-08-07T00:00:00.000Z";
const clock = { now: () => NOW };
const migrationsDirectory = fileURLToPath(new URL("../../packages/infrastructure/src/database/migrations", import.meta.url));
const fixturesRoot = fileURLToPath(new URL("../fixtures", import.meta.url));
const MEMORY_TYPES = ["diary", "thought", "person", "reading", "goal", "other"] as const;

interface AnalysisFixture {
  id: string;
  currentText: string;
  gold: MemoryAnalysisV1;
  invalidFirst?: Record<string, unknown>;
  simulate?: "valid" | "repair" | "wrong-classification";
  marker?: string;
  retrieval?: { query: string };
}

interface InsightFixture {
  id: string;
  currentText: string;
  analysis: MemoryAnalysisV1;
  memories: RetrievedMemoryV1[];
  goldReply: InsightReplyV1;
  invalidFirstReply?: InsightReplyV1;
  simulate: "valid" | "repair";
}

interface CommittedFixture {
  id: string;
  entryId: string;
  status: string;
  firstTry: boolean;
  repaired: boolean;
  analysis: MemoryAnalysisV1;
  calls: number;
}

interface Gate {
  metric: string;
  required: string;
  actual: number | boolean;
  passed: boolean;
}

function addMilliseconds(iso: string, milliseconds: number): string {
  return new Date(Date.parse(iso) + milliseconds).toISOString();
}

function loadFixtures(): { analysis: AnalysisFixture[]; insight: InsightFixture[]; noRelated: string[] } {
  const analysis: AnalysisFixture[] = [];
  const insight: InsightFixture[] = [];
  const noRelated: string[] = [];
  for (const name of readdirSync(fixturesRoot).filter((file) => file.endsWith(".json")).sort()) {
    const parsed = JSON.parse(readFileSync(join(fixturesRoot, name), "utf8")) as unknown;
    if (Array.isArray(parsed)) {
      for (const fixture of parsed) {
        const record = fixture as Record<string, unknown>;
        if (typeof record.id !== "string" || typeof record.currentText !== "string") {
          throw new Error(`Invalid fixture entry in ${name}`);
        }
        if ("goldReply" in record) {
          insight.push(record as unknown as InsightFixture);
        } else {
          analysis.push(record as unknown as AnalysisFixture);
        }
      }
    } else if (parsed && typeof parsed === "object" && "noRelated" in parsed) {
      noRelated.push(...((parsed as { noRelated: string[] }).noRelated));
    } else {
      throw new Error(`Unsupported fixture file: ${name}`);
    }
  }
  const ids = new Set<string>();
  for (const fixture of [...analysis, ...insight]) {
    if (ids.has(fixture.id)) throw new Error(`Duplicate fixture id: ${fixture.id}`);
    ids.add(fixture.id);
  }
  return { analysis, insight, noRelated };
}

function validateFixtures(analysis: readonly AnalysisFixture[], insight: readonly InsightFixture[]): void {
  for (const fixture of analysis) {
    const gold = MemoryAnalysisV1Schema.safeParse(fixture.gold);
    if (!gold.success) throw new Error(`Fixture ${fixture.id} gold fails MemoryAnalysisV1Schema`);
    if (!validateAnalysisEvidence(fixture.currentText, fixture.gold)) {
      throw new Error(`Fixture ${fixture.id} gold evidence is not locatable in currentText`);
    }
    if (fixture.invalidFirst) {
      const schemaOk = MemoryAnalysisV1Schema.safeParse(fixture.invalidFirst).success;
      const evidenceOk = schemaOk && validateAnalysisEvidence(fixture.currentText, fixture.invalidFirst as MemoryAnalysisV1);
      if (schemaOk && evidenceOk) {
        throw new Error(`Fixture ${fixture.id} invalidFirst is not actually invalid`);
      }
    }
  }
  for (const fixture of insight) {
    if (!validateInsightReplyAgainstMemories(fixture.goldReply, fixture.memories)) {
      throw new Error(`Fixture ${fixture.id} goldReply does not cite only supplied memories`);
    }
    if (fixture.invalidFirstReply && validateInsightReplyAgainstMemories(fixture.invalidFirstReply, fixture.memories)) {
      throw new Error(`Fixture ${fixture.id} invalidFirstReply is actually valid`);
    }
  }
}

function stepsFor(fixture: AnalysisFixture): Array<{ outcome: "success"; parsedJson?: unknown; rawText?: string }> {
  if (fixture.invalidFirst) {
    return [
      { outcome: "success", parsedJson: fixture.invalidFirst },
      { outcome: "success", parsedJson: fixture.gold }
    ];
  }
  if (fixture.simulate === "repair") {
    return [
      { outcome: "success", rawText: "{broken" },
      { outcome: "success", parsedJson: fixture.gold }
    ];
  }
  if (fixture.simulate === "wrong-classification") {
    return [{
      outcome: "success",
      parsedJson: {
        ...fixture.gold,
        classification: { ...fixture.gold.classification, inputType: "thought" }
      }
    }];
  }
  return [{ outcome: "success", parsedJson: fixture.gold }];
}

async function runAnalysisFixture(
  database: ReturnType<typeof createTemporaryDatabase>["database"],
  repository: SqliteJobRepository,
  fixture: AnalysisFixture
): Promise<CommittedFixture> {
  const requestId = randomUUID();
  const capture = createCaptureService({
    unitOfWork: new SqliteCaptureUnitOfWork({ database, clock, ids: { next: randomUUID } }),
    clock,
    events: { publish: async () => {} }
  });
  const receipt = await capture.capture({
    version: 1,
    requestId,
    source: "desktop",
    modality: "text",
    rawText: fixture.currentText,
    mode: "remember",
    receivedAt: NOW,
    sourceKey: `desktop:${requestId}`
  });

  const job = repository.claimNext("eval-worker", 60_000, NOW);
  if (!job || job.type !== "analyze_entry") throw new Error(`No analyze job for fixture ${fixture.id}`);
  repository.startAttempt(job.id, job.leaseOwner, job.fencingToken);

  const provider = new FakeAiProvider(stepsFor(fixture));
  const processing = new ProcessingService({
    provider,
    prompts: loadDefaultPromptRegistry(),
    unitOfWork: new SqliteAnalysisUnitOfWork({ database, now: clock.now })
  });
  const result = await processing.process(job, new AbortController().signal);
  if (result.outcome !== "succeeded") {
    return {
      id: fixture.id,
      entryId: receipt.entryId,
      status: "failed",
      firstTry: false,
      repaired: false,
      analysis: fixture.gold,
      calls: provider.calls.length
    };
  }

  const status = (database.prepare("SELECT status FROM entries WHERE id = ?").get(receipt.entryId) as { status: string }).status;
  const analysis = readCommittedAnalysis(database, receipt.entryId);
  if (!analysis) throw new Error(`Fixture ${fixture.id} has no committed analysis`);
  return {
    id: fixture.id,
    entryId: receipt.entryId,
    status,
    firstTry: !fixture.invalidFirst && fixture.simulate !== "repair",
    repaired: Boolean(fixture.invalidFirst) || fixture.simulate === "repair",
    analysis,
    calls: provider.calls.length
  };
}

function readCommittedAnalysis(database: { prepare(sql: string): { all(...args: unknown[]): Array<{ kind: string; value_json: string }> } }, entryId: string): MemoryAnalysisV1 | null {
  const rows = database.prepare(
    "SELECT kind, value_json FROM derivations WHERE entry_id = ? AND is_current = 1 AND created_by = 'ai'"
  ).all(entryId);
  if (rows.length !== 5) return null;
  const byKind = new Map(rows.map((row) => [row.kind, JSON.parse(row.value_json) as unknown]));
  const status = (database.prepare("SELECT status FROM entries WHERE id = ?").get(entryId) as { status: string }).status;
  const candidate = {
    schemaVersion: "memory-analysis.v1",
    classification: byKind.get("classification"),
    summary: byKind.get("summary"),
    entities: byKind.get("entities"),
    goals: byKind.get("goals"),
    nextActions: byKind.get("next_actions"),
    needsUserReview: status === "needs_review"
  };
  const parsed = MemoryAnalysisV1Schema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

async function runInsightFixture(fixture: InsightFixture): Promise<{ outcome: string; valid: boolean; repaired: boolean }> {
  const jobId = randomUUID();
  const entryId = randomUUID();
  const job = {
    id: jobId,
    attempts: 0,
    maxAttempts: 3,
    leaseOwner: "eval-worker",
    leaseExpiresAt: addMilliseconds(NOW, 60_000),
    fencingToken: 0,
    type: "generate_insight",
    entryId,
    payload: { schemaVersion: "generate-insight-job.v1", entryId, textRevision: 1, analysisDerivationId: randomUUID() }
  } as Extract<ClaimedJobV1, { type: "generate_insight" }>;

  const steps = fixture.simulate === "repair" && fixture.invalidFirstReply
    ? [
        { outcome: "success" as const, parsedJson: fixture.invalidFirstReply },
        { outcome: "success" as const, parsedJson: fixture.goldReply }
      ]
    : [{ outcome: "success" as const, parsedJson: fixture.goldReply }];
  const provider = new FakeAiProvider(steps);
  const service = new InsightProcessingService({
    provider,
    prompts: loadDefaultPromptRegistry(),
    load: () => ({ currentText: fixture.currentText, analysis: fixture.analysis, retrievedMemories: fixture.memories })
  });
  const result = await service.process(job, new AbortController().signal);
  const valid = result.outcome === "succeeded" && validateInsightReplyAgainstMemories(result.reply, fixture.memories);
  return { outcome: result.outcome, valid, repaired: steps.length === 2 };
}

function classificationF1(predicted: Map<string, string>, gold: Map<string, string>): number {
  const scores: number[] = [];
  for (const type of MEMORY_TYPES) {
    let tp = 0, fp = 0, fn = 0;
    for (const [id, goldType] of gold) {
      const predType = predicted.get(id);
      if (goldType === type && predType === type) tp += 1;
      else if (goldType !== type && predType === type) fp += 1;
      else if (goldType === type && predType !== type) fn += 1;
    }
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    scores.push(precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall));
  }
  return scores.reduce((sum, value) => sum + value, 0) / MEMORY_TYPES.length;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

async function main(): Promise<void> {
  const reportArg = process.argv.indexOf("--report");
  const reportPath = reportArg >= 0 ? process.argv[reportArg + 1] : undefined;
  const { analysis: analysisFixtures, insight: insightFixtures, noRelated } = loadFixtures();
  validateFixtures(analysisFixtures, insightFixtures);

  const temporary = createTemporaryDatabase({ migrationsDirectory, now: clock.now });
  const committed: CommittedFixture[] = [];
  const insightResults: Array<{ id: string; outcome: string; valid: boolean; repaired: boolean }> = [];
  const entryQuery = new SqliteEntryQueryService(temporary.database);
  let recallHits = 0;
  let recallQueries = 0;
  let noRelatedHits = 0;
  try {
    const repository = new SqliteJobRepository(temporary.database, clock);
    for (const fixture of analysisFixtures) {
      committed.push(await runAnalysisFixture(temporary.database, repository, fixture));
    }
    for (const fixture of insightFixtures) {
      insightResults.push({ id: fixture.id, ...(await runInsightFixture(fixture)) });
    }
    // Retrieval recall and no-related queries must run while the database is open.
    const entryIdByFixture = new Map(committed.filter((item) => item.status !== "failed").map((item) => [item.id, item.entryId]));
    for (const fixture of analysisFixtures.filter((fixture) => fixture.retrieval)) {
      const entryId = entryIdByFixture.get(fixture.id);
      if (!entryId) continue;
      recallQueries += 1;
      const response = entryQuery.list({ query: fixture.retrieval!.query, limit: 8 });
      if (response.items.some((item) => item.id === entryId)) recallHits += 1;
    }
    noRelatedHits = noRelated.filter((query) => entryQuery.list({ query, limit: 8 }).items.length > 0).length;
  } finally {
    temporary.close();
  }

  const byId = new Map(committed.map((item) => [item.id, item]));
  const failures = committed.filter((item) => item.status === "failed");
  const committedOk = committed.filter((item) => item.status !== "failed");
  const repairRequired = committed.filter((item) => item.repaired);
  const repairPass = repairRequired.filter((item) => item.status !== "failed");
  const firstTryPass = committed.filter((item) => item.firstTry && item.status !== "failed");
  const injectionFixtures = analysisFixtures.filter((fixture) => fixture.marker !== undefined);
  const injectionSideEffects = injectionFixtures.filter((fixture) => {
    const committedFixture = byId.get(fixture.id);
    return committedFixture?.status !== "failed" && JSON.stringify(committedFixture?.analysis).includes(fixture.marker as string);
  }).length;
  const textByFixture = new Map(analysisFixtures.map((fixture) => [fixture.id, fixture.currentText]));
  const evidenceLocatable = committedOk.filter((item) => validateAnalysisEvidence(textByFixture.get(item.id)!, item.analysis)).length;
  const predicted = new Map(committedOk.map((item) => [item.id, item.analysis.classification.inputType]));
  const gold = new Map(analysisFixtures.map((fixture) => [fixture.id, fixture.gold.classification.inputType]));

  const insightValid = insightResults.filter((result) => result.valid).length;
  const illegalCitationCount = insightResults.length - insightValid;
  const insightLegalityRate = insightFixtures.length === 0 ? 1 : insightValid / insightFixtures.length;
  const totalExtraction = analysisFixtures.length;
  const totalFixtures = totalExtraction + insightFixtures.length;
  const metrics = {
    schemaPassRate: round(totalExtraction === 0 ? 0 : committedOk.length / totalExtraction),
    schemaFirstTryPassRate: round(totalExtraction === 0 ? 0 : firstTryPass.length / totalExtraction),
    schemaRepairPassRate: round(repairRequired.length === 0 ? 1 : repairPass.length / repairRequired.length),
    primaryClassificationMacroF1: round(classificationF1(predicted, gold)),
    evidenceLocatabilityRate: round(committedOk.length === 0 ? 0 : evidenceLocatable / committedOk.length),
    insightCitationLegalityRate: round(insightLegalityRate),
    illegalCitationCount,
    recallAt8: round(recallQueries === 0 ? 0 : recallHits / recallQueries),
    noRelatedQueryFalsePositiveRate: round(noRelated.length === 0 ? 0 : noRelatedHits / noRelated.length),
    injectionSideEffectRate: round(injectionFixtures.length === 0 ? 0 : injectionSideEffects / injectionFixtures.length)
  };

  const gates: Gate[] = [
    { metric: "fixtureCount", required: ">= 30", actual: totalFixtures, passed: totalFixtures >= 30 },
    { metric: "schemaPassRate", required: "== 1.0", actual: metrics.schemaPassRate, passed: metrics.schemaPassRate === 1 },
    { metric: "pipelineFailures", required: "== 0", actual: failures.length, passed: failures.length === 0 },
    { metric: "evidenceLocatabilityRate", required: "== 1.0", actual: metrics.evidenceLocatabilityRate, passed: metrics.evidenceLocatabilityRate === 1 },
    { metric: "insightCitationLegalityRate", required: "== 1.0", actual: metrics.insightCitationLegalityRate, passed: metrics.insightCitationLegalityRate === 1 },
    { metric: "illegalCitationCount", required: "== 0", actual: metrics.illegalCitationCount, passed: metrics.illegalCitationCount === 0 },
    { metric: "recallAt8", required: ">= 0.80", actual: metrics.recallAt8, passed: metrics.recallAt8 >= 0.8 },
    { metric: "noRelatedQueryFalsePositiveRate", required: "<= 0.05", actual: metrics.noRelatedQueryFalsePositiveRate, passed: metrics.noRelatedQueryFalsePositiveRate <= 0.05 },
    { metric: "injectionSideEffectRate", required: "== 0", actual: metrics.injectionSideEffectRate, passed: metrics.injectionSideEffectRate === 0 }
  ];

  const report = {
    runner: "paopao-offline-evals",
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    counts: {
      fixtures: totalFixtures,
      extractionFixtures: totalExtraction,
      retrievalQueries: recallQueries,
      noRelatedQueries: noRelated.length,
      injectionFixtures: injectionFixtures.length,
      insightFixtures: insightFixtures.length,
      firstTryPass: firstTryPass.length,
      repairRequired: repairRequired.length,
      repairPass: repairPass.length,
      pipelineFailures: failures.length,
      committed: committedOk.length
    },
    metrics,
    fixtures: committed.map((item) => ({ id: item.id, outcome: item.status === "failed" ? "failed" : "committed", firstTry: item.firstTry, repaired: item.repaired, status: item.status })),
    gates,
    passed: gates.every((gate) => gate.passed)
  };

  const serialized = JSON.stringify(report, null, 2);
  const fixtureTextLeaked = [
    ...analysisFixtures.map((fixture) => fixture.currentText),
    ...insightFixtures.map((fixture) => fixture.currentText)
  ].some((value) => value.length >= 4 && serialized.includes(value));
  const sensitiveMarkerLeaked = serialized.includes("---BEGIN_UNTRUSTED_USER_DATA---")
    || serialized.includes("Bearer ")
    || /sk-[A-Za-z0-9_-]{8,}/.test(serialized);
  const leaked = fixtureTextLeaked || sensitiveMarkerLeaked;
  if (leaked) {
    console.error("offline evals: report sanitization gate failed (sample content would be echoed); not printing the report");
    process.exitCode = 1;
    return;
  }

  if (reportPath) writeFileSync(reportPath, `${serialized}\n`, "utf8");
  console.log(serialized);
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error("offline evals failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
