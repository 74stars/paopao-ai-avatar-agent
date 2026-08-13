import { describe, expect, it, vi } from "vitest";
import { moveWindowBy, type WindowMoveTarget } from "../electron/window-movement";

function createTarget(position: [number, number] = [120, 80], destroyed = false): WindowMoveTarget {
  return {
    getPosition: () => position,
    setPosition: vi.fn(),
    isDestroyed: () => destroyed
  };
}

describe("window.moveBy", () => {
  it("moves only the resolved sender window by a bounded relative delta", () => {
    const target = createTarget();

    expect(moveWindowBy({ version: 1, deltaX: 12, deltaY: -7 }, target)).toBe(true);
    expect(target.setPosition).toHaveBeenCalledWith(132, 73, true);
  });

  it("rejects malformed, oversized, and extra fields before moving", () => {
    const target = createTarget();

    expect(moveWindowBy({ version: 1, deltaX: 201, deltaY: 0 }, target)).toBe(false);
    expect(moveWindowBy({ version: 1, deltaX: 1.5, deltaY: 0 }, target)).toBe(false);
    expect(moveWindowBy({ version: 1, deltaX: 1, deltaY: 0, x: 999 }, target)).toBe(false);
    expect(target.setPosition).not.toHaveBeenCalled();
  });

  it("does not move a destroyed or missing target window", () => {
    expect(moveWindowBy({ version: 1, deltaX: 1, deltaY: 1 }, createTarget([0, 0], true))).toBe(false);
    expect(moveWindowBy({ version: 1, deltaX: 1, deltaY: 1 }, null)).toBe(false);
  });
});
