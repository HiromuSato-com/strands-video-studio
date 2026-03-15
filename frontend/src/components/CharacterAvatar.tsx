import { Live2DAvatar } from "./Live2DAvatar";

export type CharacterState =
  | "idle"
  | "thinking"
  | "working"
  | "complete"
  | "error"
  | "uploading"   // S3アップロード中
  | "chatting"    // AIチャット応答中
  | "greeting"    // ファイルドロップ直後（2秒間）
  | "waiting";    // WAITING_APPROVAL — ユーザーを待っている

interface Props {
  state: CharacterState;
  size?: number;
}

const GLOW: Record<CharacterState, string> = {
  idle:      "drop-shadow(0 0 18px rgba(192,132,252,0.28))",
  thinking:  "drop-shadow(0 0 14px rgba(147,197,253,0.40))",
  working:   "drop-shadow(0 0 20px rgba(192,132,252,0.42))",
  complete:  "drop-shadow(0 0 36px rgba(251,191,36,0.80))",
  error:     "drop-shadow(0 0 16px rgba(239,68,68,0.48))",
  uploading: "drop-shadow(0 0 22px rgba(192,132,252,0.55))",
  chatting:  "drop-shadow(0 0 14px rgba(147,197,253,0.40))",
  greeting:  "drop-shadow(0 0 30px rgba(251,191,36,0.65))",
  waiting:   "drop-shadow(0 0 18px rgba(147,197,253,0.52))",
};

export function CharacterAvatar({ state, size = 320 }: Props) {
  // Two cats side by side → use wider canvas
  const w = Math.round(size * 1.6);
  const h = Math.round(size * 1.1);

  return (
    <div
      style={{ filter: GLOW[state], transition: "filter 0.8s ease", display: "inline-block" }}
    >
      <Live2DAvatar state={state} width={w} height={h} />
    </div>
  );
}
