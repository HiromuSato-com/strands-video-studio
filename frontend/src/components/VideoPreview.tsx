import { useEffect, useRef } from "react";

interface Props {
  src: string;
}

export function VideoPreview({ src }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.load();
    }
  }, [src]);

  return (
    <div className="bg-white rounded-3xl shadow-xl border border-lavender-100 overflow-hidden">
      {/* Canvas frame decoration */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-lavender-100 bg-lavender-50/50">
        <span className="w-3 h-3 rounded-full bg-rose-300" />
        <span className="w-3 h-3 rounded-full bg-violet-300" />
        <span className="w-3 h-3 rounded-full bg-emerald-300" />
      </div>
      <div className="bg-black">
        <video
          ref={videoRef}
          controls
          className="w-full max-h-[480px] object-contain"
        >
          <source src={src} />
          お使いのブラウザは動画再生に対応していません。
        </video>
      </div>
    </div>
  );
}
