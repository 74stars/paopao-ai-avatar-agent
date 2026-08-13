import { describe, expect, it } from "vitest";
import { shelfMeta, shelfOrder } from "../src/components/LibraryShelf.js";

describe("LibraryShelf MVP shelves", () => {
  it("only contains the six real MVP memory types", () => {
    expect(shelfOrder).toEqual(["diary", "thought", "person", "reading", "goal", "other"]);
    expect(Object.keys(shelfMeta)).toHaveLength(6);
  });

  it("maps every shelf to a Chinese label", () => {
    for (const type of shelfOrder) expect(shelfMeta[type].label.length).toBeGreaterThan(0);
  });
  it("keeps metadata free of DOM or screen-space hotspot coordinates", () => {
    for (const type of shelfOrder) expect(Object.keys(shelfMeta[type])).toEqual(["label"]);
  });
});
