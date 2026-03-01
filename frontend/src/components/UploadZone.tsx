import { useCallback, useRef, useState } from "react";
import { UploadCloud, Film, ImageIcon, X } from "lucide-react";

interface Props {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
}

const ACCEPTED_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

function isAccepted(f: File) {
  return (
    ACCEPTED_TYPES.includes(f.type) ||
    /\.(mp4|mov|avi|webm|jpg|jpeg|png|gif|webp)$/i.test(f.name)
  );
}

export function UploadZone({ onFilesSelected, disabled }: Props) {
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
        return merged;
      });
      if (inputRef.current) inputRef.current.value = "";
    },
    [onFilesSelected]
  );

  const removeFile = useCallback(
    (index: number) => {
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
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
          isDragging
            ? "border-violet-400 bg-lavender-50 scale-[1.01]"
            : "border-lavender-200 bg-lavender-50/30 hover:border-violet-300 hover:bg-lavender-50"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        onClick={() => {
          if (!disabled) inputRef.current?.click();
        }}
      >
        <UploadCloud
          size={40}
          className={`mx-auto mb-3 transition-colors ${
            isDragging ? "text-violet-400" : "text-violet-300"
          }`}
        />
        <p className="text-violet-600 font-medium">
          動画・画像ファイルをドロップ
        </p>
        <p className="text-sm text-violet-300 mt-1">
          または クリックしてファイルを選択（複数可・追加可）
        </p>
        <p className="text-xs text-violet-300 mt-2">
          対応形式: MP4, MOV, AVI, WebM, JPG, PNG, GIF, WebP
        </p>
        <p className="text-xs text-pink-400 mt-1">
          ファイルなしでも動画生成（AI テキスト→動画）が可能です
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

      {selectedFiles.length > 0 && (
        <ul className="space-y-1.5">
          {selectedFiles.map((f, i) => (
            <li
              key={`${f.name}-${f.size}`}
              className="flex items-center gap-2 text-sm text-violet-700 bg-white border border-pink-100 rounded-xl shadow-sm px-3 py-2"
            >
              <span className="text-violet-300 flex-shrink-0">
                {f.type.startsWith("video") ? (
                  <Film size={14} />
                ) : (
                  <ImageIcon size={14} />
                )}
              </span>
              <span className="truncate flex-1">{f.name}</span>
              <span className="text-violet-300 text-xs whitespace-nowrap">
                {(f.size / 1024 / 1024).toFixed(1)} MB
              </span>
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(i);
                  }}
                  className="text-violet-300 hover:text-rose-400 transition-colors ml-1"
                  aria-label="削除"
                >
                  <X size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
