import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EntryListResponseV1 } from "@paopao/contracts";
import { entityTypeLabel, entryPreviewText, LibraryReaderSheet } from "../src/components/LibraryReaderSheet.js";
import { captureChannelLabel, formatDayLabel, statusLabel } from "../src/components/LibraryState.js";

const item = (overrides: Partial<EntryListResponseV1["items"][number]> = {}): EntryListResponseV1["items"][number] => ({
  id: "00000000-0000-4000-8000-000000000001",
  source: "desktop",
  currentTextPreview: "今天记得给书架浇水。",
  title: "今天记得给书架浇水",
  summary: null,
  memoryType: null,
  status: "stored",
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
  latestRevision: 1,
  lastErrorCode: null,
  ...overrides
});

describe("entry list preview", () => {
  it("does not repeat a complete record title as its preview", () => {
    expect(entryPreviewText(item())).toBeNull();
  });

  it("shows only record content that remains after the title", () => {
    expect(entryPreviewText(item({ currentTextPreview: "第一句。第二句是剩余内容。", title: "第一句" }))).toBe("第二句是剩余内容。");
  });
});

describe("reader dialog semantics", () => {
  it("marks the reading layer as modal", () => {
    const markup = renderToStaticMarkup(createElement(LibraryReaderSheet, {
      heading: "最近记录",
      filterNote: null,
      state: "ready",
      error: "",
      list: { items: [], nextCursor: null },
      detail: null,
      detailLoading: false,
      detailError: "",
      loadingMore: false,
      moreError: "",
      onClose() {},
      onClearFilter() {},
      onLoadMore() {},
      onOpenEntry() {},
      onRetry() {},
      onRetryDetail() {},
      async onUpdated() {},
      async onDeleted() {},
      onCapture() {},
    }));
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
  });

  it("renders a detail failure without replacing the record list", () => {
    const markup = renderToStaticMarkup(createElement(LibraryReaderSheet, {
      heading: "最近记录",
      filterNote: null,
      state: "ready",
      error: "",
      list: { items: [item()], nextCursor: null },
      detail: null,
      detailLoading: false,
      detailError: "记录读取失败",
      loadingMore: false,
      moreError: "",
      onClose() {},
      onClearFilter() {},
      onLoadMore() {},
      onOpenEntry() {},
      onRetry() {},
      onRetryDetail() {},
      async onUpdated() {},
      async onDeleted() {},
      onCapture() {},
    }));
    expect(markup).toContain("今天记得给书架浇水");
    expect(markup).toContain("这条记录暂时无法打开");
    expect(markup).toContain("记录读取失败");
  });
});

describe("library status helpers", () => {
  it("maps every real entry status to a readable label", () => {
    expect(statusLabel("stored")).toBe("已记录");
    expect(statusLabel("processing")).toBe("整理中");
    expect(statusLabel("needs_review")).toBe("需要确认");
    expect(statusLabel("failed_final")).toBe("整理失败");
    expect(statusLabel("purged")).toBe("已删除");
  });

  it("labels capture channels and today without calling evidence a source", () => {
    expect(captureChannelLabel("desktop")).toBe("桌面端");
    expect(captureChannelLabel("feishu")).toBe("飞书");
    expect(formatDayLabel(new Date().toISOString())).toBe("今日");
    expect(entityTypeLabel("organization")).toBe("组织");
  });
});
