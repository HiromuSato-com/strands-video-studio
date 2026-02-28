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
      className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-medium px-6 py-3 rounded-lg transition-colors shadow"
    >
      <span className="text-lg">⬇️</span>
      {filename} をダウンロード
    </a>
  );
}
