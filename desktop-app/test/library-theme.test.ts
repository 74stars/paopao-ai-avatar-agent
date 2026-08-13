import { describe, expect, it } from "vitest";
import { initialLibraryTheme, libraryThemeAsset, nextLibraryTheme } from "../src/components/library-theme.js";

describe("living library theme", () => {
  it("follows the system color preference on first render", () => {
    expect(initialLibraryTheme(false)).toBe("day");
    expect(initialLibraryTheme(true)).toBe("night");
  });

  it("switches between distinct production assets", () => {
    expect(libraryThemeAsset("day")).toBe("./assets/library-day.webp");
    expect(libraryThemeAsset("night")).toBe("./assets/library-night.webp");
    expect(nextLibraryTheme("day")).toBe("night");
    expect(nextLibraryTheme("night")).toBe("day");
  });
});
