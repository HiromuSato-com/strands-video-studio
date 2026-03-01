import { useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { Film, PenLine, Activity, Sparkles, Palette, Loader, Clapperboard } from "lucide-react";
import { UploadZone } from "./components/UploadZone";
import { InstructionBox } from "./components/InstructionBox";
import { TaskStatus } from "./components/TaskStatus";
import { CompletionModal } from "./components/CompletionModal";
import { useTaskPoller } from "./hooks/useTaskPoller";
import {
  getUploadUrl,
  uploadFileToS3,
  createTask,
  getDownloadUrl,
} from "./api/client";

type AppStep = "idle" | "uploading" | "submitted";
type VideoModel = "luma" | "nova_reel";

interface UploadProgress {
  filename: string;
  percent: number;
}

const STEP_LABELS = [
  { num: "1", label: "ファイルを選択",   icon: Film,       color: "bg-pink-100 text-pink-600 border-pink-200" },
  { num: "2", label: "創作指示を入力",   icon: PenLine,    color: "bg-violet-100 text-violet-600 border-violet-200" },
  { num: "3", label: "処理状況",         icon: Activity,   color: "bg-emerald-100 text-emerald-600 border-emerald-200" },
  { num: "4", label: "結果プレビュー",   icon: Sparkles,   color: "bg-amber-100 text-amber-600 border-amber-200" },
] as const;

export default function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [instruction, setInstruction] = useState("");
  const [videoModel, setVideoModel] = useState<VideoModel>("luma");
  const [step, setStep] = useState<AppStep>("idle");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadKey, setDownloadKey] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  const { task, error: pollingError } = useTaskPoller(taskId);

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
      setSubmitError("創作指示を入力してください");
      return;
    }

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

  const handleReset = () => {
    setFiles([]);
    setInstruction("");
    setVideoModel("luma");
    setStep("idle");
    setTaskId(null);
    setUploadProgress([]);
    setSubmitError(null);
    setDownloadUrl(null);
    setDownloadKey(null);
    setShowModal(false);
  };

  const StepBadge = ({ index }: { index: number }) => {
    const s = STEP_LABELS[index];
    const Icon = s.icon;
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border ${s.color} mb-3`}>
        <Icon size={12} />
        {s.num}. {s.label}
      </span>
    );
  };

  return (
    <div className="min-h-screen watercolor-bg">
      {/* 完成モーダル */}
      {showModal && downloadUrl && downloadKey && (
        <CompletionModal
          downloadUrl={downloadUrl}
          outputKey={downloadKey}
          onClose={() => setShowModal(false)}
          onReset={handleReset}
        />
      )}

      <div className="max-w-2xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="font-klee text-4xl font-semibold mb-2 bg-gradient-to-r from-violet-500 to-pink-400 bg-clip-text text-transparent">
            AI 創作スタジオ
          </h1>
          <p className="text-violet-400 text-sm flex items-center justify-center gap-1.5">
            <Palette size={14} />
            Strands Agents × Claude Sonnet × MoviePy
          </p>
        </div>

        {/* Main card */}
        <div className="bg-white/80 backdrop-blur-sm border border-lavender-200 rounded-3xl shadow-xl shadow-violet-100/50 p-6 space-y-5">

          {step === "idle" ? (
            /* ─────────────────────────────────────────
               FORM VIEW（入力フォーム）
            ───────────────────────────────────────── */
            <>
              <section>
                <StepBadge index={0} />
                <UploadZone onFilesSelected={setFiles} disabled={false} />
              </section>

              <section>
                <StepBadge index={1} />
                <InstructionBox value={instruction} onChange={setInstruction} disabled={false} />

                <div className="mt-3">
                  <p className="text-xs text-violet-400 mb-2 flex items-center gap-1">
                    <Clapperboard size={11} />
                    AI動画生成モデル（動画生成指示の場合に使用）
                  </p>
                  <div className="flex gap-2">
                    {([
                      { value: "luma" as VideoModel,     label: "Luma AI Ray 2",    desc: "5s / 9s · 多彩なアスペクト比" },
                      { value: "nova_reel" as VideoModel, label: "Amazon Nova Reel", desc: "最大6s · 1280×720固定" },
                    ] as const).map((m) => (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => setVideoModel(m.value)}
                        className={`flex-1 text-left px-3 py-2 rounded-xl border text-xs transition-all cursor-pointer ${
                          videoModel === m.value
                            ? "border-violet-400 bg-violet-50 text-violet-700"
                            : "border-lavender-200 bg-white/60 text-violet-400 hover:border-violet-300"
                        }`}
                      >
                        <span className="font-semibold block">{m.label}</span>
                        <span className="text-[10px] opacity-70">{m.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              {submitError && (
                <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
                  {submitError}
                </p>
              )}

              <button
                onClick={handleSubmit}
                className="w-full font-semibold py-3 rounded-2xl transition-all shadow-lg flex items-center justify-center gap-2 text-white bg-gradient-to-r from-violet-500 to-pink-400 hover:shadow-violet-200 hover:shadow-xl"
              >
                <Sparkles size={16} />
                創作を開始
              </button>
            </>
          ) : (
            /* ─────────────────────────────────────────
               STATUS VIEW（送信後・処理中）
               フォームを畳んでステータスを上部に表示
            ───────────────────────────────────────── */
            <>
              {/* 送信内容サマリー（コンパクト） */}
              <div className="rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50/70 to-pink-50/40 p-4">
                <p className="text-[10px] font-semibold text-violet-300 uppercase tracking-widest mb-2">
                  送信した創作内容
                </p>
                <p className="text-sm text-violet-700 leading-snug">
                  {instruction.length > 100 ? instruction.slice(0, 100) + "…" : instruction}
                </p>
                {(files.length > 0 || true) && (
                  <div className="flex flex-wrap items-center gap-2 mt-2.5">
                    {files.map((f) => (
                      <span
                        key={f.name}
                        className="inline-flex items-center gap-1 text-[11px] bg-white/80 border border-violet-100 text-violet-500 px-2 py-0.5 rounded-full"
                      >
                        <Film size={10} />
                        {f.name}
                      </span>
                    ))}
                    <span className="text-[11px] text-violet-300">
                      {videoModel === "luma" ? "Luma AI Ray 2" : "Amazon Nova Reel"}
                    </span>
                  </div>
                )}
              </div>

              {/* アップロード進捗 */}
              {step === "uploading" && uploadProgress.length > 0 && (
                <div className="space-y-2">
                  {uploadProgress.map((p) => (
                    <div key={p.filename}>
                      <div className="flex justify-between text-xs text-violet-400 mb-1">
                        <span className="truncate">{p.filename}</span>
                        <span>{p.percent}%</span>
                      </div>
                      <div className="w-full bg-lavender-100 rounded-full h-1.5">
                        <div
                          className="bg-gradient-to-r from-violet-400 to-pink-400 h-1.5 rounded-full transition-all"
                          style={{ width: `${p.percent}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* アップロード中スピナー（ファイルなし） */}
              {step === "uploading" && uploadProgress.length === 0 && (
                <div className="flex items-center gap-2 text-violet-400 text-sm py-1">
                  <Loader size={15} className="animate-spin" />
                  アップロード中...
                </div>
              )}

              {/* タスク作成直後（task未取得） */}
              {step === "submitted" && !task && (
                <div className="flex items-center gap-2 text-violet-400 text-sm py-1">
                  <Loader size={15} className="animate-spin" />
                  処理を開始しています...
                </div>
              )}

              {/* 処理状況 */}
              {task && (
                <div className="space-y-3">
                  <StepBadge index={2} />
                  <TaskStatus task={task} pollingError={pollingError} />

                  {/* 完了後：モーダルを閉じた場合に再表示ボタン */}
                  {task.status === "COMPLETED" && downloadUrl && !showModal && (
                    <button
                      onClick={() => setShowModal(true)}
                      className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-2xl border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-600 text-sm font-medium transition-colors"
                    >
                      <Sparkles size={14} />
                      プレビューを再表示
                    </button>
                  )}
                </div>
              )}

              {/* 完了 or 失敗時：リセットボタン */}
              {(task?.status === "COMPLETED" || task?.status === "FAILED") && (
                <button
                  onClick={handleReset}
                  className="w-full py-3 rounded-2xl border border-lavender-200 hover:bg-lavender-50 text-violet-500 font-medium transition-colors text-sm"
                >
                  リセット
                </button>
              )}
            </>
          )}
        </div>

        <p className="text-center text-xs text-violet-300 mt-8">
          Powered by AWS ECS Fargate · Amazon Bedrock · Strands Agents
        </p>
      </div>
    </div>
  );
}
