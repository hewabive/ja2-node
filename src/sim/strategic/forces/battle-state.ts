// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/PreBattle_Interface.h (saved PBI globals); Auto_Resolve.cc gsEnemyGainedControlOfSectorID,
// @src gsCiviliansEatenByMonsters; Strategic/Quests.h FACT_FIRST_BATTLE_*; Tactical/Overhead_Types.h ubLastBattleSector,
// @src fLastBattleWon. See docs/19 §1.1, §5, docs/26 §0.

import type { Sector } from '../../../content/strategic/sector-ids.ts';
import type { Rng } from '../../../core/rng.ts';
import type { ArRng, AutoresolveState } from './autoresolve/state.ts';
import { EncounterCode } from './constants.ts';

export const PbiChoice = { AUTORESOLVE: 'autoresolve', ENTER_SECTOR: 'enterSector', RETREAT: 'retreat', CLOSE: 'close' } as const;
export type PbiChoice = (typeof PbiChoice)[keyof typeof PbiChoice];

export const PbiReason = {
  PLAYER_INITIATED_ATTACK: 'playerInitiatedAttack',
  AMBUSH: 'ambush',
  CANNOT_RETREAT: 'cannotRetreat',
  BATTLE_IN_PROGRESS: 'battleInProgress',
  HOSTILE_CIVILIANS: 'hostileCivilians',
  FIGHTING_CREATURES: 'fightingCreatures',
  BLOODCATS: 'bloodcats',
  ENTERING_ENEMY_SECTOR: 'enteringEnemySector',
  AUTO_START: 'autoStart',
} as const;
export type PbiReason = (typeof PbiReason)[keyof typeof PbiReason];

export interface PbiOption {
  readonly choice: PbiChoice;
  readonly enabled: boolean;
  readonly reason?: PbiReason;
}

export const PromptKind = {
  PRE_BATTLE: 'preBattle',
  SURRENDER: 'surrender',
  AUTORESOLVE_DONE: 'autoresolveDone',
  SIMULTANEOUS_ARRIVAL: 'simultaneousArrival',
  NPC_OF_NOTE: 'npcOfNote',
  CONTRACT_RENEWAL: 'contractRenewal',
  MERC_DEPARTURE: 'mercDeparture',
  INSURANCE_EXTENSION: 'insuranceExtension',
  NPC_REQUEST: 'npcRequest',
} as const;
export type PromptKind = (typeof PromptKind)[keyof typeof PromptKind];

export type BattlePrompt =
  | {
      readonly id: string;
      readonly kind: typeof PromptKind.PRE_BATTLE;
      readonly options: readonly PbiOption[];
      readonly enemiesKnown: boolean;
    }
  | { readonly id: string; readonly kind: typeof PromptKind.SURRENDER; readonly context?: 'tactical'; readonly soldier?: number }
  | { readonly id: string; readonly kind: typeof PromptKind.AUTORESOLVE_DONE }
  | { readonly id: string; readonly kind: typeof PromptKind.SIMULTANEOUS_ARRIVAL }
  | { readonly id: string; readonly kind: typeof PromptKind.NPC_OF_NOTE }
  | { readonly id: string; readonly kind: typeof PromptKind.CONTRACT_RENEWAL; readonly soldier: number; readonly fromSequence: boolean }
  | {
      readonly id: string;
      readonly kind: typeof PromptKind.MERC_DEPARTURE;
      readonly soldier: number;
      readonly choices: readonly string[];
      readonly elsewhere: number | null;
    }
  | {
      readonly id: string;
      readonly kind: typeof PromptKind.INSURANCE_EXTENSION;
      readonly soldier: number;
      readonly days: number;
      readonly cost: number;
    }
  | {
      readonly id: string;
      readonly kind: typeof PromptKind.NPC_REQUEST;
      readonly request: string;
      readonly code: number;
      readonly npc: number;
      readonly src: number;
      readonly record: number;
      readonly amount?: number;
      readonly pair?: boolean;
      readonly choices: readonly string[];
    };

export interface AutoresolveSession {
  readonly ar: AutoresolveState;
  readonly sector: Sector;
  readonly fx: Rng;
  rng: ArRng | null;
  ticks: number;
  ended: boolean;
}

export interface BattleState {
  persistent: boolean;
  sector: Sector | null;
  locator: boolean;
  autoStart: boolean;
  transferTacticalOpposition: boolean;
  enterPreBattlePending: boolean;
  enemyGainedControlOf: Sector | null;
  civiliansEaten: number;
  resetAllPlayerKnowsEnemiesFlags: boolean;
  lostBattleUnloadAtMs: number | null;
  promptSeq: number;
  prompt: BattlePrompt | null;
  autoresolve: AutoresolveSession | null;
  lastBattleSector: { readonly x: number; readonly y: number } | null;
  lastBattleWon: boolean;
}

export function createBattleState(): BattleState {
  return {
    persistent: true,
    sector: null,
    locator: false,
    autoStart: false,
    transferTacticalOpposition: false,
    enterPreBattlePending: false,
    enemyGainedControlOf: null,
    civiliansEaten: 0,
    resetAllPlayerKnowsEnemiesFlags: false,
    lostBattleUnloadAtMs: null,
    promptSeq: 0,
    prompt: null,
    autoresolve: null,
    lastBattleSector: null,
    lastBattleWon: false,
  };
}

export const ENCOUNTER_NAMES: Readonly<Record<number, string>> = {
  [EncounterCode.NO_ENCOUNTER]: 'none',
  [EncounterCode.ENEMY_INVASION]: 'enemyInvasion',
  [EncounterCode.ENEMY_ENCOUNTER]: 'enemyEncounter',
  [EncounterCode.ENEMY_AMBUSH]: 'enemyAmbush',
  [EncounterCode.ENTERING_ENEMY_SECTOR]: 'enteringEnemySector',
  [EncounterCode.CREATURE_ATTACK]: 'creatureAttack',
  [EncounterCode.BLOODCAT_AMBUSH]: 'bloodcatAmbush',
  [EncounterCode.ENTERING_BLOODCAT_LAIR]: 'enteringBloodcatLair',
  [EncounterCode.FIGHTING_CREATURES]: 'fightingCreatures',
  [EncounterCode.HOSTILE_CIVILIANS]: 'hostileCivilians',
  [EncounterCode.HOSTILE_BLOODCATS]: 'hostileBloodcats',
};

export function encounterName(code: number): string {
  return ENCOUNTER_NAMES[code] ?? 'none';
}

export function nextPromptId(battle: BattleState, kind: PromptKind): string {
  battle.promptSeq++;
  return `${kind}-${battle.promptSeq}`;
}
