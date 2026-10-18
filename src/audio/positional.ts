// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Utils/Sound_Control.cc NewPositionSnd, SetPositionSndsVolumeAndPanning (the volume of 15, at most 10 for an
// @src unseen source); Tactical/Soldier_Control.cc (QUEEN_AMBIENT_NOISE for the creature queen). See docs/27 §3.1.

import { cueOf, mixCue } from '../content/audio/cue.ts';
import { type CueBook, soundPath } from '../content/audio/cue-book.ts';
import { SoundBody } from '../content/audio/cues.ts';
import type { ScreenView } from '../content/audio/sound-position.ts';
import type { SoldierView } from '../protocol/view.ts';
import type { AudioEngine, VoiceHandle } from './engine.ts';

export const POSITION_SOUND_VOLUME = 15;
const INFINITE_LOOPS = Number.POSITIVE_INFINITY;

export interface CameraLike {
  readonly centerX: number;
  readonly centerY: number;
}

export function listenerView(camera: CameraLike, width: number, height: number): ScreenView {
  return { centerX: camera.centerX, centerY: camera.centerY, width, height };
}

export class PositionalLoops {
  readonly #engine: AudioEngine;
  readonly #book: CueBook;
  readonly #loops = new Map<number, VoiceHandle>();

  constructor(engine: AudioEngine, book: CueBook) {
    this.#engine = engine;
    this.#book = book;
  }

  get count(): number {
    return this.#loops.size;
  }

  update(soldiers: readonly SoldierView[]): void {
    const queens = soldiers.filter((s) => s.bodyType === SoundBody.QUEENMONSTER && (s.life ?? 1) > 0);
    const ids = new Set(queens.map((s) => s.id));
    for (const [id, voice] of this.#loops) {
      if (ids.has(id) && voice.active) continue;
      voice.stop();
      this.#loops.delete(id);
    }
    const file = soundPath(this.#book, 'QUEEN_AMBIENT_NOISE');
    if (!file || !this.#engine.unlocked || this.#engine.volumes.master === 0) return;
    for (const q of queens) {
      const cue = cueOf(file, 'positionLoop', POSITION_SOUND_VOLUME, q.gridNo, undefined, INFINITE_LOOPS);
      let voice = this.#loops.get(q.id);
      if (!voice) {
        voice = this.#engine.play(cue);
        this.#loops.set(q.id, voice);
      }
      const mixed = mixCue(cue, this.#engine.listener, this.#engine.volumes);
      voice.remix(mixed.volume, mixed.pan);
    }
  }

  stopAll(): void {
    for (const voice of this.#loops.values()) voice.stop();
    this.#loops.clear();
  }
}
