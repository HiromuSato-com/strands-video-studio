import { useEffect, useRef, useState } from "react";
import { MessageSquare, Send, Loader, CheckCheck } from "lucide-react";
import type { ChatMessage } from "../types";

const C = {
  card:        "#F3EDE1",
  border:      "#D4C9B5",
  accent:      "#9B6B3A",
  accentHover: "#7D5530",
  textMain:    "#1C1810",
  textSub:     "#8A7D6A",
  textMuted:   "#B8AC9C",
  userBg:      "#9B6B3A",
  aiBg:        "#EDE4D4",
} as const;

const HINTS = [
  "夕焼けの映像を5秒生成したい",
  "動画の最初の10秒をカットしてください",
  "2つの動画をつなぎ合わせたい",
];

interface Props {
  messages: ChatMessage[];
  onSend: (message: string) => Promise<void>;
  onConfirm: () => Promise<void>;
  isLoading: boolean;
  disabled?: boolean;
}

export function ChatBox({ messages, onSend, onConfirm, isLoading, disabled }: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading || disabled) return;
    setInput("");
    await onSend(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasConversation = messages.length >= 2;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      {/* Message list */}
      <div
        className="flex-1 overflow-y-auto rounded-lg p-3 space-y-3 min-h-0"
        style={{ background: "#FAFAF7", border: `1px solid ${C.border}` }}
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
            <MessageSquare size={28} style={{ color: C.textMuted }} />
            <p className="text-xs" style={{ color: C.textSub }}>
              AIと対話しながら動画指示を固めましょう
            </p>
            <div className="flex flex-col gap-1.5 w-full max-w-xs">
              {HINTS.map((hint) => (
                <button
                  key={hint}
                  type="button"
                  onClick={() => setInput(hint)}
                  className="text-xs px-3 py-1.5 rounded-lg text-left transition-colors"
                  style={{
                    background: C.aiBg,
                    border: `1px solid ${C.border}`,
                    color: C.textSub,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = C.accent)}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
                >
                  {hint}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className="max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed"
                  style={
                    msg.role === "user"
                      ? { background: C.userBg, color: "#FFF" }
                      : {
                          background: C.aiBg,
                          color: C.textMain,
                          border: `1px solid ${C.border}`,
                        }
                  }
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div
                  className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs"
                  style={{
                    background: C.aiBg,
                    color: C.textSub,
                    border: `1px solid ${C.border}`,
                  }}
                >
                  <Loader size={11} className="animate-spin" />
                  考え中...
                </div>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div className="flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="メッセージを入力（Enter で送信）"
          disabled={disabled || isLoading}
          rows={2}
          className="flex-1 resize-none rounded-lg px-3 py-2 text-xs outline-none transition-colors"
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            color: C.textMain,
          }}
          onFocus={e => (e.currentTarget.style.borderColor = C.accent)}
          onBlur={e => (e.currentTarget.style.borderColor = C.border)}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || isLoading || disabled}
          className="rounded-lg p-2.5 transition-colors flex-shrink-0"
          style={{
            background: input.trim() && !isLoading ? C.accent : C.border,
            color: "#FFF",
          }}
        >
          <Send size={14} />
        </button>
      </div>

      {/* Confirm button — shown after ≥1 exchange */}
      {hasConversation && (
        <button
          type="button"
          onClick={onConfirm}
          disabled={isLoading || disabled}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors"
          style={{
            background: C.accent,
            color: "#FFF",
            opacity: isLoading ? 0.6 : 1,
          }}
          onMouseEnter={e => {
            if (!isLoading) e.currentTarget.style.background = C.accentHover;
          }}
          onMouseLeave={e => (e.currentTarget.style.background = C.accent)}
        >
          <CheckCheck size={13} />
          この内容で確定して指示欄に反映
        </button>
      )}
    </div>
  );
}
