import { useCallback, useState } from "react";

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

export function UploadZone({ onFilesSelected, disabled }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      const valid = Array.from(files).filter((f) =>
        ACCEPTED_TYPES.some(
          (t) =>
            f.type === t ||
            f.name.match(/\.(mp4|mov|avi|webm|jpg|jpeg|png|gif|webp)$/i)
        )
      );
      setSelectedFiles(valid);
      onFilesSelected(valid);
    },
    [onFilesSelected]
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          isDragging
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 hover:border-blue-400 hover:bg-gray-50"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        onClick={() => {
          if (!disabled) document.getElementById("file-input")?.click();
        }}
      >
        <div className="text-4xl mb-3">🎬</div>
        <p className="text-gray-600 font-medium">
          動画・画像ファイルをドロップ
        </p>
        <p className="text-sm text-gray-400 mt-1">
          または クリックしてファイルを選択
        </p>
        <p className="text-xs text-gray-400 mt-2">
          対応形式: MP4, MOV, AVI, WebM, JPG, PNG, GIF, WebP
        </p>
        <input
          id="file-input"
          type="file"
          multiple
          accept=".mp4,.mov,.avi,.webm,.jpg,.jpeg,.png,.gif,.webp"
          className="hidden"
          disabled={disabled}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {selectedFiles.length > 0 && (
        <ul className="space-y-1">
          {selectedFiles.map((f, i) => (
            <li
              key={i}
              className="flex items-center gap-2 text-sm text-gray-700 bg-gray-100 rounded px-3 py-1.5"
            >
              <span className="text-base">
                {f.type.startsWith("video") ? "🎥" : "🖼️"}
              </span>
              <span className="truncate">{f.name}</span>
              <span className="ml-auto text-gray-400 text-xs whitespace-nowrap">
                {(f.size / 1024 / 1024).toFixed(1)} MB
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
