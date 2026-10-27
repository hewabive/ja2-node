// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface.cc PlayGlowRegionSound (glowclick.wav at MIDVOLUME, one at a time);
// @src src/game/Strategic/MapScreen.cc RandomAwakeSelectedMercConfirmsStrategicMove (DoMercBattleSound BATTLE_SOUND_OK1);
// @src src/game/Utils/Message.cc PlayNewMessageSound (newbeep.wav, one at a time); src/game/Tactical/Vehicles.cc
// @src AddSoldierToVehicle (the enter sound of a ground vehicle, vehicles.json enterSound, at HIGHVOLUME; the helicopter
// @src has no vehicle soldier and stays silent).

import { ClientRandom, seedFromText } from '../../audio/client-random.ts';
import type { AudioEngine } from '../../audio/engine.ts';
import { type BattleMemory, battleSoundCue, NO_BATTLE_MEMORY } from '../../content/audio/battle-sound.ts';
import { cueOf, effectCue } from '../../content/audio/cue.ts';
import { type CueBook, loadCueBook } from '../../content/audio/cue-book.ts';
import type { PlayerView } from '../../protocol/view.ts';
import type { MapSounds } from '../../ui/screens/map/environment.ts';
import type { AssetSource } from '../assets/asset-source.ts';
import { loadSettings } from '../settings.ts';

const GLOW_CLICK = 'sounds/glowclick.wav';
const NEW_BEEP = 'sounds/newbeep.wav';
const INTO_VEHICLE = 'S_VECH1_INTO';
const HIGHVOLUME = 127;
const MIDVOLUME = 65;
const OUR_TEAM = 0;
const REGULAR_MALE = 0;
const NOWHERE = -1;
const VOICE_DIGITS = 3;
const NORMAL_MORALE = 50;

type Voice = ReturnType<AudioEngine['play']>;

export class MapSound implements MapSounds {
  readonly #engine: AudioEngine;
  readonly #source: AssetSource;
  readonly #view: () => PlayerView | null;
  readonly #random: ClientRandom;
  readonly #memory = new Map<number, BattleMemory>();
  #book: CueBook | null = null;
  #glow: Voice | null = null;
  #beep: Voice | null = null;

  constructor(engine: AudioEngine, source: AssetSource, view: () => PlayerView | null, session: string) {
    this.#engine = engine;
    this.#source = source;
    this.#view = view;
    this.#random = new ClientRandom(seedFromText(`${session}/map`));
  }

  async load(): Promise<void> {
    try {
      this.#book = await loadCueBook((path) => this.#source.read(path));
    } catch {
      this.#book = null;
    }
  }

  glowClick(): void {
    if (this.#glow?.active) return;
    this.#glow = this.#engine.play(cueOf(GLOW_CLICK, 'fixed', MIDVOLUME));
  }

  newMessageBeep(): void {
    if (this.#beep?.active) return;
    this.#beep = this.#engine.play(cueOf(NEW_BEEP, 'fixed', MIDVOLUME));
  }

  vehicleEntered(): void {
    const book = this.#book;
    const cue = book ? effectCue(book, INTO_VEHICLE, 'fixed', HIGHVOLUME) : null;
    if (cue) this.#engine.play(cue);
  }

  confirmRoute(soldier: number): void {
    const book = this.#book;
    const view = this.#view();
    const merc = view?.strategic?.mercs.find((m) => m.id === soldier);
    if (!book || !merc || merc.profile === undefined) return;
    const tactical = view?.soldiers.find((s) => s.id === soldier);
    const settings = loadSettings();
    const outcome = battleSoundCue(
      book,
      {
        gridNo: NOWHERE,
        team: OUR_TEAM,
        bodyType: tactical?.bodyType ?? REGULAR_MALE,
        voice: tactical?.voice ?? String(merc.profile).padStart(VOICE_DIGITS, '0'),
        morale: merc.morale ?? NORMAL_MORALE,
      },
      this.#memory.get(soldier) ?? NO_BATTLE_MEMORY,
      {
        sound: 'OK1',
        nowMs: performance.now(),
        playing: false,
        talking: false,
        muteConfirmations: settings.muteConfirmations,
        lowerVolume: false,
      },
      (path) => this.#source.resolve(path) !== undefined,
      this.#random.rand,
    );
    this.#memory.set(soldier, outcome.memory);
    for (const cue of outcome.cues) this.#engine.play(cue);
  }
}
