// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-08. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Merc_Entering.cc StartHelicopterRun (HELI_1 at volume 0, 10000 loops, MIDDLEPAN, once a run),
// @src HandleHeliDrop (SoundSetVolume at every fade step, SoundStop at the end of the fade-out and at the Esc skip).

import { cueOf, mixCue } from '../content/audio/cue.ts';
import { type CueBook, soundPath } from '../content/audio/cue-book.ts';
import { Pan } from '../content/audio/sound-position.ts';
import type { AudioEngine, VoiceHandle } from './engine.ts';

const HELI_1 = 'HELI_1';
const HELI_LOOPS = 10000;

export class HelicopterEngine {
  readonly #engine: AudioEngine;
  readonly #book: CueBook;
  #voice: VoiceHandle | null = null;
  #started = false;

  constructor(engine: AudioEngine, book: CueBook) {
    this.#engine = engine;
    this.#book = book;
  }

  get playing(): boolean {
    return this.#voice?.active === true;
  }

  update(volume: number | null): void {
    if (volume === null) {
      this.stop();
      return;
    }
    if (!this.#started) this.#start(volume);
    const voice = this.#voice;
    if (!voice?.active) return;
    const mixed = mixCue({ ...voice.cue, baseVolume: volume }, this.#engine.listener, this.#engine.volumes);
    voice.remix(mixed.volume, mixed.pan);
  }

  #start(volume: number): void {
    const file = soundPath(this.#book, HELI_1);
    if (!file || !this.#engine.unlocked || this.#engine.volumes.master === 0) return;
    this.#started = true;
    this.#voice = this.#engine.play(cueOf(file, 'fadingLoop', volume, undefined, Pan.MIDDLE, HELI_LOOPS));
  }

  stop(): void {
    this.#voice?.stop();
    this.#voice = null;
    this.#started = false;
  }
}
