// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-14. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_Map_Inventory.cc BuildStashForSelectedSector (the visible items in
// @src world item index order, sorted by SortSectorInventory and MapScreenSectorInventoryCompare: CompareItemsForSorting
// @src on the item and bStatus[0] read as UINT8), CheckGridNoOfItemsInMapScreenMapInventory,
// @src GetObjFromInventoryStashSlot, RemoveObjectFromStashSlot, PlaceObjectInInventoryStash, SaveSeenAndUnseenItems
// @src (the pool written back in its order: a gridno of 0 borrows the one before it, every item visible),
// @src ReBuildWorldItemStashForLoadedSector (the loaded sector's items trashed and added again, the pool's first, then
// @src the unseen); Tactical/Handle_Items.cc InternalAddItemToPool (NOWHERE taken as the loaded map's centre);
// @src Tactical/Tactical_Save.cc AddItemsToUnLoadedSector (the first free record),
// @src SaveWorldItemsToTempItemFile (the unseen records first, the flag of the temp file, the recount).

import { ItemClass } from '../../content/items/items.ts';
import { type Sector, sameSector } from '../../content/strategic/sector-ids.ts';
import { u8 } from '../../core/int.ts';
import {
  cloneObject,
  copyObjectInto,
  deleteObject,
  getObjFrom,
  type ItemObject,
  removeObjects,
  stackObjects,
  swapObjects,
} from '../items/object.ts';
import { compareItemsForSorting } from '../strategic/economy/merchants/supply.ts';
import { SectorFlag } from '../strategic/forces/constants.ts';
import { setSectorFlag } from '../strategic/map/sectors.ts';
import { worldDay } from '../strategic/time/world-clock.ts';
import type { TacticalContent } from '../tactical/content.ts';
import type { Count } from '../tactical/inventory-panel.ts';
import { handleAllReachableItemsInTheSector } from '../tactical/item-reachability.ts';
import { NOWHERE, Team } from '../tactical/soldier.ts';
import { teamMembers } from '../tactical/state.ts';
import {
  addItemToPool,
  removeWorldItem,
  trashWorldItems,
  Visibility,
  type WorldItem,
  WorldItemFlags,
  worldItemsByIndex,
} from '../tactical/world-items.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { type DiffWorldItem, sectorKey } from './sector-diff.ts';
import { isMapScreenWorldItemVisibleInMapInventory, synchronizeVisibleItemCount } from './sector-item-count.ts';
import { sectorDiffOf } from './sector-loot.ts';

const MONEY_STATUS = 100;
const UNSET_GRIDNO = 0;

export interface PoolItem {
  readonly gridNo: number;
  readonly level: number;
  readonly object: ItemObject;
  readonly flags: number;
  readonly zHeight: number;
  readonly visible: number;
}

export interface StashEntry extends PoolItem {
  readonly index: number;
}

export interface Stash {
  entries(): StashEntry[];
  entry(index: unknown): StashEntry | null;
  take(index: number, count: Count): ItemObject;
  placeInto(index: number, cursor: ItemObject): void;
  add(o: ItemObject, gridNo: number, level: number): number[];
  update(index: number, o: ItemObject): void;
  writeBack(pool: readonly PoolItem[]): void;
}

function contentOf(campaign: CampaignSim): TacticalContent {
  const content = campaign.battle?.content;
  if (!content) throw new Error('the stash needs the campaign roster');
  return content;
}

function visibleInMapInventory(campaign: CampaignSim, wi: { readonly object: ItemObject; readonly visible: number }): boolean {
  return isMapScreenWorldItemVisibleInMapInventory(contentOf(campaign).items, wi);
}

function slotLimit(campaign: CampaignSim, item: number): number {
  return contentOf(campaign).items.byIndex.get(item)?.perPocket ?? 0;
}

function placeIntoStashSlot(campaign: CampaignSim, slot: ItemObject, cursor: ItemObject): void {
  const limit = slotLimit(campaign, cursor.item);
  if (cursor.item !== slot.item) swapObjects(cursor, slot);
  else if (contentOf(campaign).items.byIndex.get(cursor.item)?.itemClass === ItemClass.MONEY) {
    slot.status[0] = MONEY_STATUS;
    slot.money += cursor.money;
    deleteObject(cursor);
  } else if (limit < 2) swapObjects(cursor, slot);
  else stackObjects(cursor, slot, Math.min(cursor.count, Math.max(0, limit - slot.count)));
}

export function takesWithoutSwap(campaign: CampaignSim, slot: ItemObject, cursor: ItemObject): boolean {
  if (cursor.item !== slot.item) return false;
  if (contentOf(campaign).items.byIndex.get(cursor.item)?.itemClass === ItemClass.MONEY) return true;
  return slotLimit(campaign, cursor.item) >= 2;
}

function newStashObjects(campaign: CampaignSim, cursor: ItemObject): ItemObject[] {
  const out: ItemObject[] = [];
  while (cursor.count > 0) out.push(emptySlotShare(campaign, cursor));
  return out;
}

export function emptySlotShare(campaign: CampaignSim, cursor: ItemObject): ItemObject {
  const limit = slotLimit(campaign, cursor.item);
  const n = limit !== 0 && cursor.count > limit ? limit : cursor.count;
  const part = cloneObject(cursor);
  part.count = n;
  part.status = cursor.status.slice(0, n);
  removeObjects(cursor, n);
  return part;
}

function stashFlags(gridNo: number): number {
  return WorldItemFlags.REACHABLE | entryPointFlag(gridNo);
}

function entryPointFlag(gridNo: number): number {
  return gridNo === NOWHERE ? WorldItemFlags.GRIDNO_NOT_SET_USE_ENTRY_POINT : 0;
}

function takeFrom(campaign: CampaignSim, o: ItemObject, count: Count): { readonly taken: ItemObject; readonly emptied: boolean } {
  if (count === 1 && o.count > 1) return { taken: getObjFrom(contentOf(campaign).items, o, 0) as ItemObject, emptied: false };
  return { taken: cloneObject(o), emptied: true };
}

function seenWrittenBack(seen: readonly PoolItem[]): PoolItem[] {
  const out: PoolItem[] = [];
  for (const wi of seen) {
    const before = out.at(-1);
    const gridNo = wi.gridNo === UNSET_GRIDNO && before ? before.gridNo : wi.gridNo;
    out.push({ ...wi, gridNo, flags: wi.flags | entryPointFlag(gridNo), visible: Visibility.VISIBLE });
  }
  return out;
}

function unseenWrittenBack(unseen: readonly PoolItem[]): PoolItem[] {
  return unseen.map((wi) => ({ ...wi, flags: wi.flags | entryPointFlag(wi.gridNo) }));
}

export function poolOrder<T extends { readonly object: ItemObject }>(campaign: CampaignSim, entries: readonly T[]): T[] {
  const tables = campaign.merchants?.content.tables;
  if (!tables) return [...entries];
  const items = contentOf(campaign).items;
  const quality = (o: ItemObject) => u8(o.status[0] ?? 0);
  return [...entries].sort((a, b) =>
    compareItemsForSorting(items, tables, a.object.item, b.object.item, quality(a.object), quality(b.object)),
  );
}

export function poolList<T extends { readonly index: number; readonly object: ItemObject }>(
  campaign: CampaignSim,
  seen: readonly T[],
  order: readonly number[],
): T[] {
  const byIndex = new Map(seen.map((e) => [e.index, e]));
  const named = order.flatMap((index) => {
    const entry = byIndex.get(index);
    byIndex.delete(index);
    return entry ? [entry] : [];
  });
  return [...named, ...poolOrder(campaign, [...byIndex.values()])];
}

function loadedStash(campaign: CampaignSim): Stash {
  const t = campaign.tactical?.state;
  if (!t) throw new Error('no loaded sector');
  const visible = () => worldItemsByIndex(t).filter((wi) => visibleInMapInventory(campaign, wi));
  const find = (index: number) => visible().find((wi) => wi.id === index) ?? null;
  const entryOf = (wi: WorldItem): StashEntry => ({ ...wi, index: wi.id });
  const readd = (wi: PoolItem) => addItemToPool(t, wi.gridNo, wi.object, wi.visible, wi.level, wi.flags, wi.zHeight);
  return {
    entries: () => visible().map(entryOf),
    entry: (index) => {
      const wi = typeof index === 'number' ? find(index) : null;
      return wi ? entryOf(wi) : null;
    },
    take: (index, count) => {
      const wi = find(index) as WorldItem;
      const { taken, emptied } = takeFrom(campaign, wi.object, count);
      if (emptied) removeWorldItem(t, wi);
      return taken;
    },
    placeInto: (index, cursor) => {
      const wi = find(index) as WorldItem;
      placeIntoStashSlot(campaign, wi.object, cursor);
      wi.flags |= WorldItemFlags.REACHABLE;
    },
    add: (o, gridNo, level) => {
      const at = gridNo === NOWHERE ? (t.world.map?.info.centerGridNo ?? NOWHERE) : gridNo;
      return newStashObjects(campaign, o).flatMap((part) => {
        const added = addItemToPool(t, at, part, Visibility.VISIBLE, level, stashFlags(at), 0);
        return added ? [added.id] : [];
      });
    },
    update: (index, o) => {
      const wi = find(index) as WorldItem;
      if (o.count === 0) removeWorldItem(t, wi);
      else copyObjectInto(wi.object, o);
    },
    writeBack: (pool) => {
      const unseen = worldItemsByIndex(t).filter((wi) => !visibleInMapInventory(campaign, wi));
      trashWorldItems(t);
      for (const wi of [...seenWrittenBack(pool), ...unseenWrittenBack(unseen)]) readd(wi);
    },
  };
}

function unloadedStash(campaign: CampaignSim, sector: Sector): Stash {
  const state = campaign.state;
  const records = (): DiffWorldItem[] => {
    const diff = sectorDiffOf(state, sector);
    diff.items ??= [];
    return diff.items;
  };
  const known = (): readonly DiffWorldItem[] => state.sectorDiffs.get(sectorKey(sector))?.items ?? [];
  const shown = (wi: DiffWorldItem) => wi.exists && visibleInMapInventory(campaign, wi);
  const entryOf = ({ exists: _, ...wi }: DiffWorldItem, k: number): StashEntry => ({ ...wi, index: k });
  const written = () => {
    setSectorFlag(state.map, sector, SectorFlag.ITEM_TEMP_FILE_EXISTS, worldDay(state.clock));
    synchronizeVisibleItemCount(state.map, contentOf(campaign).items, sector, records());
  };
  const record = (index: unknown): DiffWorldItem | null => {
    if (typeof index !== 'number' || !Number.isInteger(index)) return null;
    const wi = known()[index];
    return wi && shown(wi) ? wi : null;
  };
  return {
    entries: () => known().flatMap((wi, k) => (shown(wi) ? [entryOf(wi, k)] : [])),
    entry: (index) => {
      const wi = record(index);
      return wi ? entryOf(wi, index as number) : null;
    },
    take: (index, count) => {
      const items = records();
      const wi = items[index] as DiffWorldItem;
      const rest = cloneObject(wi.object);
      const { taken, emptied } = takeFrom(campaign, rest, count);
      items[index] = emptied ? { ...wi, exists: false } : { ...wi, object: rest };
      written();
      return taken;
    },
    placeInto: (index, cursor) => {
      const items = records();
      const wi = items[index] as DiffWorldItem;
      const object = cloneObject(wi.object);
      placeIntoStashSlot(campaign, object, cursor);
      items[index] = { ...wi, object, flags: wi.flags | WorldItemFlags.REACHABLE };
      written();
    },
    add: (o, gridNo, level) => {
      const items = records();
      const added = newStashObjects(campaign, o).map((object) => {
        const wi: DiffWorldItem = {
          exists: true,
          gridNo,
          level,
          object,
          flags: stashFlags(gridNo),
          zHeight: 0,
          visible: Visibility.VISIBLE,
        };
        const free = items.findIndex((other) => !other.exists);
        if (free !== -1) {
          items[free] = wi;
          return free;
        }
        items.push(wi);
        return items.length - 1;
      });
      written();
      return added;
    },
    update: (index, o) => {
      const items = records();
      const wi = items[index] as DiffWorldItem;
      items[index] = o.count === 0 ? { ...wi, exists: false } : { ...wi, object: o };
      written();
    },
    writeBack: (pool) => {
      const unseen = records().filter((wi) => wi.exists && !visibleInMapInventory(campaign, wi));
      const diff = sectorDiffOf(state, sector);
      diff.items = [...unseenWrittenBack(unseen), ...seenWrittenBack(pool)].map((wi) => ({
        exists: true,
        gridNo: wi.gridNo,
        level: wi.level,
        object: wi.object,
        flags: wi.flags,
        zHeight: wi.zHeight,
        visible: wi.visible,
      }));
      written();
    },
  };
}

function isLoaded(campaign: CampaignSim, sector: Sector): boolean {
  const world = campaign.state.worldSector;
  return campaign.tactical !== null && world !== null && sameSector(world, sector);
}

export function stashOf(campaign: CampaignSim, sector: Sector): Stash {
  if (!isLoaded(campaign, sector)) return unloadedStash(campaign, sector);
  const t = campaign.tactical?.state;
  if (t) handleAllReachableItemsInTheSector(t, teamMembers(t, Team.OUR));
  return loadedStash(campaign);
}
