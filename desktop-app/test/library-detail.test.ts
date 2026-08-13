import { describe, expect, it } from "vitest";
import type { EntryDetailV1 } from "@paopao/contracts";
import { currentInsight, entryAiState, retryableJobs } from "../src/components/library-detail.js";

const base = { id: "00000000-0000-4000-8000-000000000001", source: "desktop", rawText: "原文", currentText: "原文", textRevisions: [{ revision: 1, text: "原文", createdBy: "system", createdAt: "2026-08-07T00:00:00Z" }], status: "ready", createdAt: "2026-08-07T00:00:00Z", updatedAt: "2026-08-07T00:00:00Z", memory: null, derivations: [], sources: [], activeJobs: [] } as EntryDetailV1;

describe("library detail AI state", () => {
  it.each([["waiting_for_network", "离线，联网后继续"], ["waiting_for_configuration", "等待配置 AI"], ["retry_wait", "等待重试"], ["running", "AI 整理中"]] as const)("maps %s jobs", (status, label) => {
    const detail = { ...base, activeJobs: [{ id: "00000000-0000-4000-8000-000000000002", type: "analyze_entry", status, attempts: 1, nextRunAt: null, lastErrorCode: null }] } as EntryDetailV1;
    expect(entryAiState(detail).label).toBe(label);
  });
  it.each([["needs_review", "需要确认"], ["failed_final", "AI 整理失败"]] as const)("maps %s entries", (status, label) => expect(entryAiState({ ...base, status } as EntryDetailV1).label).toBe(label));
  it("selects the current insight and its citations", () => {
    const insight = { schemaVersion: "insight-reply.v1", text: "联系旧记忆", grounding: "grounded", citations: [{ memoryId: "00000000-0000-4000-8000-000000000010", entryId: "00000000-0000-4000-8000-000000000011", evidenceQuote: "旧记忆证据" }] } as const;
    const detail = { ...base, derivations: [{ id: "00000000-0000-4000-8000-000000000012", kind: "insight_reply", value: insight, textRevision: 1, artifactRevision: 1, supersedesId: null, isCurrent: true, createdBy: "ai", promptVersion: "insight/v1", schemaVersion: "insight-reply.v1", createdAt: base.createdAt }] } as EntryDetailV1;
    expect(currentInsight(detail)).toEqual(insight);
  });
  it("does not invent an insight for remember entries", () => expect(currentInsight(base)).toBeNull());
  it("keeps the failed job id available for manual retry", () => {
    const failedJob = { id: "00000000-0000-4000-8000-000000000020", type: "analyze_entry" as const, status: "failed_final" as const, attempts: 3, nextRunAt: null, lastErrorCode: "AI_INVALID_OUTPUT" as const };
    expect(retryableJobs({ ...base, activeJobs: [failedJob] } as EntryDetailV1)).toEqual([failedJob]);
  });
});
