import { X } from "lucide-react";
import { ChatBox } from "./ChatBox";
import type { ChatMessage } from "../types";

const C = {
  card:   "#F3EDE1",
  border: "#D4C9B5",
  accent: "#9B6B3A",
} as const;

interface Props {
  messages: ChatMessage[];
  onSend: (message: string) => Promise<void>;
  onConfirm: () => Promise<void>;
  onReset?: () => void;
  isLoading: boolean;
  onClose: () => void;
}

export function ChatModal({ messages, onSend, onConfirm, onReset, isLoading, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(6,4,2,0.82)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-4xl flex flex-col rounded-xl shadow-2xl overflow-hidden"
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          height: "min(88vh, 820px)",
        }}
      >
        {/* Header stripe */}
        <div style={{ height: "3px", background: `linear-gradient(90deg, ${C.accent} 0%, #D4A96A 55%, ${C.accent} 100%)`, flexShrink: 0 }} />

        {/* Title bar */}
        <div
          className="flex items-center justify-between px-4 py-2.5 flex-shrink-0"
          style={{ borderBottom: `1px solid ${C.border}` }}
        >
          <span className="text-sm font-medium" style={{ color: "#1C1810" }}>
            AIとチャットで指示を作成
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded transition-colors"
            style={{ color: "#B8AC9C" }}
            onMouseEnter={e => (e.currentTarget.style.color = C.accent)}
            onMouseLeave={e => (e.currentTarget.style.color = "#B8AC9C")}
          >
            <X size={15} />
          </button>
        </div>

        {/* ChatBox — flex-1 で残り高さをすべて使う */}
        <div className="flex-1 min-h-0 p-4 flex flex-col">
          <ChatBox
            messages={messages}
            onSend={onSend}
            onConfirm={async () => { await onConfirm(); }}
            onReset={onReset}
            isLoading={isLoading}
            disabled={false}
          />
        </div>
      </div>
    </div>
  );
}
