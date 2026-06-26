import { useEffect, useState } from "react";
import type { PetState } from "../types/domain";
import { BubbleLife } from "./BubbleLife";

export function PetWindow() {
  const [state, setState] = useState<PetState>("quiet");

  useEffect(() => {
    window.paopao?.onPetState?.(setState);
  }, []);

  return (
    <button className="pet-window" onClick={() => window.paopao?.toggleCapture?.()} onDoubleClick={() => window.paopao?.openLibrary?.()}>
      <BubbleLife state={state} compact />
    </button>
  );
}
