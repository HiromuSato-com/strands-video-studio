import { useState, useEffect, useRef } from "react";
import type { Task, TaskStatus } from "../types";
import { getTask } from "../api/client";

const POLL_INTERVAL_MS = 3000;
const TERMINAL_STATUSES: TaskStatus[] = ["COMPLETED", "FAILED"];

export function useTaskPoller(taskId: string | null) {
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(false);

  useEffect(() => {
    if (!taskId) {
      setTask(null);
      setError(null);
      return;
    }

    activeRef.current = true;

    const fetchTask = async () => {
      if (!activeRef.current) return;
      try {
        const t = await getTask(taskId);
        if (!activeRef.current) return;
        setTask(t);
        setError(null);

        if (TERMINAL_STATUSES.includes(t.status)) {
          activeRef.current = false;
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }
      } catch (err) {
        if (!activeRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to fetch task");
      }
    };

    fetchTask();
    intervalRef.current = setInterval(fetchTask, POLL_INTERVAL_MS);

    return () => {
      activeRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [taskId]);

  return { task, error };
}
