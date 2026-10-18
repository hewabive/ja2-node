import { effectiveMaster, loadSettings } from '../../app/settings.ts';
import { AudioEngine } from '../../audio/engine.ts';
import { laptopPowerCue } from '../../content/audio/cues.ts';
import type { ViewFrame } from '../../protocol/view.ts';
import { fetchFile } from '../asset-browser/api.ts';

async function optionalFile(path: string): Promise<Uint8Array | null> {
  try {
    return await fetchFile(path);
  } catch {
    return null;
  }
}

export class StrategicSound {
  readonly engine = new AudioEngine({ createGraph: () => new AudioContext(), load: optionalFile });
  #laptopOpen = false;

  constructor() {
    const settings = loadSettings();
    this.engine.setVolumes({ ...settings.volumes, master: effectiveMaster(settings) });
    const unlock = () => this.engine.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  reset(laptopOpen: boolean): void {
    this.#laptopOpen = laptopOpen;
  }

  frames(frames: readonly ViewFrame[]): void {
    for (const frame of frames) {
      if (frame.laptop === undefined) continue;
      const open = frame.laptop !== null;
      if (open !== this.#laptopOpen) this.engine.play(laptopPowerCue(open));
      this.#laptopOpen = open;
    }
  }
}
