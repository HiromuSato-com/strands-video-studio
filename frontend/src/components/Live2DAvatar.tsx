import { useEffect, useRef, useState } from "react";
import type { CharacterState } from "./CharacterAvatar";

// ── Motion group mapping per state ────────────────────────────────────────
const MOTION_GROUP: Record<CharacterState, string> = {
  idle:      "Idle",
  thinking:  "FlickUp",
  working:   "Idle",
  complete:  "Tap",
  error:     "Flick",
  uploading: "Tap",      // せわしなく動く
  chatting:  "FlickUp",  // 考えている
  greeting:  "Tap",      // ファイルをもらって嬉しい
  waiting:   "FlickUp",  // ユーザーを見て待つ
};

interface ModelHandle {
  motion: (g: string, i?: number) => void;
}

interface Props {
  state: CharacterState;
  width: number;
  height: number;
}

export function Live2DAvatar({ state, width, height }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const appRef     = useRef<unknown>(null);
  const modelsRef  = useRef<ModelHandle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  // ── Initialize ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;
    let destroyed = false;

    async function init() {
      // oh-my-live2d bundles live2dcubismcore → sets window.Live2DCubismCore
      await import("oh-my-live2d");

      const [PIXI, { Live2DModel }] = await Promise.all([
        import("pixi.js"),
        import("pixi-live2d-display/cubism4"),
      ]);

      (Live2DModel as { registerTicker: (t: unknown) => void }).registerTicker(PIXI.Ticker);

      const app = new PIXI.Application({
        view:            canvasRef.current!,
        width,
        height,
        backgroundAlpha: 0,
        antialias:       true,
        resolution:      window.devicePixelRatio || 1,
        autoDensity:     true,
      });
      appRef.current = app;

      // Load tororo (left) and hijiki (right) in parallel
      const [tororo, hijiki] = await Promise.all([
        (Live2DModel as { from: (p: string) => Promise<unknown> }).from("/live2d/tororo/tororo.model3.json"),
        (Live2DModel as { from: (p: string) => Promise<unknown> }).from("/live2d/hijiki/hijiki.model3.json"),
      ]);

      if (destroyed) {
        (app as { destroy: (r: boolean) => void }).destroy(false);
        return;
      }

      const stage = (app as { stage: { addChild: (c: unknown) => void } }).stage;

      // Helper: scale and position each model
      function place(
        model: unknown,
        xCenter: number,
        yCenter: number,
        fitW: number,
        fitH: number,
      ) {
        const m = model as {
          width: number; height: number;
          scale: { set: (s: number) => void };
          x: number; y: number;
          motion: (g: string, i?: number) => void;
        };
        const scale = Math.min(fitW / m.width, fitH / m.height) * 0.92;
        m.scale.set(scale);
        m.x = xCenter - (m.width / 2);
        m.y = yCenter - (m.height / 2);
        stage.addChild(model);
        return m;
      }

      // Side by side: tororo left, hijiki right
      const half = width / 2;
      const tM = place(tororo, half * 0.52, height * 0.5, half * 1.05, height);
      const hM = place(hijiki, half * 1.48, height * 0.5, half * 1.05, height);

      modelsRef.current = [tM, hM];
      setLoading(false);

      // Kick off idle
      try { tM.motion("Idle"); } catch (_) { /* ignore */ }
      try { hM.motion("Idle"); } catch (_) { /* ignore */ }

      // ── じゃれあい演出 ─────────────────────────────────────────────────
      // 8〜18 秒ごとにランダムで「一方が Tap → もう一方が Flick で反応」
      let jareTimer: ReturnType<typeof setTimeout> | null = null;

      function scheduleJare() {
        const wait = 8000 + Math.random() * 10000; // 8〜18 秒
        jareTimer = setTimeout(() => {
          if (destroyed) return;
          // じゃれる側とされる側をランダムで決定
          const [attacker, reactor] = Math.random() < 0.5 ? [tM, hM] : [hM, tM];
          try { attacker.motion("Tap"); } catch (_) { /* ignore */ }
          // 0.6 秒後に相手が Flick で反応
          setTimeout(() => {
            if (destroyed) return;
            try { reactor.motion("Flick"); } catch (_) { /* ignore */ }
            // 2.5 秒後（Flick 終了目安）に Idle へ戻す
            setTimeout(() => {
              if (destroyed) return;
              try { tM.motion("Idle"); } catch (_) { /* ignore */ }
              try { hM.motion("Idle"); } catch (_) { /* ignore */ }
              scheduleJare(); // 次のじゃれあいをスケジュール
            }, 2500);
          }, 600);
        }, wait);
      }
      scheduleJare();

      // cleanup に追加（destroyed フラグで止める）
      const origCleanup = () => { if (jareTimer) clearTimeout(jareTimer); };
      (app as { _jareCleanup?: () => void })._jareCleanup = origCleanup;

      // ── Independent floating animation per model ──────────────────────
      // Each cat floats with a different period and phase so they're never in sync
      const tBasey = tM.y;
      const hBasey = hM.y;
      const tBaseX = tM.x;
      const hBaseX = hM.x;
      let t = 0;

      const ticker = (app as { ticker: { add: (fn: (dt: number) => void) => void } }).ticker;
      ticker.add((dt: number) => {
        t += dt * 0.012; // time step (~60fps → ~0.72/s)

        // tororo: slow gentle float + slight tilt
        tM.y = tBasey + Math.sin(t * 1.0) * 9;
        tM.x = tBaseX + Math.sin(t * 0.6) * 3;

        // hijiki: different period + phase offset (π → starts opposite)
        hM.y = hBasey + Math.sin(t * 1.15 + Math.PI) * 8;
        hM.x = hBaseX + Math.sin(t * 0.75 + Math.PI * 0.5) * 3;
      });
    }

    init().catch((e) => {
      console.error("[Live2D]", e);
      setError(String(e));
      setLoading(false);
    });

    return () => {
      destroyed = true;
      modelsRef.current = [];
      if (appRef.current) {
        (appRef.current as { destroy: (r: boolean) => void }).destroy(false);
        appRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  // ── React to state changes ────────────────────────────────────────────
  useEffect(() => {
    const group = MOTION_GROUP[state];
    for (const m of modelsRef.current) {
      try { m.motion(group); } catch (_) { /* ignore */ }
    }
  }, [state]);

  // ── Render ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center text-center" style={{ width, height }}>
        <p className="text-purple-300 text-sm opacity-70">モデルの読み込みに失敗しました</p>
        <p className="text-purple-400 text-xs opacity-40 mt-1 max-w-xs break-all">{error}</p>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width, height }}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ pointerEvents: "none" }}>
          <div className="w-8 h-8 rounded-full border-2 border-purple-400 border-t-transparent animate-spin opacity-60" />
        </div>
      )}
      <canvas
        ref={canvasRef}
        style={{ display: "block", opacity: loading ? 0 : 1, transition: "opacity 0.6s ease" }}
      />
    </div>
  );
}
