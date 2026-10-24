// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Auto_Resolve.cc PlayAutoResolveSample (PlayJA2Sample at volume 50, MIDDLEPAN; HIGHVOLUME for the
// @src merc death crunches and AUTORESOLVE_FINISHFX), DoTransitionFromPreBattleInterfaceToAutoResolve and
// @src src/game/Strategic/PreBattle_Interface.cc DoTransitionFromMapscreenToPreBattleInterface (laptop power up at
// @src HIGHVOLUME); src/game/Tactical/Soldier_Control.cc DoMercBattleSound (the battle voices). See docs/28 §11.

import { ClientRandom, seedFromText } from '../../audio/client-random.ts';
import type { AudioEngine } from '../../audio/engine.ts';
import { type BattleMemory, battleSoundCue, NO_BATTLE_MEMORY } from '../../content/audio/battle-sound.ts';
import { type Cue, cueOf, effectCue, VolumeLevel } from '../../content/audio/cue.ts';
import { type CueBook, loadCueBook } from '../../content/audio/cue-book.ts';
import { LAPTOP_POWER_UP } from '../../content/audio/cues.ts';
import type { BattleSoundRequest, BattleSounds, BattleVoice } from '../../ui/screens/battle/environment.ts';
import type { AssetSource } from '../assets/asset-source.ts';
import { loadSettings } from '../settings.ts';

const AUTORESOLVE_VOLUME = 50;
const VOICE_DIGITS = 3;
const ENEMY_TEAM = 1;
const NORMAL_MORALE = 50;
const NOWHERE = -1;
const GENERIC_VOICE_PREFIX = 'bad';

export class BattleSound implements BattleSounds {
  readonly played: string[] = [];
  readonly #engine: AudioEngine;
  readonly #source: AssetSource;
  readonly #random: ClientRandom;
  readonly #memory = new Map<string, BattleMemory>();
  #book: CueBook | null = null;

  constructor(engine: AudioEngine, source: AssetSource, session: string) {
    this.#engine = engine;
    this.#source = source;
    this.#random = new ClientRandom(seedFromText(`${session}/battle`));
  }

  async load(): Promise<void> {
    try {
      this.#book = await loadCueBook((path) => this.#source.read(path));
    } catch {
      this.#book = null;
    }
  }

  #play(cue: Cue | null): void {
    if (!cue) return;
    this.played.push(cue.file);
    this.#engine.play(cue);
  }

  powerUp(): void {
    this.#play(cueOf(LAPTOP_POWER_UP, 'fixed', VolumeLevel.HIGH));
  }

  play(request: BattleSoundRequest): void {
    const book = this.#book;
    if (!book) return;
    if (request.kind === 'effect') {
      this.#play(effectCue(book, request.name, 'fixed', request.loud ? VolumeLevel.HIGH : AUTORESOLVE_VOLUME));
      return;
    }
    if (request.kind === 'weapon') {
      const weapon = book.weapons.get(request.item);
      if (!weapon) return;
      if (request.reloaded && weapon.lockAndLoad) this.#play(effectCue(book, weapon.lockAndLoad, 'fixed', AUTORESOLVE_VOLUME));
      if (weapon.sound !== '') this.#play(cueOf(weapon.sound, 'fixed', AUTORESOLVE_VOLUME));
      return;
    }
    this.#voice(book, request.sound, request.voice);
  }

  #voice(book: CueBook, sound: 'HIT1' | 'DIE1' | 'LAUGH1', voice: BattleVoice): void {
    const name = voice.profile !== null ? String(voice.profile).padStart(VOICE_DIGITS, '0') : `${GENERIC_VOICE_PREFIX}${voice.generic}`;
    const outcome = battleSoundCue(
      book,
      { gridNo: NOWHERE, team: voice.profile !== null ? 0 : ENEMY_TEAM, bodyType: voice.bodyType, voice: name, morale: NORMAL_MORALE },
      this.#memory.get(name) ?? NO_BATTLE_MEMORY,
      {
        sound,
        nowMs: performance.now(),
        playing: false,
        talking: false,
        muteConfirmations: loadSettings().muteConfirmations,
        lowerVolume: false,
      },
      (path) => this.#source.resolve(path) !== undefined,
      this.#random.rand,
    );
    this.#memory.set(name, outcome.memory);
    for (const cue of outcome.cues) this.#play(cue);
  }
}
