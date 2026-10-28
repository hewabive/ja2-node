// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Auto_Resolve.cc RenderAutoResolve (the end-of-battle block run once after the battle ends).

import { u32 } from '../../../../core/int.ts';
import { Body, type Soldier } from '../../../tactical/soldier.ts';
import { isCreatureAttack } from './end.ts';
import { type AutoresolveState, BattleStatus, CellFlag, hasFlag } from './state.ts';

const BATTLE_TIME_MULTIPLIER = 3;
const RETREAT_EXTRA_MS = 300000;

export type BattleMorale = 'battleWon' | 'heardBattleLost';
export type BattleLoyalty = 'battleWon' | 'battleLost';

export interface AutoresolveOutcome {
  readonly status: number;
  readonly sector: number;
  readonly morale: BattleMorale | null;
  readonly loyalty: BattleLoyalty | null;
  readonly mercsCaptured: readonly Soldier[];
  readonly playerTakesControl: boolean;
  readonly enemyGainsControl: boolean;
  readonly civiliansEaten: number | null;
  readonly retreatImplications: boolean;
  readonly logResult: 'victory' | 'defeat' | null;
}

const isMechanical = (s: Soldier) => s.bodyType === Body.ROBOTNOWEAPON || (s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP);

function capturedMercs(ar: AutoresolveState): Soldier[] {
  return ar.mercs
    .filter((c) => c.soldier.life !== 0 && !isMechanical(c.soldier) && !hasFlag(c, CellFlag.ROBOT))
    .map((c) => c.soldier)
    .sort((a, b) => a.id - b.id);
}

function outcomeFor(ar: AutoresolveState): Omit<AutoresolveOutcome, 'status' | 'sector'> {
  const none = {
    morale: null,
    loyalty: null,
    mercsCaptured: [],
    playerTakesControl: false,
    enemyGainsControl: false,
    civiliansEaten: null,
    retreatImplications: false,
    logResult: null,
  } as const;
  switch (ar.status) {
    case BattleStatus.VICTORY:
      return { ...none, morale: 'battleWon', loyalty: 'battleWon', playerTakesControl: true, logResult: 'victory' };
    case BattleStatus.SURRENDERED:
    case BattleStatus.CAPTURED:
      return { ...none, morale: 'heardBattleLost', loyalty: 'battleLost', mercsCaptured: capturedMercs(ar), enemyGainsControl: true };
    case BattleStatus.DEFEAT:
      return {
        ...none,
        morale: 'heardBattleLost',
        loyalty: 'battleLost',
        enemyGainsControl: true,
        civiliansEaten: isCreatureAttack(ar) ? ar.aliveEnemies : null,
        logResult: 'defeat',
      };
    case BattleStatus.RETREAT: {
      const creatures = isCreatureAttack(ar);
      return {
        ...none,
        retreatImplications: true,
        enemyGainsControl: !creatures || ar.aliveEnemies > 0,
        civiliansEaten: creatures && ar.aliveEnemies > 0 ? ar.aliveEnemies : null,
      };
    }
    default:
      return none;
  }
}

export function endOfBattle(ar: AutoresolveState): AutoresolveOutcome | null {
  if (ar.status === BattleStatus.IN_PROGRESS || ar.moraleEventsHandled) return null;
  ar.elapsedMs = u32(ar.elapsedMs * BATTLE_TIME_MULTIPLIER);
  ar.moraleEventsHandled = true;
  if (ar.status === BattleStatus.RETREAT) ar.elapsedMs = u32(ar.elapsedMs + RETREAT_EXTRA_MS);
  return { status: ar.status, sector: ar.sector, ...outcomeFor(ar) };
}
