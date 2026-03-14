import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  Paperclip, Film, ImageIcon, X, Send, Sparkles,
  RotateCcw, Download, Clapperboard, Film as FilmIcon,
} from "lucide-react";
import { CharacterAvatar, type CharacterState } from "./components/CharacterAvatar";
import { VideoPreview } from "./components/VideoPreview";
import { useTaskPoller } from "./hooks/useTaskPoller";
import {
  getUploadUrl, uploadFileToS3, createTask, getDownloadUrl,
  sendChatMessage, confirmChat, initChat, deleteFile,
} from "./api/client";
import { playSound, Snd } from "./lib/snd";
import type { Task } from "./types";

// ── Color tokens ──────────────────────────────────────────────────────────────
const C = {
  bg:         "#080412",
  panel:      "rgba(14, 6, 30, 0.92)",
  border:     "rgba(139, 92, 246, 0.28)",
  borderHov:  "rgba(192, 132, 252, 0.60)",
  accent:     "#C084FC",
  accent2:    "#22D3EE",
  accentPink: "#F9A8D4",
  textMain:   "#EDE9FE",
  textSub:    "#C4B5FD",
  textMuted:  "#7C6AAE",
  userBubble: "#5B21B6",
  aiBubble:   "rgba(14, 6, 34, 0.95)",
  green:      "#34D399",
  red:        "#F87171",
  yellow:     "#FCD34D",
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────
type VideoModel = "nova_reel" | "none";
type AppStep    = "idle" | "uploading" | "submitted";

type TLItem =
  | { id: string; kind: "msg";   role: "user" | "assistant"; content: string }
  | { id: string; kind: "file";  names: string[] }
  | { id: string; kind: "video"; url: string; key: string };

const tid = () => uuidv4();

const GREETING: TLItem = {
  id: "init",
  kind: "msg",
  role: "assistant",
  content:
    "こんにちは！私はムービィだよ🎬\n動画編集・生成なんでも任せて！\nファイルをドロップするか、何を作りたいか話しかけてね✨",
};

const STATE_LABEL: Record<CharacterState, string> = {
  idle:     "待機中 ✨",
  thinking: "考え中 🤔",
  working:  "制作中 ⚡",
  complete: "完成！🎉",
  error:    "エラー 😥",
};

// ── Inline task progress card ─────────────────────────────────────────────────
function TaskProgressCard({
  task,
  pollingError,
}: {
  task: Task;
  pollingError: string | null;
}) {
  const STATUS: Record<string, { label: string; color: string; pct: number }> = {
    PENDING:   { label: "準備中...",    color: C.textMuted, pct: 10  },
    RUNNING:   { label: "AI処理中 ⚡", color: C.accent,    pct: 60  },
    COMPLETED: { label: "完成！🎉",     color: C.green,     pct: 100 },
    FAILED:    { label: "エラー 😥",    color: C.red,       pct: 0   },
  };
  const info = STATUS[task.status] ?? STATUS.PENDING;
  const SEG  = 20;
  const filled = Math.round((info.pct / 100) * SEG);

  return (
    <div
      className="rounded-xl p-3 space-y-2 text-xs"
      style={{ background: C.panel, border: `1px solid ${C.border}` }}
    >
      <div className="flex items-center justify-between">
        <span style={{ color: info.color, fontWeight: 600 }}>{info.label}</span>
        <span className="font-mono text-[10px]" style={{ color: C.textMuted }}>
          TASK · {task.task_id.slice(0, 8).toUpperCase()}
        </span>
      </div>
      {task.status !== "FAILED" && (
        <div className="flex gap-0.5">
          {Array.from({ length: SEG }, (_, i) => (
            <div
              key={i}
              className="h-1.5 flex-1 rounded-sm transition-all duration-700"
              style={{
                background:
                  i < filled
                    ? info.color
                    : "rgba(139,92,246,0.12)",
              }}
            />
          ))}
        </div>
      )}
      {task.status === "FAILED" && task.error_message && (
        <p style={{ color: C.red }}>{task.error_message}</p>
      )}
      {pollingError && (
        <p className="text-[10px]" style={{ color: C.red }}>
          接続エラー: {pollingError}
        </p>
      )}
    </div>
  );
}

// ── Accepted file types ───────────────────────────────────────────────────────
const ACCEPTED_RE = /\.(mp4|mov|avi|webm|jpg|jpeg|png|gif|webp)$/i;

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [timeline,    setTimeline]    = useState<TLItem[]>([GREETING]);
  const [inputText,   setInputText]   = useState("");
  const [files,       setFiles]       = useState<File[]>([]);
  const [inputKeyMap, setInputKeyMap] = useState<Map<string, string>>(new Map());
  const [workingTaskId, setWorkingTaskId] = useState<string>(() => uuidv4());
  const [chatSessionId, setChatSessionId] = useState<string>(() => uuidv4());
  const [chatLoading,  setChatLoading]  = useState(false);
  const [videoModel,   setVideoModel]   = useState<VideoModel>("none");
  const [step,         setStep]         = useState<AppStep>("idle");
  const [taskId,       setTaskId]       = useState<string | null>(null);
  const [downloadUrl,  setDownloadUrl]  = useState<string | null>(null);
  const [isDragging,   setIsDragging]   = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef    = useRef<HTMLDivElement>(null);

  const { task, error: pollingError } = useTaskPoller(taskId);

  // ── Derived character state ───────────────────────────────────────────────
  const characterState = useMemo<CharacterState>(() => {
    if (chatLoading || step === "uploading") return "thinking";
    if (!task) return step === "submitted" ? "thinking" : "idle";
    switch (task.status) {
      case "PENDING":   return "thinking";
      case "RUNNING":   return "working";
      case "COMPLETED": return "complete";
      case "FAILED":    return "error";
    }
    return "idle";
  }, [chatLoading, step, task]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const addMsg = (role: "user" | "assistant", content: string) =>
    setTimeline(prev => [...prev, { id: tid(), kind: "msg", role, content }]);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [timeline, chatLoading, task?.status]);

  // ── Sound on status change ────────────────────────────────────────────────
  const prevStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!task || task.status === prevStatus.current) return;
    prevStatus.current = task.status;
    if (task.status === "RUNNING")   playSound(Snd.SOUNDS.NOTIFICATION);
    if (task.status === "COMPLETED") playSound(Snd.SOUNDS.CELEBRATION);
    if (task.status === "FAILED")    playSound(Snd.SOUNDS.CAUTION);
  }, [task?.status]); // eslint-disable-line

  // ── Task completion: add video item + celebrate ───────────────────────────
  const handleCompleted = useCallback(
    async (completedTaskId: string) => {
      if (downloadUrl) return;
      try {
        const res = await getDownloadUrl(completedTaskId);
        setDownloadUrl(res.download_url);
        setTimeline(prev => [
          ...prev,
          { id: tid(), kind: "video", url: res.download_url, key: res.output_key },
        ]);
        addMsg("assistant", "完成したよ🎉 動画を確認してみてね！\nダウンロードボタンから保存もできるよ✨");
      } catch (e) {
        console.error("Failed to get download URL", e);
      }
    },
    [downloadUrl], // eslint-disable-line
  );

  useEffect(() => {
    if (task?.status === "COMPLETED" && !downloadUrl && taskId) {
      handleCompleted(taskId);
    }
    if (task?.status === "FAILED") {
      addMsg(
        "assistant",
        `ごめんね、エラーが起きちゃった😥${task.error_message ? `\n${task.error_message}` : ""}\nもう一度試してみて！`,
      );
    }
  }, [task?.status]); // eslint-disable-line

  // ── File handling ─────────────────────────────────────────────────────────
  const handleFilesSelected = useCallback(
    async (incoming: File[]) => {
      const valid = incoming.filter(f => ACCEPTED_RE.test(f.name));

      // Delete removed files from S3
      const newFileKeys = new Set(valid.map(f => `${f.name}-${f.size}`));
      for (const prev of files) {
        const fk = `${prev.name}-${prev.size}`;
        if (!newFileKeys.has(fk)) {
          const s3k = inputKeyMap.get(fk);
          if (s3k) deleteFile(s3k).catch(() => {});
          setInputKeyMap(m => {
            const n = new Map(m);
            n.delete(fk);
            return n;
          });
        }
      }

      setFiles(valid);

      // Upload newly added files
      const prevFileKeys = new Set(files.map(f => `${f.name}-${f.size}`));
      const newFiles = valid.filter(f => !prevFileKeys.has(`${f.name}-${f.size}`));
      if (newFiles.length === 0) return;

      setTimeline(prev => [
        ...prev,
        { id: tid(), kind: "file", names: newFiles.map(f => f.name) },
      ]);
      playSound(Snd.SOUNDS.TAP);

      // Upload and collect keys
      const newMap = new Map(inputKeyMap);
      for (const file of newFiles) {
        try {
          const { upload_url, key } = await getUploadUrl(workingTaskId, file.name);
          await uploadFileToS3(upload_url, file);
          newMap.set(`${file.name}-${file.size}`, key);
        } catch (e) {
          console.error("Upload failed:", e);
        }
      }
      setInputKeyMap(newMap);

      // ムービィ greets the uploaded files
      setChatLoading(true);
      try {
        const allNames = valid.map(f => f.name);
        const allKeys  = valid.map(f => newMap.get(`${f.name}-${f.size}`)).filter(Boolean) as string[];
        const res = await initChat(chatSessionId, allNames, allKeys);
        const latestAi = res.messages.findLast(m => m.role === "assistant");
        if (latestAi) addMsg("assistant", latestAi.content);
      } catch (e) {
        console.error("initChat failed:", e);
      } finally {
        setChatLoading(false);
      }
    },
    [files, inputKeyMap, workingTaskId, chatSessionId], // eslint-disable-line
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const incoming = Array.from(e.dataTransfer.files);
    handleFilesSelected([...files, ...incoming]);
  };

  const removeFile = (index: number) => {
    const next = files.filter((_, i) => i !== index);
    handleFilesSelected(next);
    playSound(Snd.SOUNDS.TAP);
  };

  // ── Chat send ─────────────────────────────────────────────────────────────
  const handleChatSend = async () => {
    const text = inputText.trim();
    if (!text || chatLoading || step !== "idle") return;
    addMsg("user", text);
    setInputText("");
    setChatLoading(true);
    try {
      const res  = await sendChatMessage(chatSessionId, text);
      const last = res.messages.findLast(m => m.role === "assistant");
      if (last) addMsg("assistant", last.content);
    } catch {
      addMsg("assistant", "ごめんね、うまく聞き取れなかったよ😥 もう一度試してね！");
    } finally {
      setChatLoading(false);
    }
  };

  // ── Start task ────────────────────────────────────────────────────────────
  const handleStartTask = async () => {
    if (step !== "idle" || chatLoading) return;

    let instruction = inputText.trim();

    if (!instruction) {
      // Confirm instruction from chat history
      const hasUserMsg = timeline.some(i => i.kind === "msg" && i.role === "user");
      if (!hasUserMsg) {
        addMsg(
          "assistant",
          "まず何を作りたいか教えてね！💬\nチャットで相談するか、直接テキストを入力してから「製作開始」を押してね！",
        );
        return;
      }
      setChatLoading(true);
      try {
        const res = await confirmChat(chatSessionId);
        instruction = res.instruction;
      } catch {
        addMsg("assistant", "指示の確定に失敗しちゃった😥 もう一度試してね！");
        setChatLoading(false);
        return;
      }
      setChatLoading(false);
    } else {
      addMsg("user", instruction);
      setInputText("");
    }

    const preview = instruction.length > 60
      ? instruction.slice(0, 60) + "…"
      : instruction;
    addMsg("assistant", `了解！「${preview}」で製作開始するね⚡\nしばらく待っててね🎬`);
    playSound(Snd.SOUNDS.BUTTON);
    setStep("uploading");

    try {
      const uploadedKeys = files
        .map(f => inputKeyMap.get(`${f.name}-${f.size}`))
        .filter(Boolean) as string[];
      const { task_id } = await createTask(workingTaskId, instruction, uploadedKeys, videoModel);
      setTaskId(task_id);
      setStep("submitted");
    } catch (e) {
      setStep("idle");
      addMsg("assistant", "タスクの作成に失敗しちゃった😥 もう一度試してね！");
    }
  };

  // ── Reset ─────────────────────────────────────────────────────────────────
  const handleReset = () => {
    playSound(Snd.SOUNDS.TAP);
    setTimeline([GREETING]);
    setInputText("");
    setFiles([]);
    setInputKeyMap(new Map());
    setWorkingTaskId(uuidv4());
    setChatSessionId(uuidv4());
    setVideoModel("none");
    setStep("idle");
    setTaskId(null);
    setDownloadUrl(null);
    setChatLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleChatSend();
    }
  };

  const isProcessing = step !== "idle" || chatLoading;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="vtuber-bg h-screen flex flex-col overflow-hidden"
      onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); }}
      onDrop={handleDrop}
    >
      {/* ── Drag overlay ── */}
      {isDragging && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(124,58,237,0.25)", border: "3px dashed rgba(192,132,252,0.8)" }}
        >
          <div className="text-center" style={{ color: C.accent }}>
            <FilmIcon size={48} className="mx-auto mb-3 opacity-80" />
            <p className="text-xl font-bold">ドロップしてね！</p>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <header
        className="flex-shrink-0 flex items-center justify-between px-6 py-2 relative z-10"
        style={{ borderBottom: `1px solid ${C.border}`, background: "rgba(8,4,18,0.90)" }}
      >
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold" style={{ color: C.accent }}>
            🎬 ムービィ AI Studio
          </span>
          <span className="text-[10px] hidden sm:block" style={{ color: C.textMuted }}>
            Strands Agents · Claude Sonnet · Bedrock
          </span>
        </div>
        {(step === "submitted" || !!downloadUrl) && (
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all"
            style={{ border: `1px solid ${C.border}`, color: C.textSub }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = C.accent;
              e.currentTarget.style.color = C.accent;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = C.border;
              e.currentTarget.style.color = C.textSub;
            }}
          >
            <RotateCcw size={12} />
            新しい創作
          </button>
        )}
      </header>

      {/* ── Main body ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative z-10">

        {/* ─── Left: Character panel ─── */}
        <div
          className="w-52 flex-shrink-0 flex flex-col items-center gap-4 py-6 px-3 overflow-y-auto vtuber-scroll"
          style={{ borderRight: `1px solid ${C.border}`, background: "rgba(8,4,20,0.60)" }}
        >
          {/* Avatar */}
          <CharacterAvatar state={characterState} size={160} />

          {/* Name + state */}
          <div className="text-center">
            <p className="font-bold text-sm" style={{ color: C.textMain }}>ムービィ</p>
            <p
              className="text-[11px] mt-0.5"
              style={{
                color: characterState === "working"
                  ? C.yellow
                  : characterState === "complete"
                    ? C.green
                    : characterState === "error"
                      ? C.red
                      : C.textMuted,
              }}
            >
              {STATE_LABEL[characterState]}
            </p>
          </div>

          {/* Divider */}
          <div className="w-full h-px" style={{ background: C.border }} />

          {/* File section */}
          <div className="w-full space-y-1.5">
            <p className="text-[10px] font-medium px-1" style={{ color: C.textMuted }}>
              添付ファイル{files.length > 0 ? ` (${files.length}件)` : ""}
            </p>

            {files.length === 0 ? (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex flex-col items-center justify-center gap-2 p-4 rounded-xl text-xs transition-all"
                style={{
                  border: `1.5px dashed ${C.border}`,
                  color: C.textMuted,
                  background: "rgba(139,92,246,0.05)",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = C.accent;
                  e.currentTarget.style.color = C.accent;
                  e.currentTarget.style.background = "rgba(192,132,252,0.08)";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = C.border;
                  e.currentTarget.style.color = C.textMuted;
                  e.currentTarget.style.background = "rgba(139,92,246,0.05)";
                }}
              >
                <Paperclip size={20} />
                <span>ドロップ or クリック</span>
                <span className="text-[9px]" style={{ color: C.textMuted }}>
                  動画・画像を追加
                </span>
              </button>
            ) : (
              <ul className="space-y-1">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${f.size}`}
                    className="flex items-center gap-1.5 text-[10px] px-2 py-1.5 rounded-lg"
                    style={{ background: "rgba(139,92,246,0.10)", border: `1px solid ${C.border}` }}
                  >
                    <span style={{ color: C.textMuted, flexShrink: 0 }}>
                      {f.type.startsWith("video") ? <Film size={10} /> : <ImageIcon size={10} />}
                    </span>
                    <span className="truncate flex-1" style={{ color: C.textSub }}>{f.name}</span>
                    <button
                      onClick={() => removeFile(i)}
                      className="flex-shrink-0 transition-colors"
                      style={{ color: C.textMuted }}
                      onMouseEnter={e => (e.currentTarget.style.color = C.red)}
                      onMouseLeave={e => (e.currentTarget.style.color = C.textMuted)}
                    >
                      <X size={10} />
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full text-center text-[10px] py-1 rounded transition-colors"
                    style={{ color: C.textMuted }}
                    onMouseEnter={e => (e.currentTarget.style.color = C.accent)}
                    onMouseLeave={e => (e.currentTarget.style.color = C.textMuted)}
                  >
                    + ファイルを追加
                  </button>
                </li>
              </ul>
            )}
          </div>
        </div>

        {/* ─── Right: Chat area ─── */}
        <div className="flex flex-1 flex-col min-w-0">

          {/* Chat timeline */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-4 space-y-3 vtuber-scroll"
          >
            {timeline.map(item => {
              /* ── Chat message ── */
              if (item.kind === "msg") {
                return (
                  <div
                    key={item.id}
                    className={`flex ${item.role === "user" ? "justify-end" : "justify-start"} items-end gap-2`}
                  >
                    {item.role === "assistant" && (
                      <div
                        className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-sm"
                        style={{ background: "rgba(124,58,237,0.30)", border: `1px solid ${C.border}` }}
                      >
                        🎬
                      </div>
                    )}
                    <div
                      className="max-w-[72%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
                      style={
                        item.role === "user"
                          ? {
                              background: C.userBubble,
                              color: "#F5F3FF",
                              borderBottomRightRadius: 4,
                            }
                          : {
                              background: C.aiBubble,
                              color: C.textMain,
                              border: `1px solid ${C.border}`,
                              borderBottomLeftRadius: 4,
                            }
                      }
                    >
                      <p className="whitespace-pre-wrap">{item.content}</p>
                    </div>
                  </div>
                );
              }

              /* ── File notification ── */
              if (item.kind === "file") {
                return (
                  <div key={item.id} className="flex justify-center">
                    <div
                      className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px]"
                      style={{
                        background: "rgba(139,92,246,0.14)",
                        border: `1px solid ${C.border}`,
                        color: C.textMuted,
                      }}
                    >
                      <Paperclip size={11} />
                      {item.names.join("、")} を添付したよ
                    </div>
                  </div>
                );
              }

              /* ── Completed video ── */
              if (item.kind === "video") {
                return (
                  <div key={item.id} className="space-y-2 max-w-xl">
                    <VideoPreview src={item.url} />
                    <a
                      href={item.url}
                      download={item.key.split("/").pop() ?? "output.mp4"}
                      onClick={() => playSound(Snd.SOUNDS.CELEBRATION)}
                      className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold transition-all"
                      style={{ background: C.accent, color: "#1A0832" }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
                      onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
                    >
                      <Download size={15} />
                      ダウンロード
                    </a>
                  </div>
                );
              }

              return null;
            })}

            {/* Task progress (inline, follows messages) */}
            {step === "submitted" && task && (
              <TaskProgressCard task={task} pollingError={pollingError} />
            )}
            {step === "uploading" && (
              <div className="flex items-center gap-2 text-xs" style={{ color: C.textMuted }}>
                <div
                  className="w-3 h-3 border-2 rounded-full animate-spin"
                  style={{ borderColor: `${C.accent} transparent` }}
                />
                アップロード中...
              </div>
            )}
            {step === "submitted" && !task && (
              <div className="flex items-center gap-2 text-xs" style={{ color: C.textMuted }}>
                <div
                  className="w-3 h-3 border-2 rounded-full animate-spin"
                  style={{ borderColor: `${C.accent} transparent` }}
                />
                エージェント起動中...
              </div>
            )}

            {/* Typing indicator */}
            {chatLoading && (
              <div className="flex items-end gap-2">
                <div
                  className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-sm"
                  style={{ background: "rgba(124,58,237,0.30)", border: `1px solid ${C.border}` }}
                >
                  🎬
                </div>
                <div
                  className="flex items-center gap-1.5 px-4 py-3 rounded-2xl rounded-bl-sm"
                  style={{ background: C.aiBubble, border: `1px solid ${C.border}` }}
                >
                  {[0, 160, 320].map(d => (
                    <span
                      key={d}
                      className="w-2 h-2 rounded-full inline-block"
                      style={{
                        background: C.accent,
                        animation: `typingPulse 1.2s ease-in-out ${d}ms infinite`,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Scroll anchor */}
            <div className="h-1" />
          </div>

          {/* ── Bottom input bar ── */}
          <div
            className="flex-shrink-0 px-3 py-3 space-y-2"
            style={{ borderTop: `1px solid ${C.border}`, background: "rgba(8,4,18,0.96)" }}
          >
            {/* Model select row */}
            <div className="flex items-center gap-2">
              <Clapperboard size={12} style={{ color: C.textMuted }} />
              <select
                value={videoModel}
                onChange={e => {
                  const v = e.target.value as VideoModel;
                  if (videoModel !== v) playSound(Snd.SOUNDS.TOGGLE_ON);
                  setVideoModel(v);
                }}
                disabled={isProcessing}
                className="text-xs rounded-lg px-3 py-1.5 outline-none cursor-pointer"
                style={{
                  background: "rgba(139,92,246,0.10)",
                  border: `1px solid ${C.border}`,
                  color: C.textSub,
                  appearance: "none",
                }}
                onFocus={e => (e.currentTarget.style.borderColor = C.accent)}
                onBlur={e => (e.currentTarget.style.borderColor = C.border)}
              >
                <option value="none">🎞 動画編集モード</option>
                <option value="nova_reel">🤖 Amazon Nova Reel</option>
              </select>

              {isProcessing && step !== "idle" && (
                <span className="text-[10px] ml-auto" style={{ color: C.textMuted }}>
                  {step === "uploading"
                    ? "アップロード中..."
                    : task
                      ? `${task.status}`
                      : "エージェント起動中..."}
                </span>
              )}
            </div>

            {/* Input row */}
            <div className="flex items-end gap-2">
              {/* File attach */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="flex-shrink-0 p-2.5 rounded-xl transition-all"
                style={{
                  background: "rgba(139,92,246,0.10)",
                  border: `1px solid ${C.border}`,
                  color: C.textMuted,
                  opacity: isProcessing ? 0.5 : 1,
                }}
                onMouseEnter={e => {
                  if (!isProcessing) e.currentTarget.style.color = C.accent;
                }}
                onMouseLeave={e => (e.currentTarget.style.color = C.textMuted)}
                title="ファイルを添付"
              >
                <Paperclip size={16} />
              </button>

              {/* Textarea */}
              <textarea
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  isProcessing
                    ? "処理中です..."
                    : "ムービィに話しかける（Enter で送信 / Shift+Enter で改行）"
                }
                disabled={isProcessing}
                rows={2}
                className="flex-1 resize-none rounded-xl px-3 py-2.5 text-sm outline-none"
                style={{
                  background: "rgba(139,92,246,0.07)",
                  border: `1px solid ${C.border}`,
                  color: C.textMain,
                  opacity: isProcessing ? 0.5 : 1,
                  transition: "border-color 0.15s",
                }}
                onFocus={e => (e.currentTarget.style.borderColor = C.accent)}
                onBlur={e => (e.currentTarget.style.borderColor = C.border)}
              />

              {/* Chat send button */}
              <button
                onClick={handleChatSend}
                disabled={!inputText.trim() || isProcessing}
                className="flex-shrink-0 p-2.5 rounded-xl transition-all"
                style={{
                  background:
                    inputText.trim() && !isProcessing
                      ? "rgba(192,132,252,0.18)"
                      : "rgba(139,92,246,0.08)",
                  border: `1px solid ${inputText.trim() && !isProcessing ? C.accent : C.border}`,
                  color: inputText.trim() && !isProcessing ? C.accent : C.textMuted,
                }}
                title="チャット送信"
              >
                <Send size={16} />
              </button>

              {/* Start task button */}
              <button
                onClick={handleStartTask}
                disabled={isProcessing}
                className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
                style={{
                  background: isProcessing ? "rgba(139,92,246,0.08)" : C.accent,
                  color: isProcessing ? C.textMuted : "#1A0832",
                  cursor: isProcessing ? "not-allowed" : "pointer",
                }}
                onMouseEnter={e => {
                  if (!isProcessing) {
                    e.currentTarget.style.opacity = "0.85";
                    e.currentTarget.style.transform = "scale(1.02)";
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.opacity = "1";
                  e.currentTarget.style.transform = "scale(1)";
                }}
              >
                <Sparkles size={15} />
                製作開始
              </button>
            </div>

            {/* Hint text */}
            <p className="text-[10px] px-1" style={{ color: C.textMuted }}>
              💬 Enter でチャット送信 ·
              ▶ 製作開始 でタスク作成（チャットなしでも直接入力可）
            </p>
          </div>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".mp4,.mov,.avi,.webm,.jpg,.jpeg,.png,.gif,.webp"
        className="hidden"
        onChange={e => {
          if (e.target.files) {
            handleFilesSelected([...files, ...Array.from(e.target.files)]);
          }
          e.target.value = "";
        }}
      />
    </div>
  );
}
