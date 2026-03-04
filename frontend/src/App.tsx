import { useState, useCallback, useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { Film, PenLine, Activity, Sparkles, Palette, Loader, Clapperboard, MessageSquare } from "lucide-react";
import { UploadZone } from "./components/UploadZone";
import { InstructionBox } from "./components/InstructionBox";
import { ChatBox } from "./components/ChatBox";
import { TaskStatus } from "./components/TaskStatus";
import { CompletionModal } from "./components/CompletionModal";
import { ChatPreviewModal } from "./components/ChatPreviewModal";
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
type InstructionMode = "direct" | "chat";

interface UploadProgress {
  filename: string;
  percent: number;
}

// 色の定数 — 素材感のある温かいパレット
const C = {
  bg:          "#121008",  // 深い琥珀の暗闇
  card:        "#F3EDE1",  // リネン
  border:      "#D4C9B5",  // 砂
  accent:      "#9B6B3A",  // コニャック
  accentHover: "#7D5530",
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

  const [instructionMode, setInstructionMode] = useState<InstructionMode>("direct");
  const [chatSessionId, setChatSessionId] = useState<string>(() => {
    const stored = localStorage.getItem("chat_session_id");
    if (stored) return stored;
    const id = uuidv4();
    localStorage.setItem("chat_session_id", id);
    return id;
  });
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [previewInstruction, setPreviewInstruction] = useState<string | null>(null);

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
    setChatLoading(true);
    try {
      const res = await sendChatMessage(chatSessionId, message);
      setChatMessages(res.messages);
    } catch (e) {
      console.error(e);
    } finally {
      setChatLoading(false);
    }
  };

  const handleChatConfirm = async () => {
    setChatLoading(true);
    try {
      const res = await confirmChat(chatSessionId);
      setPreviewInstruction(res.instruction); // プレビューモーダルを表示
    } catch (e) {
      console.error(e);
    } finally {
      setChatLoading(false);
    }
  };

  const handlePreviewConfirm = () => {
    if (previewInstruction) {
      setInstruction(previewInstruction);
      setInstructionMode("direct");
      playSound(Snd.SOUNDS.CELEBRATION);
    }
    setPreviewInstruction(null);
  };

  const handleChatReset = () => {
    const newId = uuidv4();
    localStorage.setItem("chat_session_id", newId);
    setChatSessionId(newId);
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
    const newId = uuidv4();
    localStorage.setItem("chat_session_id", newId);
    setChatSessionId(newId);
    setChatMessages([]);
    setInstructionMode("direct");
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

  return (
    <div className="h-screen flex flex-col overflow-y-hidden luxury-bg">

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

      {/* Header */}
      <div className="text-center py-2.5 flex-shrink-0" style={{ borderBottom: `1px solid #2A2318` }}>
        <h1 className="font-klee text-xl font-semibold" style={{ color: C.card, letterSpacing: "0.06em" }}>
          AI 創作スタジオ
        </h1>
        <p className="text-[11px] mt-0.5 flex items-center justify-center gap-1.5" style={{ color: C.textSub }}>
          <Palette size={11} />
          Strands Agents · Claude Sonnet · MoviePy
        </p>
      </div>

      {/* Main container */}
      <div className="max-w-5xl w-full mx-auto flex-1 overflow-hidden px-6 pb-4 pt-3">
        {/* Card — リネン */}
        <div
          className="p-5 h-full flex flex-col rounded-xl shadow-2xl"
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            boxShadow: `0 24px 60px rgba(6,4,2,0.7)`,
          }}
        >

          {step === "idle" ? (
            <div className="flex-1 overflow-hidden grid grid-cols-[2fr_3fr] gap-8">

              {/* 左カラム */}
              <div className="flex flex-col gap-4 min-h-0 min-w-0">
                <StepBadge index={0} />
                <UploadZone onFilesSelected={setFiles} disabled={false} className="flex-1 min-h-0" />
              </div>

              {/* 右カラム */}
              <div className="flex flex-col gap-4 min-h-0 min-w-0 pl-8" style={{ borderLeft: `1px solid ${C.border}` }}>
                <StepBadge index={1} />

                {/* モード切替タブ */}
                <div className="flex rounded-lg overflow-hidden flex-shrink-0" style={{ border: `1px solid ${C.border}` }}>
                  {(["direct", "chat"] as const).map((mode) => {
                    const active = instructionMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setInstructionMode(mode)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium transition-colors"
                        style={{
                          background: active ? C.accent : "transparent",
                          color: active ? "#FFF" : C.textSub,
                        }}
                      >
                        {mode === "direct" ? <PenLine size={11} /> : <MessageSquare size={11} />}
                        {mode === "direct" ? "直接入力" : "AIとチャットで作成"}
                      </button>
                    );
                  })}
                </div>

                <div className="flex-1 min-h-0 flex flex-col">
                  {instructionMode === "direct" ? (
                    <InstructionBox value={instruction} onChange={setInstruction} disabled={false} />
                  ) : (
                    <ChatBox
                      messages={chatMessages}
                      onSend={handleChatSend}
                      onConfirm={handleChatConfirm}
                      onReset={handleChatReset}
                      isLoading={chatLoading}
                      disabled={false}
                    />
                  )}
                </div>

                {/* モデル選択 — カセット選択UI */}
                <div>
                  <p className="text-xs mb-2 flex items-center gap-1.5" style={{ color: C.textSub }}>
                    <Clapperboard size={12} />
                    AI動画生成モデル
                  </p>
                  <div className="flex gap-2">
                    {([
                      {
                        value: "none" as VideoModel,
                        label: "使用しない",
                        desc: "動画編集のみ",
                        stripe: "linear-gradient(90deg, #8A7D6A 0%, #B8AC9C 60%, #9A8D7C 100%)",
                      },
                      {
                        value: "luma" as VideoModel,
                        label: "Luma AI Ray 2",
                        desc: "5s / 9s · 多彩なアスペクト比",
                        stripe: "linear-gradient(90deg, #9B6B3A 0%, #D4A96A 60%, #C49050 100%)",
                      },
                      {
                        value: "nova_reel" as VideoModel,
                        label: "Amazon Nova Reel",
                        desc: "最大6s · 1280×720固定",
                        stripe: "linear-gradient(90deg, #4A6070 0%, #7A9AAE 60%, #5A8098 100%)",
                      },
                    ] as const).map((m) => {
                      const active = videoModel === m.value;
                      return (
                        <button
                          key={m.value}
                          type="button"
                          onClick={() => {
                            if (videoModel !== m.value) playSound(Snd.SOUNDS.TOGGLE_ON);
                            setVideoModel(m.value);
                          }}
                          className="flex-1 text-left rounded-lg overflow-hidden cursor-pointer transition-all duration-200"
                          style={{
                            border: `1.5px solid ${active ? C.accent : C.border}`,
                            background: active ? C.card : "rgba(243,237,225,0.45)",
                            boxShadow: active
                              ? `0 0 20px rgba(155,107,58,0.35), 0 2px 8px rgba(6,4,2,0.3)`
                              : `0 1px 4px rgba(6,4,2,0.15)`,
                          }}
                        >
                          {/* カセットラベルのカラーストライプ */}
                          <div style={{ height: "4px", background: m.stripe }} />
                          <div className="px-3 py-2">
                            <span className="font-semibold block text-sm" style={{ color: C.textMain }}>
                              {m.label}
                            </span>
                            <span className="text-xs" style={{ color: C.textSub }}>
                              {m.desc}
                            </span>
                            {active && (
                              <span className="text-[10px] tracking-[0.15em] uppercase mt-1.5 block" style={{ color: C.accent }}>
                                ▶ selected
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {submitError && (
                  <p className="text-xs border px-3 py-2 rounded-lg" style={{ color: "#9B2C2C", background: "#FFF5F5", borderColor: "#FEB2B2" }}>
                    {submitError}
                  </p>
                )}

                <button
                  onClick={handleSubmit}
                  className="mt-auto w-full font-medium py-3 rounded-lg flex items-center justify-center gap-2 transition-colors btn-glow-pulse text-sm"
                  style={{ background: C.accent, color: C.card }}
                  onMouseEnter={e => (e.currentTarget.style.background = C.accentHover)}
                  onMouseLeave={e => (e.currentTarget.style.background = C.accent)}
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
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(155,107,58,0.08)")}
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

      {/* Footer */}
      <p className="text-center text-[10px] py-2 flex-shrink-0" style={{ color: "#4A3F30" }}>
        Powered by AWS ECS Fargate · Amazon Bedrock · Strands Agents
      </p>
    </div>
  );
}
