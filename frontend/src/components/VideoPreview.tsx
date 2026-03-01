import { useEffect, useRef } from "react";

interface Props {
  src: string;
}

const C = {
  bg:       "#121008",
  accent:   "#9B6B3A",
  accentHi: "#D4A96A",
  border:   "#D4C9B5",
  textMuted:"#B8AC9C",
  textSub:  "#8A7D6A",
} as const;

export function VideoPreview({ src }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.load();
    }
  }, [src]);

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: C.bg,
        border: `1px solid rgba(155,107,58,0.35)`,
        boxShadow: `0 0 24px rgba(155,107,58,0.12), inset 0 1px 0 rgba(212,169,106,0.15)`,
      }}
    >
      {/* Monitor header bar */}
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: `1px solid rgba(155,107,58,0.2)` }}
      >
        <div className="flex items-center gap-2">
          {/* LED indicator */}
          <span
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ background: C.accentHi, boxShadow: `0 0 6px ${C.accentHi}` }}
          />
          <span
            className="text-[10px] font-mono tracking-[0.25em] uppercase"
            style={{ color: C.textMuted }}
          >
            ▶ PLAYBACK
          </span>
        </div>
        {/* Right side scan-line marks */}
        <div className="flex gap-1">
          {[1, 2, 3].map((i) => (
            <span
              key={i}
              className="inline-block rounded-sm"
              style={{
                width: "18px",
                height: "4px",
                background: i === 1 ? C.accent : `rgba(155,107,58,${0.2 * i})`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Screen */}
      <div className="bg-black">
        <video
          ref={videoRef}
          controls
          className="w-full max-h-[38vh] object-contain"
        >
          <source src={src} />
          お使いのブラウザは動画再生に対応していません。
        </video>
      </div>

      {/* Bottom status bar */}
      <div
        className="flex items-center justify-between px-5 py-2"
        style={{ borderTop: `1px solid rgba(155,107,58,0.15)` }}
      >
        <span className="text-[9px] font-mono tracking-widest uppercase" style={{ color: `${C.textMuted}88` }}>
          AI CREATIVE STUDIO
        </span>
        <div
          className="h-1"
          style={{
            width: "40px",
            background: `linear-gradient(90deg, ${C.accent}, ${C.accentHi})`,
            borderRadius: "2px",
          }}
        />
      </div>
    </div>
  );
}
