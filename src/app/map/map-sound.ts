// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface.cc PlayGlowRegionSound (glowclick.wav at MIDVOLUME, one at a time);
// @src src/game/Strategic/MapScreen.cc RandomAwakeSelectedMercConfirmsStrategicMove (DoMercBattleSound BATTLE_SOUND_OK1);
// @src src/game/Tactical/Soldier_Control.cc InternalDoMercBattleSound (the merc's last battle sound and his talking
// @src face decide over a new one, which may stop the old; uiBattleSoundID per merc for the dialogue's wait) (2026-11-03);
// @src src/game/Utils/Message.cc PlayNewMessageSound (newbeep.wav, one at a time); src/game/Tactical/Vehicles.cc
// @src AddSoldierToVehicle and ExitVehicle (the enter sound of a ground vehicle, vehicles.json enterSound, at HIGHVOLUME at
// @src the vehicle's tile, NOWHERE off the loaded map; the helicopter has no vehicle soldier and stays silent);
// @src src/game/Utils/Sound_Control.cc PlayLocationJA2Sample (SoundVolume and SoundDir against the world view the last
// @src ApplyScrolling left, the tactical screen's last, 2026-11-07); src/game/Tactical/Soldier_Control.cc
// @src HandleTakeDamageDeath (the DIE1 cry, DOORCR_1 and HEADCR_1 of a soldier dying while the map screen is up,
// @src 2026-11-06; InternalDoMercBattleSound's cry at his tile against that world view, faded for another team's,
// @src 2026-11-07); HandleSoldierTakeDamageFeedback and HandleTakeDamageDeath, TileEngine/Explosion_Control.cc
// @src DishOutGasDamage (the DIE1 and HIT1 grunts at bleeding, gas and electric damage while the map screen is up, an
// @src unseen soldier's in the middle, 2026-11-09).

import { ClientRandom, seedFromText } from '../../audio/client-random.ts';
import type { SpeechOwner } from '../../audio/director.ts';
import type { AudioEngine, VoiceHandle } from '../../audio/engine.ts';
import {
  type BattleMemory,
  type BattleSoundName,
  battleSoundCue,
  NO_BATTLE_MEMORY,
  type VoiceSoldier,
} from '../../content/audio/battle-sound.ts';
import { cueOf, effectCue } from '../../content/audio/cue.ts';
import { type CueBook, loadCueBook } from '../../content/audio/cue-book.ts';
import { deathOffTheMapCues } from '../../content/audio/cues.ts';
import { BleedGrunts, damageFeedbackSounds } from '../../content/audio/damage-feedback.ts';
import { offScreenVolume } from '../../content/audio/sound-position.ts';
import type { PlayerView } from '../../protocol/view.ts';
import type { DamageFeedback, DeathCry, MapSounds } from '../../ui/screens/map/environment.ts';
import type { AssetSource } from '../assets/asset-source.ts';
import { loadSettings } from '../settings.ts';

const GLOW_CLICK = 'sounds/glowclick.wav';
const NEW_BEEP = 'sounds/newbeep.wav';
const INTO_VEHICLE = 'S_VECH1_INTO';
const HIGHVOLUME = 127;
const MIDVOLUME = 65;
const OUR_TEAM = 0;
const UNSEEN_TEAM = 1;
const REGULAR_MALE = 0;
const NOWHERE = -1;
const VOICE_DIGITS = 3;
const NORMAL_MORALE = 50;
const SPEECH_BUS = 'speech';

type Voice = ReturnType<AudioEngine['play']>;

export class MapSound implements MapSounds {
  readonly #engine: AudioEngine;
  readonly #source: AssetSource;
  readonly #view: () => PlayerView | null;
  readonly #random: ClientRandom;
  readonly #speech: SpeechOwner;
  readonly #memory = new Map<number, BattleMemory>();
  readonly #battleVoices = new Map<number, VoiceHandle>();
  readonly #bleedGrunts = new BleedGrunts();
  #book: CueBook | null = null;
  #glow: Voice | null = null;
  #beep: Voice | null = null;

  constructor(engine: AudioEngine, source: AssetSource, view: () => PlayerView | null, session: string, speech: SpeechOwner) {
    this.#engine = engine;
    this.#source = source;
    this.#view = view;
    this.#speech = speech;
    this.#random = new ClientRandom(seedFromText(`${session}/map`));
  }

  mercBattleSoundPlaying(profile: number): boolean {
    const merc = this.#view()?.strategic?.mercs.find((m) => m.profile === profile);
    return merc !== undefined && (this.#battleVoices.get(merc.id)?.active ?? false);
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

  vehicleEntered(gridNo: number | null): void {
    const book = this.#book;
    const cue = book ? effectCue(book, INTO_VEHICLE, 'location', HIGHVOLUME, gridNo ?? NOWHERE) : null;
    if (cue) this.#engine.play(cue);
  }

  confirmRoute(soldier: number): void {
    const book = this.#book;
    const view = this.#view();
    const merc = view?.strategic?.mercs.find((m) => m.id === soldier);
    if (!book || !merc || merc.profile === undefined) return;
    const tactical = view?.soldiers.find((s) => s.id === soldier);
    const voiced = {
      gridNo: NOWHERE,
      team: OUR_TEAM,
      bodyType: tactical?.bodyType ?? REGULAR_MALE,
      voice: tactical?.voice ?? String(merc.profile).padStart(VOICE_DIGITS, '0'),
      morale: merc.morale ?? NORMAL_MORALE,
    };
    this.#battleSound(book, soldier, voiced, 'OK1');
  }

  mercDiedOffTheMap(soldier: number, cry: DeathCry | null): void {
    const book = this.#book;
    if (!book) return;
    if (cry) this.#battleSound(book, soldier, { gridNo: NOWHERE, ...cry, morale: NORMAL_MORALE }, 'DIE1');
    for (const cue of deathOffTheMapCues(book)) this.#engine.play(cue);
  }

  damageFeedback(feedback: DamageFeedback): void {
    const book = this.#book;
    const gruntDue = this.#bleedGrunts.due(feedback.soldier, performance.now());
    const voiced = this.#feedbackVoice(feedback);
    if (!book || !voiced) return;
    const facts = { cause: feedback.cause, seen: !feedback.cry && !feedback.unseen, conscious: feedback.conscious === true };
    const offScreen = feedback.unseen !== undefined;
    for (const sound of damageFeedbackSounds(facts, gruntDue)) this.#battleSound(book, feedback.soldier, voiced, sound, offScreen);
  }

  #feedbackVoice(feedback: DamageFeedback): VoiceSoldier | null {
    if (feedback.cry) return { gridNo: NOWHERE, ...feedback.cry, morale: NORMAL_MORALE };
    const unseen = feedback.unseen;
    if (unseen) return { gridNo: NOWHERE, team: UNSEEN_TEAM, bodyType: unseen.bodyType, voice: unseen.voice, morale: NORMAL_MORALE };
    const s = this.#view()?.soldiers.find((v) => v.id === feedback.soldier);
    if (!s || s.muted) return null;
    return { gridNo: s.gridNo, team: s.team, bodyType: s.bodyType, voice: s.voice ?? null, morale: s.morale ?? NORMAL_MORALE };
  }

  #battleSound(book: CueBook, soldier: number, voiced: VoiceSoldier, sound: BattleSoundName, offScreen = false): void {
    const playing = this.#battleVoices.get(soldier);
    const outcome = battleSoundCue(
      book,
      voiced,
      this.#memory.get(soldier) ?? NO_BATTLE_MEMORY,
      {
        sound,
        nowMs: performance.now(),
        playing: playing?.active ?? false,
        talking: this.#speech.isTalking(soldier),
        muteConfirmations: loadSettings().muteConfirmations,
        lowerVolume: false,
      },
      (path) => this.#source.resolve(path) !== undefined,
      this.#random.rand,
    );
    this.#memory.set(soldier, outcome.memory);
    if (outcome.stopPrevious) playing?.stop();
    if (outcome.cutSpeech) this.#speech.cut(soldier);
    for (const cue of outcome.cues) {
      const voice = this.#engine.play(offScreen ? { ...cue, baseVolume: offScreenVolume(cue.baseVolume) } : cue);
      if (cue.bus === SPEECH_BUS) this.#battleVoices.set(soldier, voice);
    }
  }
}
