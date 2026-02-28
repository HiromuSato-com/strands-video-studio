import { useState, useEffect, useRef } from "react";
import type { Task, TaskStatus } from "../types";
import { getTask } from "../api/client";

const POLL_INTERVAL_MS = 3000;
const TERMINAL_STATUSES: TaskStatus[] = ["COMPLETED", "FAILED"];

export function useTaskPoller(taskId: string | null) {
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!taskId) {
      setTask(null);
      setError(null);
      return;
    }

    const fetchTask = async () => {
      try {
        const t = await getTask(taskId);
        setTask(t);
        setError(null);

        if (TERMINAL_STATUSES.includes(t.status) && intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch task");
      }
    };

    fetchTask();
    intervalRef.current = setInterval(fetchTask, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [taskId]);

  return { task, error };
}
