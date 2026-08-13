import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { PetState } from "../types/domain";
import { BubbleLife } from "./BubbleLife";
import { createPetClickScheduler } from "./pet-interaction";

export function PetWindow() {
  const [state, setState] = useState<PetState>("quiet");
  const drag = useRef<{ pointerId: number; startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const clickScheduler = useRef(createPetClickScheduler({
    onSingle: () => void window.paopao?.windows.toggleCapture(),
    onDouble: () => void window.paopao?.windows.openLibrary()
  })).current;

  useEffect(() => window.paopao?.onDomainEvent((event) => {
    if (event.type === "pet:state") setState(event.state);
  }), []);

  useEffect(() => () => {
    clickScheduler.dispose();
  }, []);

  function handleClick() {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    clickScheduler.click();
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const deltaX = Math.round(event.clientX - current.x);
    const deltaY = Math.round(event.clientY - current.y);
    current.x = event.clientX;
    current.y = event.clientY;
    if (!current.moved && Math.abs(event.clientX - current.startX) + Math.abs(event.clientY - current.startY) < 3) return;
    current.moved = true;
    void window.paopao?.windows.moveBy({ version: 1, deltaX, deltaY });
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    suppressClick.current = current.moved;
    drag.current = null;
  }

  return (
    <button className="pet-window" aria-label="泡泡：单击快速记录，双击打开活书房" onClick={handleClick} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
      <BubbleLife state={state} compact />
    </button>
  );
}
