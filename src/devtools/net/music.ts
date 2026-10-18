import { type ClientSettings, effectiveMaster } from '../../app/settings.ts';
import { ClientRandom, seedFromText } from '../../audio/client-random.ts';
import type { AudioEngine } from '../../audio/engine.ts';
import { MusicPlayer, type MusicStats } from '../../audio/music.ts';
import { loadMusicTable } from '../../content/audio/music-table.ts';
import type { MusicView } from '../../protocol/music.ts';
import { MUSIC_OVERHEAD_MS, type MusicModeName } from '../../protocol/music-modes.ts';
import type { ViewFrame } from '../../protocol/view.ts';
import { fetchFile } from '../asset-browser/api.ts';

export interface MusicHook {
  ready: boolean;
  serverMode: MusicModeName | null;
  creature: boolean;
  mode: MusicModeName | null;
  track: string | null;
  tracks: string[];
  stats: MusicStats | null;
  error: string | null;
}

const MUSIC_SEED_SUFFIX = ':music';
const TRACK_LOG = 50;

export function musicLevel(settings: ClientSettings): number {
  return effectiveMaster(settings) === 0 ? 0 : settings.volumes.music;
}

export class PageMusic {
  readonly hook: MusicHook = {
    ready: false,
    serverMode: null,
    creature: false,
    mode: null,
    track: null,
    tracks: [],
    stats: null,
    error: null,
  };
  #player: MusicPlayer | null = null;
  #pending: MusicView | null = null;
  #level: number;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(level: number) {
    this.#level = level;
  }

  async load(engine: AudioEngine, session: string): Promise<void> {
    try {
      const table = await loadMusicTable(fetchFile);
      const rng = new ClientRandom(seedFromText(`${session}${MUSIC_SEED_SUFFIX}`));
      this.#player = new MusicPlayer({ engine, table, rand: rng.rand });
      this.hook.stats = this.#player.stats;
      this.hook.ready = true;
      if (this.#pending) this.#player.show(this.#pending);
      this.#timer ??= setInterval(() => this.#poll(), MUSIC_OVERHEAD_MS);
    } catch (err) {
      this.hook.error = (err as Error).message;
    }
  }

  #poll(): void {
    const player = this.#player;
    if (!player) return;
    player.poll();
    this.#sync();
  }

  #sync(): void {
    const player = this.#player;
    if (!player) return;
    this.hook.mode = player.mode;
    const track = player.track;
    if (track && track !== this.hook.track) {
      this.hook.tracks.push(track);
      if (this.hook.tracks.length > TRACK_LOG) this.hook.tracks.shift();
    }
    this.hook.track = track;
  }

  show(view: MusicView | undefined): void {
    if (!view) return;
    this.hook.serverMode = view.mode;
    this.hook.creature = view.creature;
    this.#pending = view;
    this.#player?.show(view);
    this.#sync();
  }

  reset(view: MusicView | undefined): void {
    this.#player?.reset(undefined);
    this.show(view);
  }

  frames(frames: readonly ViewFrame[]): void {
    for (const frame of frames) if (frame.music) this.show(frame.music);
  }

  setLevel(level: number): void {
    const previous = this.#level;
    this.#level = level;
    if (previous !== level) this.#player?.setVolume(previous, level);
    this.#sync();
  }

  unlocked(): void {
    if (this.#level > 0) this.#player?.setVolume(0, this.#level);
    this.#sync();
  }
}
