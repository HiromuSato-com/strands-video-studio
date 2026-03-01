import { PenLine } from "lucide-react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const EXAMPLES = [
  { text: "最初の10秒をトリミングして", color: "bg-pink-50 hover:bg-pink-100 text-pink-600 border-pink-200" },
  { text: "夕焼けの富士山の動画を生成して", color: "bg-violet-50 hover:bg-violet-100 text-violet-600 border-violet-200" },
  { text: "video1とvideo2を結合して", color: "bg-emerald-50 hover:bg-emerald-100 text-emerald-600 border-emerald-200" },
  { text: "5秒から15秒に画像を挿入して", color: "bg-amber-50 hover:bg-amber-100 text-amber-600 border-amber-200" },
];

export function InstructionBox({ value, onChange, disabled }: Props) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1.5 text-sm font-medium text-violet-600">
        <PenLine size={14} />
        創作指示
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={3}
        placeholder="例: 夕焼けの富士山の動画を生成して"
        className="w-full rounded-2xl border border-lavender-200 px-4 py-3 text-sm text-violet-800 placeholder-violet-200 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-300 disabled:opacity-50 disabled:bg-lavender-50 resize-none bg-white/80"
      />
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.text}
            type="button"
            disabled={disabled}
            onClick={() => onChange(ex.text)}
            className={`text-xs rounded-full px-3 py-1.5 border transition-colors disabled:opacity-50 ${ex.color}`}
          >
            {ex.text}
          </button>
        ))}
      </div>
    </div>
  );
}
