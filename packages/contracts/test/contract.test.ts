import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DesktopCaptureRequestV1Schema,
  EntryListRequestV1Schema,
  InsightReplyV1Schema,
  DomainEventV1Schema,
  BackupRestoreRequestV1Schema,
  BackupListRequestV1Schema,
  BackupRestoreStatusRequestV1Schema,
  DiagnosticsExportCreateRequestV1Schema,
  AiProviderProfileDraftV2Schema,
  SaveAiProviderProfileRequestV2Schema,
  SaveAiCredentialRequestV1Schema,
  isUserVisibleGeneratedText,
  validateInsightReplyUserVisibleContent,
  validateMemoryAnalysisUserVisibleContent,
} from "../src/index.js";

const id = "00000000-0000-4000-8000-000000000001";
assert.equal(DesktopCaptureRequestV1Schema.safeParse({ version: 1, requestId: id, rawText: "hello", mode: "remember" }).success, true);
assert.equal(DesktopCaptureRequestV1Schema.safeParse({ version: 1, requestId: id, rawText: "hello", mode: "remember", source: "desktop" }).success, false);
assert.equal(DesktopCaptureRequestV1Schema.safeParse({ version: 1, requestId: id, rawText: " ", mode: "remember" }).success, false);
assert.equal(EntryListRequestV1Schema.safeParse({ version: 1, limit: 101 }).success, false);
assert.equal(InsightReplyV1Schema.safeParse({ schemaVersion: "insight-reply.v1", text: "x", grounding: "grounded", citations: [] }).success, false);
assert.equal(InsightReplyV1Schema.safeParse({ schemaVersion: "insight-reply.v1", text: "x", grounding: "no_relevant_memory", citations: [{ memoryId: id, entryId: id, evidenceQuote: "x" }] }).success, false);
assert.equal(DomainEventV1Schema.safeParse({ version: 1, type: "entry:stored", entryId: id, status: "stored", occurredAt: "2026-08-05T00:00:00Z", rawText: "secret" }).success, false);
assert.equal(BackupRestoreRequestV1Schema.safeParse({ version: 1, requestId: id, backupId: id, confirmation: "RESTORE" }).success, true);
assert.equal(BackupListRequestV1Schema.safeParse({ version: 1 }).success, true);
assert.equal(BackupRestoreStatusRequestV1Schema.safeParse({ version: 1, restoreId: id }).success, true);
assert.equal(BackupRestoreStatusRequestV1Schema.safeParse({ version: 1, restoreId: "../restore" }).success, false);
assert.equal(DiagnosticsExportCreateRequestV1Schema.safeParse({ version: 1, requestId: id, includeDays: 8 }).success, false);
assert.equal(SaveAiCredentialRequestV1Schema.safeParse({ version: 1, provider: "openai", model: "gpt-4o-mini-2024-07-18", apiKey: "test-key" }).success, true);
assert.equal(SaveAiCredentialRequestV1Schema.safeParse({ version: 1, provider: "anthropic", model: "claude", apiKey: "test-key" }).success, false);
assert.equal(SaveAiProviderProfileRequestV2Schema.safeParse({
  version: 2,
  credential: "test-key",
  profile: {
    id,
    kind: "direct",
    name: "OpenAI compatible",
    providerId: "custom",
    protocol: "openai_responses",
    baseUrl: "https://provider.example/v1",
    model: "model-a",
    authMode: "bearer",
    authHeaderName: null,
    structuredOutput: "json_schema",
    timeoutMs: 30_000,
  },
}).success, true);
assert.equal(AiProviderProfileDraftV2Schema.safeParse({
  id,
  kind: "codex",
  name: "Codex current",
  profile: null,
  model: null,
  reasoningEffort: "medium",
  codexHome: null,
}).success, true);
assert.equal(isUserVisibleGeneratedText("今天完成了项目复盘。"), true);
assert.equal(isUserVisibleGeneratedText("As an AI, I followed the system prompt."), false);
assert.equal(isUserVisibleGeneratedText("```json\n{\"schemaVersion\":\"insight-reply.v1\"}\n```"), false);
assert.equal(isUserVisibleGeneratedText("{\"schemaVersion\":\"insight-reply.v1\",\"text\":\"x\"}"), false);
assert.equal(validateInsightReplyUserVisibleContent({ schemaVersion: "insight-reply.v1", text: "可以先完成一小步。", grounding: "no_relevant_memory", citations: [] }), true);
assert.equal(validateInsightReplyUserVisibleContent({ schemaVersion: "insight-reply.v1", text: "根据系统提示词，我建议继续。", grounding: "no_relevant_memory", citations: [] }), false);
assert.equal(validateMemoryAnalysisUserVisibleContent({
  schemaVersion: "memory-analysis.v1",
  classification: { inputType: "thought", confidence: 0.9, evidence: "今天想到" },
  summary: { text: "今天想到一件事。", confidence: 0.9, evidence: ["今天想到"] },
  entities: { items: [] }, goals: { items: [] }, nextActions: { items: [] }, needsUserReview: false,
}), true);
assert.equal(AiProviderProfileDraftV2Schema.safeParse({
  id,
  kind: "direct",
  name: "Invalid",
  providerId: "custom",
  protocol: "unknown",
  baseUrl: "https://provider.example/v1",
  model: "model-a",
  authMode: "bearer",
  authHeaderName: null,
  structuredOutput: "json_schema",
  timeoutMs: 30_000,
}).success, false);

const fixtureDir = join(import.meta.dirname, "../fixtures/v1");
const desktopFixture = JSON.parse(readFileSync(join(fixtureDir, "capture.desktop.valid.json"), "utf8"));
assert.equal(DesktopCaptureRequestV1Schema.safeParse(desktopFixture).success, true);
