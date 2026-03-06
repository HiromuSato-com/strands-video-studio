import { useEffect } from "react";
import { X, Download, RotateCcw, Zap } from "lucide-react";
import { VideoPreview } from "./VideoPreview";
import { playSound, Snd } from "../lib/snd";

interface Props {
  downloadUrl: string;
  outputKey: string;
  onClose: () => void;
  onReset: () => void;
}

const C = {
  bg:        "#0E0C07",
  accent:    "#7A4E22",
  accentHov: "#6B4318",
  accentHi:  "#C49035",
  card:      "#E2D4B8",
  border:    "#9C8660",
  textMain:  "#1A1308",
  textSub:   "#3D2C18",
  textMuted: "#6B5438",
  badge:     "#C4A86E",
} as const;

export function CompletionModal({ downloadUrl, outputKey, onClose, onReset }: Props) {
  const filename = outputKey.split("/").pop() ?? "output.mp4";

  useEffect(() => {
    document.body.style.overflow = "hidden";
    playSound(Snd.SOUNDS.TRANSITION_UP);
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-modal-backdrop">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/65 backdrop-blur-md" onClick={onClose} />

      {/* Modal card */}
      <div
        className="relative z-10 w-full max-w-2xl rounded-2xl overflow-hidden animate-modal-in shadow-2xl flex flex-col max-h-[90vh]"
        style={{ background: C.card, border: `1px solid ${C.border}` }}
      >
        {/* Top cartridge stripe */}
        <div
          style={{
            height: "4px",
            background: `linear-gradient(90deg, ${C.accent} 0%, ${C.accentHi} 55%, ${C.accent} 100%)`,
          }}
        />

        {/* Header — dark game panel */}
        <div className="relative px-5 py-3 overflow-hidden" style={{ background: C.bg }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{
                  background: "rgba(122,78,34,0.22)",
                  border: "1px solid rgba(122,78,34,0.45)",
                }}
              >
                <Zap size={16} style={{ color: C.accentHi }} />
              </div>
              <div>
                <p
                  className="text-[9px] font-mono tracking-[0.28em] uppercase"
                  style={{ color: C.textMuted }}
                >
                  Mission Complete
                </p>
                <h2 className="font-bold text-lg leading-tight" style={{ color: C.card }}>
                  動画が完成しました！
                </h2>
              </div>
            </div>

            <button
              onClick={() => { playSound(Snd.SOUNDS.TRANSITION_DOWN); onClose(); }}
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
              style={{ background: "rgba(255,255,255,0.07)", color: C.textMuted }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.15)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
              aria-label="閉じる"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto">
          {/* File label */}
          <div className="flex items-center gap-2">
            <span
              className="text-[9px] font-mono tracking-widest uppercase px-2 py-0.5 rounded"
              style={{ background: C.badge, color: C.textSub, border: `1px solid ${C.border}` }}
            >
              OUTPUT
            </span>
            <span className="text-[10px] font-mono truncate" style={{ color: C.textMuted }}>
              {filename}
            </span>
          </div>

          {/* Video player */}
          <VideoPreview src={downloadUrl} />

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-1">
            <a
              href={downloadUrl}
              download={filename}
              onClick={() => playSound(Snd.SOUNDS.CELEBRATION)}
              className="flex-1 inline-flex items-center justify-center gap-2 font-semibold px-6 py-4 rounded-lg transition-colors text-sm"
              style={{ background: C.accent, color: C.card }}
              onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = C.accentHov)}
              onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = C.accent)}
            >
              <Download size={15} />
              ダウンロード
            </a>
            <button
              onClick={onReset}
              className="inline-flex items-center gap-2 px-6 py-4 rounded-lg font-medium transition-colors text-sm"
              style={{ border: `1px solid ${C.border}`, color: C.textSub, background: "transparent" }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = C.accent)}
              onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
            >
              <RotateCcw size={14} />
              新しい創作
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
