import { Clock, Loader, CheckCircle, XCircle } from "lucide-react";
import type { Task } from "../types";

interface Props {
  task: Task | null;
  pollingError: string | null;
}

const STATUS_CONFIG = {
  PENDING: {
    Icon: Clock,
    label: "準備中",
    color: "text-amber-500",
    bg: "bg-amber-50 border-amber-200",
    iconClass: "text-amber-400",
    spin: false,
  },
  RUNNING: {
    Icon: Loader,
    label: "処理中",
    color: "text-violet-600",
    bg: "bg-violet-50 border-violet-200",
    iconClass: "text-violet-400",
    spin: true,
  },
  COMPLETED: {
    Icon: CheckCircle,
    label: "完了",
    color: "text-emerald-600",
    bg: "bg-emerald-50 border-emerald-200",
    iconClass: "text-emerald-500",
    spin: false,
  },
  FAILED: {
    Icon: XCircle,
    label: "失敗",
    color: "text-rose-600",
    bg: "bg-rose-50 border-rose-200",
    iconClass: "text-rose-400",
    spin: false,
  },
} as const;

export function TaskStatus({ task, pollingError }: Props) {
  if (!task) return null;

  const config = STATUS_CONFIG[task.status];
  const { Icon } = config;

  return (
    <div className={`rounded-2xl border p-4 ${config.bg}`}>
      <div className="flex items-center gap-3">
        <Icon
          size={24}
          className={`${config.iconClass} flex-shrink-0 ${config.spin ? "animate-spin" : ""}`}
        />
        <div className="flex-1">
          <div className={`font-semibold ${config.color}`}>{config.label}</div>
          <div className="text-xs text-violet-300 mt-0.5">
            タスクID: {task.task_id}
          </div>
        </div>
      </div>

      {task.status === "FAILED" && task.error_message && (
        <p className="mt-3 text-sm text-rose-700 bg-rose-100 rounded-xl p-3">
          {task.error_message}
        </p>
      )}

      {pollingError && (
        <p className="mt-2 text-xs text-rose-400">
          ステータス取得エラー: {pollingError}
        </p>
      )}
    </div>
  );
}
