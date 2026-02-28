import { useEffect, useRef } from "react";

interface Props {
  src: string;
}

export function VideoPreview({ src }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // Reload video element when src changes
    if (videoRef.current) {
      videoRef.current.load();
    }
  }, [src]);

  return (
    <div className="rounded-xl overflow-hidden bg-black shadow-lg">
      <video
        ref={videoRef}
        controls
        className="w-full max-h-[480px] object-contain"
      >
        <source src={src} />
        お使いのブラウザは動画再生に対応していません。
      </video>
    </div>
  );
}
