interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const EXAMPLES = [
  "0秒から20秒までトリミングして",
  "動画の最初にロゴ画像を5秒間表示して",
  "video1.mp4とvideo2.mp4を順番に結合して",
];

export function InstructionBox({ value, onChange, disabled }: Props) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">
        編集指示
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={3}
        placeholder="例: 0秒から30秒までトリミングして"
        className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:bg-gray-50 resize-none"
      />
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={disabled}
            onClick={() => onChange(ex)}
            className="text-xs bg-gray-100 hover:bg-blue-50 hover:text-blue-600 text-gray-500 rounded-full px-3 py-1 transition-colors disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
