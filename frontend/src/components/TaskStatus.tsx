import type { Task } from "../types";

interface Props {
  task: Task | null;
  pollingError: string | null;
}

const STATUS_CONFIG = {
  PENDING: {
    icon: "⏳",
    label: "準備中",
    color: "text-yellow-600",
    bg: "bg-yellow-50 border-yellow-200",
    showSpinner: false,
  },
  RUNNING: {
    icon: "⚙️",
    label: "処理中",
    color: "text-blue-600",
    bg: "bg-blue-50 border-blue-200",
    showSpinner: true,
  },
  COMPLETED: {
    icon: "✅",
    label: "完了",
    color: "text-green-600",
    bg: "bg-green-50 border-green-200",
    showSpinner: false,
  },
  FAILED: {
    icon: "❌",
    label: "失敗",
    color: "text-red-600",
    bg: "bg-red-50 border-red-200",
    showSpinner: false,
  },
} as const;

export function TaskStatus({ task, pollingError }: Props) {
  if (!task) return null;

  const config = STATUS_CONFIG[task.status];

  return (
    <div className={`rounded-xl border p-4 ${config.bg}`}>
      <div className="flex items-center gap-3">
        <span className="text-2xl">{config.icon}</span>
        <div className="flex-1">
          <div className={`font-semibold ${config.color}`}>
            {config.showSpinner && (
              <span className="inline-block w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mr-2 align-middle" />
            )}
            {config.label}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            タスクID: {task.task_id}
          </div>
        </div>
      </div>

      {task.status === "FAILED" && task.error_message && (
        <p className="mt-3 text-sm text-red-700 bg-red-100 rounded p-2">
          {task.error_message}
        </p>
      )}

      {pollingError && (
        <p className="mt-2 text-xs text-red-500">
          ステータス取得エラー: {pollingError}
        </p>
      )}
    </div>
  );
}
