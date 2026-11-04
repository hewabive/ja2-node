// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/World_Items.cc AddItemToWorld, LoadWorldItemsFromMap; Handle_Items.cc InternalAddItemToPool,
// @src RemoveItemFromPool, SetItemsVisibilityOn, LookForHiddenItems, NotifySoldiersToLookforItems; Overhead.cc
// @src FlatRoofAboveGridNo.
// @src 2026-11-04: World_Items.cc RemoveItemFromWorld, TrashWorldItems and LoadWorldItemsFromMap's pits and map mines;
// @src InternalAddItemToPool's STRUCTURE_HASITEMONTOP, switch detonators and pits; RemoveItemFromPool's
// @src STRUCTURE_HASITEMONTOP; FlatRoofAboveGridNo's roof types (TileEngine/TileDat.h FIRSTROOF, LASTROOF).

import type { MapItem } from '../../content/formats/map.ts';
import { decodeObject } from '../../content/formats/object.ts';
import { ItemFlags, NOTHING } from '../../content/items/items.ts';
import { levelTilesAt } from '../../content/world/level.ts';
import {
  has,
  STRUCTURE_ON_GROUND,
  STRUCTURE_ON_ROOF,
  StructureFlags,
  type StructureInstance,
  structureHeight,
} from '../../content/world/structures.ts';
import { idiv, u32 } from '../../core/int.ts';
import { cloneObject, type ItemObject, objectFromRecord } from '../items/object.ts';
import { armBomb, Detonator, isPit, setDetonator } from './bombs/bomb-object.ts';
import { MineFlag, setMineFlag } from './bombs/mine-flags.ts';
import { addBombToWorld, removeBombFromWorld } from './bombs/world-bombs.ts';
import { isWater } from './pathfinding.ts';
import type { TacticalState } from './state.ts';

export const Visibility = { HIDDEN_ITEM: -4, BURIED: -3, HIDDEN_IN_OBJECT: -2, INVISIBLE: -1, VISIBLE: 1 } as const;
export const ANY_VISIBILITY_VALUE = -10;

export const WorldItemFlags = {
  DONTRENDER: 0x0001,
  FIND_SWEETSPOT_FROM_GRIDNO: 0x0002,
  ARMED_BOMB: 0x0040,
  SCIFI_ONLY: 0x0080,
  REALISTIC_ONLY: 0x0100,
  REACHABLE: 0x0200,
  GRIDNO_NOT_SET_USE_ENTRY_POINT: 0x0400,
} as const;

export const FORCE_ON_GROUND = -1;
const NO_DETONATOR = 0;

const WORLD_ITEM_OBJECT_OFFSET = 8;

export interface WorldItem {
  gridNo: number;
  level: number;
  readonly object: ItemObject;
  flags: number;
  zHeight: number;
  visible: number;
}

export interface ItemSnapshot {
  readonly gridNo: number;
  readonly level: number;
  readonly item: string;
  readonly count: number;
  readonly status: number;
  readonly money?: number;
  readonly attachments?: readonly { readonly item: string; readonly status: number }[];
  readonly height?: number;
  readonly notRendered?: boolean;
}

const itemIndex = (t: TacticalState, name: string) => t.content.items.byName.get(name)?.index ?? -2;

const FIRST_ROOF_TYPE = 64;
const LAST_ROOF_TYPE = 67;
const NO_TILE_TYPE = -1;

export function flatRoofAboveGridNo(t: Pick<TacticalState, 'world'>, g: number): boolean {
  const tiles = t.world.tiles ?? [];
  return levelTilesAt(t.world.level.layers.roofs, g).some((tile) => {
    const type = tiles[tile]?.type ?? NO_TILE_TYPE;
    return type >= FIRST_ROOF_TYPE && type <= LAST_ROOF_TYPE;
  });
}

interface Placement {
  gridNo: number;
  zHeight: number;
  visible: number;
  flags: number;
  inOpenable: boolean;
}

function placeOnStructure(t: TacticalState, o: ItemObject, level: number, at: Placement, forceOnGround: boolean): void {
  if (o.item === itemIndex(t, 'OWNERSHIP') || o.item === itemIndex(t, 'ACTION_ITEM')) return;
  const desired = level ? STRUCTURE_ON_ROOF : STRUCTURE_ON_GROUND;
  for (const s of t.world.structures.at(at.gridNo)) {
    if (!has(s.flags, StructureFlags.BLOCKSMOVES)) continue;
    if (has(s.flags, StructureFlags.PERSON | StructureFlags.CORPSE) || s.cubeOffset !== desired) continue;
    if (bottomLevel(s) !== 1 && forceOnGround) return;
    at.gridNo = (t.world.structures.findBase(s) ?? s).gridNo;
    if (has(s.flags, StructureFlags.OPENABLE)) {
      at.flags |= WorldItemFlags.DONTRENDER;
      if (!has(s.flags, StructureFlags.OPEN)) at.visible = Visibility.HIDDEN_IN_OBJECT;
      at.inOpenable = true;
      at.zHeight = indexToPixels(structureHeight(s));
      return;
    }
    if (has(s.flags, StructureFlags.GENERIC)) {
      at.zHeight = densestLevelHeight(s);
      s.flags = u32(s.flags | StructureFlags.HASITEMONTOP);
      return;
    }
  }
}

const PROFILE_CELLS = 25;
const PROFILE_Z_SIZE = 4;
const MAX_STRUCTURE_HEIGHT = 50;
const HEIGHT_UNITS = 256;
const HEIGHT_UNITS_PER_INDEX = HEIGHT_UNITS / PROFILE_Z_SIZE;
const DENSITY_PERCENT_PER_CELL = 4;

const indexToPixels = (n: number) => idiv(n * MAX_STRUCTURE_HEIGHT * HEIGHT_UNITS_PER_INDEX, HEIGHT_UNITS);
const atHeight = (z: number) => 1 << z;

function bottomLevel(s: StructureInstance): number {
  let lowest = PROFILE_Z_SIZE;
  for (let k = 0; k < PROFILE_CELLS; k++) {
    const cell = s.tile.shape[k] ?? 0;
    for (let z = 0; z < lowest; z++) {
      if (cell & atHeight(z)) {
        lowest = z;
        break;
      }
    }
  }
  return lowest + 1;
}

function densestLevelHeight(s: StructureInstance): number {
  const density = [0, 0, 0, 0];
  for (let k = 0; k < PROFILE_CELLS; k++) {
    const cell = s.tile.shape[k] ?? 0;
    for (let z = 0; z < PROFILE_Z_SIZE; z++) if (cell & atHeight(z)) density[z] = (density[z] ?? 0) + DENSITY_PERCENT_PER_CELL;
  }
  let height = 0;
  let max = 0;
  for (let z = PROFILE_Z_SIZE - 1; z >= 0; z--) {
    if ((density[z] ?? 0) > max) {
      max = density[z] ?? 0;
      height = indexToPixels(z + 1);
    }
  }
  return height;
}

export function addItemToPool(
  t: TacticalState,
  g: number,
  o: ItemObject,
  visible: number,
  levelIn: number,
  flags = 0,
  zHeight: number = FORCE_ON_GROUND,
): WorldItem | null {
  const def = t.content.items.byIndex.get(o.item);
  if (isWater(t.pathWorld, g) && def && def.flags & ItemFlags.SINKS) return null;
  const level = levelIn && !flatRoofAboveGridNo(t, g) ? 0 : levelIn;
  const forceOnGround = zHeight === FORCE_ON_GROUND;
  const at: Placement = { gridNo: g, zHeight: forceOnGround ? 0 : zHeight, visible, flags, inOpenable: false };
  placeOnStructure(t, o, level, at, forceOnGround);
  const object = cloneObject(o);
  setSwitchDetonator(t, object, g, at);
  if (object.item === itemIndex(t, 'ACTION_ITEM') && isPit(object)) setMineFlag(t, at.gridNo, MineFlag.ENEMY);
  const item: WorldItem = { gridNo: at.gridNo, level, object, flags: at.flags, zHeight: at.zHeight, visible: at.visible };
  t.worldItems.push(item);
  if (item.flags & WorldItemFlags.ARMED_BOMB) addBombToWorld(t, item);
  return item;
}

function setSwitchDetonator(t: TacticalState, o: ItemObject, g: number, at: Placement): void {
  if (o.item !== itemIndex(t, 'SWITCH') || at.inOpenable) return;
  if (at.visible === Visibility.HIDDEN_IN_OBJECT) {
    setDetonator(o, Detonator.SWITCH);
    return;
  }
  at.visible = Visibility.BURIED;
  setDetonator(o, t.world.structures.find(g, StructureFlags.SWITCH) ? Detonator.SWITCH : Detonator.PRESSURE);
}

export function itemsAt(t: TacticalState, g: number, level: number): WorldItem[] {
  return t.worldItems.filter((i) => i.gridNo === g && i.level === level);
}

function clearItemOnTop(t: TacticalState, g: number): void {
  const s = t.world.structures.find(g, StructureFlags.HASITEMONTOP);
  if (s) s.flags = u32(s.flags & ~StructureFlags.HASITEMONTOP);
}

export function removeWorldItem(t: TacticalState, item: WorldItem): void {
  const k = t.worldItems.indexOf(item);
  if (k < 0) return;
  t.worldItems.splice(k, 1);
  if (item.zHeight > 0 && itemsAt(t, item.gridNo, item.level).length === 0) clearItemOnTop(t, item.gridNo);
  if (item.flags & WorldItemFlags.ARMED_BOMB) removeBombFromWorld(t, item);
}

export function trashWorldItems(t: TacticalState): void {
  for (const wi of [...t.worldItems]) removeWorldItem(t, wi);
  t.worldBombs.length = 0;
}

export function setItemsVisibilityOn(t: TacticalState, g: number, level: number, allGreaterThan: number, setLocator: boolean): boolean {
  let modified = false;
  for (const wi of itemsAt(t, g, level)) {
    if (wi.visible === Visibility.VISIBLE || wi.visible < allGreaterThan) continue;
    if (wi.object.item === itemIndex(t, 'ACTION_ITEM') || wi.object.item === itemIndex(t, 'OWNERSHIP')) continue;
    wi.visible = Visibility.VISIBLE;
    modified = true;
  }
  if (modified && setLocator) t.events.push({ type: 'itemsRevealed', gridNo: g, level });
  return modified;
}

export function notifySoldiersToLookForItems(t: TacticalState): void {
  for (const s of t.mercSlots) s.lookForItems = true;
}

export function setItemsVisibilityHidden(t: TacticalState, g: number, level: number): void {
  for (const wi of itemsAt(t, g, level)) wi.visible = Visibility.HIDDEN_IN_OBJECT;
}

export function lookForHiddenItems(t: TacticalState, g: number, level: number): boolean {
  let found = false;
  for (const wi of itemsAt(t, g, level)) {
    if (wi.visible !== Visibility.HIDDEN_ITEM || wi.object.item === itemIndex(t, 'OWNERSHIP')) continue;
    wi.visible = Visibility.INVISIBLE;
    found = true;
  }
  if (found) setItemsVisibilityOn(t, g, level, Visibility.INVISIBLE, true);
  return found;
}

function replaceBigGun(t: TacticalState, o: ItemObject): void {
  const items = t.content.items;
  const def = items.byIndex.get(o.item);
  if (!def || !(def.flags & ItemFlags.BIGGUNLIST)) return;
  if (def.weapon?.standardReplacement) {
    const replacement = items.byName.get(def.weapon.standardReplacement);
    if (!replacement?.weapon) return;
    const ammo = o.gunShotsLeft;
    let newAmmo = idiv(replacement.weapon.magSize * ammo, def.weapon.magSize || 1);
    if (newAmmo === 0 && ammo > 0) newAmmo = 1;
    o.item = replacement.index;
    o.gunShotsLeft = newAmmo;
  } else if (def.magazine?.standardReplacement) {
    const replacement = items.byName.get(def.magazine.standardReplacement);
    if (!replacement?.magazine) return;
    const oldSize = def.magazine.capacity || 1;
    for (let i = 0; i < o.count; i++) o.status[i] = idiv((o.status[i] ?? 0) * replacement.magazine.capacity, oldSize);
    o.item = replacement.index;
  }
}

function isPressureTriggered(t: TacticalState, item: number): boolean {
  return t.content.items.byIndex.get(item)?.explosive?.pressureTriggered === true;
}

export function loadWorldItemsFromMap(t: TacticalState, mapItems: readonly MapItem[]): void {
  trashWorldItems(t);
  const sciFi = t.options.sciFi;
  for (const record of mapItems) {
    const o = objectFromRecord(decodeObject(record.raw, WORLD_ITEM_OBJECT_OFFSET));
    const nonExistChance = o.item === itemIndex(t, 'OWNERSHIP') ? 0 : record.nonExistChance;
    if (t.pre.int(100) < nonExistChance) continue;
    if (record.flags & (sciFi ? WorldItemFlags.REALISTIC_ONLY : WorldItemFlags.SCIFI_ONLY)) continue;
    const def = t.content.items.byIndex.get(o.item);
    if (!def || def.flags & ItemFlags.NOT_EDITOR) continue;
    if (!t.options.gunNut) replaceBigGun(t, o);
    let flags = record.flags;
    let visible = record.visible;
    if (o.item === itemIndex(t, 'ACTION_ITEM')) {
      if (isPit(o)) {
        flags &= ~WorldItemFlags.ARMED_BOMB;
        visible = Visibility.BURIED;
        setDetonator(o, NO_DETONATOR);
      }
    } else if (isPressureTriggered(t, o.item) && visible === Visibility.HIDDEN_ITEM && o.trap > 0) {
      armBomb(t, o, Detonator.PRESSURE);
      flags |= WorldItemFlags.ARMED_BOMB;
      setMineFlag(t, record.gridNo, MineFlag.ENEMY);
    }
    if (flags & WorldItemFlags.ARMED_BOMB) visible = Visibility.BURIED;
    if (o.item === NOTHING) continue;
    addItemToPool(t, record.gridNo, o, visible, record.level, flags, record.renderZHeightAboveLevel);
  }
}
