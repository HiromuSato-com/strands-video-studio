import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  Paperclip, Film, ImageIcon, X, Send, Sparkles,
  RotateCcw, Download,
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
  accent:     "#C084FC",
  accent2:    "#22D3EE",
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
      className="rounded-xl p-3 space-y-2 text-xs w-full"
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
              style={{ background: i < filled ? info.color : "rgba(139,92,246,0.12)" }}
            />
          ))}
        </div>
      )}
      {task.status === "FAILED" && task.error_message && (
        <p style={{ color: C.red }}>{task.error_message}</p>
      )}
      {pollingError && (
        <p className="text-[10px]" style={{ color: C.red }}>接続エラー: {pollingError}</p>
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
  const [chatLoading,    setChatLoading]    = useState(false);
  const [videoModel,     setVideoModel]     = useState<VideoModel>("none");
  const [step,           setStep]           = useState<AppStep>("idle");
  const [greetingActive, setGreetingActive] = useState(false);
  const prevFilesLenRef = useRef(0);
  const [taskId,       setTaskId]       = useState<string | null>(null);
  const [downloadUrl,  setDownloadUrl]  = useState<string | null>(null);
  const [isDragging,   setIsDragging]   = useState(false);

  const [panelWidth, setPanelWidth] = useState(300);

  const fileInputRef  = useRef<HTMLInputElement>(null);
  const logScrollRef  = useRef<HTMLDivElement>(null);
  const isResizing    = useRef(false);
  const resizeStartX  = useRef(0);
  const resizeStartW  = useRef(0);

  // ── Panel resize (mouse) ──────────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = e.clientX - resizeStartX.current;
      setPanelWidth(Math.min(Math.max(200, resizeStartW.current + delta), 640));
    };
    const onUp = () => { isResizing.current = false; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",   onUp);
    };
  }, []);

  const { task, error: pollingError } = useTaskPoller(taskId);

  // ── やり取りが1回以上あったか ─────────────────────────────────────────────
  const hasUserMessage = useMemo(
    () => timeline.some(i => i.kind === "msg" && i.role === "user"),
    [timeline],
  );

  // ── ファイルが新たに追加されたら2秒間 greeting 状態 ─────────────────────
  useEffect(() => {
    if (files.length > 0 && prevFilesLenRef.current === 0) {
      setGreetingActive(true);
      const t = setTimeout(() => setGreetingActive(false), 2000);
      return () => clearTimeout(t);
    }
    prevFilesLenRef.current = files.length;
  }, [files.length]);

  // ── Derived character state ───────────────────────────────────────────────
  const characterState = useMemo<CharacterState>(() => {
    if (greetingActive)           return "greeting";
    if (chatLoading)              return "chatting";
    if (step === "uploading")     return "uploading";
    if (!task) return step === "submitted" ? "thinking" : "idle";
    switch (task.status) {
      case "PENDING":            return "thinking";
      case "RUNNING":            return "working";
      case "WAITING_APPROVAL":   return "waiting";
      case "COMPLETED":          return "complete";
      case "FAILED":             return "error";
    }
    return "idle";
  }, [greetingActive, chatLoading, step, task]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const addMsg = (role: "user" | "assistant", content: string) =>
    setTimeline(prev => [...prev, { id: tid(), kind: "msg", role, content }]);

  // ── ログパネル自動スクロール ──────────────────────────────────────────────
  useEffect(() => {
    const el = logScrollRef.current;
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

  // ── Task completion ───────────────────────────────────────────────────────
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

      const newFileKeys = new Set(valid.map(f => `${f.name}-${f.size}`));
      for (const prev of files) {
        const fk = `${prev.name}-${prev.size}`;
        if (!newFileKeys.has(fk)) {
          const s3k = inputKeyMap.get(fk);
          if (s3k) deleteFile(s3k).catch(() => {});
          setInputKeyMap(m => { const n = new Map(m); n.delete(fk); return n; });
        }
      }
      setFiles(valid);

      const prevFileKeys = new Set(files.map(f => `${f.name}-${f.size}`));
      const newFiles = valid.filter(f => !prevFileKeys.has(`${f.name}-${f.size}`));
      if (newFiles.length === 0) return;

      setTimeline(prev => [
        ...prev,
        { id: tid(), kind: "file", names: newFiles.map(f => f.name) },
      ]);
      playSound(Snd.SOUNDS.TAP);

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
    handleFilesSelected([...files, ...Array.from(e.dataTransfer.files)]);
  };

  const removeFile = (index: number) => {
    handleFilesSelected(files.filter((_, i) => i !== index));
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

    const preview = instruction.length > 60 ? instruction.slice(0, 60) + "…" : instruction;
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
    } catch {
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
          className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
          style={{ background: "rgba(124,58,237,0.22)", border: "3px dashed rgba(192,132,252,0.75)" }}
        >
          <div className="text-center" style={{ color: C.accent }}>
            <Paperclip size={44} className="mx-auto mb-3 opacity-80" />
            <p className="text-xl font-bold">ドロップしてね！</p>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <header
        className="flex-shrink-0 flex items-center justify-between px-5 py-2 relative z-10"
        style={{ borderBottom: `1px solid ${C.border}`, background: "rgba(8,4,18,0.90)" }}
      >
        <div className="flex items-center gap-3">
          <span className="text-base font-bold" style={{ color: C.accent }}>
            🎬 ムービィ AI Studio
          </span>
          <span className="text-[10px] hidden sm:block" style={{ color: C.textMuted }}>
            Strands Agents · Claude Sonnet · Bedrock
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* 新しい創作 */}
          {(step === "submitted" || !!downloadUrl) && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all"
              style={{ border: `1px solid ${C.border}`, color: C.textSub }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textSub; }}
            >
              <RotateCcw size={12} />
              新しい創作
            </button>
          )}
        </div>
      </header>

      {/* ── Main body ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden z-10">

        {/* ─── Left: Chat log + controls ─── */}
        <div
          className="flex-shrink-0 flex flex-col relative"
          style={{
            width: panelWidth,
            borderRight: "1px solid rgba(139,92,246,0.06)",
            background: "rgba(8,4,20,0.85)",
          }}
        >
            {/* Timeline */}
            <div ref={logScrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 vtuber-scroll">
              {timeline.map(item => {
                if (item.kind === "msg") {
                  return (
                    <div
                      key={item.id}
                      className={`flex ${item.role === "user" ? "justify-end" : "justify-start"} items-end gap-1.5`}
                    >
                      {item.role === "assistant" && (
                        <div
                          className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs"
                          style={{ background: "rgba(124,58,237,0.30)", border: `1px solid ${C.border}` }}
                        >🎬</div>
                      )}
                      <div
                        className="max-w-[84%] rounded-2xl px-3 py-2 text-xs leading-relaxed"
                        style={
                          item.role === "user"
                            ? { background: C.userBubble, color: "#F5F3FF", borderBottomRightRadius: 4 }
                            : { background: C.aiBubble, color: C.textMain, border: `1px solid ${C.border}`, borderBottomLeftRadius: 4 }
                        }
                      >
                        <p className="whitespace-pre-wrap">{item.content}</p>
                      </div>
                    </div>
                  );
                }
                if (item.kind === "file") {
                  return (
                    <div key={item.id} className="flex justify-center">
                      <div
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px]"
                        style={{ background: "rgba(139,92,246,0.12)", border: `1px solid ${C.border}`, color: C.textMuted }}
                      >
                        <Paperclip size={9} />
                        {item.names.join("、")} を添付
                      </div>
                    </div>
                  );
                }
                if (item.kind === "video") {
                  return (
                    <div key={item.id} className="space-y-2">
                      <VideoPreview src={item.url} />
                      <a
                        href={item.url}
                        download={item.key.split("/").pop() ?? "output.mp4"}
                        onClick={() => playSound(Snd.SOUNDS.CELEBRATION)}
                        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-xs font-semibold transition-all"
                        style={{ background: C.accent, color: "#1A0832" }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
                        onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
                      >
                        <Download size={13} />ダウンロード
                      </a>
                    </div>
                  );
                }
                return null;
              })}

              {/* Task progress */}
              {step === "submitted" && task && (
                <TaskProgressCard task={task} pollingError={pollingError} />
              )}
              {(step === "uploading" || (step === "submitted" && !task)) && (
                <div className="flex items-center gap-2 text-xs justify-center py-1" style={{ color: C.textMuted }}>
                  <div className="w-3 h-3 border-2 rounded-full animate-spin" style={{ borderColor: `${C.accent} transparent` }} />
                  {step === "uploading" ? "アップロード中..." : "エージェント起動中..."}
                </div>
              )}

              {/* Typing indicator */}
              {chatLoading && (
                <div className="flex items-end gap-1.5">
                  <div
                    className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs"
                    style={{ background: "rgba(124,58,237,0.30)", border: `1px solid ${C.border}` }}
                  >🎬</div>
                  <div
                    className="flex items-center gap-1 px-3 py-2.5 rounded-2xl rounded-bl-sm"
                    style={{ background: C.aiBubble, border: `1px solid ${C.border}` }}
                  >
                    {[0, 160, 320].map(d => (
                      <span key={d} className="w-1.5 h-1.5 rounded-full inline-block"
                        style={{ background: C.accent, animation: `typingPulse 1.2s ease-in-out ${d}ms infinite` }} />
                    ))}
                  </div>
                </div>
              )}
              <div className="h-1" />
            </div>

            {/* File chips */}
            {files.length > 0 && (
              <div
                className="px-3 py-2 flex flex-wrap gap-1.5 flex-shrink-0"
                style={{ borderTop: "1px solid rgba(139,92,246,0.07)" }}
              >
                {files.map((f, i) => (
                  <span
                    key={`${f.name}-${f.size}`}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-full"
                    style={{ background: "rgba(139,92,246,0.12)", border: `1px solid ${C.border}`, color: C.textSub }}
                  >
                    {f.type.startsWith("video") ? <Film size={9} /> : <ImageIcon size={9} />}
                    <span className="max-w-[100px] truncate">{f.name}</span>
                    <button
                      onClick={() => removeFile(i)}
                      className="ml-0.5 transition-colors"
                      style={{ color: C.textMuted }}
                      onMouseEnter={e => (e.currentTarget.style.color = C.red)}
                      onMouseLeave={e => (e.currentTarget.style.color = C.textMuted)}
                    ><X size={9} /></button>
                  </span>
                ))}
              </div>
            )}

            {/* Input controls */}
            <div
              className="flex-shrink-0 p-3 space-y-2"
              style={{ borderTop: "1px solid rgba(139,92,246,0.07)" }}
            >
              {/* Textarea */}
              <textarea
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isProcessing ? "処理中です..." : "ムービィに話しかける…"}
                disabled={isProcessing}
                rows={3}
                className="w-full resize-none rounded-xl px-3 py-2.5 text-xs outline-none"
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
              {/* Button row */}
              <div className="flex items-center gap-1.5">
                {/* File attach */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessing}
                  className="flex-shrink-0 p-2 rounded-lg transition-all"
                  style={{
                    background: "rgba(139,92,246,0.10)",
                    border: `1px solid ${files.length > 0 ? C.accent : C.border}`,
                    color: files.length > 0 ? C.accent : C.textMuted,
                    opacity: isProcessing ? 0.5 : 1,
                  }}
                  title={files.length > 0 ? `${files.length} 件添付中` : "ファイルを添付"}
                ><Paperclip size={14} /></button>

                {/* Chat send */}
                <button
                  onClick={handleChatSend}
                  disabled={!inputText.trim() || isProcessing}
                  className="flex-shrink-0 p-2 rounded-lg transition-all"
                  style={{
                    background: inputText.trim() && !isProcessing ? "rgba(192,132,252,0.18)" : "rgba(139,92,246,0.08)",
                    border: `1px solid ${inputText.trim() && !isProcessing ? C.accent : C.border}`,
                    color: inputText.trim() && !isProcessing ? C.accent : C.textMuted,
                  }}
                  title="チャット送信"
                ><Send size={14} /></button>

                {/* Model select — 1回以上やり取り後に有効 */}
                <select
                  value={videoModel}
                  onChange={e => {
                    const v = e.target.value as VideoModel;
                    if (videoModel !== v) playSound(Snd.SOUNDS.TOGGLE_ON);
                    setVideoModel(v);
                  }}
                  disabled={!hasUserMessage || isProcessing}
                  className="flex-1 text-xs rounded-lg px-2 py-2 outline-none cursor-pointer"
                  style={{
                    background: "rgba(139,92,246,0.10)",
                    border: `1px solid ${C.border}`,
                    color: C.textSub,
                    appearance: "none",
                    opacity: !hasUserMessage || isProcessing ? 0.35 : 1,
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = C.accent)}
                  onBlur={e => (e.currentTarget.style.borderColor = C.border)}
                  title={!hasUserMessage ? "ムービィと1回以上やり取りしてから選べるよ" : undefined}
                >
                  <option value="none">🎞 編集</option>
                  <option value="nova_reel">🤖 Nova Reel</option>
                </select>

                {/* Start task — 1回以上やり取り後に有効 */}
                {(() => {
                  const disabled = !hasUserMessage || isProcessing;
                  return (
                    <button
                      onClick={handleStartTask}
                      disabled={disabled}
                      className="flex-shrink-0 flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all"
                      style={{
                        background: disabled ? "rgba(139,92,246,0.08)" : C.accent,
                        color: disabled ? C.textMuted : "#1A0832",
                        cursor: disabled ? "not-allowed" : "pointer",
                        opacity: disabled ? 0.35 : 1,
                      }}
                      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.opacity = "0.85"; e.currentTarget.style.transform = "scale(1.02)"; } }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = disabled ? "0.35" : "1"; e.currentTarget.style.transform = "scale(1)"; }}
                      title={!hasUserMessage ? "ムービィと1回以上やり取りしてから押してね" : undefined}
                    >
                      <Sparkles size={13} />製作開始
                    </button>
                  );
                })()}
              </div>
            </div>

            {/* Resize handle — invisible, hover でごく薄く */}
            <div
              className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize group select-none"
              onMouseDown={e => {
                isResizing.current   = true;
                resizeStartX.current = e.clientX;
                resizeStartW.current = panelWidth;
                e.preventDefault();
              }}
            >
              <div
                className="absolute right-0 top-0 bottom-0 w-px opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{ background: "rgba(139,92,246,0.18)" }}
              />
            </div>
        </div>

        {/* ─── Right: Character — fills all remaining space ─── */}
        <div className="flex-1 relative flex items-center justify-center overflow-hidden">
          <CharacterAvatar state={characterState} size={420} />
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
          if (e.target.files) handleFilesSelected([...files, ...Array.from(e.target.files)]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
