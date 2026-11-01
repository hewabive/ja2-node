// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-01. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Tile.cc TeleportSoldier, SwapMercPositions

import { givingSoldierCancelServices } from './first-aid.ts';
import { setSoldierPosition } from './movement.ts';
import { NOWHERE, newOKDestination } from './pathfinding.ts';
import { revealRoofsAndItems } from './perception/fov.ts';
import { handleSight, SightFlags } from './perception/sight.ts';
import { removeMercStructure } from './person-structure.ts';
import type { Soldier } from './soldier.ts';
import { removeOccupant, type TacticalState } from './state.ts';

const GROUND_LEVEL = 0;

export function teleportSoldier(t: TacticalState, s: Soldier, gridNo: number, force: boolean): boolean {
  if (gridNo === NOWHERE || (!newOKDestination(t.pathEnv, s, gridNo, true, GROUND_LEVEL) && !force)) return false;
  setSoldierPosition(t, s, gridNo);
  s.finalDestination = gridNo;
  revealRoofsAndItems(t, s, true);
  handleSight(t, s, SightFlags.LOOK | SightFlags.RADIO);
  givingSoldierCancelServices(t, s);
  return true;
}

function liftOffGrid(t: TacticalState, s: Soldier): void {
  removeOccupant(t, s);
  removeMercStructure(t, s);
  s.placed = false;
}

export function swapMercPositions(t: TacticalState, a: Soldier, b: Soldier): void {
  let ga = a.gridNo;
  let gb = b.gridNo;
  liftOffGrid(t, a);
  liftOffGrid(t, b);
  const canSwap = newOKDestination(t.pathEnv, a, gb, true, GROUND_LEVEL) && newOKDestination(t.pathEnv, b, ga, true, GROUND_LEVEL);
  if (canSwap) [ga, gb] = [gb, ga];
  setSoldierPosition(t, b, gb);
  teleportSoldier(t, a, ga, !canSwap);
  teleportSoldier(t, b, gb, !canSwap);
}
