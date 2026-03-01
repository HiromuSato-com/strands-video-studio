import { useEffect } from "react";
import { X, Download, RotateCcw, Sparkles, Star } from "lucide-react";
import { VideoPreview } from "./VideoPreview";

interface Props {
  downloadUrl: string;
  outputKey: string;
  onClose: () => void;
  onReset: () => void;
}

export function CompletionModal({ downloadUrl, outputKey, onClose, onReset }: Props) {
  const filename = outputKey.split("/").pop() ?? "output.mp4";

  // body スクロールをロック
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Escape キーで閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-modal-backdrop">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Modal card */}
      <div className="relative z-10 w-full max-w-2xl bg-white/96 backdrop-blur-sm rounded-3xl shadow-2xl shadow-violet-900/25 border border-violet-100 overflow-hidden animate-modal-in">

        {/* ── Celebration header ── */}
        <div className="relative overflow-hidden bg-gradient-to-r from-violet-600 via-pink-500 to-amber-400 px-6 py-5">
          {/* Decorative floating sparkles */}
          <span className="absolute top-2 right-14 text-white/40 animate-float-sparkle" style={{ animationDelay: "0s" }}>
            <Star size={10} fill="currentColor" />
          </span>
          <span className="absolute bottom-2 right-24 text-white/30 animate-float-sparkle" style={{ animationDelay: "0.7s" }}>
            <Star size={7} fill="currentColor" />
          </span>
          <span className="absolute top-3 left-32 text-white/25 animate-float-sparkle" style={{ animationDelay: "1.2s" }}>
            <Star size={8} fill="currentColor" />
          </span>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-2xl bg-white/20 flex items-center justify-center backdrop-blur-sm">
                <Sparkles size={18} className="text-white animate-pulse" />
              </div>
              <div>
                <p className="text-white/70 text-xs tracking-widest uppercase font-medium">Complete</p>
                <h2 className="text-white font-bold text-xl leading-tight">動画が完成しました！</h2>
              </div>
            </div>

            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/35 text-white transition-all hover:rotate-90 duration-200"
              aria-label="閉じる"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Content ── */}
        <div className="p-5 space-y-4 bg-gradient-to-b from-violet-50/40 to-white">
          {/* Mac-style window dots */}
          <div className="flex items-center gap-1.5 -mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-300" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-300" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-300" />
            <span className="ml-2 text-xs text-violet-300 font-mono">{filename}</span>
          </div>

          {/* Video player */}
          <VideoPreview src={downloadUrl} />

          {/* Action buttons */}
          <div className="flex gap-3 pt-1">
            <a
              href={downloadUrl}
              download={filename}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-600 hover:to-teal-500 text-white font-semibold px-5 py-3 rounded-2xl transition-all shadow-lg shadow-emerald-200/60 hover:shadow-emerald-300/60 hover:-translate-y-0.5 active:translate-y-0 duration-150"
            >
              <Download size={16} />
              ダウンロード
            </a>
            <button
              onClick={onReset}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl border border-violet-200 bg-white hover:bg-violet-50 text-violet-600 font-medium transition-all hover:-translate-y-0.5 active:translate-y-0 duration-150 shadow-sm"
            >
              <RotateCcw size={15} />
              新しい創作
            </button>
          </div>
        </div>

        {/* Bottom gradient accent */}
        <div className="h-1 bg-gradient-to-r from-violet-400 via-pink-400 to-amber-300" />
      </div>
    </div>
  );
}
