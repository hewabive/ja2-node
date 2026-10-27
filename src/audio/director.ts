// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc EVENT_InitNewSoldierAnim (the final footstep), TurnSoldier (turning footsteps),
// @src PlaySoldierFootstepSound (silent in stealth mode), PlayStealthySoldierFootstepSound (Overhead.cc HandleAtNewGridNo),
// @src InternalDoMercBattleSound (nothing from a muted soldier), EVENT_SoldierGotHit (impact and hit sounds);
// @src Tactical/Soldier_Ani.cc (death sounds, the creature battle cry of code 717 by the call kind); Tactical/Handle_Doors.cc
// @src HandleDoorChangeFromGridNo (the close sound on the door's key frame); TileEngine/Interactive_Tiles.cc
// @src HandleStructChangeFromGridNo (an openable's sound, the opener's battle sound 500 ms later); Tactical/Weapons.cc
// @src UseGun, BulletHitStructure, StructureHit and ShotMiss (the miss sounds and the Random(40) curse of our mercs, drawn here, not in the simulation),
// @src DoSpecialEffectAmmoMiss, WindowHit; TileEngine/Structure.cc DamageStructure (the material a bullet strikes);
// @src TileEngine/Physics.cc (a thrown object landing, the mortar whistle, CATCH_OBJECT as a catch ends); Tactical/Handle_UI.cc and Real_Time_Input.cc
// @src (OK and ATTN on orders and selection); Tactical/Soldier_Ani.cc code 491 (idle sounds, counted from the passes of
// @src the loop that holds it, since the server sends no frames of a predictable loop). See docs/27 §3.1, §3.3.

import { ticksPerFrame } from '../content/anim/schedule-track.ts';
import { type AnimationTables, AnimFlags } from '../content/anim/tables.ts';
import { DEFAULT_TAIL_FRAMES, followTimeline, type TimelinePosition } from '../content/anim/timeline-follower.ts';
import { ambientActive, ambientCue, ambientGapMs } from '../content/audio/ambient-schedule.ts';
import { type BattleMemory, type BattleSoundName, battleSoundCue, NO_BATTLE_MEMORY } from '../content/audio/battle-sound.ts';
import { type Cue, effectCue, type FileExists, VolumeLevel } from '../content/audio/cue.ts';
import type { CueBook } from '../content/audio/cue-book.ts';
import {
  type CreatureCall,
  type DoorKind,
  doorCue,
  doorTrapCue,
  dropCue,
  dryFireCue,
  explosionCue,
  footstepCue,
  glassShatterCue,
  gunshotCue,
  impactCue,
  isSoundOpcode,
  lockOutcomeCue,
  materialHitCue,
  missCue,
  offMapMissCue,
  opcodeSound,
  openableCue,
  reloadCue,
  SoundBody,
  smallExplosionCue,
  TerrainKind,
} from '../content/audio/cues.ts';
import { hasIdleSounds, idleCheck, idleCheckLoopFrames } from '../content/audio/idle-sounds.ts';
import { NOWHERE, onScreen } from '../content/audio/sound-position.ts';
import { speechCue, speechPathForLine } from '../content/audio/speech.ts';
import type { AmbientEntry } from '../content/formats/ambient.ts';
import type { AnimationScripts } from '../content/formats/ja2bin.ts';
import type { TextKey } from '../content/narrative/dialogue-text.ts';
import { TICK_MS } from '../protocol/messages.ts';
import type { SoldierView, ViewFrame } from '../protocol/view.ts';
import { ClientRandom } from './client-random.ts';
import type { AudioEngine, VoiceHandle } from './engine.ts';
import { PositionalLoops } from './positional.ts';

export const CATCH_UP_TICKS = 100;
const DOOR_CLOSE_DELAY_MS = 2 * 70;
const CONSCIOUSNESS = 10;
const NORMAL_MORALE = 50;
const OUR_TEAM = 0;
const MISS_CURSE_CHANCE = 40;
const GUN_KINDS: ReadonlySet<string> = new Set(['handgun', 'smg', 'rifle', 'shotgun', 'lmg']);
const isGunKind = (kind: string | undefined) => kind !== undefined && GUN_KINDS.has(kind);
const NO_VARIANT = 0;
const FAR_VOLUME_MOD = 25;
const DEFAULT_MINUTE_OF_DAY = 12 * 60;
const RECRUITED_KINDS = new Set(['rpc', 'epc']);
const ANIM_STAND = 6;
const DYING_HEALTH_INDEX = 0;
const CRITICAL_HEALTH_INDEX = 1;

export interface SoundWorld {
  terrainAt(gridNo: number): number;
  readonly ambient: readonly AmbientEntry[];
}

export interface DirectorSettings {
  readonly speech: boolean;
  readonly muteConfirmations: boolean;
}

export interface SpeechOwner {
  isTalking(soldier: number): boolean;
  cut(soldier: number): void;
}

export interface DirectorContext {
  readonly selected: number | null;
  readonly inCombat: boolean;
  readonly minuteOfDay: number | null;
}

export interface DirectorOptions {
  readonly engine: AudioEngine;
  readonly book: CueBook;
  readonly scripts: AnimationScripts | null;
  readonly animations: AnimationTables | null;
  readonly exists: FileExists;
  readonly seed: number;
  readonly rpcSpeechPrefixed: boolean;
  readonly now: () => number;
  readonly later: (ms: number, run: () => void) => void;
}

export interface DirectorStats {
  frames: number;
  events: number;
  opcodes: number;
  footsteps: number;
  battleSounds: number;
  speechLines: number;
  ambientPlays: number;
  cues: number;
}

type AttackKind = 'gun' | 'blade' | 'punch';

interface AmbientSlot {
  nextAt: number | null;
  voice: VoiceHandle | null;
}

interface IdleLoop {
  readonly state: number;
  readonly since: number;
  passes: number;
}

interface QueuedLine {
  readonly cue: Cue;
  readonly speaker: number | null;
}

type EventOf<T extends string> = Extract<NonNullable<ViewFrame['events']>[number], { type: T }>;

export class SoundDirector {
  readonly stats: DirectorStats = {
    frames: 0,
    events: 0,
    opcodes: 0,
    footsteps: 0,
    battleSounds: 0,
    speechLines: 0,
    ambientPlays: 0,
    cues: 0,
  };
  readonly #o: DirectorOptions;
  readonly #rng: ClientRandom;
  readonly #loops: PositionalLoops;
  readonly #soldiers = new Map<number, SoldierView>();
  readonly #timelines = new Map<number, TimelinePosition>();
  readonly #lastFootstep = new Map<number, number>();
  readonly #battle = new Map<number, BattleMemory>();
  readonly #battleVoices = new Map<number, VoiceHandle>();
  readonly #dead = new Set<number>();
  readonly #weapons = new Map<number, number>();
  readonly #bursts = new Map<number, boolean>();
  readonly #calls = new Map<number, CreatureCall>();
  readonly #idleLoops = new Map<number, IdleLoop>();
  readonly #idleCounters = new Map<number, number>();
  readonly #idleLoopFrames = new Map<number, number | null>();
  #whistle: VoiceHandle | null = null;
  readonly #attacks = new Map<number, AttackKind>();
  readonly #speechQueue: QueuedLine[] = [];
  #speech: { voice: VoiceHandle; speaker: number | null } | null = null;
  #speechOwner: SpeechOwner | null = null;
  #world: SoundWorld | null = null;
  #ambient: AmbientSlot[] = [];
  #settings: DirectorSettings = { speech: true, muteConfirmations: false };
  #context: DirectorContext = { selected: null, inCombat: false, minuteOfDay: null };

  constructor(options: DirectorOptions) {
    this.#o = options;
    this.#rng = new ClientRandom(options.seed);
    this.#loops = new PositionalLoops(options.engine, options.book);
  }

  get rand(): (n: number) => number {
    return this.#rng.rand;
  }

  reset(soldiers: readonly SoldierView[]): void {
    this.#soldiers.clear();
    this.#timelines.clear();
    for (const s of soldiers) this.#soldierChanged(s, false);
  }

  setWorld(world: SoundWorld | null): void {
    this.#world = world;
    for (const slot of this.#ambient) slot.voice?.stop();
    this.#ambient = (world?.ambient ?? []).map(() => ({ nextAt: null, voice: null }));
  }

  setSettings(settings: DirectorSettings): void {
    this.#settings = settings;
    if (!settings.speech) this.#silenceSpeech();
  }

  setSpeechOwner(owner: SpeechOwner | null): void {
    this.#speechOwner = owner;
    if (owner) this.#silenceSpeech();
  }

  setContext(context: DirectorContext): void {
    this.#context = context;
  }

  confirm(soldier: number): void {
    this.#battleSound(soldier, 'OK1', false);
  }

  attention(soldier: number): void {
    this.#battleSound(soldier, 'ATTN1', true);
  }

  curse(soldier: number): void {
    this.#battleSound(soldier, 'CURSE1', false);
  }

  locked(soldier: number): void {
    this.#battleSound(soldier, 'LOCKED', false);
  }

  applyFrames(frames: readonly ViewFrame[]): void {
    const newest = frames.at(-1)?.tick;
    if (newest === undefined) return;
    for (const frame of frames) {
      this.stats.frames++;
      const audible = newest - frame.tick <= CATCH_UP_TICKS;
      const events = frame.events ?? [];
      for (const e of events) this.#remember(e);
      for (const id of frame.removed) this.#soldiers.delete(id);
      for (const s of frame.changed) this.#soldierChanged(s, audible);
      for (const e of events) {
        this.stats.events++;
        if (audible) this.#event(e);
      }
      this.#idleChecks(frame.tick, audible);
    }
    this.#loops.update([...this.#soldiers.values()]);
  }

  update(): void {
    this.#loops.update([...this.#soldiers.values()]);
    this.#scheduleAmbient();
  }

  stop(): void {
    this.#loops.stopAll();
    this.#silenceSpeech();
    for (const slot of this.#ambient) slot.voice?.stop();
    this.#o.engine.stopAll();
  }

  #play(cue: Cue | null): VoiceHandle | null {
    if (!cue) return null;
    this.stats.cues++;
    return this.#o.engine.play(cue);
  }

  #flags(state: number): number {
    return this.#o.animations?.controls[state]?.flags ?? 0;
  }

  #stateName(state: number): string {
    return this.#o.animations?.controls[state]?.id ?? '';
  }

  #has(state: number, flag: number): boolean {
    return (this.#flags(state) & flag) >>> 0 !== 0;
  }

  #soldierChanged(s: SoldierView, audible: boolean): void {
    const prev = this.#soldiers.get(s.id);
    this.#soldiers.set(s.id, s);
    if (s.life !== undefined && s.life > 0) this.#dead.delete(s.id);
    const scripts = this.#o.scripts;
    if (scripts) {
      const from = prev ? (this.#timelines.get(s.id) ?? null) : null;
      const followed = followTimeline(scripts, from, { state: s.animation, frame: s.frame }, DEFAULT_TAIL_FRAMES);
      this.#timelines.set(s.id, followed.position);
      if (audible && prev) for (const code of followed.ops) if (isSoundOpcode(code)) this.#opcode(s, code);
    }
    if (!audible || !prev) return;
    const stateChanged = prev.animation !== s.animation;
    if (stateChanged && this.#has(prev.animation, AnimFlags.MOVING) && this.#has(s.animation, AnimFlags.STATIONARY)) this.#footstep(s);
    if (!stateChanged && prev.direction !== s.direction && this.#turningStep(s)) this.#footstep(s);
  }

  #loopFrames(state: number): number | null {
    const scripts = this.#o.scripts;
    if (!scripts) return null;
    if (!this.#idleLoopFrames.has(state)) this.#idleLoopFrames.set(state, idleCheckLoopFrames(scripts, state));
    return this.#idleLoopFrames.get(state) ?? null;
  }

  #idleChecks(tick: number, audible: boolean): void {
    for (const s of this.#soldiers.values()) {
      const frames = hasIdleSounds(s.bodyType) ? this.#loopFrames(s.animation) : null;
      if (frames === null) {
        this.#idleLoops.delete(s.id);
        continue;
      }
      let loop = this.#idleLoops.get(s.id);
      if (loop?.state !== s.animation) {
        loop = { state: s.animation, since: tick, passes: 0 };
        this.#idleLoops.set(s.id, loop);
      }
      const passes = Math.floor((tick - loop.since) / (frames * ticksPerFrame(s.frameDelay, TICK_MS)));
      if (!audible) loop.passes = passes;
      for (; loop.passes < passes; loop.passes++) this.#idleCheck(s);
    }
  }

  #idleCheck(s: SoldierView): void {
    const health = s.healthIndex ?? Number.MAX_SAFE_INTEGER;
    const terrain = this.#world?.terrainAt(s.gridNo) ?? 0;
    const check = idleCheck(
      this.#idleCounters.get(s.id) ?? 0,
      {
        bodyType: s.bodyType,
        gridNo: s.gridNo,
        dying: health <= DYING_HEALTH_INDEX,
        injured: health <= CRITICAL_HEALTH_INDEX,
        inWater: terrain >= TerrainKind.LOW_WATER && terrain <= TerrainKind.DEEP_WATER,
        standing: this.#o.animations?.controls[s.animation]?.endHeight === ANIM_STAND,
      },
      this.#rng.rand,
    );
    this.#idleCounters.set(s.id, check.counter);
    this.#play(check.cue);
  }

  #turningStep(s: SoldierView): boolean {
    if (!this.#has(s.animation, AnimFlags.STATIONARY) || s.bodyType === SoundBody.LARVAE_MONSTER) return false;
    const terrain = this.#world?.terrainAt(s.gridNo) ?? 0;
    const water = terrain >= TerrainKind.LOW_WATER && terrain <= TerrainKind.DEEP_WATER;
    return !water && terrain !== TerrainKind.DIRT_ROAD && terrain !== TerrainKind.PAVED_ROAD;
  }

  #footstep(s: SoldierView, evenStealthy = false): void {
    if (s.stealth && !evenStealthy) return;
    const name = this.#stateName(s.animation);
    const step = footstepCue(
      this.#o.book,
      {
        gridNo: s.gridNo,
        terrain: this.#world?.terrainAt(s.gridNo) ?? 0,
        bodyType: s.bodyType,
        crawling: name === 'CRAWLING',
        hopFence: name === 'HOPFENCE',
        quiet: !this.#context.inCombat && s.id !== this.#context.selected,
      },
      this.#lastFootstep.get(s.id) ?? NO_VARIANT,
      this.#rng.rand,
    );
    if (!step) return;
    this.#lastFootstep.set(s.id, step.variant);
    this.stats.footsteps++;
    this.#play(step.cue);
  }

  #handItem(s: SoldierView): number | null {
    return s.inventory?.find((i) => i.slot === 0)?.index ?? this.#weapons.get(s.id) ?? null;
  }

  #opcode(s: SoldierView, code: number): void {
    this.stats.opcodes++;
    const ctx = {
      gridNo: s.gridNo,
      bodyType: s.bodyType,
      stealth: s.stealth ?? false,
      onScreen: onScreen(s.gridNo, this.#o.engine.listener),
      handItem: this.#handItem(s),
      creatureCall: this.#calls.get(s.id) ?? null,
    };
    const sound = opcodeSound(this.#o.book, code, ctx, this.#rng.rand);
    if (!sound) return;
    if (sound.kind === 'footstep') this.#footstep(s);
    else if (sound.kind === 'battle') this.#battleSound(s.id, sound.sound, false);
    else this.#play(sound.cue);
  }

  #battleSound(id: number, sound: BattleSoundName, lowerVolume: boolean): void {
    const s = this.#soldiers.get(id);
    if (!s || s.muted) return;
    if (sound === 'DIE1') {
      if (this.#dead.has(id)) return;
      this.#dead.add(id);
    }
    const playing = this.#battleVoices.get(id);
    const owner = this.#speechOwner;
    const talking = owner ? owner.isTalking(id) : this.#speech?.speaker === id && this.#speech.voice.active;
    const outcome = battleSoundCue(
      this.#o.book,
      { gridNo: s.gridNo, team: s.team, bodyType: s.bodyType, voice: s.voice ?? null, morale: s.morale ?? NORMAL_MORALE },
      this.#battle.get(id) ?? NO_BATTLE_MEMORY,
      {
        sound,
        nowMs: this.#o.now(),
        playing: playing?.active ?? false,
        talking,
        muteConfirmations: this.#settings.muteConfirmations,
        lowerVolume,
      },
      this.#o.exists,
      this.#rng.rand,
    );
    this.#battle.set(id, outcome.memory);
    if (outcome.stopPrevious) playing?.stop();
    if (outcome.cutSpeech && owner) owner.cut(id);
    else if (outcome.cutSpeech && this.#speech?.speaker === id) this.#speech.voice.stop();
    for (const cue of outcome.cues) {
      this.stats.battleSounds++;
      const voice = this.#play(cue);
      if (voice && cue.bus === 'speech') this.#battleVoices.set(id, voice);
    }
  }

  #located(soldier: number, cue: Cue | null): Cue | null {
    if (!cue) return null;
    const s = this.#soldiers.get(soldier);
    if (s) return { ...cue, gridNo: s.gridNo };
    return { ...cue, gridNo: NOWHERE, baseVolume: Math.max(VolumeLevel.LOW, cue.baseVolume - FAR_VOLUME_MOD) };
  }

  #remember(e: NonNullable<ViewFrame['events']>[number]): void {
    if (e.type === 'shotFired') {
      if (e.item !== undefined) this.#weapons.set(e.soldier, e.item);
      this.#bursts.set(e.soldier, e.burst ?? false);
      this.#attacks.set(e.soldier, 'gun');
    } else if (e.type === 'meleeStrike') this.#attacks.set(e.soldier, e.weapon === 'blade' ? 'blade' : 'punch');
    else if (e.type === 'creatureCall') this.#calls.set(e.soldier, e.call);
  }

  #event(e: NonNullable<ViewFrame['events']>[number]): void {
    const book = this.#o.book;
    const rand = this.#rng.rand;
    switch (e.type) {
      case 'shotFired':
        if (e.item !== undefined)
          this.#play(
            this.#located(
              e.soldier,
              gunshotCue(
                book,
                NOWHERE,
                { item: e.item, silenced: e.silenced ?? false, burst: e.burst ?? false, rounds: e.rounds ?? 1 },
                this.#o.exists,
              ),
            ),
          );
        return;
      case 'gunJammed':
        if (!e.unjammed && this.#soldiers.get(e.soldier)?.team === OUR_TEAM)
          this.#play(this.#located(e.soldier, dryFireCue(book, NOWHERE)));
        return;
      case 'reloaded':
        if (this.#soldiers.has(e.soldier)) this.#play(reloadCue(book, e.item));
        return;
      case 'bulletStopped':
        this.#bulletStopped(e);
        return;
      case 'bulletImpact':
        this.#bulletImpact(e);
        return;
      case 'structureStruck':
        this.#play(materialHitCue(book, e.gridNo, e.material, e.caveWall ?? false));
        return;
      case 'windowShattered':
        this.#play(glassShatterCue(book, e.gridNo, rand));
        return;
      case 'creatureGas':
        this.#play(effectCue(book, 'CREATURE_GAS_NOISE', 'location', VolumeLevel.HIGH, e.gridNo));
        return;
      case 'thrownImpact':
        this.#play(effectCue(book, 'THROW_IMPACT_2', 'location', VolumeLevel.MID, e.gridNo));
        return;
      case 'catchEnded':
        this.#play(effectCue(book, 'CATCH_OBJECT', 'location', VolumeLevel.MID, e.gridNo));
        return;
      case 'mortarWhistle':
        this.#mortarWhistle(e.sounding);
        return;
      case 'stealthyFootstep':
        this.#stealthyFootstep(e.soldier);
        return;
      case 'soldierHit':
        this.#soldierHit(e);
        return;
      case 'soldierDied':
        this.#battleSound(e.soldier, 'DIE1', false);
        return;
      case 'explosion':
        this.#play(explosionCue(book, e.animation ?? '', e.gridNo, rand));
        return;
      case 'doorChanged':
        this.#door(e.gridNo, e.kind ?? 'wood', e.open, e.noisy ?? false);
        return;
      case 'doorResult':
        this.#doorResult(e);
        return;
      case 'doorTrap':
        this.#play(doorTrapCue(book, e.trap, e.gridNo));
        return;
      case 'openableChanged':
        this.#play(openableCue(book, e.gridNo, e.material, e.open));
        return;
      case 'contentsExclaimed':
        this.#o.later(e.delayMs, () => this.#battleSound(e.soldier, e.sound, false));
        return;
      case 'itemDropped':
        if (this.#soldiers.has(e.soldier)) this.#play(dropCue(book, e.gridNo));
        return;
      case 'mercQuote':
        if (e.textKey) this.#speak(e.profile, e.soldier >= 0 ? e.soldier : null, e.textKey);
        return;
      case 'npcQuote':
        this.#speak(e.profile, e.soldier, e.textKey);
        return;
      default:
        return;
    }
  }

  #weaponOf(soldier: number) {
    return this.#o.book.weapons.get(this.#weapons.get(soldier) ?? -1) ?? null;
  }

  #bulletStopped(e: EventOf<'bulletStopped'>): void {
    const book = this.#o.book;
    const weapon = this.#weaponOf(e.soldier);
    if (e.reason === 'offMap') {
      this.#play(offMapMissCue(book, weapon, e.explosiveAmmo ?? false, this.#rng.rand));
      this.#maybeCurse(e.soldier, false);
    } else if (e.reason !== 'soldier' && (weapon?.kind === 'blade' || weapon?.kind === 'throwingBlade'))
      this.#play(missCue(book, e.gridNo, weapon, 'ground', this.#rng.rand));
  }

  #maybeCurse(soldier: number, singleShotsOnly: boolean): void {
    if (this.#soldiers.get(soldier)?.team !== OUR_TEAM || !isGunKind(this.#weaponOf(soldier)?.kind)) return;
    if (singleShotsOnly && this.#bursts.get(soldier)) return;
    if (this.#rng.rand(MISS_CURSE_CHANCE) === 0) this.#battleSound(soldier, 'CURSE1', false);
  }

  #bulletImpact(e: EventOf<'bulletImpact'>): void {
    const book = this.#o.book;
    this.#maybeCurse(e.soldier, true);
    if (e.effect === 'miniboom') {
      this.#play(smallExplosionCue(book, e.gridNo));
      return;
    }
    this.#play(missCue(book, e.gridNo, this.#weaponOf(e.soldier), e.z === 0 ? 'ground' : 'air', this.#rng.rand));
  }

  #mortarWhistle(sounding: boolean): void {
    this.#whistle?.stop();
    this.#whistle = sounding ? this.#play(effectCue(this.#o.book, 'MORTAR_WHISTLE', 'fixed', VolumeLevel.HIGH)) : null;
  }

  #stealthyFootstep(soldier: number): void {
    const s = this.#soldiers.get(soldier);
    if (s) this.#footstep(s, true);
  }

  #soldierHit(e: EventOf<'soldierHit'>): void {
    const s = this.#soldiers.get(e.soldier);
    if (!s) return;
    const blade = e.attacker !== null && this.#attacks.get(e.attacker) === 'blade';
    this.#play(impactCue(this.#o.book, s.gridNo, blade, this.#rng.rand));
    if (e.life === 0) {
      this.#battleSound(s.id, 'DIE1', false);
      return;
    }
    if (e.life < CONSCIOUSNESS) return;
    if (s.bodyType === SoundBody.CROW) {
      this.#play(effectCue(this.#o.book, 'CROW_EXPLODE_1', 'location', VolumeLevel.HIGH, s.gridNo));
      return;
    }
    this.#battleSound(s.id, 'HIT1', false);
  }

  #door(gridNo: number, kind: DoorKind, open: boolean, noisy: boolean): void {
    if (open) {
      if (noisy) this.#play(doorCue(this.#o.book, gridNo, kind, true, this.#rng.rand));
      return;
    }
    const cue = doorCue(this.#o.book, gridNo, kind, false, this.#rng.rand);
    this.#o.later(DOOR_CLOSE_DELAY_MS, () => this.#play(cue));
  }

  #doorResult(e: EventOf<'doorResult'>): void {
    const soldierGridNo = this.#soldiers.get(e.soldier)?.gridNo ?? e.gridNo;
    this.#play(lockOutcomeCue(this.#o.book, { action: e.action, result: e.result, doorGridNo: e.gridNo, soldierGridNo }));
    if (e.action === 'open' && e.result === 'locked') this.#battleSound(e.soldier, 'LOCKED', false);
  }

  #speak(profile: number, soldier: number | null, textKey: TextKey): void {
    if (!this.#settings.speech || this.#speechOwner) return;
    const view = soldier !== null ? this.#soldiers.get(soldier) : undefined;
    const recruitedNpcOrRpc = view?.kind !== undefined && RECRUITED_KINDS.has(view.kind);
    const path = speechPathForLine({ profile, textKey, recruitedNpcOrRpc }, this.#o.rpcSpeechPrefixed);
    if (!path) return;
    this.#speechQueue.push({ cue: speechCue(path), speaker: soldier });
    this.#nextLine();
  }

  #nextLine(): void {
    if (this.#speech?.voice.active) return;
    const line = this.#speechQueue.shift();
    if (!line) {
      this.#speech = null;
      return;
    }
    this.stats.speechLines++;
    const voice = this.#play(line.cue);
    if (!voice) return;
    this.#speech = { voice, speaker: line.speaker };
    if (!voice.active) {
      this.#nextLine();
      return;
    }
    voice.onEnded = () => this.#nextLine();
  }

  get speaking(): { readonly speaker: number; readonly file: string; readonly elapsedMs: number; readonly playing: boolean } | null {
    const current = this.#speech;
    if (!current || current.speaker === null || !current.voice.active) return null;
    return {
      speaker: current.speaker,
      file: current.voice.cue.file,
      elapsedMs: current.voice.elapsedMs,
      playing: current.voice.state === 'playing',
    };
  }

  #silenceSpeech(): void {
    this.#speechQueue.length = 0;
    const current = this.#speech;
    this.#speech = null;
    current?.voice.stop();
  }

  #scheduleAmbient(): void {
    const world = this.#world;
    if (!world || !this.#o.engine.unlocked) return;
    const now = this.#o.now();
    const minute = this.#context.minuteOfDay ?? DEFAULT_MINUTE_OF_DAY;
    world.ambient.forEach((entry, i) => {
      const slot = this.#ambient[i];
      if (!slot) return;
      if (!ambientActive(entry, minute)) {
        slot.nextAt = null;
        return;
      }
      if (slot.nextAt === null) {
        slot.nextAt = now + ambientGapMs(entry, this.#rng.rand);
        return;
      }
      if (now < slot.nextAt || slot.voice?.active) return;
      slot.voice = this.#play(ambientCue(entry));
      slot.nextAt = now + ambientGapMs(entry, this.#rng.rand);
      this.stats.ambientPlays++;
    });
  }
}
