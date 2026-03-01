import { Download } from "lucide-react";

interface Props {
  downloadUrl: string;
  outputKey: string;
}

export function DownloadButton({ downloadUrl, outputKey }: Props) {
  const filename = outputKey.split("/").pop() ?? "output.mp4";

  return (
    <a
      href={downloadUrl}
      download={filename}
      className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-medium px-6 py-3 rounded-2xl transition-colors shadow-lg shadow-emerald-100"
    >
      <Download size={16} />
      {filename} をダウンロード
    </a>
  );
}
