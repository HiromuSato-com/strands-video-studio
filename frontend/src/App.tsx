import { useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
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

  // Fetch download URL when task completes
  const handleCompleted = useCallback(
    async (completedTaskId: string) => {
      if (downloadUrl) return; // already fetched
      try {
        const res = await getDownloadUrl(completedTaskId);
        setDownloadUrl(res.download_url);
        setDownloadKey(res.output_key);
      } catch (e) {
        // silently ignore — user can still see task status
        console.error("Failed to get download URL", e);
      }
    },
    [downloadUrl]
  );

  // Watch for task completion
  if (task?.status === "COMPLETED" && !downloadUrl && taskId) {
    handleCompleted(taskId);
  }

  const handleSubmit = async () => {
    if (files.length === 0) {
      setSubmitError("ファイルを選択してください");
      return;
    }
    if (!instruction.trim()) {
      setSubmitError("編集指示を入力してください");
      return;
    }

    setSubmitError(null);
    setStep("uploading");
    setDownloadUrl(null);
    setDownloadKey(null);

    const newTaskId = uuidv4();

    try {
      // Upload all files to S3 in parallel
      const initialProgress = files.map((f) => ({
        filename: f.name,
        percent: 0,
      }));
      setUploadProgress(initialProgress);

      const inputKeys = await Promise.all(
        files.map(async (file, i) => {
          const { upload_url, key } = await getUploadUrl(
            newTaskId,
            file.name
          );
          await uploadFileToS3(upload_url, file, (percent) => {
            setUploadProgress((prev) =>
              prev.map((p, idx) => (idx === i ? { ...p, percent } : p))
            );
          });
          return key;
        })
      );

      // Create the task
      const { task_id } = await createTask(instruction, inputKeys);
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white">
      <div className="max-w-2xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold mb-2">🎬 AI 動画編集</h1>
          <p className="text-gray-400 text-sm">
            Strands Agents × Claude Sonnet × MoviePy
          </p>
        </div>

        {/* Main card */}
        <div className="bg-white text-gray-900 rounded-2xl shadow-2xl p-6 space-y-6">
          {/* Step 1: Upload */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              1. ファイルを選択
            </h2>
            <UploadZone onFilesSelected={setFiles} disabled={isProcessing} />
          </section>

          {/* Step 2: Instruction */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              2. 編集指示を入力
            </h2>
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
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span className="truncate">{p.filename}</span>
                    <span>{p.percent}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div
                      className="bg-blue-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${p.percent}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Submit error */}
          {submitError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              {submitError}
            </p>
          )}

          {/* Submit / Reset buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleSubmit}
              disabled={isProcessing}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors shadow"
            >
              {step === "uploading"
                ? "アップロード中..."
                : step === "submitted"
                ? "処理中..."
                : "編集を開始"}
            </button>
            {(step === "submitted" || task?.status === "COMPLETED" || task?.status === "FAILED") && (
              <button
                onClick={handleReset}
                className="px-5 py-3 rounded-xl border border-gray-300 hover:bg-gray-50 text-gray-600 font-medium transition-colors"
              >
                リセット
              </button>
            )}
          </div>

          {/* Step 3: Task status */}
          {task && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                3. 処理状況
              </h2>
              <TaskStatus task={task} pollingError={pollingError} />
            </section>
          )}

          {/* Step 4: Preview & Download */}
          {task?.status === "COMPLETED" && downloadUrl && (
            <section className="space-y-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                4. 結果プレビュー & ダウンロード
              </h2>
              <VideoPreview src={downloadUrl} />
              <DownloadButton
                downloadUrl={downloadUrl}
                outputKey={downloadKey ?? "output.mp4"}
              />
            </section>
          )}
        </div>

        <p className="text-center text-xs text-gray-600 mt-8">
          Powered by AWS ECS Fargate · Amazon Bedrock · Strands Agents
        </p>
      </div>
    </div>
  );
}
