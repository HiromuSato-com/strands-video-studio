import { useCallback, useRef, useState } from "react";
import { UploadCloud, Film, ImageIcon, X } from "lucide-react";
import { playSound, Snd } from "../lib/snd";

interface Props {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
}

const ACCEPTED_TYPES = [
  "video/mp4", "video/quicktime", "video/x-msvideo", "video/webm",
  "image/jpeg", "image/png", "image/gif", "image/webp",
];

function isAccepted(f: File) {
  return (
    ACCEPTED_TYPES.includes(f.type) ||
    /\.(mp4|mov|avi|webm|jpg|jpeg|png|gif|webp)$/i.test(f.name)
  );
}

const C = {
  border:    "#9C8660",
  accent:    "#7A4E22",
  textMain:  "#1A1308",
  textSub:   "#3D2C18",
  textMuted: "#6B5438",
} as const;

export function UploadZone({ onFilesSelected, disabled, className }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    (incoming: FileList | null) => {
      if (!incoming) return;
      const valid = Array.from(incoming).filter(isAccepted);
      if (valid.length === 0) return;
      setSelectedFiles((prev) => {
        const existingKeys = new Set(prev.map((f) => `${f.name}-${f.size}`));
        const merged = [
          ...prev,
          ...valid.filter((f) => !existingKeys.has(`${f.name}-${f.size}`)),
        ];
        onFilesSelected(merged);
        if (merged.length > prev.length) playSound(Snd.SOUNDS.TAP);
        return merged;
      });
      if (inputRef.current) inputRef.current.value = "";
    },
    [onFilesSelected]
  );

  const removeFile = useCallback(
    (index: number) => {
      playSound(Snd.SOUNDS.TAP);
      setSelectedFiles((prev) => {
        const next = prev.filter((_, i) => i !== index);
        onFilesSelected(next);
        return next;
      });
    },
    [onFilesSelected]
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      if (!disabled) addFiles(e.dataTransfer.files);
    },
    [addFiles, disabled]
  );

  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      {/* ドロップゾーン */}
      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => { if (!disabled) inputRef.current?.click(); }}
        className="flex-shrink-0 flex flex-col justify-center text-center p-6 rounded-lg cursor-pointer transition-all"
        style={{
          border: `1.5px dashed ${isDragging ? C.accent : C.border}`,
          background: isDragging ? "rgba(122,78,34,0.08)" : "rgba(255,255,255,0.35)",
          boxShadow: isDragging
            ? `inset 0 2px 10px rgba(122,78,34,0.14), 0 0 16px rgba(122,78,34,0.25)`
            : `inset 0 2px 8px rgba(12,10,5,0.18)`,
        }}
      >
        <UploadCloud
          size={36}
          className="mx-auto mb-3 transition-colors"
          style={{ color: isDragging ? C.accent : C.textMuted }}
        />
        <p className="text-sm font-medium" style={{ color: C.textMain }}>
          動画・画像をドロップ
        </p>
        <p className="text-xs mt-1.5" style={{ color: C.textMuted }}>
          クリックで選択（複数可）
        </p>
        <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>
          ファイルなしでも動画生成が可能
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".mp4,.mov,.avi,.webm,.jpg,.jpeg,.png,.gif,.webp"
          className="hidden"
          disabled={disabled}
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {/* ファイル一覧 */}
      {selectedFiles.length > 0 && (
        <div className="md:flex-1 md:min-h-0 overflow-y-auto flex flex-col gap-1">
          <p className="flex-shrink-0 text-xs font-medium px-0.5" style={{ color: C.textMuted }}>
            {selectedFiles.length} 件選択済み
          </p>
          <ul className="space-y-1.5">
            {selectedFiles.map((f, i) => (
              <li
                key={`${f.name}-${f.size}`}
                className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg"
                style={{ background: "rgba(255,255,255,0.6)", border: `1px solid ${C.border}` }}
              >
                <span className="flex-shrink-0" style={{ color: C.textMuted }}>
                  {f.type.startsWith("video") ? <Film size={13} /> : <ImageIcon size={13} />}
                </span>
                <span className="truncate flex-1 text-xs" style={{ color: C.textMain }}>{f.name}</span>
                <span className="text-xs whitespace-nowrap" style={{ color: C.textMuted }}>
                  {(f.size / 1024 / 1024).toFixed(1)} MB
                </span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                    className="ml-1 transition-colors"
                    style={{ color: C.textMuted }}
                    onMouseEnter={e => (e.currentTarget.style.color = "#9B2C2C")}
                    onMouseLeave={e => (e.currentTarget.style.color = C.textMuted)}
                    aria-label="削除"
                  >
                    <X size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
