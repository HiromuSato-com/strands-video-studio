import { useState, useCallback, useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { Film, PenLine, Activity, Sparkles, Palette, Loader, Clapperboard, MessageSquare, Edit3 } from "lucide-react";
import { UploadZone } from "./components/UploadZone";
import { InstructionBox } from "./components/InstructionBox";
import { TaskStatus } from "./components/TaskStatus";
import { CompletionModal } from "./components/CompletionModal";
import { ChatModal } from "./components/ChatModal";
import { ChatPreviewModal } from "./components/ChatPreviewModal";
import { Stepper } from "./components/Stepper";
import { WelcomeModal, shouldShowWelcome } from "./components/WelcomeModal";
import { useTaskPoller } from "./hooks/useTaskPoller";
import {
  getUploadUrl,
  uploadFileToS3,
  createTask,
  getDownloadUrl,
  sendChatMessage,
  confirmChat,
} from "./api/client";
import type { ChatMessage } from "./types";
import { playSound, Snd } from "./lib/snd";

type AppStep = "idle" | "uploading" | "submitted";
type VideoModel = "luma" | "nova_reel" | "none";

interface UploadProgress {
  filename: string;
  percent: number;
}

// 色の定数 — 素材感のある温かいパレット
const C = {
  bg:          "#121008",  // 深い琥珀の暗闇
  card:        "#F3EDE1",  // リネン
  border:      "#D4C9B5",  // 砂
  accent:      "#8B5E34",  // コニャック（濃くしてコントラスト改善）
  accentHover: "#7D5530",
  accentDisabled: "#C4B8A8",  // disabled 状態用グレー
  textMain:    "#1C1810",  // 温かい黒
  textSub:     "#8A7D6A",  // 温かい中間
  textMuted:   "#B8AC9C",  // 温かい薄
  badge:       "#EDE4D4",  // 薄い砂
  badgeText:   "#6B5440",
} as const;

const STEP_LABELS = [
  { num: "1", label: "ファイルを選択", icon: Film       },
  { num: "2", label: "創作指示を入力", icon: PenLine    },
  { num: "3", label: "処理状況",       icon: Activity   },
  { num: "4", label: "結果プレビュー", icon: Sparkles   },
] as const;

export default function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [instruction, setInstruction] = useState("");
  const [videoModel, setVideoModel] = useState<VideoModel>("none");
  const [step, setStep] = useState<AppStep>("idle");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadKey, setDownloadKey] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  const [showChatModal, setShowChatModal] = useState(false);
  const [chatSessionId, setChatSessionId] = useState<string>(() => uuidv4());
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [previewInstruction, setPreviewInstruction] = useState<string | null>(null);

  // ウェルカムモーダル（初回のみ）
  const [showWelcome, setShowWelcome] = useState<boolean>(() => shouldShowWelcome());

  // 指示入力エリアへのフォーカス ref（スキップリンク用）
  const instructionRef = useRef<HTMLDivElement>(null);

  const { task, error: pollingError } = useTaskPoller(taskId);

  // サウンド — タスクステータス変化を検知して再生
  const prevStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!task || task.status === prevStatusRef.current) return;
    prevStatusRef.current = task.status;
    if (task.status === "RUNNING")    playSound(Snd.SOUNDS.NOTIFICATION);
    if (task.status === "COMPLETED")  playSound(Snd.SOUNDS.CELEBRATION);
    if (task.status === "FAILED")     playSound(Snd.SOUNDS.CAUTION);
  }, [task?.status]);

  const handleCompleted = useCallback(
    async (completedTaskId: string) => {
      if (downloadUrl) return;
      try {
        const res = await getDownloadUrl(completedTaskId);
        setDownloadUrl(res.download_url);
        setDownloadKey(res.output_key);
        setShowModal(true);
      } catch (e) {
        console.error("Failed to get download URL", e);
      }
    },
    [downloadUrl]
  );

  if (task?.status === "COMPLETED" && !downloadUrl && taskId) {
    handleCompleted(taskId);
  }

  const handleSubmit = async () => {
    if (!instruction.trim()) {
      playSound(Snd.SOUNDS.CAUTION);
      setSubmitError("創作指示を入力してください");
      return;
    }
    playSound(Snd.SOUNDS.BUTTON);
    setSubmitError(null);
    setStep("uploading");
    setDownloadUrl(null);
    setDownloadKey(null);
    setShowModal(false);

    const newTaskId = uuidv4();
    try {
      const initialProgress = files.map((f) => ({ filename: f.name, percent: 0 }));
      setUploadProgress(initialProgress);

      const inputKeys = await Promise.all(
        files.map(async (file, i) => {
          const { upload_url, key } = await getUploadUrl(newTaskId, file.name);
          await uploadFileToS3(upload_url, file, (percent) => {
            setUploadProgress((prev) =>
              prev.map((p, idx) => (idx === i ? { ...p, percent } : p))
            );
          });
          return key;
        })
      );

      const { task_id } = await createTask(newTaskId, instruction, inputKeys, videoModel);
      setTaskId(task_id);
      setStep("submitted");
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "送信中にエラーが発生しました");
      setStep("idle");
    }
  };

  const handleChatSend = async (message: string) => {
    // 送信直後にユーザーメッセージを即時表示（楽観的更新）
    setChatMessages(prev => [...prev, { role: "user", content: message }]);
    setChatLoading(true);
    try {
      const res = await sendChatMessage(chatSessionId, message);
      setChatMessages(res.messages);
    } catch (e) {
      console.error(e);
      // 失敗時は楽観的に追加したメッセージを取り消す
      setChatMessages(prev => prev.slice(0, -1));
    } finally {
      setChatLoading(false);
    }
  };

  const handleChatConfirm = async () => {
    setChatLoading(true);
    try {
      const res = await confirmChat(chatSessionId);
      setShowChatModal(false);
      setPreviewInstruction(res.instruction);
    } catch (e) {
      console.error(e);
    } finally {
      setChatLoading(false);
    }
  };

  const handlePreviewConfirm = () => {
    if (previewInstruction) {
      setInstruction(previewInstruction);
      playSound(Snd.SOUNDS.CELEBRATION);
    }
    setPreviewInstruction(null);
  };

  const handleChatReset = () => {
    setChatSessionId(uuidv4());
    setChatMessages([]);
    playSound(Snd.SOUNDS.TAP);
  };

  const handleReset = () => {
    playSound(Snd.SOUNDS.TAP);
    setFiles([]);
    setInstruction("");
    setVideoModel("none");
    setStep("idle");
    setTaskId(null);
    setUploadProgress([]);
    setSubmitError(null);
    setDownloadUrl(null);
    setDownloadKey(null);
    setShowModal(false);
    setChatSessionId(uuidv4());
    setChatMessages([]);
    setShowChatModal(false);
    setChatLoading(false);
  };

  const StepBadge = ({ index }: { index: number }) => {
    const s = STEP_LABELS[index];
    const Icon = s.icon;
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full self-start"
        style={{ background: C.badge, color: C.badgeText, border: `1px solid ${C.border}` }}
      >
        <Icon size={12} />
        {s.num}. {s.label}
      </span>
    );
  };

  const isSubmitDisabled = !instruction.trim();

  return (
    <div className="h-screen flex flex-col overflow-y-hidden luxury-bg">

      {/* ウェルカムモーダル（初回のみ） */}
      {showWelcome && (
        <WelcomeModal onClose={() => setShowWelcome(false)} />
      )}


      {/* 指示プレビューモーダル */}
      {previewInstruction !== null && (
        <ChatPreviewModal
          instruction={previewInstruction}
          onConfirm={handlePreviewConfirm}
          onCancel={() => setPreviewInstruction(null)}
        />
      )}

      {/* 完成モーダル */}
      {showModal && downloadUrl && downloadKey && (
        <CompletionModal
          downloadUrl={downloadUrl}
          outputKey={downloadKey}
          onClose={() => setShowModal(false)}
          onReset={handleReset}
        />
      )}

      {/* チャットモーダル */}
      {showChatModal && (
        <ChatModal
          messages={chatMessages}
          onSend={handleChatSend}
          onConfirm={handleChatConfirm}
          onReset={handleChatReset}
          isLoading={chatLoading}
          onClose={() => setShowChatModal(false)}
        />
      )}

      {/* Header — 1行 */}
      <div
        className="flex items-center justify-between px-6 py-1.5 flex-shrink-0"
        style={{ borderBottom: `1px solid #2A2318` }}
      >
        <h1 className="font-klee text-lg font-semibold" style={{ color: C.card, letterSpacing: "0.06em" }}>
          AI 創作スタジオ
        </h1>
        <p className="text-[10px] flex items-center gap-1.5" style={{ color: "#4A3F30" }}>
          <Palette size={10} />
          Strands Agents · Claude Sonnet · Bedrock · ECS Fargate
        </p>
      </div>

      {/* Stepper — ヘッダーとカードの間 */}
      {step === "idle" && (
        <div className="flex-shrink-0 pt-2">
          <Stepper
            hasFiles={files.length > 0}
            hasInstruction={instruction.trim().length > 0}
            hasModel={videoModel !== "none"}
            isSubmitted={false}
          />
        </div>
      )}

      {/* Main container */}
      <div className="max-w-7xl w-full mx-auto flex-1 overflow-hidden px-4 pb-3 pt-1">
        {/* Card — リネン */}
        <div
          className="p-3 h-full flex flex-col rounded-xl shadow-2xl"
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            boxShadow: `0 24px 60px rgba(6,4,2,0.7)`,
          }}
        >

          {step === "idle" ? (
            <div className="flex-1 overflow-hidden grid grid-cols-[1.4fr_2fr_1.3fr] gap-3 min-h-0">

              {/* 左カラム — ファイル選択 */}
              <div className="flex flex-col gap-3 min-h-0 min-w-0">
                <div className="flex items-center gap-2 flex-shrink-0">
                  <StepBadge index={0} />
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                    style={{ background: C.badge, color: C.textMuted, border: `1px solid ${C.border}` }}
                  >
                    任意
                  </span>
                </div>
                <UploadZone onFilesSelected={setFiles} disabled={false} className="flex-1 min-h-0" />
                {files.length === 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      instructionRef.current?.querySelector("textarea")?.focus();
                    }}
                    className="text-xs underline self-start transition-colors flex-shrink-0"
                    style={{ color: C.textMuted }}
                    onMouseEnter={e => (e.currentTarget.style.color = C.accent)}
                    onMouseLeave={e => (e.currentTarget.style.color = C.textMuted)}
                  >
                    スキップ（テキストから生成）
                  </button>
                )}
              </div>

              {/* 中カラム — 指示入力 */}
              <div
                ref={instructionRef}
                className="flex flex-col gap-3 min-h-0 min-w-0 px-4"
                style={{ borderLeft: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}` }}
              >
                {/* モード切替セグメント */}
                <div
                  className="flex rounded-lg overflow-hidden flex-shrink-0"
                  style={{ border: `1px solid ${C.border}` }}
                >
                  <button
                    type="button"
                    onClick={() => setShowChatModal(false)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors"
                    style={{
                      background: !showChatModal ? C.accent : "transparent",
                      color: !showChatModal ? C.card : C.textSub,
                    }}
                  >
                    <Edit3 size={11} />
                    直接入力
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowChatModal(true)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors"
                    style={{
                      background: showChatModal ? C.accent : "transparent",
                      color: showChatModal ? C.card : C.textSub,
                      borderLeft: `1px solid ${C.border}`,
                    }}
                  >
                    <MessageSquare size={11} />
                    AIと相談しながら作成
                  </button>
                </div>

                <div className="flex-1 min-h-0 flex flex-col">
                  <InstructionBox
                    value={instruction}
                    onChange={setInstruction}
                    disabled={false}
                    hasFiles={files.length > 0}
                  />
                </div>
              </div>

              {/* 右カラム — モデル選択 + 送信 */}
              <div className="flex flex-col gap-3 min-h-0 min-w-0">
                <div className="flex flex-col gap-1.5 flex-shrink-0">
                  <label className="text-xs flex items-center gap-1.5" style={{ color: C.textSub }}>
                    <Clapperboard size={12} />
                    AI動画生成モデル
                  </label>
                  <select
                    value={videoModel}
                    onChange={e => {
                      const v = e.target.value as VideoModel;
                      if (videoModel !== v) playSound(Snd.SOUNDS.TOGGLE_ON);
                      setVideoModel(v);
                    }}
                    className="w-full rounded-lg px-3 py-2 text-xs outline-none cursor-pointer transition-colors"
                    style={{
                      background: C.card,
                      border: `1px solid ${C.border}`,
                      color: C.textMain,
                      appearance: "none",
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238A7D6A' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "right 10px center",
                      paddingRight: "28px",
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = C.accent)}
                    onBlur={e => (e.currentTarget.style.borderColor = C.border)}
                  >
                    <option value="none">使用しない</option>
                    <option value="luma">Luma AI Ray 2</option>
                    <option value="nova_reel">Amazon Nova Reel</option>
                  </select>

                  {/* モデル情報パネル */}
                  {videoModel !== "none" && (
                    <div
                      className="rounded-lg p-2.5 space-y-1.5 flex-shrink-0"
                      style={{ background: C.badge, border: `1px solid ${C.border}` }}
                    >
                      {videoModel === "luma" && (
                        <>
                          <p className="text-[10px] font-semibold" style={{ color: C.accent }}>
                            🎬 Luma AI Ray 2 の特徴
                          </p>
                          <ul className="space-y-1 text-[10px] leading-relaxed" style={{ color: C.textSub }}>
                            <li>✦ 流体・煙・滝など複雑な物理現象を高精度にレンダリング</li>
                            <li>✦ 人物の微妙な表情・手の動き・自然なボディランゲージの再現に優れる</li>
                            <li>✦ スケール・遠近法・細部まで忠実に映像化する高い指示実行能力</li>
                            <li>✦ プロモーション動画・製品モックアップ・VFX プレビズに最適</li>
                          </ul>
                          <p className="text-[9px] pt-0.5" style={{ color: C.textMuted }}>
                            5s / 9s　540p〜720p　生成: 約2〜8分
                          </p>
                        </>
                      )}
                      {videoModel === "nova_reel" && (
                        <>
                          <p className="text-[10px] font-semibold" style={{ color: C.accent }}>
                            🎬 Amazon Nova Reel の特徴
                          </p>
                          <ul className="space-y-1 text-[10px] leading-relaxed" style={{ color: C.textSub }}>
                            <li>✦ カメラアングル・動きのコントロールが優れており、テンポ感のある映像演出が可能</li>
                            <li>✦ ロゴやビジュアルアイデンティティをシーン全体で一貫して保持し、ブランド動画制作に強い</li>
                            <li>✦ 製品中心のナラティブや企業ブランドのストーリーテリングに最適</li>
                            <li>✦ 短尺シーンを低コストで量産でき、ストーリーボード検討の反復に向く</li>
                          </ul>
                          <p className="text-[9px] pt-0.5" style={{ color: C.textMuted }}>
                            最大6s（〜120s）　1280×720固定　生成: 約90秒〜
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {submitError && (
                  <p className="text-xs border px-3 py-2 rounded-lg flex-shrink-0" style={{ color: "#9B2C2C", background: "#FFF5F5", borderColor: "#FEB2B2" }}>
                    {submitError}
                  </p>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={isSubmitDisabled}
                  title={isSubmitDisabled ? "創作指示を入力してください" : undefined}
                  className="mt-auto w-full font-medium py-3 rounded-lg flex items-center justify-center gap-2 text-sm flex-shrink-0"
                  style={{
                    background: isSubmitDisabled ? C.accentDisabled : C.accent,
                    color: C.card,
                    cursor: isSubmitDisabled ? "not-allowed" : "pointer",
                    transition: "background 0.15s, transform 0.15s",
                  }}
                  onMouseEnter={e => {
                    if (!isSubmitDisabled) {
                      e.currentTarget.style.background = C.accentHover;
                      e.currentTarget.style.transform = "scale(1.02)";
                    }
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = isSubmitDisabled ? C.accentDisabled : C.accent;
                    e.currentTarget.style.transform = "scale(1)";
                  }}
                >
                  <Sparkles size={16} />
                  創作を開始
                </button>
              </div>
            </div>

          ) : (
            <>
              {/* 送信内容サマリー */}
              <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
                {/* Cartridge stripe */}
                <div style={{ height: "3px", background: `linear-gradient(90deg, ${C.accent} 0%, #D4A96A 55%, ${C.accent} 100%)` }} />
                <div className="p-4" style={{ background: "#EDE4D4" }}>
                <p className="text-[10px] font-mono tracking-[0.15em] uppercase mb-2" style={{ color: C.textMuted }}>
                  送信した創作内容
                </p>
                <p className="text-sm leading-snug" style={{ color: C.textMain }}>
                  {instruction.length > 100 ? instruction.slice(0, 100) + "…" : instruction}
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-2.5">
                  {files.map((f) => (
                    <span
                      key={f.name}
                      className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full"
                      style={{ background: C.card, border: `1px solid ${C.border}`, color: C.textSub }}
                    >
                      <Film size={9} />
                      {f.name}
                    </span>
                  ))}
                  {videoModel !== "none" && (
                    <span className="text-[10px]" style={{ color: C.textMuted }}>
                      {videoModel === "luma" ? "Luma AI Ray 2" : "Amazon Nova Reel"}
                    </span>
                  )}
                </div>
                </div>
              </div>

              {step === "uploading" && uploadProgress.length > 0 && (
                <div className="space-y-2 mt-4">
                  {uploadProgress.map((p) => (
                    <div key={p.filename}>
                      <div className="flex justify-between text-xs mb-1 font-mono" style={{ color: C.textSub }}>
                        <span className="truncate">{p.filename}</span>
                        <span>{p.percent}%</span>
                      </div>
                      <div className="w-full h-1.5 rounded-sm" style={{ background: "rgba(28,24,16,0.1)" }}>
                        <div
                          className="h-1.5 rounded-sm transition-all duration-300"
                          style={{ width: `${p.percent}%`, background: C.accent }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {step === "uploading" && uploadProgress.length === 0 && (
                <div className="flex items-center gap-2 py-1 mt-4 font-mono text-xs tracking-widest uppercase" style={{ color: C.textSub }}>
                  <Loader size={13} className="animate-spin" />
                  UPLOADING...
                </div>
              )}

              {step === "submitted" && !task && (
                <div className="flex items-center gap-2 py-1 mt-4 font-mono text-xs tracking-widest uppercase" style={{ color: C.textSub }}>
                  <Loader size={13} className="animate-spin" />
                  INITIALIZING...
                </div>
              )}

              {task && (
                <div className="space-y-3 mt-4">
                  <StepBadge index={2} />
                  <TaskStatus task={task} pollingError={pollingError} />

                  {task.status === "COMPLETED" && downloadUrl && !showModal && (
                    <button
                      onClick={() => setShowModal(true)}
                      className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-lg text-xs font-mono font-medium tracking-wider transition-all"
                      style={{ border: `1px solid ${C.accent}`, color: C.accent, background: "transparent" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(139,94,52,0.08)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    >
                      <Sparkles size={12} />
                      ▶ プレビューを再表示
                    </button>
                  )}
                </div>
              )}

              {(task?.status === "COMPLETED" || task?.status === "FAILED") && (
                <button
                  onClick={handleReset}
                  className="w-full mt-3 inline-flex items-center justify-center gap-2 py-3 rounded-lg text-xs font-mono font-medium tracking-wider transition-all"
                  style={{ border: `1px solid ${C.border}`, color: C.textSub, background: "transparent" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textSub; }}
                >
                  ↩ リセット
                </button>
              )}
            </>
          )}
        </div>
      </div>

    </div>
  );
}
