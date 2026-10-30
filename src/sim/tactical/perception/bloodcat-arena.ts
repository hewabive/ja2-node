// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-29. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/LOS.cc SoldierToSoldierLineOfSightTest and Tactical/OppList.cc ProcessNoise (the bloodcat arena).

import { type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';

const BLOODCAT_ARENA = { x: 5, y: 14 } as const;

function inBloodcatArena(t: TacticalState): boolean {
  return t.sector !== null && t.sector.x === BLOODCAT_ARENA.x && t.sector.y === BLOODCAT_ARENA.y;
}

function armyAndCreature(a: Soldier, b: Soldier): boolean {
  return (a.team === Team.ENEMY && b.team === Team.CREATURE) || (a.team === Team.CREATURE && b.team === Team.ENEMY);
}

export function keptApartInBloodcatArena(t: TacticalState, a: Soldier, b: Soldier): boolean {
  return armyAndCreature(a, b) && inBloodcatArena(t);
}
