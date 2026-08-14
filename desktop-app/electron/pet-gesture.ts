export type PetGestureResult = "click" | "drag";

export interface PetWindowDragController {
  pointerDown(cursorX: number, cursorY: number, windowX: number, windowY: number): void;
  pointerMove(cursorX: number, cursorY: number): { x: number; y: number } | null;
  pointerUp(x: number, y: number): PetGestureResult | null;
  cancel(): void;
}

export interface PetClickScheduler {
  click(): void;
  cancel(): void;
  dispose(): void;
}

export type PetMouseButton = "left" | "middle" | "right" | undefined;

export function isPetPrimaryMouseButton(button: PetMouseButton): boolean {
  return button === undefined || button === "left";
}

const PET_DRAG_THRESHOLD_PX = 3;

export function createPetWindowDragController(thresholdPx = PET_DRAG_THRESHOLD_PX): PetWindowDragController {
  let start: { cursorX: number; cursorY: number; windowX: number; windowY: number } | null = null;
  let dragging = false;

  return {
    pointerDown(cursorX, cursorY, windowX, windowY) {
      start = { cursorX, cursorY, windowX, windowY };
      dragging = false;
    },
    pointerMove(cursorX, cursorY) {
      if (!start) return null;
      const deltaX = cursorX - start.cursorX;
      const deltaY = cursorY - start.cursorY;
      const distance = Math.abs(deltaX) + Math.abs(deltaY);
      if (!dragging && distance <= thresholdPx) return null;
      dragging = true;
      return {
        x: Math.round(start.windowX + deltaX),
        y: Math.round(start.windowY + deltaY)
      };
    },
    pointerUp(x, y) {
      const initial = start;
      start = null;
      if (!initial) return null;

      const distance = Math.abs(x - initial.cursorX) + Math.abs(y - initial.cursorY);
      const result = dragging || distance > thresholdPx ? "drag" : "click";
      dragging = false;
      return result;
    },
    cancel() {
      start = null;
      dragging = false;
    }
  };
}

export function createPetClickScheduler(options: { onSingle(): void; onDouble(): void; delayMs?: number }): PetClickScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const delayMs = options.delayMs ?? 350;

  return {
    click() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        options.onDouble();
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        options.onSingle();
      }, delayMs);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
    dispose() {
      this.cancel();
    }
  };
}
