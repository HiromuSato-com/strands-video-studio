import { useCallback, useRef, useState } from "react";

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
        // deduplicate by name+size
        const existingKeys = new Set(prev.map((f) => `${f.name}-${f.size}`));
        const merged = [
          ...prev,
          ...valid.filter((f) => !existingKeys.has(`${f.name}-${f.size}`)),
        ];
        onFilesSelected(merged);
        return merged;
      });
      // reset input so same file can be re-added after removal
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
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          isDragging
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 hover:border-blue-400 hover:bg-gray-50"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        onClick={() => {
          if (!disabled) inputRef.current?.click();
        }}
      >
        <div className="text-4xl mb-3">🎬</div>
        <p className="text-gray-600 font-medium">
          動画・画像ファイルをドロップ
        </p>
        <p className="text-sm text-gray-400 mt-1">
          または クリックしてファイルを選択（複数可・追加可）
        </p>
        <p className="text-xs text-gray-400 mt-2">
          対応形式: MP4, MOV, AVI, WebM, JPG, PNG, GIF, WebP
        </p>
        <p className="text-xs text-blue-400 mt-1">
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
        <ul className="space-y-1">
          {selectedFiles.map((f, i) => (
            <li
              key={`${f.name}-${f.size}`}
              className="flex items-center gap-2 text-sm text-gray-700 bg-gray-100 rounded px-3 py-1.5"
            >
              <span className="text-base">
                {f.type.startsWith("video") ? "🎥" : "🖼️"}
              </span>
              <span className="truncate flex-1">{f.name}</span>
              <span className="text-gray-400 text-xs whitespace-nowrap">
                {(f.size / 1024 / 1024).toFixed(1)} MB
              </span>
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(i);
                  }}
                  className="text-gray-400 hover:text-red-500 transition-colors ml-1"
                  aria-label="削除"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
