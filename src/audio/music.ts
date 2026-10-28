// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Utils/Music_Control.cc MusicPlay (no fade-in), MusicSetVolume (volume 0 stops, raising it from 0 restarts),
// @src MusicStop, MusicFadeOut, MusicPoll (one volume step per MUSICOVERHEAD, the victory track falls back to the nothing
// @src mode, the defeat track to silence, any other track to the next of its mode), SetMusicMode, StartMusicBasedOnMode
// @src (creature variants), SetMusicFadeSpeed; src/externalized/DefaultContentManager.cc getMusicForMode (a random track).

import { cueOf } from '../content/audio/cue.ts';
import type { MusicTable } from '../content/audio/music-table.ts';
import { MAX_VOLUME, Pan } from '../content/audio/sound-position.ts';
import type { MusicView } from '../protocol/music.ts';
import {
  FAST_FADE_STEP,
  MUSIC_TRACK_KEYS,
  MusicMode,
  type MusicModeName,
  NORMAL_FADE_STEP,
  trackEndRule,
  trackListMode,
} from '../protocol/music-modes.ts';
import type { AudioEngine, VoiceHandle } from './engine.ts';

export interface MusicPlayerOptions {
  readonly engine: AudioEngine;
  readonly table: MusicTable;
  readonly rand: (n: number) => number;
}

export interface MusicStats {
  tracksStarted: number;
  fadesCompleted: number;
  modeChanges: number;
}

export class MusicPlayer {
  readonly stats: MusicStats = { tracksStarted: 0, fadesCompleted: 0, modeChanges: 0 };
  readonly #o: MusicPlayerOptions;
  #serverMode: MusicModeName | null = null;
  #mode: MusicModeName = MusicMode.NONE;
  #creature = false;
  #voice: VoiceHandle | null = null;
  #track: string | null = null;
  #endedMode: MusicModeName | null = null;
  #volume = 0;
  #fadingOut = false;
  #fadeStep = NORMAL_FADE_STEP;
  #ended = false;
  #dontRestart = false;

  constructor(options: MusicPlayerOptions) {
    this.#o = options;
  }

  get mode(): MusicModeName {
    return this.#mode;
  }

  get track(): string | null {
    return this.#voice?.active ? this.#track : null;
  }

  get fading(): boolean {
    return this.#fadingOut;
  }

  get volume(): number {
    return this.#volume;
  }

  #musicVolume(): number {
    return this.#o.engine.volumes.music;
  }

  show(view: MusicView): void {
    this.#creature = view.creature;
    if (view.mode === this.#serverMode) return;
    this.#serverMode = view.mode;
    if (view.fastFade) this.#fadeStep = FAST_FADE_STEP;
    this.#setMode(view.mode);
  }

  reset(view: MusicView | undefined): void {
    this.#serverMode = null;
    if (view) this.show(view);
  }

  #setMode(mode: MusicModeName): void {
    if (mode === this.#mode) return;
    this.#mode = mode;
    this.stats.modeChanges++;
    if (this.#voice?.active) this.#fadingOut = true;
    else this.#startBasedOnMode();
  }

  #startBasedOnMode(): void {
    const mode = this.#mode;
    const key = MUSIC_TRACK_KEYS[trackListMode(mode, this.#creature)];
    const tracks = key ? (this.#o.table.get(key) ?? []) : [];
    if (!key) {
      this.#fadingOut = this.#voice?.active === true;
      return;
    }
    this.#fadeStep = NORMAL_FADE_STEP;
    const track = tracks[this.#o.rand(tracks.length)];
    if (track) this.#play(track);
  }

  #play(track: string): void {
    this.#stop();
    this.#ended = false;
    const voice = this.#o.engine.play(cueOf(track, 'music', MAX_VOLUME, undefined, Pan.MIDDLE, 1));
    if (!voice.active) return;
    this.#voice = voice;
    this.#track = track;
    const mode = this.#mode;
    this.#volume = this.#musicVolume();
    this.stats.tracksStarted++;
    voice.onEnded = () => {
      if (this.#voice !== voice) return;
      this.#voice = null;
      this.#ended = voice.state === 'ended' || voice.state === 'stopped';
      this.#endedMode = mode;
    };
  }

  #stop(): void {
    const voice = this.#voice;
    if (!voice) return;
    voice.stop();
  }

  setVolume(previous: number, next: number): void {
    if (this.#voice?.active) {
      if (next === 0) {
        this.#dontRestart = true;
        this.#stop();
      } else {
        this.#volume = next;
        this.#voice.remix(this.#volume, Pan.MIDDLE);
      }
      return;
    }
    if (next > 0 && previous === 0) this.#startBasedOnMode();
  }

  poll(): void {
    if (this.#fadingOut) this.#fadeStepDown();
    if (!this.#ended) return;
    this.#ended = false;
    const restart = !this.#dontRestart;
    this.#dontRestart = false;
    const end = this.#endedMode === this.#mode ? trackEndRule(this.#mode) : 'nextTrack';
    if (end === 'thenNothing') this.#setMode(MusicMode.TACTICAL_NOTHING);
    else if (end === 'nextTrack' && restart) this.#startBasedOnMode();
  }

  #fadeStepDown(): void {
    const voice = this.#voice;
    if (!voice?.active) {
      this.#fadingOut = false;
      return;
    }
    this.#volume = Math.max(this.#volume - this.#fadeStep, 0);
    voice.remix(this.#volume, Pan.MIDDLE);
    if (this.#volume > 0) return;
    this.#fadingOut = false;
    this.#fadeStep = NORMAL_FADE_STEP;
    this.stats.fadesCompleted++;
    this.#stop();
  }

  stop(): void {
    this.#serverMode = null;
    this.#fadingOut = false;
    this.#ended = false;
    this.#stop();
  }
}
