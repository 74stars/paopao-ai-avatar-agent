import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MemoryType } from "@paopao/contracts";
import { LibraryMasterScene } from "../src/components/LibraryMasterScene.js";

const props = {
  counts: new Map<MemoryType, number>([["diary", 3]]),
  total: 3,
  selectedType: null,
  state: "ready" as const,
  error: "",
  latestTitle: null,
  theme: "day" as const,
  visualAction: "idle" as const,
  onSelectType: () => undefined,
  onTypewriter: () => undefined,
  onBrowse: () => undefined,
  onToggleTheme: () => undefined
};

describe("library master scene", () => {
  it("keeps persistent entry text on the six shelf labels only", () => {
    const markup = renderToStaticMarkup(createElement(LibraryMasterScene, props));
    const visibleLabels = markup.match(/data-entry-label=/g) ?? [];
    expect(markup).toContain("日记 3");
    expect(markup).toContain("data-entry-label=\"shelf-diary\"");
    expect(markup).not.toContain("data-entry-label=\"typewriter\"");
    expect(markup).not.toContain("data-entry-label=\"letterbox\"");
    expect(markup).not.toContain("data-entry-label=\"theme-lamp\"");
    expect(visibleLabels).toHaveLength(6);
  });

  it("uses the approved idle, correspondence and book frames without a typewriter action frame", () => {
    const idleMarkup = renderToStaticMarkup(createElement(LibraryMasterScene, props));
    expect(idleMarkup).toContain("day-idle.png");
    expect(idleMarkup).not.toContain("typewriter-paper-open");

    const letterMarkup = renderToStaticMarkup(createElement(LibraryMasterScene, { ...props, visualAction: "letterbox" as const }));
    expect(letterMarkup).toContain("day-correspondence-letter-lift.png");

    const shelfMarkup = renderToStaticMarkup(createElement(LibraryMasterScene, { ...props, selectedType: "diary" as const }));
    expect(shelfMarkup).toContain("day-books-diary-pull.png");
  });

  it("keeps non-text scene objects accessible through their real hit controls", () => {
    const markup = renderToStaticMarkup(createElement(LibraryMasterScene, { ...props, latestTitle: "今天整理书架" }));
    expect(markup).toContain("aria-label=\"打开最近记录：今天整理书架\"");
    expect(markup).toContain("aria-label=\"浏览最近记录\"");
    expect(markup).toContain("aria-label=\"切换到夜间模式\"");
  });
});
