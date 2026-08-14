import { useEffect, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { PetState } from "../types/domain";
import { BubbleLife } from "./BubbleLife";

export function petKeyboardAction(key: string, shiftKey = false): "capture" | "library" | null {
  if (key === "Enter" && shiftKey) return "library";
  if (key === "Enter" || key === " ") return "capture";
  return null;
}

export function PetWindow() {
  const [state, setState] = useState<PetState>("quiet");

  useEffect(() => window.paopao?.onDomainEvent((event) => {
    if (event.type === "pet:state") setState(event.state);
  }), []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const action = petKeyboardAction(event.key, event.shiftKey);
    if (!action) return;
    event.preventDefault();
    if (action === "library") void window.paopao?.windows.openLibrary();
    else void window.paopao?.windows.toggleCapture();
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div className="pet-window" role="button" tabIndex={0} aria-label="泡泡：按 Enter 快速记录，按 Shift+Enter 打开活书房" aria-keyshortcuts="Enter Space Shift+Enter" onKeyDown={handleKeyDown} onPointerDown={handlePointerDown} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
      <BubbleLife state={state} compact />
    </div>
  );
}
