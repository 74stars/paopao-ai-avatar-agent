import { WindowMoveRequestV1Schema } from "./preload-shared/window-contracts.js";

export interface WindowMoveTarget {
  getPosition(): readonly number[];
  setPosition(x: number, y: number, animate?: boolean): void;
  isDestroyed?(): boolean;
}

/** Applies a bounded relative move after the Main-side validation boundary. */
export function moveWindowBy(rawInput: unknown, target: WindowMoveTarget | null): boolean {
  const input = WindowMoveRequestV1Schema.safeParse(rawInput);
  if (!input.success || !target || target.isDestroyed?.()) return false;

  const [x, y] = target.getPosition();
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  target.setPosition(x + input.data.deltaX, y + input.data.deltaY, true);
  return true;
}
