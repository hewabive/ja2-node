// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc EVENT_InitNewSoldierAnim (the final footstep), TurnSoldier (turning
// @src footsteps), PlaySoldierFootstepSound (silent in stealth mode), PlayStealthySoldierFootstepSound (Overhead.cc
// @src HandleAtNewGridNo), InternalDoMercBattleSound (nothing from a muted soldier; a vehicle's goes to a random
// @src passenger, Vehicles.cc PickRandomPassengerFromVehicle with Random(n) drawn here, 2026-11-05), EVENT_SoldierGotHit
// @src (impact and hit sounds, none for a vehicle, which only rings its metal in Vehicles.cc VehicleTakeDamage);
// @src Tactical/Soldier_Ani.cc (death sounds, the creature battle
// @src cry of code 717 by the call kind); Tactical/Handle_Doors.cc HandleDoorChangeFromGridNo (the close sound on the
// @src door's key frame); TileEngine/Interactive_Tiles.cc HandleStructChangeFromGridNo (an openable's sound from the
// @src view's open containers, silent when Bobby Ray's delivery closes the crate as Strategic_Event_Handler.cc
// @src CloseCrate does, the opener's battle sound 500 ms later); Tactical/Weapons.cc UseGun, BulletHitStructure,
// @src StructureHit and ShotMiss (the miss sounds and the Random(40) curse of our mercs, drawn here, not in the
// @src simulation), DoSpecialEffectAmmoMiss, WindowHit; Tactical/Handle_Items.cc HandleItem (the rocket rifle's RG_ID
// @src sounds); TileEngine/Structure.cc DamageStructure (the material a bullet strikes); TileEngine/Physics.cc (a thrown
// @src object landing, the mortar whistle, CATCH_OBJECT as a catch ends);
// @src Tactical/Handle_UI.cc and Real_Time_Input.cc (OK and ATTN on orders and selection); Tactical/Soldier_Ani.cc code
// @src 491 (idle sounds, counted from the passes of the loop that holds it, since the server sends no frames of a
// @src predictable loop); Tactical/Rotting_Corpses.cc VaporizeCorpse (BODY_EXPLODE_1); Tactical/OppList.cc OurTeamSeesSomeone
// @src and SaySeenQuote (the ENEMY and CURSE1 battle sounds of a sighting, 2026-10-30); Tactical/Handle_Items.cc
// @src SoldierGetItemFromWorld (the GOTIT battle sound of a pickup, 2026-10-30), HandleSoldierPickupItem (the NOTHING
// @src battle sound of a pickup or search that finds nothing, 2026-11-03); Tactical/Weapons.cc UseHandToHand (the curse
// @src of a failed or fumbled steal, 2026-10-31); Tactical/Dialogue_Control.cc DialogueEventQuote::Execute (the battle sound
// @src of the merc on our team with a line's profile, which holds the line, 2026-10-31); Tactical/Interface_Panels.cc
// @src SMInvClickCamoCallback (the COOL1 battle sound after a camouflage kit, elixir or drug applied on the portrait, none
// @src after the canteen) and Tactical/Items.cc ApplyCanteen (its drinking sound at MIDVOLUME, 2026-11-04);
// @src Tactical/Overhead.cc HandleGotoNewGridNo (the CURSE1 of the blind and the drunk fall, 2026-11-04);
// @src Tactical/Handle_Items.cc HandleItem (USE_X_RAY_MACHINE at the merc's tile as the x-ray device starts, the NOTHING
// @src battle sound of a jar or tin can used where no corpse lies, 2026-11-04); Tactical/Vehicles.cc AddSoldierToVehicle
// @src and ExitVehicle (the vehicle type's enter sound at the vehicle's tile, HIGHVOLUME, on the tactical screen),
// @src HandleVehicleMovementSound (its move sound at the tile it starts from, once a vehicle's state turns moving,
// @src stopped by a state that is not, Soldier_Control.cc EVENT_InitNewSoldierAnim, or by AdjustNoAPToFinishMove,
// @src 2026-11-05); Tactical/Soldier_Control.cc TurnSoldier (a tank's TURRET_MOVE loop from its first 32-facing step,
// @src stopped with TURRET_STOP once it faces where it turns, 2026-11-05); Tactical/Soldier_Control.cc
// @src HandleTakeDamageDeath (the DIE1 cry, DOORCR_1 and HEADCR_1 of a merc of ours dying off the loaded map while the
// @src tactical screen is up, 2026-11-06; the cry by his team and sGridNo, NOWHERE off the map, 2026-11-07); GameScreen.cc MainGameScreenHandle (ExecuteOverhead, which runs the
// @src animation codes, the final footsteps and code 491, only on the game screen; LeaveTacticalScreen's
// @src SetPositionSndsInActive, which silences the position sounds off the game screen, 2026-11-06); Overhead.cc
// @src HandlePlayerServices (the CURSE1 of a medic out of bandages, none in auto-bandage, 2026-11-06); Merc_Entering.cc
// @src StartHelicopterRun and HandleHeliDrop (HELI_1 through a run of the helicopter drop at the view's engine volume,
// @src silent off the game screen, 2026-11-08); TileEngine/Pits.cc SearchForOtherMembersWithinPitRadiusAndMakeThemFall
// @src (CAVE_COLLAPSE at the pit, HIGHVOLUME, 2026-11-09); Tactical/Handle_Items.cc StartBombMessageBox (USE_STATUE_REMOTE
// @src at HIGHVOLUME, MIDDLEPAN, then OK1 by the opened statue or CURSE1), SoldierPickupItem (OK1), Tactical/Items.cc
// @src CheckEquipmentForFragileItemDamage (GLASS_CRACK at the soldier, MIDVOLUME), Tactical/Soldier_Control.cc DoNinjaAttack
// @src (Dr. Q's chop as his battle sound), HandleTakeDamageDeath and HandleSoldierTakeDamageFeedback, TileEngine/
// @src Explosion_Control.cc DishOutGasDamage (DIE1 and the HIT1 grunts at bleeding, gas and electric damage, 2026-11-09).

import { ticksPerFrame } from '../content/anim/schedule-track.ts';
import { facingOfDirection } from '../content/anim/soldier-sprite.ts';
import { type AnimationTables, AnimFlags } from '../content/anim/tables.ts';
import { DEFAULT_TAIL_FRAMES, followTimeline, type TimelinePosition } from '../content/anim/timeline-follower.ts';
import { ambientActive, ambientCue, ambientGapMs } from '../content/audio/ambient-schedule.ts';
import { type BattleMemory, type BattleSoundName, battleSoundCue, NO_BATTLE_MEMORY } from '../content/audio/battle-sound.ts';
import { CALL_CRY_CODES, callAnimationState, codesInScript } from '../content/audio/creature-call.ts';
import { type Cue, cueOf, effectCue, type FileExists, VolumeLevel } from '../content/audio/cue.ts';
import type { CueBook } from '../content/audio/cue-book.ts';
import {
  alarmCue,
  type CreatureCall,
  type DoorKind,
  deathOffTheMapCues,
  doorCue,
  doorTrapCue,
  dropCue,
  dryFireCue,
  explosionCue,
  footstepCue,
  glassShatterCue,
  gunshotCue,
  impactCue,
  imprintCue,
  isSoundOpcode,
  isTankBody,
  lockOutcomeCue,
  martialArtsChopCue,
  materialHitCue,
  missCue,
  offMapMissCue,
  opcodeSound,
  openableCue,
  reloadCue,
  SoundBody,
  smallExplosionCue,
  TerrainKind,
  turretMoveCue,
  turretStopCue,
} from '../content/audio/cues.ts';
import { BleedGrunts, damageFeedbackSounds } from '../content/audio/damage-feedback.ts';
import { type Heard, heardSoundTile } from '../content/audio/heard-place.ts';
import { hasIdleSounds, idleCheck, idleCheckLoopFrames } from '../content/audio/idle-sounds.ts';
import { NOWHERE, offScreenVolume, onScreen } from '../content/audio/sound-position.ts';
import type { AmbientEntry } from '../content/formats/ambient.ts';
import type { AnimationScripts } from '../content/formats/ja2bin.ts';
import { vehicleTypeOfBody } from '../content/strategic/vehicle-types.ts';
import { TICK_MS } from '../protocol/messages.ts';
import type { HelicopterDropView, SoldierView, ViewFrame } from '../protocol/view.ts';
import { ClientRandom } from './client-random.ts';
import type { AudioEngine, VoiceHandle } from './engine.ts';
import { HelicopterEngine } from './helicopter-engine.ts';
import { PositionalLoops } from './positional.ts';

export const CATCH_UP_TICKS = 100;
const DOOR_CLOSE_DELAY_MS = 2 * 70;
const NORMAL_MORALE = 50;
const OUR_TEAM = 0;
const MISS_CURSE_CHANCE = 40;
const GUN_KINDS: ReadonlySet<string> = new Set(['handgun', 'smg', 'rifle', 'shotgun', 'lmg']);
const isGunKind = (kind: string | undefined) => kind !== undefined && GUN_KINDS.has(kind);
const NO_VARIANT = 0;
const DEFAULT_MINUTE_OF_DAY = 12 * 60;
const CONTENTS_EXCLAMATION_DELAY_MS = 500;
const UNSEEN_VICTIM_TEAM = 1;
const NOBODY = -1;
const NO_MATERIAL = 0;
const isVehicleBody = (bodyType: number) => bodyType >= SoundBody.FIRST_VEHICLE && bodyType <= SoundBody.LAST_VEHICLE;
const hiResFacing = (s: SoldierView) => s.hiResDirection ?? facingOfDirection(s.direction).hiResDirection;
const ANIM_STAND = 6;
const CANTEEN = 'CANTEEN';
const DYING_HEALTH_INDEX = 0;
const CRITICAL_HEALTH_INDEX = 1;

export interface SoundWorld {
  terrainAt(gridNo: number): number;
  openableMaterialAt(gridNo: number): number | null;
  readonly ambient: readonly AmbientEntry[];
}

export interface DirectorSettings {
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
  readonly now: () => number;
  readonly later: (ms: number, run: () => void) => void;
  readonly onTacticalScreen?: () => boolean;
}

export interface DirectorStats {
  frames: number;
  events: number;
  opcodes: number;
  footsteps: number;
  battleSounds: number;
  ambientPlays: number;
  cues: number;
}

interface AmbientSlot {
  nextAt: number | null;
  voice: VoiceHandle | null;
}

interface IdleLoop {
  readonly state: number;
  readonly since: number;
  passes: number;
}

type Voiced = Pick<SoldierView, 'id' | 'gridNo' | 'team' | 'bodyType' | 'voice' | 'morale' | 'muted'> & { readonly far?: boolean };

type EventOf<T extends string> = Extract<NonNullable<ViewFrame['events']>[number], { type: T }>;
type UnseenVictim = NonNullable<EventOf<'soldierHit'>['unseen']>;
type Firer = Pick<EventOf<'bulletImpact'>, 'soldier' | 'item'>;

interface Place {
  readonly gridNo: number;
  readonly far: boolean;
}

function absentVoice(id: number, cry: NonNullable<EventOf<'mercDied'>['cry']>): Voiced {
  return { id, gridNo: cry.gridNo ?? NOWHERE, team: cry.team, bodyType: cry.bodyType, voice: cry.voice };
}

export class SoundDirector {
  readonly stats: DirectorStats = {
    frames: 0,
    events: 0,
    opcodes: 0,
    footsteps: 0,
    battleSounds: 0,
    ambientPlays: 0,
    cues: 0,
  };
  readonly #o: DirectorOptions;
  readonly #rng: ClientRandom;
  readonly #loops: PositionalLoops;
  readonly #helicopter: HelicopterEngine;
  #helicopterDrop: HelicopterDropView | null = null;
  readonly #soldiers = new Map<number, SoldierView>();
  readonly #timelines = new Map<number, TimelinePosition>();
  readonly #lastFootstep = new Map<number, number>();
  readonly #battle = new Map<number, BattleMemory>();
  readonly #battleVoices = new Map<number, VoiceHandle>();
  readonly #dead = new Set<number>();
  readonly #bleedGrunts = new BleedGrunts();
  readonly #struckVehicles = new Set<number>();
  readonly #driving = new Map<number, VoiceHandle>();
  readonly #turrets = new Map<number, VoiceHandle>();
  readonly #weapons = new Map<number, number>();
  readonly #bursts = new Map<number, boolean>();
  readonly #calls = new Map<number, CreatureCall>();
  readonly #idleLoops = new Map<number, IdleLoop>();
  readonly #idleCounters = new Map<number, number>();
  readonly #idleLoopFrames = new Map<number, number | null>();
  #openContainers = new Set<number>();
  #whistle: VoiceHandle | null = null;
  #speechOwner: SpeechOwner | null = null;
  #world: SoundWorld | null = null;
  #ambient: AmbientSlot[] = [];
  #settings: DirectorSettings = { muteConfirmations: false };
  #context: DirectorContext = { selected: null, inCombat: false, minuteOfDay: null };

  constructor(options: DirectorOptions) {
    this.#o = options;
    this.#rng = new ClientRandom(options.seed);
    this.#loops = new PositionalLoops(options.engine, options.book);
    this.#helicopter = new HelicopterEngine(options.engine, options.book);
  }

  get helicopterEnginePlaying(): boolean {
    return this.#helicopter.playing;
  }

  get rand(): (n: number) => number {
    return this.#rng.rand;
  }

  reset(soldiers: readonly SoldierView[], openContainers: readonly number[] = [], helicopterDrop: HelicopterDropView | null = null): void {
    this.#helicopterDrop = helicopterDrop;
    for (const id of [...this.#driving.keys()]) this.#stopDriving(id);
    for (const id of [...this.#turrets.keys()]) this.#silenceTurret(id);
    this.#soldiers.clear();
    this.#timelines.clear();
    for (const s of soldiers) this.#soldierChanged(s, false);
    this.#openContainers = new Set(openContainers);
  }

  setWorld(world: SoundWorld | null): void {
    this.#world = world;
    for (const slot of this.#ambient) slot.voice?.stop();
    this.#ambient = (world?.ambient ?? []).map(() => ({ nextAt: null, voice: null }));
  }

  setSettings(settings: DirectorSettings): void {
    this.#settings = settings;
  }

  setSpeechOwner(owner: SpeechOwner | null): void {
    this.#speechOwner = owner;
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

  mercBattleSoundPlaying(profile: number): boolean {
    const merc = [...this.#soldiers.values()].find((s) => s.team === OUR_TEAM && s.profile === profile);
    return merc !== undefined && (this.#battleVoices.get(merc.id)?.active ?? false);
  }

  fingerprintDenied(): void {
    this.#play(imprintCue(this.#o.book, false));
  }

  applyFrames(frames: readonly ViewFrame[]): void {
    const newest = frames.at(-1)?.tick;
    if (newest === undefined) return;
    const animating = this.#onTacticalScreen();
    for (const frame of frames) {
      this.stats.frames++;
      const audible = newest - frame.tick <= CATCH_UP_TICKS;
      const events = frame.events ?? [];
      if (frame.helicopterDrop !== undefined) this.#helicopterDrop = frame.helicopterDrop;
      for (const e of events) this.#remember(e);
      for (const id of frame.removed) this.#forget(id);
      for (const s of frame.changed) this.#soldierChanged(s, audible && animating);
      if (frame.openContainers) this.#containersChanged(frame.openContainers, audible, events);
      for (const e of events) {
        this.stats.events++;
        if (audible) this.#event(e);
      }
      this.#idleChecks(frame.tick, audible && animating);
    }
    this.#updatePositionSounds();
  }

  #onTacticalScreen(): boolean {
    return this.#o.onTacticalScreen?.() !== false;
  }

  #updatePositionSounds(): void {
    this.#loops.update(this.#onTacticalScreen() ? [...this.#soldiers.values()] : []);
    this.#helicopter.update(this.#helicopterEngineVolume());
  }

  #helicopterEngineVolume(): number | null {
    const drop = this.#helicopterDrop;
    return drop?.running && this.#onTacticalScreen() ? drop.engineVolume : null;
  }

  update(): void {
    this.#updatePositionSounds();
    this.#scheduleAmbient();
  }

  stop(): void {
    this.#loops.stopAll();
    this.#helicopter.stop();
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
    if (prev && isVehicleBody(s.bodyType)) this.#vehicleMovement(prev, s, audible);
    if (prev && isTankBody(s.bodyType)) this.#turret(prev, s, audible);
    if (!audible || !prev) return;
    const stateChanged = prev.animation !== s.animation;
    if (stateChanged && this.#has(prev.animation, AnimFlags.MOVING) && this.#has(s.animation, AnimFlags.STATIONARY)) this.#footstep(s);
    if (!stateChanged && prev.direction !== s.direction && this.#turningStep(s)) this.#footstep(s);
  }

  #forget(id: number): void {
    this.#soldiers.delete(id);
    this.#driving.delete(id);
    this.#silenceTurret(id);
  }

  #turret(prev: SoldierView, s: SoldierView, audible: boolean): void {
    if (s.turning !== true) {
      this.#stopTurret(s, audible);
      return;
    }
    if (audible && hiResFacing(prev) !== hiResFacing(s) && !this.#turrets.has(s.id)) {
      const voice = this.#play(turretMoveCue(this.#o.book, s.gridNo));
      if (voice) this.#turrets.set(s.id, voice);
    }
  }

  #stopTurret(s: SoldierView, audible: boolean): void {
    if (!this.#turrets.has(s.id)) return;
    this.#silenceTurret(s.id);
    if (audible) this.#play(turretStopCue(this.#o.book, s.gridNo));
  }

  #silenceTurret(id: number): void {
    this.#turrets.get(id)?.stop();
    this.#turrets.delete(id);
  }

  #vehicleMovement(prev: SoldierView, s: SoldierView, audible: boolean): void {
    if (!this.#has(s.animation, AnimFlags.MOVING) || s.noApToFinishMove === true) {
      this.#stopDriving(s.id);
      return;
    }
    if (audible && !this.#has(prev.animation, AnimFlags.MOVING)) this.#startDriving(s);
  }

  #startDriving(s: SoldierView): void {
    if (this.#driving.has(s.id)) return;
    const sounds = this.#o.book.vehicles[vehicleTypeOfBody(s.bodyType)];
    const voice = sounds ? this.#play(cueOf(sounds.move, 'location', VolumeLevel.HIGH, s.gridNo)) : null;
    if (voice) this.#driving.set(s.id, voice);
  }

  #stopDriving(id: number): void {
    this.#driving.get(id)?.stop();
    this.#driving.delete(id);
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
    this.#voiceSound(this.#soldiers.get(id), sound, lowerVolume);
  }

  #victim(id: number, place: Place, unseen: UnseenVictim | undefined): Voiced | undefined {
    const known = this.#soldiers.get(id);
    if (known || !unseen) return known;
    return { id, gridNo: place.gridNo, team: UNSEEN_VICTIM_TEAM, bodyType: unseen.bodyType, voice: unseen.voice, far: place.far };
  }

  #placeOf(gridNo: number | undefined, heard: Heard | undefined): Place {
    if (gridNo !== undefined) return { gridNo, far: false };
    const by = heard ? this.#soldiers.get(heard.by) : undefined;
    if (heard && by) return { gridNo: heardSoundTile(by.gridNo, heard.direction, heard.volumeClass), far: false };
    return { gridNo: NOWHERE, far: true };
  }

  #sourcePlace(soldier: number | undefined, gridNo?: number, heard?: Heard): Place {
    const known = soldier === undefined ? undefined : this.#soldiers.get(soldier);
    return known ? { gridNo: known.gridNo, far: false } : this.#placeOf(gridNo, heard);
  }

  #placed(cue: Cue | null, place: Place): Cue | null {
    if (!cue) return null;
    if (!place.far) return { ...cue, gridNo: place.gridNo };
    return { ...cue, gridNo: NOWHERE, baseVolume: offScreenVolume(cue.baseVolume) };
  }

  #randomPassenger(vehicle: number): Voiced | undefined {
    const aboard = this.#soldiers.get(vehicle)?.passengers ?? [];
    if (aboard.length === 0) return undefined;
    return this.#soldiers.get(aboard[this.#rng.rand(aboard.length)] ?? NOBODY);
  }

  #deathSoundPlayed(id: number): boolean {
    if (this.#dead.has(id)) return true;
    this.#dead.add(id);
    return false;
  }

  #voiceSound(soldier: Voiced | undefined, sound: BattleSoundName, lowerVolume: boolean): void {
    if (!soldier) return;
    const vehicle = isVehicleBody(soldier.bodyType);
    if (!vehicle && soldier.muted) return;
    if (sound === 'DIE1' && this.#deathSoundPlayed(soldier.id)) return;
    const s = vehicle ? this.#randomPassenger(soldier.id) : soldier;
    if (!s || s.muted) return;
    const id = s.id;
    const playing = this.#battleVoices.get(id);
    const owner = this.#speechOwner;
    const talking = owner?.isTalking(id) ?? false;
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
    if (outcome.cutSpeech) owner?.cut(id);
    for (const cue of outcome.cues) {
      this.stats.battleSounds++;
      const voice = this.#play(s.far ? this.#placed(cue, { gridNo: NOWHERE, far: true }) : cue);
      if (voice && cue.bus === 'speech') this.#battleVoices.set(id, voice);
    }
  }

  #remember(e: NonNullable<ViewFrame['events']>[number]): void {
    if (e.type === 'shotFired' && e.soldier !== undefined) {
      if (e.item !== undefined) this.#weapons.set(e.soldier, e.item);
      this.#bursts.set(e.soldier, e.burst ?? false);
    } else if (e.type === 'creatureCall' && e.soldier !== undefined) this.#calls.set(e.soldier, e.call);
    else if (e.type === 'soldierHit' && this.#knownVehicle(e.soldier)) this.#struckVehicles.add(e.soldier);
  }

  #knownVehicle(id: number): boolean {
    const s = this.#soldiers.get(id);
    return s !== undefined && isVehicleBody(s.bodyType);
  }

  #event(e: NonNullable<ViewFrame['events']>[number]): void {
    const book = this.#o.book;
    const rand = this.#rng.rand;
    switch (e.type) {
      case 'shotFired':
        if (e.item !== undefined)
          this.#play(
            this.#placed(
              gunshotCue(
                book,
                NOWHERE,
                { item: e.item, silenced: e.silenced ?? false, burst: e.burst ?? false, rounds: e.rounds ?? 1 },
                this.#o.exists,
              ),
              this.#sourcePlace(e.soldier, undefined, e.heard),
            ),
          );
        return;
      case 'gunJammed':
        if (!e.unjammed && this.#soldiers.get(e.soldier)?.team === OUR_TEAM)
          this.#play(this.#placed(dryFireCue(book, NOWHERE), this.#sourcePlace(e.soldier)));
        return;
      case 'gunImprint':
        this.#play(imprintCue(book, e.result === 'imprinted'));
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
        this.#play(this.#placed(effectCue(book, 'CATCH_OBJECT', 'location', VolumeLevel.MID), this.#sourcePlace(e.soldier)));
        return;
      case 'remoteUsed':
        this.#remoteUsed(e);
        return;
      case 'jarsBroken':
        this.#play(this.#placed(effectCue(book, 'GLASS_CRACK', 'location', VolumeLevel.MID), this.#sourcePlace(e.soldier)));
        return;
      case 'martialArtsChop':
        this.#martialArtsChop(e);
        return;
      case 'pickupConfirmed':
        this.#battleSound(e.soldier, 'OK1', false);
        return;
      case 'damageFeedback':
        if (!e.mapScreen) this.#damageFeedback(e);
        return;
      case 'mortarWhistle':
        this.#mortarWhistle(e.sounding);
        return;
      case 'stealthyFootstep':
        this.#stealthyFootstep(e.soldier);
        return;
      case 'stealAttempt':
        if (e.result !== 'grabbed' && this.#soldiers.get(e.soldier)?.team === OUR_TEAM) this.#battleSound(e.soldier, 'CURSE1', false);
        return;
      case 'soldierHit':
        this.#soldierHit(e);
        return;
      case 'soldierDied':
        this.#voiceSound(this.#victim(e.soldier, this.#sourcePlace(e.soldier, e.gridNo, e.heard), e.unseen), 'DIE1', false);
        return;
      case 'mercDied':
        if (!e.mapScreen) this.#mercDiedOffTheMap(e);
        return;
      case 'creatureCall':
        if (e.unseen) this.#unseenCall(e.call, e.unseen.bodyType, this.#placeOf(undefined, e.heard));
        return;
      case 'bloodcatAttack':
        this.#play(effectCue(book, 'BLOODCAT_ATTACK', 'fixed', VolumeLevel.HIGH));
        return;
      case 'explosion':
        this.#play(explosionCue(book, e.animation ?? '', e.gridNo, rand));
        return;
      case 'corpseVaporized':
        this.#play(effectCue(book, 'BODY_EXPLODE_1', 'location', VolumeLevel.HIGH, e.gridNo));
        return;
      case 'pitOpened':
        this.#play(effectCue(book, 'CAVE_COLLAPSE', 'location', VolumeLevel.HIGH, e.gridNo));
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
      case 'alarm':
        this.#play(alarmCue(book, e.gridNo));
        return;
      case 'contentsExclaimed':
        this.#o.later(CONTENTS_EXCLAMATION_DELAY_MS, () => this.#battleSound(e.soldier, e.sound, false));
        return;
      case 'enemySighted':
      case 'itemsPickedUp':
      case 'outOfBandages':
      case 'trapDisarmed':
      case 'trapSetOff':
        if (e.battleSound) this.#battleSound(e.soldier, e.battleSound, false);
        return;
      case 'nothingFound':
        this.#voiceSound(this.#victim(e.soldier, this.#sourcePlace(e.soldier, e.gridNo, e.heard), e.unseen), 'NOTHING', false);
        return;
      case 'fellDown':
      case 'slippedOnMarbles':
        this.#battleSound(e.soldier, 'CURSE1', false);
        return;
      case 'itemApplied':
        this.#itemApplied(e);
        return;
      case 'itemDropped':
        if (!e.beside && this.#soldiers.has(e.soldier)) this.#play(dropCue(book, e.gridNo));
        return;
      case 'vehicleBoarded':
      case 'vehicleLeft':
        if (e.gridNo !== undefined) this.#enterSound(e.gridNo);
        return;
      default:
        return;
    }
  }

  #mercDiedOffTheMap(e: EventOf<'mercDied'>): void {
    if (e.cry) this.#voiceSound(absentVoice(e.soldier, e.cry), 'DIE1', false);
    for (const cue of deathOffTheMapCues(this.#o.book)) this.#play(cue);
  }

  #damageFeedback(e: EventOf<'damageFeedback'>): void {
    const soldier = e.cry
      ? absentVoice(e.soldier, e.cry)
      : this.#victim(e.soldier, this.#sourcePlace(e.soldier, undefined, e.heard), e.unseen);
    const facts = { cause: e.cause, seen: !e.cry && !e.unseen, conscious: e.conscious === true };
    for (const sound of damageFeedbackSounds(facts, this.#bleedGrunts.due(e.soldier, this.#o.now())))
      this.#voiceSound(soldier, sound, false);
  }

  #remoteUsed(e: EventOf<'remoteUsed'>): void {
    if (e.result === 'xray')
      this.#play(this.#placed(effectCue(this.#o.book, 'USE_X_RAY_MACHINE', 'location', VolumeLevel.HIGH), this.#sourcePlace(e.soldier)));
    if (e.result !== 'statueOpened' && e.result !== 'nothing') return;
    this.#play(effectCue(this.#o.book, 'USE_STATUE_REMOTE', 'fixed', VolumeLevel.HIGH));
    this.#battleSound(e.soldier, e.result === 'statueOpened' ? 'OK1' : 'CURSE1', false);
  }

  #martialArtsChop(e: EventOf<'martialArtsChop'>): void {
    const place = this.#sourcePlace(e.soldier);
    const team = this.#soldiers.get(e.soldier)?.team ?? UNSEEN_VICTIM_TEAM;
    const chop = martialArtsChopCue(this.#o.book, place.gridNo, team, e.spinKick === true, this.#rng.rand);
    const voice = this.#play(this.#placed(chop, place));
    if (voice) this.#battleVoices.set(e.soldier, voice);
  }

  #enterSound(gridNo: number): void {
    if (!this.#onTacticalScreen()) return;
    const vehicle = [...this.#soldiers.values()].find((s) => s.gridNo === gridNo && isVehicleBody(s.bodyType));
    const sounds = vehicle ? this.#o.book.vehicles[vehicleTypeOfBody(vehicle.bodyType)] : undefined;
    if (sounds) this.#play(cueOf(sounds.enter, 'location', VolumeLevel.HIGH, gridNo));
  }

  #itemApplied(e: EventOf<'itemApplied'>): void {
    if (e.sound) this.#play(effectCue(this.#o.book, e.sound, 'fixed', VolumeLevel.MID));
    if (e.item !== CANTEEN) this.#battleSound(e.target, 'COOL1', false);
  }

  #weaponOf(firer: Firer) {
    const item = firer.item ?? (firer.soldier === undefined ? undefined : this.#weapons.get(firer.soldier));
    return this.#o.book.weapons.get(item ?? -1) ?? null;
  }

  #bulletStopped(e: EventOf<'bulletStopped'>): void {
    const book = this.#o.book;
    const weapon = this.#weaponOf(e);
    if (e.reason === 'offMap') {
      this.#play(offMapMissCue(book, weapon, e.explosiveAmmo ?? false, this.#rng.rand));
      this.#maybeCurse(e, false);
    } else if (e.reason !== 'soldier' && (weapon?.kind === 'blade' || weapon?.kind === 'throwingBlade'))
      this.#play(missCue(book, e.gridNo, weapon, 'ground', this.#rng.rand));
  }

  #maybeCurse(firer: Firer, singleShotsOnly: boolean): void {
    const soldier = firer.soldier;
    if (soldier === undefined || this.#soldiers.get(soldier)?.team !== OUR_TEAM || !isGunKind(this.#weaponOf(firer)?.kind)) return;
    if (singleShotsOnly && this.#bursts.get(soldier)) return;
    if (this.#rng.rand(MISS_CURSE_CHANCE) === 0) this.#battleSound(soldier, 'CURSE1', false);
  }

  #bulletImpact(e: EventOf<'bulletImpact'>): void {
    const book = this.#o.book;
    this.#maybeCurse(e, true);
    if (e.effect === 'miniboom') {
      this.#play(smallExplosionCue(book, e.gridNo));
      return;
    }
    this.#play(missCue(book, e.gridNo, this.#weaponOf(e), e.z === 0 ? 'ground' : 'air', this.#rng.rand));
  }

  #mortarWhistle(sounding: boolean): void {
    this.#whistle?.stop();
    this.#whistle = sounding ? this.#play(effectCue(this.#o.book, 'MORTAR_WHISTLE', 'fixed', VolumeLevel.HIGH)) : null;
  }

  #containersChanged(open: readonly number[], audible: boolean, events: NonNullable<ViewFrame['events']>): void {
    const now = new Set(open);
    const quietClose = events.some((e) => e.type === 'shipmentDelivered');
    if (audible) {
      for (const g of now) if (!this.#openContainers.has(g)) this.#openableSound(g, true);
      if (!quietClose) for (const g of this.#openContainers) if (!now.has(g)) this.#openableSound(g, false);
    }
    this.#openContainers = now;
  }

  #openableSound(gridNo: number, open: boolean): void {
    const material = this.#world?.openableMaterialAt(gridNo) ?? NO_MATERIAL;
    this.#play(openableCue(this.#o.book, gridNo, material, open));
  }

  #stealthyFootstep(soldier: number): void {
    const s = this.#soldiers.get(soldier);
    if (s) this.#footstep(s, true);
  }

  #soldierHit(e: EventOf<'soldierHit'>): void {
    const place = this.#sourcePlace(e.soldier, e.gridNo, e.heard);
    const s = this.#victim(e.soldier, place, e.unseen);
    const book = this.#o.book;
    if (this.#struckVehicles.delete(e.soldier) || (s && isVehicleBody(s.bodyType))) {
      this.#play(this.#placed(effectCue(book, 'S_METAL_IMPACT3', 'location', VolumeLevel.MID), place));
      return;
    }
    if (!s) return;
    this.#play(this.#placed(impactCue(book, place.gridNo, e.blade === true, this.#rng.rand), place));
    if (e.life === 0) {
      this.#voiceSound(s, 'DIE1', false);
      return;
    }
    if (!e.conscious) return;
    if (s.bodyType === SoundBody.CROW) {
      this.#play(this.#placed(effectCue(book, 'CROW_EXPLODE_1', 'location', VolumeLevel.HIGH), place));
      return;
    }
    this.#voiceSound(s, 'HIT1', false);
  }

  #unseenCall(call: CreatureCall, bodyType: number, place: Place): void {
    const scripts = this.#o.scripts;
    const state = callAnimationState(this.#o.animations, bodyType);
    if (!scripts || state === null) return;
    const book = this.#o.book;
    const ctx = { gridNo: place.gridNo, bodyType, stealth: false, onScreen: true, handItem: null, creatureCall: call };
    for (const at of codesInScript(scripts, state, CALL_CRY_CODES)) {
      const sound = opcodeSound(book, at.code, ctx, this.#rng.rand);
      if (sound?.kind !== 'cue') continue;
      const cue = this.#placed(sound.cue, place);
      const delayMs = at.framesBefore * (this.#o.animations?.controls[state]?.speed ?? 0);
      if (delayMs === 0) this.#play(cue);
      else this.#o.later(delayMs, () => this.#play(cue));
    }
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
