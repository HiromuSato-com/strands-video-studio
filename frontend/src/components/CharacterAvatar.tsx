import type { CSSProperties } from "react";

export type CharacterState = "idle" | "thinking" | "working" | "complete" | "error";

interface Props {
  state: CharacterState;
  size?: number;
}

// ── Eye expressions ───────────────────────────────────────────────────────────
function IdleEyes() {
  return (
    <g>
      <path d="M 64 87 Q 74 78 84 87" stroke="#4C1D95" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M 96 87 Q 106 78 116 87" stroke="#4C1D95" strokeWidth="4" fill="none" strokeLinecap="round" />
    </g>
  );
}

function ThinkingEyes() {
  return (
    <g>
      <circle cx="74" cy="85" r="13" fill="white" stroke="#4C1D95" strokeWidth="1.5" />
      <circle cx="74" cy="86" r="7" fill="#4C1D95" />
      <circle cx="77" cy="82" r="2.5" fill="white" />
      <circle cx="106" cy="85" r="13" fill="white" stroke="#4C1D95" strokeWidth="1.5" />
      <circle cx="106" cy="86" r="7" fill="#4C1D95" />
      <circle cx="109" cy="82" r="2.5" fill="white" />
      {/* Thinking cloud dots */}
      <circle cx="142" cy="57" r="5.5" fill="#C084FC" opacity="0.9" />
      <circle cx="154" cy="48" r="4" fill="#C084FC" opacity="0.65" />
      <circle cx="163" cy="41" r="3" fill="#C084FC" opacity="0.35" />
    </g>
  );
}

function WorkingEyes() {
  return (
    <g>
      {/* >< eyes */}
      <path d="M 61 82 L 70 91 L 79 82" stroke="#4C1D95" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M 101 82 L 110 91 L 119 82" stroke="#4C1D95" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* Energy sparks */}
      <path d="M 145 58 L 156 63 M 147 70 L 160 73 M 149 82 L 161 80"
        stroke="#FCD34D" strokeWidth="2.5" strokeLinecap="round" />
    </g>
  );
}

function CompleteEyes() {
  return (
    <g>
      {/* Left star eye */}
      <path d="M 74 73 L 77 81 L 85 81 L 79 86 L 81 94 L 74 89 L 67 94 L 69 86 L 63 81 L 71 81 Z" fill="#FBBF24" />
      {/* Right star eye */}
      <path d="M 106 73 L 109 81 L 117 81 L 111 86 L 113 94 L 106 89 L 99 94 L 101 86 L 95 81 L 103 81 Z" fill="#FBBF24" />
    </g>
  );
}

function ErrorEyes() {
  return (
    <g>
      {/* Droopy brows */}
      <path d="M 62 76 Q 70 70 78 76" stroke="#4C1D95" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M 102 76 Q 110 70 118 76" stroke="#4C1D95" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* X eyes */}
      <path d="M 63 82 L 79 96 M 79 82 L 63 96" stroke="#4C1D95" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M 101 82 L 117 96 M 117 82 L 101 96" stroke="#4C1D95" strokeWidth="3.5" strokeLinecap="round" />
      {/* Sweat drop */}
      <ellipse cx="141" cy="77" rx="5" ry="9" fill="#93C5FD" opacity="0.8" transform="rotate(12 141 77)" />
      <circle cx="141" cy="68" r="3.5" fill="#93C5FD" opacity="0.8" />
    </g>
  );
}

// ── Animation & glow config ───────────────────────────────────────────────────
const ANIM_CLASS: Record<CharacterState, string> = {
  idle:     "mooby-idle",
  thinking: "mooby-think",
  working:  "mooby-work",
  complete: "mooby-complete",
  error:    "mooby-error",
};

const GLOW: Record<CharacterState, string> = {
  idle:     "drop-shadow(0 0 14px rgba(192,132,252,0.35))",
  thinking: "drop-shadow(0 0 12px rgba(147,197,253,0.50))",
  working:  "drop-shadow(0 0 20px rgba(251,191,36,0.60))",
  complete: "drop-shadow(0 0 32px rgba(251,191,36,0.90))",
  error:    "drop-shadow(0 0 14px rgba(239,68,68,0.55))",
};

// ── Main component ────────────────────────────────────────────────────────────
export function CharacterAvatar({ state, size = 200 }: Props) {
  const style: CSSProperties = {
    filter:     GLOW[state],
    transition: "filter 0.7s ease",
    display:    "inline-block",
  };

  const h = Math.round(size * (215 / 180));

  return (
    <div className={ANIM_CLASS[state]} style={style}>
      <svg viewBox="0 0 180 215" xmlns="http://www.w3.org/2000/svg" width={size} height={h}>

        {/* ── Bunny ears (behind head) ── */}
        <path d="M 44 88 Q 37 38 62 20 Q 78 44 74 90" fill="#7C3AED" />
        <path d="M 49 86 Q 44 46 63 31 Q 73 50 70 88" fill="#F9A8D4" />
        <path d="M 136 88 Q 143 38 118 20 Q 102 44 106 90" fill="#7C3AED" />
        <path d="M 131 86 Q 136 46 117 31 Q 107 50 110 88" fill="#F9A8D4" />

        {/* ── Head ── */}
        <circle cx="90" cy="98" r="69" fill="#F5EEFF" />

        {/* ── Hair covering top of head ── */}
        <path d="M 23 84 Q 44 22 90 15 Q 136 22 157 84 Q 136 57 90 53 Q 44 57 23 84" fill="#7C3AED" />

        {/* ── Ahoge / hair tuft ── */}
        <path d="M 90 17 Q 83 1 90 -5 Q 97 1 90 17" fill="#7C3AED" />
        <circle cx="90" cy="-4" r="9" fill="#C084FC" />

        {/* ── Eyes (state-based) ── */}
        {state === "idle"     && <IdleEyes />}
        {state === "thinking" && <ThinkingEyes />}
        {state === "working"  && <WorkingEyes />}
        {state === "complete" && <CompleteEyes />}
        {state === "error"    && <ErrorEyes />}

        {/* ── Blush ── */}
        <ellipse cx="63" cy="108" rx="17" ry="9" fill="#FCA5A5" opacity="0.45" />
        <ellipse cx="117" cy="108" rx="17" ry="9" fill="#FCA5A5" opacity="0.45" />

        {/* ── Mouth ── */}
        {state === "idle"     && <path d="M 76 122 Q 90 134 104 122" stroke="#7C3AED" strokeWidth="3" fill="none" strokeLinecap="round" />}
        {state === "thinking" && <circle cx="90" cy="125" r="7" fill="none" stroke="#7C3AED" strokeWidth="2.5" />}
        {state === "working"  && <path d="M 76 120 L 104 120" stroke="#7C3AED" strokeWidth="4" strokeLinecap="round" />}
        {state === "complete" && <path d="M 70 120 Q 90 138 110 120" stroke="#7C3AED" strokeWidth="3.5" fill="none" strokeLinecap="round" />}
        {state === "error"    && <path d="M 76 129 Q 90 120 104 129" stroke="#7C3AED" strokeWidth="3" fill="none" strokeLinecap="round" />}

        {/* ── Neck ── */}
        <rect x="76" y="163" width="28" height="13" rx="5" fill="#EDE9FE" />

        {/* ── Body ── */}
        <path d="M 50 170 Q 18 184 16 213 L 164 213 Q 162 184 130 170 Z" fill="#6D28D9" />

        {/* ── Collar detail ── */}
        <path d="M 60 170 Q 90 186 120 170 L 110 186 L 90 178 L 70 186 Z" fill="rgba(255,255,255,0.85)" />

        {/* ── Body decoration: film reel ── */}
        <circle cx="73" cy="197" r="7" fill="rgba(255,255,255,0.22)" />
        <rect x="80" y="191" width="20" height="13" rx="2" fill="rgba(255,255,255,0.16)" />
        <circle cx="107" cy="197" r="7" fill="rgba(255,255,255,0.22)" />
        <circle cx="73" cy="197" r="3" fill="#4C1D95" opacity="0.4" />
        <circle cx="107" cy="197" r="3" fill="#4C1D95" opacity="0.4" />

        {/* ── Arms ── */}
        <rect x="20" y="176" width="30" height="38" rx="14" fill="#8B5CF6" transform="rotate(-18 22 176)" />
        <rect x="130" y="176" width="30" height="38" rx="14" fill="#8B5CF6" transform="rotate(18 158 176)" />

        {/* ── Hands ── */}
        <circle cx="20" cy="209" r="14" fill="#F5EEFF" />
        <circle cx="160" cy="209" r="14" fill="#F5EEFF" />

        {/* ── Complete sparkles ── */}
        {state === "complete" && (
          <g>
            <path d="M 14 60 L 17 66 L 20 60 L 17 54 Z" fill="#FBBF24" />
            <path d="M 162 44 L 165 50 L 168 44 L 165 38 Z" fill="#FBBF24" />
            <path d="M 170 92 L 173 98 L 176 92 L 173 86 Z" fill="#F9A8D4" />
            <path d="M 4 92 L 7 98 L 10 92 L 7 86 Z" fill="#C084FC" />
            <circle cx="170" cy="65" r="4" fill="#FBBF24" opacity="0.7" />
            <circle cx="8" cy="68" r="3" fill="#F9A8D4" opacity="0.7" />
          </g>
        )}

      </svg>
    </div>
  );
}
