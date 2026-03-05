import { PenLine } from "lucide-react";
import { playSound, Snd } from "../lib/snd";

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  hasFiles?: boolean;
}

const EDIT_EXAMPLES = [
  "最初の10秒をトリミングして",
  "video1とvideo2を結合して",
  "動画にテロップを追加して",
];

const GEN_EXAMPLES = [
  "夕焼けの富士山の動画を5秒生成して",
  "桜吹雪のスローモーション動画を作って",
  "5秒から15秒に画像を挿入して",
];

const C = {
  border:    "#D4C9B5",
  textMain:  "#1C1810",
  textSub:   "#8A7D6A",
  textMuted: "#B8AC9C",
  badge:     "#EDE4D4",
  badgeText: "#6B5440",
} as const;

export function InstructionBox({ value, onChange, disabled, hasFiles }: Props) {
  const examples = hasFiles
    ? [...EDIT_EXAMPLES, ...GEN_EXAMPLES]
    : [...GEN_EXAMPLES, ...EDIT_EXAMPLES];

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1.5 text-xs font-medium" style={{ color: C.textSub }}>
        <PenLine size={12} />
        創作指示
      </label>
      <p className="text-xs leading-relaxed" style={{ color: C.textMuted }}>
        何を作りたいか自由に書いてください
      </p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={3}
        placeholder="例: 夕焼けの富士山を背景に桜が舞う5秒の動画を生成して"
        className="w-full rounded-lg px-3 py-2.5 text-sm disabled:opacity-50 resize-none transition-all focus:outline-none"
        style={{
          background: "rgba(255,255,255,0.6)",
          border: `1px solid ${C.border}`,
          color: C.textMain,
        }}
        onFocus={e => (e.currentTarget.style.borderColor = "#9B6B3A")}
        onBlur={e => (e.currentTarget.style.borderColor = C.border)}
      />
      <p className="text-[10px]" style={{ color: C.textMuted }}>↓ クリックで入力できます</p>
      <div className="flex gap-1.5 overflow-x-auto pb-1 flex-nowrap">
        {examples.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={disabled}
            onClick={() => { playSound(Snd.SOUNDS.SELECT); onChange(ex); }}
            className="text-xs px-3 py-1.5 rounded-full transition-colors disabled:opacity-50 whitespace-nowrap flex-shrink-0"
            style={{ background: C.badge, color: C.badgeText, border: `1px solid ${C.border}` }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = "#9B6B3A")}
            onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
