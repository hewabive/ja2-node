// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Tactical_Save.cc AddItemsToUnLoadedSector, AddDeadSoldierToUnLoadedSector (the corpse and the
// @src item records; the drop rules are in autoresolve/close.ts), AddRottingCorpseToUnloadedSectorsRottingCorpseFile;
// @src Strategic/Strategic_Town_Loyalty.cc RemoveRandomItemsInSector.

import { corpseTypeFor } from '../../content/anim/corpses.ts';
import { type Sector, sameSector } from '../../content/strategic/sector-ids.ts';
import type { ItemObject } from '../items/object.ts';
import type { CorpseRecord } from '../strategic/forces/autoresolve/close.ts';
import { SectorFlag } from '../strategic/forces/constants.ts';
import { setSectorFlag } from '../strategic/map/sectors.ts';
import type { StrategicState } from '../strategic/state.ts';
import { worldDay, worldTotalMinutes } from '../strategic/time/world-clock.ts';
import { anim } from '../tactical/anim-states.ts';
import { corpseLook } from '../tactical/combat/death.ts';
import type { TacticalContent } from '../tactical/content.ts';
import type { TacticalState } from '../tactical/state.ts';
import { removeWorldItem, Visibility, WorldItemFlags } from '../tactical/world-items.ts';
import { type DiffWorldItem, emptySectorDiff, type SectorDiff, sectorKey } from './sector-diff.ts';

const DROPPED_ITEM_FLAGS = WorldItemFlags.FIND_SWEETSPOT_FROM_GRIDNO | WorldItemFlags.REACHABLE;
const NOT_RENDERED_ABOVE_LEVEL = 0;
const PERCENT = 100;

export interface LootRandom {
  int(n: number): number;
}

function diffOf(state: StrategicState, sector: Sector): SectorDiff {
  const key = sectorKey(sector);
  let diff = state.sectorDiffs.get(key);
  if (!diff) {
    diff = emptySectorDiff();
    state.sectorDiffs.set(key, diff);
  }
  return diff;
}

function placeIntoFreeSlot(items: DiffWorldItem[], record: DiffWorldItem): void {
  const free = items.findIndex((wi) => !wi.exists);
  if (free === -1) items.push(record);
  else items[free] = record;
}

export function addItemsToUnloadedSector(
  state: StrategicState,
  sector: Sector,
  gridNo: number,
  objects: readonly ItemObject[],
  level: number,
  flags: number,
  visible: number,
): void {
  const diff = diffOf(state, sector);
  diff.items ??= [];
  const usedFlags = gridNo < 0 ? flags | WorldItemFlags.GRIDNO_NOT_SET_USE_ENTRY_POINT : flags;
  for (const object of objects)
    placeIntoFreeSlot(diff.items, { exists: true, gridNo, level, object, flags: usedFlags, zHeight: NOT_RENDERED_ABOVE_LEVEL, visible });
  setSectorFlag(state.map, sector, SectorFlag.ITEM_TEMP_FILE_EXISTS, worldDay(state.clock));
}

export function addDeadSoldierToUnloadedSector(
  state: StrategicState,
  content: TacticalContent,
  sector: Sector,
  record: CorpseRecord,
): void {
  addItemsToUnloadedSector(state, sector, record.gridNo, record.items, record.level, DROPPED_ITEM_FLAGS, Visibility.VISIBLE);
  const s = record.soldier;
  const diff = diffOf(state, sector);
  diff.corpses ??= [];
  diff.corpses.push({
    gridNo: record.gridNo,
    level: record.level,
    bodyType: s.bodyType,
    direction: s.direction,
    state: anim(content, record.deathAnimation),
    profile: s.profile,
    type: corpseTypeFor(content.corpses.table, s.bodyType, anim(content, record.deathAnimation)),
    timeOfDeath: worldTotalMinutes(state.clock),
    findSweetSpot: true,
    ...corpseLook(s),
  });
  setSectorFlag(state.map, sector, SectorFlag.ROTTING_CORPSE_TEMP_FILE_EXISTS, worldDay(state.clock));
}

export function stealFromUnloadedSector(state: StrategicState, sector: Sector, chance: number, rng: LootRandom): number {
  const items = state.sectorDiffs.get(sectorKey(sector))?.items;
  if (!items) return 0;
  let stolen = 0;
  items.forEach((wi, k) => {
    if (!wi.exists || wi.visible !== Visibility.VISIBLE || !(wi.flags & WorldItemFlags.REACHABLE)) return;
    if (rng.int(PERCENT) >= chance) return;
    items[k] = { ...wi, exists: false };
    stolen++;
  });
  return stolen;
}

export function stealFromLoadedSector(t: TacticalState, chance: number, rng: LootRandom): number {
  let stolen = 0;
  for (const wi of [...t.worldItems]) {
    if (wi.visible !== Visibility.VISIBLE) continue;
    if (rng.int(PERCENT) >= chance) continue;
    removeWorldItem(t, wi);
    stolen++;
  }
  return stolen;
}

export function removeRandomItemsInSector(
  state: StrategicState,
  tactical: TacticalState | null,
  sector: Sector,
  chance: number,
  rng: LootRandom,
): number {
  const world = state.worldSector;
  if (tactical && world && sameSector(world, sector)) return stealFromLoadedSector(tactical, chance, rng);
  return stealFromUnloadedSector(state, sector, chance, rng);
}
