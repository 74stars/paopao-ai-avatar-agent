import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EntryDetailV1 } from "@paopao/contracts";
import { DELETE_EXPORT_NOTICE, EntryGovernance } from "../src/components/EntryGovernance.js";
import { RecordContent } from "../src/components/RecordContent.js";

const baseDetail: EntryDetailV1 = {
  id: "00000000-0000-4000-8000-000000000001",
  source: "desktop",
  rawText: "最初记录",
  currentText: "最初记录",
  textRevisions: [{ revision: 1, text: "最初记录", createdBy: "system", createdAt: "2026-08-11T00:00:00.000Z" }],
  status: "ready",
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
  memory: { type: "thought", summary: "AI 摘要", confidence: 0.8 },
  derivations: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      kind: "classification",
      value: { inputType: "thought", confidence: 0.8, evidence: "最初记录" },
      textRevision: 1,
      artifactRevision: 1,
      supersedesId: null,
      isCurrent: true,
      createdBy: "ai",
      promptVersion: "test/v1",
      schemaVersion: "classification.v1",
      createdAt: "2026-08-11T00:00:01.000Z"
    },
    {
      id: "00000000-0000-4000-8000-000000000003",
      kind: "summary",
      value: { text: "AI 摘要", confidence: 0.8, evidence: ["最初记录"] },
      textRevision: 1,
      artifactRevision: 1,
      supersedesId: null,
      isCurrent: true,
      createdBy: "ai",
      promptVersion: "test/v1",
      schemaVersion: "summary.v1",
      createdAt: "2026-08-11T00:00:01.000Z"
    }
  ],
  sources: [],
  activeJobs: []
};

describe("record semantics", () => {
  it("shows the accepted record first and reveals the original only after revision", () => {
    const initial = renderToStaticMarkup(createElement(RecordContent, { detail: baseDetail, onUpdated: async () => undefined }));
    expect(initial).toContain("<h2>记录内容</h2>");
    expect(initial).toContain("最初记录");
    expect(initial).toContain("编辑记录内容");
    expect(initial).not.toContain("<summary>最初记录</summary>");
    expect(initial).not.toContain("原始记录");

    const revised: EntryDetailV1 = {
      ...baseDetail,
      currentText: "用户修改后的记录",
      textRevisions: [...baseDetail.textRevisions, { revision: 2, text: "用户修改后的记录", createdBy: "user", createdAt: "2026-08-11T00:01:00.000Z" }]
    };
    const edited = renderToStaticMarkup(createElement(RecordContent, { detail: revised, onUpdated: async () => undefined }));
    expect(edited).toContain("<h2>记录内容</h2>");
    expect(edited).toContain("用户修改后的记录");
    expect(edited).toContain("<summary>最初记录</summary>");
    expect(edited).toContain("最初记录");
  });

  it("offers field-level adjustments without derivation, AI, or JSON terminology", () => {
    const markup = renderToStaticMarkup(createElement(EntryGovernance, { detail: baseDetail, onUpdated: async () => undefined, onDeleted: async () => undefined }));
    expect(markup).toContain("修改整理结果");
    expect(markup).not.toContain("AI 结果");
    expect(markup).toContain("保存分类");
    expect(markup).toContain("整理摘要");
    expect(markup).toContain("保存整理摘要");
    expect(markup).not.toContain("纠正派生");
    expect(markup).not.toContain("value_json");
    expect(DELETE_EXPORT_NOTICE).toContain("旧导出不会被删除");
  });
});
