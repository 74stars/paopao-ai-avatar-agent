import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LibraryScene, normalizedLibrarySearchQuery } from "../src/components/LibraryScene.js";

const sceneProps = {
  summary: null,
  state: "error" as const,
  error: "活书房读取失败",
  latest: null,
  selectedType: null,
  queryInput: "",
  settingsOpen: false,
  readerOpen: false,
  theme: "day" as const,
  onQueryInputChange() {},
  onSearch() {},
  onSelectType() {},
  onOpenSelectedType() {},
  onCapture() {},
  onBrowse() {},
  onOpenEntry() {},
  onOpenSettings() {},
  onToggleTheme() {},
  onRetry() {},
};

describe("library search submission", () => {
  it("rejects blank input and normalizes a real query", () => {
    expect(normalizedLibrarySearchQuery("   ")).toBeNull();
    expect(normalizedLibrarySearchQuery("  项目复盘  ")).toBe("项目复盘");
  });
});

describe("library scene recovery", () => {
  it("renders a visible retry action for a library failure", () => {
    const markup = renderToStaticMarkup(createElement(LibraryScene, sceneProps));
    expect(markup).toContain('data-testid="library-scene-status"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("活书房读取失败");
    expect(markup).toContain("重新读取");
  });
});
