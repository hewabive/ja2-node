// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Tactical_Save.cc AddItemsToUnLoadedSector, AddDeadSoldierToUnLoadedSector (the corpse and the
// @src item records; the corpse's level 0 and the soldier's height, 2026-11-02; the drop rules and the key ring dropped
// @src through Tactical/Keys.cc DropKeysInKeyRing's unloaded path, 2026-11-05), AddRottingCorpseToUnloadedSectorsRottingCorpseFile;
// @src Tactical/Rotting_Corpses.cc ReduceAmmoDroppedByNonPlayerSoldiers; TileEngine/Isometric_Utils.cc RandomGridNo;
// @src Strategic/Strategic_Town_Loyalty.cc RemoveRandomItemsInSector;
// @src Strategic/Strategic_Movement.cc AddCorpsesToBloodcatLair (the facing drawn on a cosmetic stream; the zeroed
// @src definition leaves profile 0 and level 0).

import { type CorpseTable, corpseTypeFor } from '../../content/anim/corpses.ts';
import { ItemClass } from '../../content/items/items.ts';
import { type Sector, sameSector } from '../../content/strategic/sector-ids.ts';
import { WORLD_COLS, WORLD_ROWS } from '../../content/world/grid.ts';
import { gridNoOnVisibleWorldTile } from '../../content/world/render-bounds.ts';
import { u32 } from '../../core/int.ts';
import { cloneObject, type ItemObject, ObjectFlags } from '../items/object.ts';
import { SectorFlag } from '../strategic/forces/constants.ts';
import { setSectorFlag } from '../strategic/map/sectors.ts';
import type { StrategicState } from '../strategic/state.ts';
import { NUM_SEC_IN_DAY, NUM_SEC_IN_MIN } from '../strategic/time/constants.ts';
import { worldDay, worldTotalMinutes } from '../strategic/time/world-clock.ts';
import { anim } from '../tactical/anim-states.ts';
import type { RandomStream } from '../tactical/combat/context.ts';
import { type Corpse, corpseLook, truncatedHeight } from '../tactical/combat/death.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { type KeyContent, takeKeyRingObjects } from '../tactical/doors/keys.ts';
import { Body, type Soldier, Team } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
import { removeWorldItem, Visibility, WorldItemFlags } from '../tactical/world-items.ts';
import { type DiffWorldItem, emptySectorDiff, type SectorDiff, sectorKey } from './sector-diff.ts';

const DROPPED_ITEM_FLAGS = WorldItemFlags.FIND_SWEETSPOT_FROM_GRIDNO | WorldItemFlags.REACHABLE;
const NOT_RENDERED_ABOVE_LEVEL = 0;
const PERCENT = 100;
const LAIR_CORPSE_GRID_NOS = [14319, 9835, 11262];
const LAIR_CORPSE_TYPE = 'SMERC_JFK';
const LAIR_CORPSE_PALETTES = ['BROWNHEAD', 'PINKSKIN', 'YELLOWVEST', 'GREENPANTS'] as const;
const LAIR_CORPSE_HEIGHT = 0;
const LAIR_CORPSE_AGE_MINUTES = (2 * NUM_SEC_IN_DAY) / NUM_SEC_IN_MIN;
const ZEROED_PROFILE = 0;
const ZEROED_LEVEL = 0;
const NO_ANIMATION = 0;
const DROP_SKIP_PERCENT = 75;
const DEATH_ANIMATIONS = ['GENERIC_HIT_DEATH', 'FALLBACK_HIT_DEATH', 'PRONE_HIT_DEATH', 'FLYBACK_HIT_DEATH'] as const;

export type DeathAnimation = (typeof DEATH_ANIMATIONS)[number];

export interface CorpseRecord {
  readonly soldier: Soldier;
  readonly gridNo: number;
  readonly level: number;
  readonly deathAnimation: DeathAnimation;
  readonly items: readonly ItemObject[];
  readonly keys: readonly ItemObject[];
}

export interface LootRandom {
  int(n: number): number;
}

export function randomGridNo(main: RandomStream, restrictedScroll: number): number {
  for (;;) {
    const x = main.int(WORLD_COLS);
    const y = main.int(WORLD_ROWS);
    const g = y * WORLD_COLS + x;
    if (gridNoOnVisibleWorldTile(restrictedScroll, g)) return g;
  }
}

const isRobot = (s: Soldier) => s.bodyType === Body.ROBOTNOWEAPON;

function droppedItem(main: RandomStream, content: KeyContent, s: Soldier, o: ItemObject): ItemObject | null {
  if (s.team !== Team.OUR) {
    if (main.int(PERCENT) < DROP_SKIP_PERCENT) {
      o.flags |= ObjectFlags.UNDROPPABLE;
      return null;
    }
    if (o.flags & ObjectFlags.UNDROPPABLE) return null;
    if (content.items.byIndex.get(o.item)?.itemClass === ItemClass.AMMO) o.count = 1 + main.int(o.count);
  }
  return cloneObject(o);
}

function droppedItems(main: RandomStream, content: KeyContent, s: Soldier): ItemObject[] {
  const items: ItemObject[] = [];
  if (isRobot(s)) return items;
  for (const o of s.inv) {
    if (o.item === 0) continue;
    const dropped = droppedItem(main, content, s, o);
    if (dropped) items.push(dropped);
  }
  return items;
}

export function deadSoldierRecord(main: RandomStream, content: KeyContent, s: Soldier, gridNo: number): CorpseRecord {
  const items = droppedItems(main, content, s);
  const keys = takeKeyRingObjects(content, s);
  const deathAnimation = DEATH_ANIMATIONS[main.int(DEATH_ANIMATIONS.length)] as DeathAnimation;
  return { soldier: s, gridNo, level: s.level, deathAnimation, items, keys };
}

export function sectorDiffOf(state: StrategicState, sector: Sector): SectorDiff {
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
  const diff = sectorDiffOf(state, sector);
  diff.items ??= [];
  const usedFlags = gridNo < 0 ? flags | WorldItemFlags.GRIDNO_NOT_SET_USE_ENTRY_POINT : flags;
  for (const object of objects)
    placeIntoFreeSlot(diff.items, { exists: true, gridNo, level, object, flags: usedFlags, zHeight: NOT_RENDERED_ABOVE_LEVEL, visible });
  setSectorFlag(state.map, sector, SectorFlag.ITEM_TEMP_FILE_EXISTS, worldDay(state.clock));
}

export function addRottingCorpseToUnloadedSector(state: StrategicState, sector: Sector, corpse: Corpse): void {
  const diff = sectorDiffOf(state, sector);
  diff.corpses ??= [];
  diff.corpses.push(corpse);
  setSectorFlag(state.map, sector, SectorFlag.ROTTING_CORPSE_TEMP_FILE_EXISTS, worldDay(state.clock));
}

export function addDeadSoldierToUnloadedSector(
  state: StrategicState,
  content: TacticalContent,
  sector: Sector,
  record: CorpseRecord,
  keySector: Sector = sector,
): void {
  addItemsToUnloadedSector(state, sector, record.gridNo, record.items, record.level, DROPPED_ITEM_FLAGS, Visibility.VISIBLE);
  if (record.keys.length > 0)
    addItemsToUnloadedSector(state, keySector, record.gridNo, record.keys, record.level, DROPPED_ITEM_FLAGS, Visibility.VISIBLE);
  const s = record.soldier;
  addRottingCorpseToUnloadedSector(state, sector, {
    gridNo: record.gridNo,
    level: ZEROED_LEVEL,
    heightAdjustment: truncatedHeight(s),
    bodyType: s.bodyType,
    direction: s.direction,
    state: anim(content, record.deathAnimation),
    profile: s.profile,
    type: corpseTypeFor(content.corpses.table, s.bodyType, anim(content, record.deathAnimation)),
    timeOfDeath: worldTotalMinutes(state.clock),
    headTaken: false,
    servicingCrows: 0,
    findSweetSpot: true,
    ...corpseLook(s),
  });
}

export function addCorpsesToBloodcatLair(state: StrategicState, table: CorpseTable, sector: Sector, direction: number): void {
  const definition = {
    level: ZEROED_LEVEL,
    heightAdjustment: LAIR_CORPSE_HEIGHT,
    bodyType: Body.REGMALE,
    direction,
    state: NO_ANIMATION,
    profile: ZEROED_PROFILE,
    type: table.types.indexOf(LAIR_CORPSE_TYPE),
    timeOfDeath: u32(worldTotalMinutes(state.clock) - LAIR_CORPSE_AGE_MINUTES),
    headTaken: false,
    servicingCrows: 0,
    findSweetSpot: true,
    palettes: LAIR_CORPSE_PALETTES,
  };
  for (const gridNo of LAIR_CORPSE_GRID_NOS) addRottingCorpseToUnloadedSector(state, sector, { ...definition, gridNo });
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
