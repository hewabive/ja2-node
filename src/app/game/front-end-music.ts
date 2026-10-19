import type { AudioEngine } from '../../audio/engine.ts';
import type { MusicView } from '../../protocol/music.ts';
import { MusicMode } from '../../protocol/music-modes.ts';
import type { ViewFrame } from '../../protocol/view.ts';
import type { FrontEndMusic } from '../../ui/screens/front-end/flow.ts';
import type { ClientSettings } from '../../ui/settings.ts';
import { musicLevel, PageMusic } from '../net/music.ts';
import type { ReadVfsFile } from '../net/vfs.ts';

const FRONT_END_MUSIC_SEED = 'front-end';
const MAIN_MENU_MUSIC: MusicView = { mode: MusicMode.MAIN_MENU, creature: false };
const NO_MUSIC: MusicView = { mode: MusicMode.NONE, creature: false };

export class FrontEndMusicPlayer {
  readonly page: PageMusic;
  #mode: FrontEndMusic = 'none';

  constructor(settings: ClientSettings, read: ReadVfsFile) {
    this.page = new PageMusic(musicLevel(settings), read);
  }

  get mode(): FrontEndMusic {
    return this.#mode;
  }

  load(engine: AudioEngine): Promise<void> {
    return this.page.load(engine, FRONT_END_MUSIC_SEED);
  }

  show(mode: FrontEndMusic, session: MusicView | null): void {
    this.#mode = mode;
    if (mode === 'session') this.page.reset(session ?? NO_MUSIC);
    else this.page.show(mode === 'mainMenu' ? MAIN_MENU_MUSIC : NO_MUSIC);
  }

  frames(frames: readonly ViewFrame[]): void {
    if (this.#mode === 'session') this.page.frames(frames);
  }

  settings(settings: ClientSettings): void {
    this.page.setLevel(musicLevel(settings));
  }
}
