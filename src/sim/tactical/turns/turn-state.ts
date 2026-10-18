// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead_Types.h TacticalStatusType; TeamTurns.cc gOutOfTurnOrder; TacticalAI/AIList.cc;
// @src OppList.cc gbSeenOpponents, watched locations; Overhead.cc gfPauseAllAI, guiPauseAllAITimer; Overhead.h
// @src ENEMY_OFFERED_SURRENDER. See docs/10 §0, docs/24 §3.6, §8.5.

import type { Soldier } from '../soldier.ts';

export const TEAM_COUNT = 6;
export const NUM_WATCHED_LOCS = 3;

export interface DeferredNoise {
  readonly maker: number;
  readonly gridNo: number;
  readonly level: number;
  readonly volume: number;
  readonly kind: number;
}

export interface AiListEntry {
  readonly soldier: Soldier;
  readonly priority: number;
}

export interface WatchedLocations {
  readonly gridNo: Int16Array;
  readonly level: Int8Array;
  readonly points: Uint8Array;
  readonly reset: Uint8Array;
  readonly incremented: Uint8Array;
}

export interface TurnState {
  currentTeam: number;
  attackBusyCount: number;
  consNumTurnsNotSeen: number;
  consNumTurnsWeHaventSeenButEnemyDoes: number;
  readonly numFoughtInBattle: number[];
  enemyInSector: boolean;
  virginSector: boolean;
  interruptOccurred: boolean;
  enemySightingOnTheirTurn: { enemy: Soldier; since: number } | null;
  killedEnemyOnAttack: boolean;
  killingGuysForLosingBattle: boolean;
  checkSightAtEndOfAttack: boolean;
  selected: number;
  readonly intList: Soldier[];
  hiddenInterrupt: boolean;
  lastInterruptedGuy: Soldier | null;
  unlockUIAfterHiddenInterrupt: boolean;
  interruptProvoker: Soldier | null;
  whoThrewRock: Soldier | null;
  sightFlags: number;
  delayResolvingBestSightingDueToDoor: boolean;
  aiList: AiListEntry[];
  readonly deferredNoises: DeferredNoise[];
  pauseAllAi: boolean;
  pauseAllAiSinceMs: number | null;
  enemyOfferedSurrender: boolean;
  readonly seenOpponents: Int8Array;
  readonly watched: WatchedLocations;
  round: number;
  forceRealtimeTurn: boolean;
  someoneHit: boolean;
  skipCoverCheck: boolean;
  spottersCalledForBy: number;
  lastMercKill: Soldier | null;
}

export function createTurnState(maxSoldiers: number): TurnState {
  return {
    currentTeam: 0,
    attackBusyCount: 0,
    consNumTurnsNotSeen: 0,
    consNumTurnsWeHaventSeenButEnemyDoes: 0,
    numFoughtInBattle: new Array<number>(TEAM_COUNT).fill(0),
    enemyInSector: false,
    virginSector: true,
    interruptOccurred: false,
    enemySightingOnTheirTurn: null,
    killedEnemyOnAttack: false,
    killingGuysForLosingBattle: false,
    checkSightAtEndOfAttack: false,
    selected: -1,
    intList: [],
    hiddenInterrupt: false,
    lastInterruptedGuy: null,
    unlockUIAfterHiddenInterrupt: false,
    interruptProvoker: null,
    whoThrewRock: null,
    sightFlags: 0,
    delayResolvingBestSightingDueToDoor: false,
    aiList: [],
    deferredNoises: [],
    pauseAllAi: false,
    pauseAllAiSinceMs: null,
    enemyOfferedSurrender: false,
    seenOpponents: new Int8Array(maxSoldiers * maxSoldiers),
    watched: {
      gridNo: new Int16Array(maxSoldiers * NUM_WATCHED_LOCS).fill(-1),
      level: new Int8Array(maxSoldiers * NUM_WATCHED_LOCS),
      points: new Uint8Array(maxSoldiers * NUM_WATCHED_LOCS),
      reset: new Uint8Array(maxSoldiers * NUM_WATCHED_LOCS),
      incremented: new Uint8Array(maxSoldiers * NUM_WATCHED_LOCS),
    },
    round: 0,
    forceRealtimeTurn: false,
    someoneHit: false,
    skipCoverCheck: false,
    spottersCalledForBy: -1,
    lastMercKill: null,
  };
}
