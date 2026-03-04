import { CheckCheck, X } from "lucide-react";

const C = {
  card:        "#F3EDE1",
  border:      "#D4C9B5",
  accent:      "#9B6B3A",
  accentHover: "#7D5530",
  textMain:    "#1C1810",
  textSub:     "#8A7D6A",
  textMuted:   "#B8AC9C",
  aiBg:        "#EDE4D4",
  badge:       "#EDE4D4",
  badgeText:   "#6B5440",
} as const;

interface Props {
  instruction: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ChatPreviewModal({ instruction, onConfirm, onCancel }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(6,4,2,0.78)" }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="w-full max-w-lg rounded-xl shadow-2xl overflow-hidden"
        style={{ background: C.card, border: `1px solid ${C.border}` }}
      >
        {/* Header stripe */}
        <div style={{ height: "3px", background: `linear-gradient(90deg, ${C.accent} 0%, #D4A96A 55%, ${C.accent} 100%)` }} />

        <div className="p-5">
          {/* Title row */}
          <div className="flex items-start justify-between mb-1">
            <div>
              <h2 className="text-sm font-semibold" style={{ color: C.textMain }}>
                指示プレビュー
              </h2>
              <p className="text-xs mt-0.5" style={{ color: C.textSub }}>
                以下の内容で指示欄を上書きします。確認してから反映してください。
              </p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="p-1 rounded transition-colors flex-shrink-0"
              style={{ color: C.textMuted }}
              onMouseEnter={e => (e.currentTarget.style.color = C.accent)}
              onMouseLeave={e => (e.currentTarget.style.color = C.textMuted)}
            >
              <X size={15} />
            </button>
          </div>

          {/* Instruction preview box */}
          <div
            className="mt-4 rounded-lg px-4 py-3 max-h-56 overflow-y-auto"
            style={{ background: C.aiBg, border: `1px solid ${C.border}` }}
          >
            <p
              className="text-sm leading-relaxed whitespace-pre-wrap"
              style={{ color: C.textMain }}
            >
              {instruction}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 mt-5">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-2 rounded-lg text-xs font-medium transition-colors"
              style={{
                border: `1px solid ${C.border}`,
                color: C.textSub,
                background: "transparent",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textSub; }}
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="flex-[2] py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
              style={{ background: C.accent, color: "#FFF" }}
              onMouseEnter={e => (e.currentTarget.style.background = C.accentHover)}
              onMouseLeave={e => (e.currentTarget.style.background = C.accent)}
            >
              <CheckCheck size={13} />
              確定して指示欄に反映
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
