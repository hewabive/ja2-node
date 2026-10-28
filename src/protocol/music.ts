// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Utils/Music_Control.cc SetMusicMode (RESTORE and the previous mode); the setters: Strategic/StrategicMap.cc
// @src SetCurrentWorldSector (sector entry, fast fade), AllMercsHaveWalkedOffSector (to the map screen, fast fade);
// @src Tactical/Overhead.cc SetEnemyPresence, CommonEnterCombatModeCode, ExitCombatMode, CheckForEndOfCombatMode,
// @src CheckForEndOfBattle; Tactical/OppList.cc OurTeamSeesSomeone (battle music when none plays in combat);
// @src Tactical/Merc_Entering.cc (the first helicopter drop); Tactical/Boxing.cc ExitBoxing; Laptop/Laptop.cc EnterLaptop,
// @src ExitLaptop; Strategic/Strategic_Movement.cc PrepareForPreBattleInterface; Strategic/PreBattle_Interface.cc
// @src InitPreBattleInterface, RetreatMercsCallback; Strategic/Auto_Resolve.cc RenderAutoResolve; Strategic/Meanwhile.cc
// @src StartMeanwhile, EndMeanwhile, DoneFadeOutMeanwhileOnceDone; Tactical/End_Game.cc HandleDeidrannaDeath,
// @src DoneFadeOutKilledQueen, HandleQueenBitchDeath; Strategic/Creature_Spreading.cc PrepareCreaturesForBattle.

import type { SimEvent } from '../sim/events.ts';
import { MusicMode, type MusicModeName } from './music-modes.ts';

export interface MusicState {
  readonly mode: MusicModeName;
  readonly previous: MusicModeName;
}

export interface MusicFacts {
  readonly creature: boolean;
  readonly inCombat: boolean;
  readonly sectorLoaded: boolean;
  readonly hostiles: number;
  readonly gameJustStarted: boolean;
}

export interface MusicTransition extends MusicState {
  readonly fastFade: boolean;
}

export interface MusicView {
  readonly mode: MusicModeName;
  readonly creature: boolean;
  readonly fastFade?: true;
}

export function initialMusic(mode: MusicModeName = MusicMode.NONE, previous: MusicModeName = MusicMode.NONE): MusicState {
  return { mode, previous };
}

const ENDED_TRACK_MODES: ReadonlySet<MusicModeName> = new Set([MusicMode.TACTICAL_VICTORY, MusicMode.TACTICAL_DEFEAT]);
const DEFEAT_STATUSES: ReadonlySet<string> = new Set(['defeat', 'surrendered', 'captured']);
const VICTORY_STATUS = 'victory';
const INTERROGATION_SCENE = 'interrogation';

export function setMusicMode(state: MusicState, mode: MusicModeName): MusicState {
  if (mode === MusicMode.RESTORE) {
    const restored = ENDED_TRACK_MODES.has(state.previous) ? MusicMode.TACTICAL_NOTHING : state.previous;
    return { mode: restored, previous: restored };
  }
  return { mode, previous: state.mode };
}

class Setter {
  state: MusicState;
  fastFade = false;

  constructor(state: MusicState) {
    this.state = state;
  }

  set(mode: MusicModeName, fast = false): void {
    const next = setMusicMode(this.state, mode);
    if (next.mode !== this.state.mode) this.fastFade = fast;
    this.state = next;
  }

  leaveCombat(): void {
    if (this.state.mode === MusicMode.TACTICAL_BATTLE) this.set(MusicMode.TACTICAL_ENEMY_PRESENT);
  }

  sectorEntry(hostiles: number): void {
    const mode = this.state.mode;
    if (mode === MusicMode.TACTICAL_ENEMY_PRESENT ? hostiles === 0 : mode !== MusicMode.TACTICAL_BATTLE)
      this.set(MusicMode.TACTICAL_NOTHING, true);
  }
}

type EventOf<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;

function sectorLoaded(s: Setter, e: EventOf<'sectorLoaded'>): void {
  if (e.enemyPresence) s.set(MusicMode.TACTICAL_ENEMY_PRESENT);
  s.sectorEntry(e.hostiles ?? 0);
  if (e.firstArrival) s.set(MusicMode.TACTICAL_ENEMY_PRESENT);
}

function combatEnded(s: Setter, e: EventOf<'combatEnded'>): void {
  switch (e.reason) {
    case 'lull':
      s.set(MusicMode.TACTICAL_ENEMY_PRESENT);
      s.set(MusicMode.TACTICAL_ENEMY_PRESENT);
      return;
    case 'lost':
      s.leaveCombat();
      s.set(MusicMode.TACTICAL_DEFEAT);
      return;
    case 'boxing':
      s.leaveCombat();
      s.set(MusicMode.TACTICAL_NOTHING);
      return;
    case 'won':
      s.leaveCombat();
      if (!e.fought) s.set(MusicMode.TACTICAL_NOTHING);
      else if (!e.monsterKill) s.set(MusicMode.TACTICAL_VICTORY);
      return;
  }
}

function meanwhileResolved(s: Setter, facts: MusicFacts): void {
  s.set(MusicMode.MAIN_MENU);
  if (!facts.sectorLoaded) return;
  if (facts.hostiles > 0) s.set(MusicMode.TACTICAL_ENEMY_PRESENT);
  s.sectorEntry(facts.hostiles);
}

function interrogationStarted(s: Setter, facts: MusicFacts): void {
  s.set(MusicMode.MAIN_MENU);
  if (facts.sectorLoaded) s.sectorEntry(facts.hostiles);
}

function apply(s: Setter, e: SimEvent, facts: MusicFacts): void {
  switch (e.type) {
    case 'sectorLoaded':
      sectorLoaded(s, e);
      return;
    case 'enemyPresence':
      s.set(MusicMode.TACTICAL_ENEMY_PRESENT);
      return;
    case 'combatStarted':
      s.set(MusicMode.TACTICAL_BATTLE);
      return;
    case 'enemySighted':
      if (facts.inCombat && s.state.mode === MusicMode.NONE) s.set(MusicMode.TACTICAL_BATTLE);
      return;
    case 'combatEnded':
      combatEnded(s, e);
      return;
    case 'preBattle':
      s.set(MusicMode.TACTICAL_ENEMY_PRESENT);
      if (!e.autoStart) s.set(MusicMode.TACTICAL_ENEMY_PRESENT);
      return;
    case 'retreated':
      if (e.via === 'preBattle') s.set(MusicMode.TACTICAL_NOTHING);
      return;
    case 'arBattleOver':
      if (e.status === VICTORY_STATUS) s.set(MusicMode.TACTICAL_VICTORY);
      else if (DEFEAT_STATUSES.has(e.status)) s.set(MusicMode.TACTICAL_DEFEAT);
      return;
    case 'laptopOpened':
      s.set(MusicMode.LAPTOP);
      return;
    case 'laptopClosed':
      s.set(facts.gameJustStarted ? MusicMode.LAPTOP : MusicMode.RESTORE);
      return;
    case 'meanwhile':
      meanwhileResolved(s, facts);
      return;
    case 'meanwhileStarted':
      interrogationStarted(s, facts);
      return;
    case 'meanwhileEnded':
      if (e.scene === INTERROGATION_SCENE) s.set(MusicMode.TACTICAL_ENEMY_PRESENT);
      return;
    case 'queenKilled':
    case 'creatureQueenKilled':
      s.set(MusicMode.TACTICAL_VICTORY);
      return;
    case 'squadMovedUpstairs':
      s.set(MusicMode.TACTICAL_ENEMY_PRESENT);
      s.set(MusicMode.TACTICAL_VICTORY);
      s.set(MusicMode.TACTICAL_VICTORY);
      return;
    case 'creatureAttack':
      s.set(MusicMode.TACTICAL_NOTHING);
      return;
    case 'mercsLeftSector':
      if (e.mapScreen) s.set(MusicMode.TACTICAL_NOTHING, true);
      return;
    default:
      return;
  }
}

export function musicMode(prev: MusicState, events: readonly SimEvent[], facts: MusicFacts): MusicTransition {
  const s = new Setter(prev);
  for (const e of events) apply(s, e, facts);
  return { ...s.state, fastFade: s.fastFade };
}

export function musicView(state: MusicState, creature: boolean, fastFade = false): MusicView {
  return { mode: state.mode, creature, ...(fastFade ? { fastFade: true as const } : {}) };
}

export function sameMusic(a: MusicView | undefined, b: MusicView | undefined): boolean {
  if (!a || !b) return !a === !b;
  return a.mode === b.mode && a.creature === b.creature;
}
