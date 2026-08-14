import { describe, expect, it } from "vitest";
import { initialLibraryTheme, nextLibraryTheme } from "../src/components/library-theme.js";

describe("living library theme", () => {
  it("follows the system color preference on first render", () => {
    expect(initialLibraryTheme(false)).toBe("day");
    expect(initialLibraryTheme(true)).toBe("night");
  });

  it("switches between day and night themes", () => {
    expect(nextLibraryTheme("day")).toBe("night");
    expect(nextLibraryTheme("night")).toBe("day");
  });
});
