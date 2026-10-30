// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-29. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Rotting_Corpses.cc FindNearestAvailableGridNoForCorpse; Tactical/Tactical_Save.cc
// @src LoadRottingCorpsesFromTempCorpseFile (where a loaded corpse goes).

import { corpseFileBase } from '../../content/anim/corpses.ts';
import type { StructureFile } from '../../content/formats/jsd.ts';
import { rangeInCellCoords } from '../../content/world/grid.ts';
import type { Corpse } from './combat/death.ts';
import { DIRECTION_COUNT, oneCDirection } from './directions.ts';
import { entryPoint } from './insertion.ts';
import { freeTilesAround, SWEET_SPOT_RADIUS, WIDE_SWEET_SPOT_RADIUS } from './item-placement.ts';
import { NOWHERE } from './pathfinding.ts';
import type { TacticalState } from './state.ts';

const GORY_CORPSE_FILES = true;
const KEEP_DIRECTION = -1;

export interface CorpseSpot {
  readonly gridNo: number;
  readonly direction: number;
}

function searchedStructureFile(t: TacticalState, type: number): StructureFile | undefined {
  const corpses = t.content.corpses;
  return corpses.structures.get(corpseFileBase(corpses.table, type, GORY_CORPSE_FILES));
}

function firstFittingDirection(t: TacticalState, file: StructureFile | undefined, g: number, level: number): number | null {
  if (!file) return KEEP_DIRECTION;
  for (let direction = 0; direction < DIRECTION_COUNT; direction++) {
    const def = file.structures[oneCDirection(direction)];
    if (def && t.world.structures.okayToAdd(g, level, def)) return direction;
  }
  return null;
}

export function findNearestAvailableGridNoForCorpse(t: TacticalState, corpse: Corpse, radius: number): CorpseSpot {
  const file = searchedStructureFile(t, corpse.type);
  let best: CorpseSpot = { gridNo: NOWHERE, direction: corpse.direction };
  let bestRange = Number.POSITIVE_INFINITY;
  for (const g of freeTilesAround(t, corpse.gridNo, radius)) {
    const direction = firstFittingDirection(t, file, g, corpse.level);
    if (direction === null) continue;
    const range = rangeInCellCoords(corpse.gridNo, g);
    if (range < bestRange) {
      best = { gridNo: g, direction: direction === KEEP_DIRECTION ? corpse.direction : direction };
      bestRange = range;
    }
  }
  return best;
}

function sweetSpotOf(t: TacticalState, corpse: Corpse): CorpseSpot {
  const near = findNearestAvailableGridNoForCorpse(t, corpse, SWEET_SPOT_RADIUS);
  if (near.gridNo !== NOWHERE) return near;
  return findNearestAvailableGridNoForCorpse(t, { ...corpse, gridNo: NOWHERE }, WIDE_SWEET_SPOT_RADIUS);
}

export function placeLoadedCorpse(t: TacticalState, corpse: Corpse): Corpse {
  if (corpse.findSweetSpot) return { ...corpse, ...sweetSpotOf(t, corpse) };
  if (corpse.entryPoint !== undefined) return { ...corpse, gridNo: entryPoint(t, corpse.entryPoint) };
  return corpse;
}
