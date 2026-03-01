// snd-lib singleton — lazy-loads SND01 kit on first call
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no official @types/snd-lib
import Snd from "snd-lib";

let _snd: InstanceType<typeof Snd> | null = null;
let _loadPromise: Promise<void> | null = null;

function getSnd(): Promise<InstanceType<typeof Snd>> {
  if (!_snd) {
    _snd = new Snd();
    _loadPromise = _snd.load(Snd.KITS.SND01);
  }
  return _loadPromise!.then(() => _snd!);
}

export function playSound(sound: string): void {
  getSnd()
    .then((snd) => snd.play(sound))
    .catch(() => {
      // Audio permission denied or autoplay blocked — fail silently
    });
}

export { Snd };
