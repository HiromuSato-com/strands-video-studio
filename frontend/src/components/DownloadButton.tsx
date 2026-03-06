import { Download } from "lucide-react";

interface Props {
  downloadUrl: string;
  outputKey: string;
}

const C = {
  accent:    "#7A4E22",
  accentHov: "#6B4318",
  card:      "#E2D4B8",
} as const;

export function DownloadButton({ downloadUrl, outputKey }: Props) {
  const filename = outputKey.split("/").pop() ?? "output.mp4";

  return (
    <a
      href={downloadUrl}
      download={filename}
      className="inline-flex items-center gap-2 font-mono font-semibold text-[11px] tracking-wider px-6 py-3 rounded-lg transition-colors"
      style={{ background: C.accent, color: C.card }}
      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = C.accentHov)}
      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = C.accent)}
    >
      <Download size={14} />
      {filename} をダウンロード
    </a>
  );
}
