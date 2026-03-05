interface StepperProps {
  hasFiles: boolean;
  hasInstruction: boolean;
  hasModel: boolean;
  isSubmitted: boolean;
}

const STEPS = [
  { label: "ファイル選択", sublabel: "任意" },
  { label: "創作指示" },
  { label: "モデル選択", sublabel: "任意" },
  { label: "生成" },
] as const;

const C = {
  accent:    "#8B5E34",
  textSub:   "#8A7D6A",
  textMuted: "#B8AC9C",
  border:    "#D4C9B5",
  card:      "#F3EDE1",
} as const;

export function Stepper({ hasFiles, hasInstruction, hasModel, isSubmitted }: StepperProps) {
  // 各ステップの完了状態
  const completed = [
    hasFiles,
    hasInstruction,
    hasModel,
    isSubmitted,
  ];

  // アクティブステップ: 最初の未完了のインデックス（ただし最大 3）
  const activeIndex = isSubmitted ? 3 : hasInstruction ? 2 : hasFiles ? 1 : 0;

  return (
    <div className="flex items-center justify-center gap-0 px-4 pb-2 flex-shrink-0">
      {STEPS.map((s, i) => {
        const isDone    = completed[i];
        const isActive  = !isDone && i === activeIndex;
        const isFuture  = !isDone && i > activeIndex;

        return (
          <div key={i} className="flex items-center">
            {/* ステップ丸 */}
            <div className="flex flex-col items-center gap-0.5">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all"
                style={{
                  background: isDone
                    ? C.accent
                    : isActive
                    ? C.accent
                    : "transparent",
                  border: isFuture ? `1.5px solid ${C.border}` : `1.5px solid ${C.accent}`,
                  color: isDone || isActive ? C.card : C.textMuted,
                  fontSize: "10px",
                }}
              >
                {isDone ? "✓" : i + 1}
              </div>
              <div className="flex flex-col items-center leading-none">
                <span
                  className="text-[10px] font-medium whitespace-nowrap"
                  style={{ color: isFuture ? C.textMuted : C.textSub }}
                >
                  {s.label}
                </span>
                {"sublabel" in s && (
                  <span className="text-[9px]" style={{ color: C.textMuted }}>
                    {s.sublabel}
                  </span>
                )}
              </div>
            </div>

            {/* コネクタ線 */}
            {i < STEPS.length - 1 && (
              <div
                className="w-12 h-px mx-1 mb-4 flex-shrink-0 transition-all"
                style={{ background: completed[i] ? C.accent : C.border }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
