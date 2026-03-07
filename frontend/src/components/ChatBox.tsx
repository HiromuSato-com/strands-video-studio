import { useEffect, useRef, useState } from "react";
import { Send, CheckCheck, RotateCcw } from "lucide-react";
import type { ChatMessage } from "../types";

const C = {
  card:        "#E2D4B8",
  border:      "#9C8660",
  accent:      "#7A4E22",
  accentHover: "#6B4318",
  textMain:    "#1A1308",
  textSub:     "#3D2C18",
  textMuted:   "#6B5438",
  userBg:      "#7A4E22",
  aiBg:        "#D4C4A0",
  codeBg:      "#2A2318",
  codeFg:      "#E2D4B8",
  codeLabelBg: "#3A3020",
} as const;

// ── Inline markdown: **bold**, *italic*, `code` ────────────────────────────
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*"))
      return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith("`") && part.endsWith("`"))
      return (
        <code
          key={i}
          className="px-1 py-0.5 rounded text-[0.7rem] font-mono"
          style={{ background: "#C0AC84", color: "#3A2010" }}
        >
          {part.slice(1, -1)}
        </code>
      );
    return <span key={i}>{part}</span>;
  });
}

// ── Fenced code block ─────────────────────────────────────────────────────
function CodeBlock({ raw }: { raw: string }) {
  const inner = raw.slice(3, -3); // strip opening/closing ```
  const newlineIdx = inner.indexOf("\n");
  const lang = newlineIdx > 0 ? inner.slice(0, newlineIdx).trim() : "";
  const code = newlineIdx > 0 ? inner.slice(newlineIdx + 1) : inner;

  return (
    <div className="rounded-lg overflow-hidden text-[0.7rem] font-mono my-1" style={{ background: C.codeBg }}>
      {lang && (
        <div
          className="px-3 py-0.5 text-[0.65rem] tracking-wider uppercase select-none"
          style={{ background: C.codeLabelBg, color: C.textMuted }}
        >
          {lang}
        </div>
      )}
      <pre
        className="px-3 py-2.5 overflow-x-auto leading-relaxed m-0"
        style={{ color: C.codeFg }}
      >
        <code>{code.trimEnd()}</code>
      </pre>
    </div>
  );
}

// ── Block markdown: headings, lists, paragraphs ───────────────────────────
function BlockMarkdown({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let listBuf: string[] = [];
  let key = 0;

  const flushList = () => {
    if (listBuf.length === 0) return;
    elements.push(
      <ul
        key={key++}
        className="space-y-0.5"
        style={{ listStyleType: "disc", paddingLeft: "1.1rem" }}
      >
        {listBuf.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
      </ul>
    );
    listBuf = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("### ")) {
      flushList();
      elements.push(
        <p key={key++} className="font-semibold text-[0.78rem]" style={{ color: C.accent }}>
          {renderInline(line.slice(4))}
        </p>
      );
    } else if (line.startsWith("## ")) {
      flushList();
      elements.push(
        <p key={key++} className="font-bold text-[0.8rem]" style={{ color: C.accent }}>
          {renderInline(line.slice(3))}
        </p>
      );
    } else if (line.startsWith("# ")) {
      flushList();
      elements.push(
        <p key={key++} className="font-bold text-[0.85rem]" style={{ color: C.accentHover }}>
          {renderInline(line.slice(2))}
        </p>
      );
    } else if (/^[-*] /.test(line)) {
      listBuf.push(line.slice(2));
    } else if (/^\d+\. /.test(line)) {
      listBuf.push(line.replace(/^\d+\. /, ""));
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      elements.push(<p key={key++}>{renderInline(line)}</p>);
    }
  }
  flushList();
  return <>{elements}</>;
}

// ── AI message: split by fenced code blocks first ────────────────────────
function AIMessageContent({ content }: { content: string }) {
  // Split on ``` ... ``` (including language hint, multiline)
  const segments = content.split(/(```[\s\S]*?```)/);

  return (
    <div className="space-y-1 leading-relaxed">
      {segments.map((seg, i) =>
        seg.startsWith("```") && seg.endsWith("```") ? (
          <CodeBlock key={i} raw={seg} />
        ) : (
          <BlockMarkdown key={i} content={seg} />
        )
      )}
    </div>
  );
}

// ── Typing dots ───────────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div className="flex justify-start items-end gap-2">
      {/* Avatar dot matching AI message style */}
      <span
        className="w-5 h-5 rounded-full flex-shrink-0 mb-0.5"
        style={{ background: C.aiBg, border: `1px solid ${C.border}` }}
      />
      <div
        className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm px-4 py-3"
        style={{ background: C.aiBg, border: `1px solid ${C.border}` }}
      >
        {[0, 160, 320].map((delay) => (
          <span
            key={delay}
            className="inline-block w-2 h-2 rounded-full"
            style={{
              background: C.accent,
              animation: `typingPulse 1.2s ease-in-out ${delay}ms infinite`,
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes typingPulse {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
          30%            { transform: translateY(-5px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────
interface Props {
  messages: ChatMessage[];
  onSend: (message: string) => Promise<void>;
  onConfirm: () => Promise<void>;
  onReset?: () => void;
  isLoading: boolean;
  disabled?: boolean;
}

export function ChatBox({ messages, onSend, onConfirm, onReset, isLoading, disabled }: Props) {
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
  const inputBlocked = disabled || isLoading;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">

      {/* Reset link — top-right, only when messages exist */}
      {messages.length > 0 && onReset && (
        <div className="flex justify-end flex-shrink-0 -mb-1">
          <button
            type="button"
            onClick={onReset}
            disabled={isLoading}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition-colors"
            style={{ color: C.textMuted, opacity: isLoading ? 0.4 : 1 }}
            onMouseEnter={e => (e.currentTarget.style.color = C.accent)}
            onMouseLeave={e => (e.currentTarget.style.color = C.textMuted)}
          >
            <RotateCcw size={9} />
            会話をリセット
          </button>
        </div>
      )}

      {/* Message list */}
      <div
        className="flex-1 overflow-y-auto rounded-lg p-3 space-y-3 min-h-0 transition-all duration-300"
        style={{
          background: "#EDE3CC",
          border: `1px solid ${isLoading ? C.accent : C.border}`,
          boxShadow: isLoading ? `0 0 0 2px ${C.accent}22` : undefined,
        }}
      >
        {messages.length > 0 ? (
          <>
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "user" ? (
                  <div
                    className="max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed"
                    style={{ background: C.userBg, color: "#FFF" }}
                  >
                    {msg.content}
                  </div>
                ) : (
                  <div
                    className="max-w-[92%] rounded-lg px-3 py-2.5 text-xs"
                    style={{ background: C.aiBg, color: C.textMain, border: `1px solid ${C.border}` }}
                  >
                    <AIMessageContent content={msg.content} />
                  </div>
                )}
              </div>
            ))}
            {isLoading && <TypingDots />}
          </>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div
        className="flex gap-2 items-end transition-all duration-200"
        style={inputBlocked ? { opacity: 0.6, pointerEvents: "none" } : undefined}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isLoading ? "AIが応答中です..." : "メッセージを入力（Enter で送信）"}
          disabled={inputBlocked}
          rows={2}
          className="flex-1 resize-none rounded-lg px-3 py-2 text-xs outline-none transition-colors"
          style={{ background: C.card, border: `1px solid ${C.border}`, color: C.textMain }}
          onFocus={e => (e.currentTarget.style.borderColor = C.accent)}
          onBlur={e => (e.currentTarget.style.borderColor = C.border)}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || inputBlocked}
          className="rounded-lg p-2.5 transition-colors flex-shrink-0"
          style={{ background: input.trim() && !inputBlocked ? C.accent : C.border, color: "#FFF" }}
        >
          <Send size={14} />
        </button>
      </div>

      {/* Confirm button */}
      {hasConversation && (
        <button
          type="button"
          onClick={onConfirm}
          disabled={inputBlocked}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors"
          style={{ background: C.accent, color: "#FFF", opacity: inputBlocked ? 0.6 : 1 }}
          onMouseEnter={e => { if (!inputBlocked) e.currentTarget.style.background = C.accentHover; }}
          onMouseLeave={e => (e.currentTarget.style.background = C.accent)}
        >
          <CheckCheck size={13} />
          この内容で確定して指示欄に反映
        </button>
      )}
    </div>
  );
}
