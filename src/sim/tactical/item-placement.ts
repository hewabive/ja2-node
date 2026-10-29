// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Items.cc FindNearestAvailableGridNoForItem; Tactical/Tactical_Save.cc
// @src LoadAndAddWorldItemsFromTempFile (where a loaded item goes); TileEngine/GridSquare.cc GridSquare.

import { WORLD_COLS, WORLD_MAX, WORLD_ROWS } from '../../content/world/grid.ts';
import { rangeInCellCoords } from './insertion.ts';
import { findBestPath, isWater, NOWHERE, newOKDestination, PathCopy, type PathSoldier } from './pathfinding.ts';
import { Body, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';
import { WorldItemFlags } from './world-items.ts';

export const SWEET_SPOT_RADIUS = 5;
export const WIDE_SWEET_SPOT_RADIUS = 15;
const PROBE_SOLDIER_ID = 0;

function probeSoldier(sweet: number): PathSoldier {
  return {
    id: PROBE_SOLDIER_ID,
    team: Team.ENEMY,
    bodyType: Body.REGMALE,
    gridNo: sweet,
    level: 0,
    visible: 0,
    hasKeys: false,
    underAiControl: false,
    monsterOrAnimal: false,
  };
}

export function freeTilesAround(t: TacticalState, sweet: number, radius: number): number[] {
  if (sweet < 0 || sweet >= WORLD_MAX) return [];
  const probe = probeSoldier(sweet);
  const flood = findBestPath(t.pathEnv, probe, NOWHERE, 0, { copy: PathCopy.REACHABLE, distLimit: radius });
  const cx = sweet % WORLD_COLS;
  const cy = Math.trunc(sweet / WORLD_COLS);
  const free: number[] = [];
  for (let y = Math.max(0, cy - radius); y <= Math.min(WORLD_ROWS - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(WORLD_COLS - 1, cx + radius); x++) {
      const g = y * WORLD_COLS + x;
      if (!flood.reachable?.[g] || isWater(t.pathEnv.world, g)) continue;
      if (newOKDestination(t.pathEnv, probe, g, true, probe.level)) free.push(g);
    }
  }
  return free;
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
