import type { PetState } from "../types/domain";

const BUBBLE_ASSET = "./assets/paopao.webp";

export function BubbleLife({ state = "quiet", compact = false, className = "" }: { state?: PetState; compact?: boolean; className?: string }) {
  return (
    <div className={`bubble-canvas ${className}`} data-pet-state={state} data-compact={compact || undefined}>
      <img className="bubble-character" src={BUBBLE_ASSET} alt="" draggable={false} aria-hidden="true" />
    </div>
  );
}
