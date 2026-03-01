import { useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { Film, PenLine, Activity, Sparkles, Palette, Loader } from "lucide-react";
import { UploadZone } from "./components/UploadZone";
import { InstructionBox } from "./components/InstructionBox";
import { TaskStatus } from "./components/TaskStatus";
import { VideoPreview } from "./components/VideoPreview";
import { DownloadButton } from "./components/DownloadButton";
import { useTaskPoller } from "./hooks/useTaskPoller";
import {
  getUploadUrl,
  uploadFileToS3,
  createTask,
  getDownloadUrl,
} from "./api/client";

type AppStep = "idle" | "uploading" | "submitted";

interface UploadProgress {
  filename: string;
  percent: number;
}

const STEP_LABELS = [
  {
    num: "1",
    label: "ファイルを選択",
    icon: Film,
    color: "bg-pink-100 text-pink-600 border-pink-200",
  },
  {
    num: "2",
    label: "創作指示を入力",
    icon: PenLine,
    color: "bg-violet-100 text-violet-600 border-violet-200",
  },
  {
    num: "3",
    label: "処理状況",
    icon: Activity,
    color: "bg-emerald-100 text-emerald-600 border-emerald-200",
  },
  {
    num: "4",
    label: "結果プレビュー",
    icon: Sparkles,
    color: "bg-amber-100 text-amber-600 border-amber-200",
  },
] as const;

export default function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [instruction, setInstruction] = useState("");
  const [step, setStep] = useState<AppStep>("idle");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadKey, setDownloadKey] = useState<string | null>(null);

  const { task, error: pollingError } = useTaskPoller(taskId);

  const isProcessing = step === "uploading" || step === "submitted";

  const handleCompleted = useCallback(
    async (completedTaskId: string) => {
      if (downloadUrl) return;
      try {
        const res = await getDownloadUrl(completedTaskId);
        setDownloadUrl(res.download_url);
        setDownloadKey(res.output_key);
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

    const newTaskId = uuidv4();

    try {
      const initialProgress = files.map((f) => ({
        filename: f.name,
        percent: 0,
      }));
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

      const { task_id } = await createTask(newTaskId, instruction, inputKeys);
      setTaskId(task_id);
      setStep("submitted");
    } catch (e) {
      setSubmitError(
        e instanceof Error ? e.message : "送信中にエラーが発生しました"
      );
      setStep("idle");
    }
  };

  const handleReset = () => {
    setFiles([]);
    setInstruction("");
    setStep("idle");
    setTaskId(null);
    setUploadProgress([]);
    setSubmitError(null);
    setDownloadUrl(null);
    setDownloadKey(null);
  };

  const StepBadge = ({ index }: { index: number }) => {
    const s = STEP_LABELS[index];
    const Icon = s.icon;
    return (
      <span
        className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border ${s.color} mb-3`}
      >
        <Icon size={12} />
        {s.num}. {s.label}
      </span>
    );
  };

  return (
    <div className="min-h-screen watercolor-bg">
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
        <div className="bg-white/80 backdrop-blur-sm border border-lavender-200 rounded-3xl shadow-xl shadow-violet-100/50 p-6 space-y-6">
          {/* Step 1: Upload */}
          <section>
            <StepBadge index={0} />
            <UploadZone onFilesSelected={setFiles} disabled={isProcessing} />
          </section>

          {/* Step 2: Instruction */}
          <section>
            <StepBadge index={1} />
            <InstructionBox
              value={instruction}
              onChange={setInstruction}
              disabled={isProcessing}
            />
          </section>

          {/* Upload progress */}
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

          {/* Submit error */}
          {submitError && (
            <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
              {submitError}
            </p>
          )}

          {/* Submit / Reset buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleSubmit}
              disabled={isProcessing}
              className={`flex-1 font-semibold py-3 rounded-2xl transition-all shadow-lg flex items-center justify-center gap-2 text-white ${
                isProcessing
                  ? "bg-gradient-to-r from-violet-300 to-pink-300 cursor-not-allowed"
                  : "bg-gradient-to-r from-violet-500 to-pink-400 hover:shadow-violet-200 hover:shadow-xl"
              }`}
            >
              {step === "uploading" ? (
                <>
                  <Loader size={16} className="animate-spin" />
                  アップロード中...
                </>
              ) : step === "submitted" ? (
                <>
                  <Loader size={16} className="animate-spin" />
                  処理中...
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  創作を開始
                </>
              )}
            </button>
            {(step === "submitted" ||
              task?.status === "COMPLETED" ||
              task?.status === "FAILED") && (
              <button
                onClick={handleReset}
                className="px-5 py-3 rounded-2xl border border-lavender-200 hover:bg-lavender-50 text-violet-500 font-medium transition-colors"
              >
                リセット
              </button>
            )}
          </div>

          {/* Step 3: Task status */}
          {task && (
            <section>
              <StepBadge index={2} />
              <TaskStatus task={task} pollingError={pollingError} />
            </section>
          )}

          {/* Step 4: Preview & Download */}
          {task?.status === "COMPLETED" && downloadUrl && (
            <section className="space-y-4">
              <StepBadge index={3} />
              <VideoPreview src={downloadUrl} />
              <DownloadButton
                downloadUrl={downloadUrl}
                outputKey={downloadKey ?? "output.mp4"}
              />
            </section>
          )}
        </div>

        <p className="text-center text-xs text-violet-300 mt-8">
          Powered by AWS ECS Fargate · Amazon Bedrock · Strands Agents
        </p>
      </div>
    </div>
  );
}
