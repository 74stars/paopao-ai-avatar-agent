import type { PetState } from "../types/domain";

export function BubbleLife({ state = "quiet", compact = false, className = "" }: { state?: PetState; compact?: boolean; className?: string }) {
  return (
    <div className={`bubble-canvas ${className}`} data-pet-state={state} data-compact={compact || undefined}>
      <svg className="bubble-character" viewBox="0 0 112 112" aria-hidden="true">
        <defs>
          <radialGradient id="paopao-glass" cx="0" cy="0" r="1" gradientTransform="translate(43 39) rotate(48) scale(49)" gradientUnits="userSpaceOnUse">
            <stop stopColor="#EAF7FF" stopOpacity="0.72" />
            <stop offset="0.42" stopColor="#9CDCFE" stopOpacity="0.38" />
            <stop offset="1" stopColor="#007ACC" stopOpacity="0.18" />
          </radialGradient>
          <linearGradient id="paopao-rim" x1="34" y1="31" x2="80" y2="84" gradientUnits="userSpaceOnUse">
            <stop stopColor="#F4FBFF" stopOpacity="0.8" />
            <stop offset="0.48" stopColor="#23A8F2" stopOpacity="0.34" />
            <stop offset="1" stopColor="#007ACC" stopOpacity="0.5" />
          </linearGradient>
          <filter id="paopao-soft-shadow" x="-35%" y="-35%" width="170%" height="180%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="4.2" />
          </filter>
        </defs>

        <circle className="bubble-ambient" cx="56" cy="57" r="37" fill="#007ACC" filter="url(#paopao-soft-shadow)" />
        <g className="bubble-glass">
          <circle className="bubble-shell" cx="56" cy="55" r="33" fill="url(#paopao-glass)" stroke="url(#paopao-rim)" strokeWidth="1.35" />
          <circle className="bubble-inner-rim" cx="56" cy="55" r="30.5" fill="none" stroke="#EAF7FF" strokeOpacity="0.18" strokeWidth="0.8" />
          <path className="bubble-highlight" d="M38 47c2.4-7.4 7.5-12.6 14.7-15.1" fill="none" stroke="#FFFFFF" strokeLinecap="round" strokeOpacity="0.56" strokeWidth="3.4" />
          <path className="bubble-refraction" d="M37.5 66.5c6.1 10.3 17.2 15.5 28.5 12.6" fill="none" stroke="#007ACC" strokeLinecap="round" strokeOpacity="0.18" strokeWidth="1.2" />
          <g className="bubble-status">
            <circle className="bubble-signal" cx="56" cy="67" r="9.5" fill="none" stroke="#9CDCFE" strokeDasharray="5 7" strokeLinecap="round" strokeWidth="1" />
            <circle className="bubble-core" cx="56" cy="67" r="3.2" fill="#DDF3FF" />
          </g>
        </g>
      </svg>
    </div>
  );
}
