import axios from "axios";
import type {
  UploadUrlResponse,
  CreateTaskResponse,
  Task,
  DownloadUrlResponse,
} from "../types";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "";

const api = axios.create({ baseURL: API_BASE_URL });

/**
 * Step 1: Get a presigned S3 PUT URL for a specific file.
 */
export async function getUploadUrl(
  taskId: string,
  filename: string
): Promise<UploadUrlResponse> {
  const { data } = await api.get<UploadUrlResponse>("/upload-url", {
    params: { task_id: taskId, filename },
  });
  return data;
}

/**
 * Step 2: Upload a file directly to S3 using the presigned URL.
 */
export async function uploadFileToS3(
  presignedUrl: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<void> {
  await axios.put(presignedUrl, file, {
    headers: { "Content-Type": file.type || "application/octet-stream" },
    onUploadProgress: (e) => {
      if (onProgress && e.total) {
        onProgress(Math.round((e.loaded * 100) / e.total));
      }
    },
  });
}

/**
 * Step 3: Create a task with instruction and S3 input keys.
 */
export async function createTask(
  taskId: string,
  instruction: string,
  inputKeys: string[],
  videoModel: "luma" | "nova_reel" = "luma"
): Promise<CreateTaskResponse> {
  const { data } = await api.post<CreateTaskResponse>("/tasks", {
    task_id: taskId,
    instruction,
    input_keys: inputKeys,
    video_model: videoModel,
  });
  return data;
}

/**
 * Step 4: Get the current status of a task.
 */
export async function getTask(taskId: string): Promise<Task> {
  const { data } = await api.get<Task>(`/tasks/${taskId}`);
  return data;
}

/**
 * Step 5: Get a presigned S3 GET URL for the completed task's output.
 */
export async function getDownloadUrl(
  taskId: string
): Promise<DownloadUrlResponse> {
  const { data } = await api.get<DownloadUrlResponse>(
    `/download-url/${taskId}`
  );
  return data;
}
