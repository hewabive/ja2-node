import { AudioEngine } from '../../audio/engine.ts';
import { laptopPowerCue } from '../../content/audio/cues.ts';
import type { PlayerView, ViewFrame } from '../../protocol/view.ts';
import { type MusicHook, musicLevel, PageMusic } from '../net/music.ts';
import { readVfsFileOrNull } from '../net/vfs.ts';
import { effectiveMaster, loadSettings } from '../settings.ts';

declare global {
  interface Window {
    __ja2Music: MusicHook;
  }
}

export class StrategicSound {
  readonly engine = new AudioEngine({ createGraph: () => new AudioContext(), load: readVfsFileOrNull });
  readonly music: PageMusic;
  #laptopOpen = false;

  constructor() {
    const settings = loadSettings();
    this.engine.setVolumes({ ...settings.volumes, master: effectiveMaster(settings) });
    this.music = new PageMusic(musicLevel(settings));
    window.__ja2Music = this.music.hook;
    const unlock = () => {
      const wasLocked = !this.engine.unlocked;
      this.engine.unlock();
      if (wasLocked && this.engine.unlocked) this.music.unlocked();
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  async attach(session: string, view: PlayerView | null): Promise<void> {
    await this.music.load(this.engine, session);
    this.music.reset(view?.music);
  }

  reset(laptopOpen: boolean, view: PlayerView | null = null): void {
    this.#laptopOpen = laptopOpen;
    if (view) this.music.reset(view.music);
  }

  frames(frames: readonly ViewFrame[]): void {
    this.music.frames(frames);
    for (const frame of frames) {
      if (frame.laptop === undefined) continue;
      const open = frame.laptop !== null;
      if (open !== this.#laptopOpen) this.engine.play(laptopPowerCue(open));
      this.#laptopOpen = open;
    }
  }
}
