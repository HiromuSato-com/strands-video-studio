import { useState } from "react";

const STORAGE_KEY = "welcome_shown_v1";

const C = {
  bg:          "#121008",
  card:        "#F3EDE1",
  border:      "#D4C9B5",
  accent:      "#8B5E34",
  accentHover: "#7D5530",
  textMain:    "#1C1810",
  textSub:     "#8A7D6A",
  textMuted:   "#B8AC9C",
  badge:       "#EDE4D4",
} as const;

const SLIDES = [
  {
    title: "AI 創作スタジオへようこそ 🎬",
    content: (
      <ul className="space-y-2 text-sm text-left list-none">
        <li>🎞️ <strong>動画編集</strong> — トリミング・結合・テロップ・音声など 15 種以上</li>
        <li>✨ <strong>AI 動画生成</strong> — テキストから Luma AI / Nova Reel で動画を生成</li>
        <li>🖼️ <strong>画像・音声生成</strong> — Stable Diffusion / Amazon Polly で素材を作成</li>
      </ul>
    ),
  },
  {
    title: "3ステップで動画が完成します",
    content: (
      <ol className="space-y-3 text-sm text-left">
        <li className="flex items-start gap-3">
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{ background: C.accent, color: C.card }}>1</span>
          <div>
            <p className="font-medium" style={{ color: C.textMain }}>指示を入力</p>
            <p className="text-xs mt-0.5" style={{ color: C.textSub }}>何を作りたいか自由に書くか、サンプルを選ぶ</p>
          </div>
        </li>
        <li className="flex items-start gap-3">
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{ background: C.accent, color: C.card }}>2</span>
          <div>
            <p className="font-medium" style={{ color: C.textMain }}>モデルを選ぶ（任意）</p>
            <p className="text-xs mt-0.5" style={{ color: C.textSub }}>AI 動画生成を使う場合はモデルを選択</p>
          </div>
        </li>
        <li className="flex items-start gap-3">
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{ background: C.accent, color: C.card }}>3</span>
          <div>
            <p className="font-medium" style={{ color: C.textMain }}>生成開始</p>
            <p className="text-xs mt-0.5" style={{ color: C.textSub }}>「創作を開始」ボタンで処理を実行</p>
          </div>
        </li>
      </ol>
    ),
  },
  {
    title: "さっそく試してみましょう！",
    content: (
      <div className="text-sm text-center space-y-3" style={{ color: C.textSub }}>
        <p>創作指示欄にやりたいことを入力するだけで</p>
        <p>AI が最適なツールを選んで動画を仕上げます。</p>
        <p className="text-xs mt-2" style={{ color: C.textMuted }}>
          ファイルがなくてもテキストだけで動画生成できます
        </p>
      </div>
    ),
  },
] as const;

interface Props {
  onClose: () => void;
}

export function WelcomeModal({ onClose }: Props) {
  const [slide, setSlide] = useState(0);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    onClose();
  };

  const next = () => {
    if (slide < SLIDES.length - 1) setSlide(slide + 1);
    else dismiss();
  };

  const current = SLIDES[slide];
  const isLast = slide === SLIDES.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(6,4,2,0.75)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="relative rounded-2xl shadow-2xl w-[420px] max-w-[92vw] p-8 flex flex-col gap-5"
        style={{ background: C.card, border: `1px solid ${C.border}` }}
      >
        {/* タイトル */}
        <h2 className="text-xl font-semibold text-center leading-snug" style={{ color: C.textMain }}>
          {current.title}
        </h2>

        {/* コンテンツ */}
        <div style={{ color: C.textSub }}>{current.content}</div>

        {/* ドットインジケーター */}
        <div className="flex justify-center gap-1.5">
          {SLIDES.map((_, i) => (
            <div
              key={i}
              className="rounded-full transition-all"
              style={{
                width: i === slide ? "20px" : "6px",
                height: "6px",
                background: i === slide ? C.accent : C.border,
              }}
            />
          ))}
        </div>

        {/* ボタン */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={dismiss}
            className="text-xs px-4 py-2 rounded-lg transition-colors"
            style={{ color: C.textMuted, border: `1px solid ${C.border}` }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = C.accent)}
            onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
          >
            スキップ
          </button>
          <button
            type="button"
            onClick={next}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-all"
            style={{ background: C.accent, color: C.card }}
            onMouseEnter={e => (e.currentTarget.style.background = C.accentHover)}
            onMouseLeave={e => (e.currentTarget.style.background = C.accent)}
          >
            {isLast ? "はじめる" : "次へ →"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function shouldShowWelcome(): boolean {
  return !localStorage.getItem(STORAGE_KEY);
}
