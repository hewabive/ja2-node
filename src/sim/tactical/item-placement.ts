// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Items.cc FindNearestAvailableGridNoForItem; Tactical/Tactical_Save.cc
// @src LoadAndAddWorldItemsFromTempFile (where a loaded item goes); TileEngine/GridSquare.cc GridSquare.

import { rangeInCellCoords } from '../../content/world/grid.ts';
import { isWater, NOWHERE, newOKDestination } from './pathfinding.ts';
import { Team } from './soldier.ts';
import type { TacticalState } from './state.ts';
import { dummySoldier, reachableAround } from './sweet-spots.ts';
import { WorldItemFlags } from './world-items.ts';

export const SWEET_SPOT_RADIUS = 5;
export const WIDE_SWEET_SPOT_RADIUS = 15;
const PATH_AROUND_PEOPLE = 0;

export function freeTilesAround(t: TacticalState, sweet: number, radius: number): number[] {
  const dummy = dummySoldier(sweet, Team.ENEMY, 0);
  return reachableAround(t, dummy, radius, { flags: PATH_AROUND_PEOPLE }).filter(
    (g) => !isWater(t.pathEnv.world, g) && newOKDestination(t.pathEnv, dummy, g, true, dummy.level),
  );
}

export function findNearestAvailableGridNoForItem(t: TacticalState, sweet: number, radius: number): number {
  let best = NOWHERE;
  let bestRange = Number.POSITIVE_INFINITY;
  for (const g of freeTilesAround(t, sweet, radius)) {
    const range = rangeInCellCoords(sweet, g);
    if (range < bestRange) {
      best = g;
      bestRange = range;
    }
  }
  return best;
}

function sweetSpotForUnloadedDrop(t: TacticalState, gridNo: number): number {
  const near = findNearestAvailableGridNoForItem(t, gridNo, SWEET_SPOT_RADIUS);
  if (near !== NOWHERE) return near;
  const wide = findNearestAvailableGridNoForItem(t, gridNo, WIDE_SWEET_SPOT_RADIUS);
  return wide !== NOWHERE ? wide : gridNo;
}

export function loadedWorldItemGridNo(t: TacticalState, gridNo: number, flags: number, centerGridNo: number): number {
  if (flags & WorldItemFlags.GRIDNO_NOT_SET_USE_ENTRY_POINT) return centerGridNo;
  if (flags & WorldItemFlags.FIND_SWEETSPOT_FROM_GRIDNO) return sweetSpotForUnloadedDrop(t, gridNo);
  return gridNo;
}
