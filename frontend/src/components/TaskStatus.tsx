import type { Task, TaskStatus as TStatus } from "../types";

const C = {
  accent:   "#7A4E22",
  accentHi: "#C49035",
  textMain: "#1A1308",
  textSub:  "#3D2C18",
  textMuted:"#6B5438",
  border:   "#9C8660",
  ok:       "#2C6B3A",
  error:    "#9B2C2C",
} as const;

const PHASES = [
  { label: "STAND BY" },
  { label: "PROCESS"  },
  { label: "COMPLETE" },
];

interface PhaseConfig {
  phaseIdx: number;
  label: string;
  sub: string;
  pct: number;
  color: string;
}

const STATUS_INFO: Record<TStatus, PhaseConfig> = {
  PENDING:   { phaseIdx: 0, label: "STAND BY",   sub: "システム準備中", pct: 12,  color: C.textMuted },
  RUNNING:   { phaseIdx: 1, label: "PROCESSING", sub: "AI処理実行中",  pct: 62,  color: C.accent    },
  COMPLETED: { phaseIdx: 2, label: "COMPLETE",   sub: "ミッション達成", pct: 100, color: C.ok        },
  FAILED:    { phaseIdx: -1, label: "SYS ERROR", sub: "処理失敗",      pct: 0,   color: C.error     },
};

const SEG = 20;

interface Props {
  task: Task | null;
  pollingError: string | null;
}

export function TaskStatus({ task, pollingError }: Props) {
  if (!task) return null;

  const info    = STATUS_INFO[task.status];
  const filled  = Math.round((info.pct / 100) * SEG);
  const isRunning = task.status === "RUNNING";
  const isFailed  = task.status === "FAILED";

  return (
    <div className="space-y-2.5">

      {/* Phase trail — STAND BY ── PROCESS ── COMPLETE */}
      {!isFailed && (
        <div className="flex items-center gap-1.5 text-[9px] font-mono tracking-[0.2em] uppercase select-none">
          {PHASES.map((ph, i) => {
            const done   = info.phaseIdx > i;
            const active = info.phaseIdx === i;
            return (
              <span key={ph.label} className="flex items-center gap-1.5">
                <span style={{ color: active ? info.color : done ? C.textSub : C.border, fontWeight: active ? 700 : 400 }}>
                  {active ? "▶ " : done ? "✓ " : "· "}{ph.label}
                </span>
                {i < PHASES.length - 1 && (
                  <span style={{ color: C.border }}>──</span>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* HUD panel */}
      <div
        className="rounded-lg p-5 space-y-4"
        style={{
          background: "rgba(255,255,255,0.45)",
          border: `1px solid ${isFailed ? "#FEB2B2" : C.border}`,
          boxShadow: isRunning
            ? "inset 0 2px 8px rgba(12,10,5,0.12), 0 0 18px rgba(155,107,58,0.14)"
            : "inset 0 2px 8px rgba(12,10,5,0.08)",
        }}
      >
        {/* Status label + task ID */}
        <div className="flex items-start justify-between">
          <div>
            <div
              className="flex items-center gap-2 text-sm font-mono font-bold tracking-[0.18em] uppercase"
              style={{ color: info.color }}
            >
              {isRunning && (
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ background: C.accent }}
                />
              )}
              {info.label}
            </div>
            <div className="text-xs mt-0.5" style={{ color: C.textMuted }}>
              {info.sub}
            </div>
          </div>
          <div className="text-right font-mono" style={{ color: C.textMuted }}>
            <div className="text-[9px] tracking-widest uppercase">TASK ID</div>
            <div className="text-[10px] mt-0.5" style={{ color: C.textSub }}>
              {task.task_id.slice(0, 8).toUpperCase()}
            </div>
          </div>
        </div>

        {/* Segmented progress bar */}
        {!isFailed && (
          <div className="space-y-1">
            <div className="flex gap-[3px]">
              {Array.from({ length: SEG }, (_, i) => (
                <div
                  key={i}
                  className="h-2 flex-1 rounded-sm transition-all duration-700"
                  style={{ background: i < filled ? info.color : "rgba(28,24,16,0.1)" }}
                />
              ))}
            </div>
            <div className="flex justify-between text-[9px] font-mono" style={{ color: C.textMuted }}>
              <span>PWR</span>
              <span>{info.pct}%</span>
            </div>
          </div>
        )}

        {/* Error message */}
        {isFailed && task.error_message && (
          <p
            className="text-xs px-3 py-2 rounded"
            style={{ color: C.error, background: "#FFF5F5", border: "1px solid #FEB2B2" }}
          >
            {task.error_message}
          </p>
        )}
      </div>

      {pollingError && (
        <p className="text-[10px] px-1 font-mono" style={{ color: C.error }}>
          POLL ERR: {pollingError}
        </p>
      )}
    </div>
  );
}
