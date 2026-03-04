export type TaskStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export interface Task {
  task_id: string;
  status: TaskStatus;
  instruction: string;
  input_keys: string[];
  output_key?: string;
  created_at: string;
  updated_at: string;
  error_message?: string;
  agent_result?: string;
}

export interface UploadUrlResponse {
  upload_url: string;
  key: string;
}

export interface CreateTaskResponse {
  task_id: string;
}

export interface DownloadUrlResponse {
  download_url: string;
  output_key: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatMessageResponse {
  reply: string;
  messages: ChatMessage[];
}

export interface ChatConfirmResponse {
  instruction: string;
}
