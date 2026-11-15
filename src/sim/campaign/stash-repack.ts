// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_Map_Inventory.cc StackAndSortMapInventoryPool, SectorInventoryStackLimit,
// @src IsLooseSectorInventorySlot, CanMergeSectorInventorySlots, UnloadSectorInventoryGun,
// @src DetachSectorInventoryAttachments, StripSectorInventoryItem, RepackSectorInventoryGroup,
// @src GetRefillablePointCapacity, TakeRefillPointsFromStash, RefillMercItemsFromMapInventoryPool,
// @src IsMercInSectorShownInInventory, IsOurTeamInSectorShownInInventory.

import { ItemClass, type ItemDef, type ItemTable } from '../../content/items/items.ts';
import { type Sector, sameSector } from '../../content/strategic/sector-ids.ts';
import { idiv, u8 } from '../../core/int.ts';
import {
  cloneObject,
  emptyWeaponMagazine,
  type ItemObject,
  itemHasAttachments,
  MAX_ATTACHMENTS,
  MAX_MONEY_PER_SLOT,
  MAX_OBJECTS_PER_SLOT,
  ObjectFlags,
  removeAttachment,
  removeObjectAt,
} from '../items/object.ts';
import { Assignment } from '../strategic/forces/constants.ts';
import { WorldItemFlags } from '../tactical/world-items.ts';
import type { CampaignSim } from './campaign-sim.ts';
import type { RosterMerc } from './roster.ts';
import { type PoolItem, poolOrder, type StashEntry } from './stash.ts';

const KIT_POINTS = 100;
const NOT_REFILLABLE = 0;

const classOf = (items: ItemTable, item: number): number => items.byIndex.get(item)?.itemClass ?? 0;

export function standsInStashSector(m: RosterMerc, sector: Sector): boolean {
  if (m.life <= 0 || m.isVehicle) return false;
  if (m.assignment === Assignment.ASSIGNMENT_POW || m.assignment === Assignment.IN_TRANSIT) return false;
  return !m.betweenSectors && sameSector(m.sector, sector);
}

export function refillablePoints(items: ItemTable, item: number): number {
  const def = items.byIndex.get(item);
  if (def?.itemClass === ItemClass.AMMO) return def.magazine?.capacity ?? NOT_REFILLABLE;
  if (def?.itemClass === ItemClass.KIT || def?.itemClass === ItemClass.MEDKIT) return KIT_POINTS;
  return NOT_REFILLABLE;
}

function sectorStackLimit(def: ItemDef | undefined): number {
  return Math.min(Math.max(def?.perPocket ?? 0, 1), MAX_OBJECTS_PER_SLOT);
}

function isLoose(items: ItemTable, wi: PoolItem): boolean {
  const o = wi.object;
  if (o.count === 0 || itemHasAttachments(o) || o.trap > 0) return false;
  return classOf(items, o.item) !== ItemClass.KEY;
}

function canMerge(items: ItemTable, target: PoolItem, source: PoolItem): boolean {
  if (!isLoose(items, target) || !isLoose(items, source)) return false;
  return target.object.item === source.object.item && target.level === source.level;
}

function unloadGun(items: ItemTable, wi: PoolItem, extracted: PoolItem[]): void {
  const gun = wi.object;
  if (gun.count !== 1 || classOf(items, gun.item) !== ItemClass.GUN) return;
  if (gun.gunShotsLeft === 0 || classOf(items, gun.gunAmmoItem) !== ItemClass.AMMO) return;
  const magazine = emptyWeaponMagazine(gun);
  if (magazine) extracted.push({ ...wi, object: magazine });
}

function detachAttachments(items: ItemTable, wi: PoolItem, extracted: PoolItem[]): void {
  let pos = 0;
  while (pos < MAX_ATTACHMENTS) {
    const detached = removeAttachment(items, wi.object, pos);
    if (detached) extracted.push({ ...wi, object: detached });
    else pos++;
  }
}

function strip(items: ItemTable, wi: PoolItem, extracted: PoolItem[]): void {
  const o = wi.object;
  if (o.count === 0 || o.trap > 0 || o.flags & ObjectFlags.ARMED_BOMB) return;
  unloadGun(items, wi, extracted);
  detachAttachments(items, wi, extracted);
}

function takenApart(items: ItemTable, reachable: readonly PoolItem[]): PoolItem[] {
  const all = [...reachable];
  let pending: PoolItem[] = [];
  for (const wi of all) strip(items, wi, pending);
  while (pending.length > 0) {
    const next: PoolItem[] = [];
    for (const wi of pending) strip(items, wi, next);
    all.push(...pending);
    pending = next;
  }
  return all;
}

function carriedValues(group: readonly PoolItem[], money: boolean, capacity: number): number[] {
  if (money) return group.map((wi) => wi.object.money);
  return group.flatMap(({ object: o }) =>
    Array.from({ length: o.count }, (_, k) => (capacity > 0 ? Math.min(u8(o.status[k] ?? 0), capacity) : (o.status[k] ?? 0))),
  );
}

function poured(total: number, capacity: number): number[] {
  const values: number[] = Array.from({ length: idiv(total, capacity) }, () => capacity);
  if (total % capacity > 0) values.push(total % capacity);
  return values;
}

function repackGroup(items: ItemTable, group: readonly PoolItem[], packed: PoolItem[]): void {
  const first = group[0] as PoolItem;
  const def = items.byIndex.get(first.object.item);
  const money = def?.itemClass === ItemClass.MONEY;
  const capacity = money ? MAX_MONEY_PER_SLOT : refillablePoints(items, first.object.item);
  const perSlot = money ? 1 : sectorStackLimit(def);
  if (capacity === 0 && perSlot < 2) {
    packed.push(...group);
    return;
  }
  const carried = carriedValues(group, money, capacity);
  const total = carried.reduce((sum, value) => sum + value, 0);
  const values = capacity > 0 && total > 0 ? poured(total, capacity) : carried;
  for (let next = 0; next < values.length; next += perSlot) {
    const share = values.slice(next, next + perSlot);
    const object = cloneObject(first.object);
    object.count = share.length;
    if (money) object.money = share[0] ?? 0;
    else object.status = share;
    packed.push({ ...first, object });
  }
}

function repacked(items: ItemTable, loose: readonly PoolItem[]): PoolItem[] {
  const packed: PoolItem[] = [];
  const grouped = new Set<number>();
  loose.forEach((wi, first) => {
    if (grouped.has(first)) return;
    if (!isLoose(items, wi)) {
      packed.push(wi);
      return;
    }
    const group = [wi];
    for (let k = first + 1; k < loose.length; k++) {
      const other = loose[k] as PoolItem;
      if (grouped.has(k) || !canMerge(items, wi, other)) continue;
      group.push(other);
      grouped.add(k);
    }
    repackGroup(items, group, packed);
  });
  return packed;
}

const isReachable = (wi: PoolItem): boolean => (wi.flags & WorldItemFlags.REACHABLE) !== 0;

export function stackedAndSorted(campaign: CampaignSim, items: ItemTable, pool: readonly PoolItem[]): PoolItem[] {
  const slots = pool.filter((wi) => wi.object.count > 0).map((wi) => ({ ...wi, object: cloneObject(wi.object) }));
  const packed = repacked(items, takenApart(items, slots.filter(isReachable)));
  return poolOrder(campaign, [...packed, ...slots.filter((wi) => !isReachable(wi))]);
}

export function refillSources(pool: readonly StashEntry[], pointed: StashEntry): StashEntry[] {
  const others = pool.filter(
    (wi) =>
      wi.index !== pointed.index &&
      wi.object.count > 0 &&
      wi.object.item === pointed.object.item &&
      isReachable(wi) &&
      wi.object.trap <= 0 &&
      !itemHasAttachments(wi.object),
  );
  return [pointed, ...others];
}

class StashPoints {
  readonly objects: readonly ItemObject[];
  readonly drawn = new Set<number>();
  #next = 0;

  constructor(objects: readonly ItemObject[]) {
    this.objects = objects;
  }

  get spent(): boolean {
    return this.#next >= this.objects.length;
  }

  take(wanted: number): number {
    while (!this.spent) {
      const o = this.objects[this.#next] as ItemObject;
      if (o.count === 0) {
        this.#next++;
        continue;
      }
      this.drawn.add(this.#next);
      const last = o.count - 1;
      const available = u8(o.status[last] ?? 0);
      if (available === 0) {
        removeObjectAt(o, last);
        continue;
      }
      const taken = Math.min(wanted, available);
      o.status[last] = available - taken;
      if (available === taken) removeObjectAt(o, last);
      return taken;
    }
    return 0;
  }
}

function topUp(o: ItemObject, k: number, max: number, stash: StashPoints): number {
  let moved = 0;
  while (u8(o.status[k] ?? 0) < max) {
    const points = u8(o.status[k] ?? 0);
    const taken = stash.take(max - points);
    if (taken === 0) break;
    o.status[k] = points + taken;
    moved += taken;
  }
  return moved;
}

function refillMerc(m: RosterMerc, item: number, max: number, stash: StashPoints): number {
  let moved = 0;
  for (const o of m.soldier.inv) {
    if (stash.spent) break;
    if (o.item !== item || itemHasAttachments(o)) continue;
    for (let k = 0; k < o.count; k++) moved += topUp(o, k, max, stash);
  }
  return moved;
}

export interface RefillOutcome {
  readonly points: number;
  readonly drawn: readonly number[];
}

export function refillMercItems(
  mercs: readonly RosterMerc[],
  sector: Sector,
  item: number,
  max: number,
  sources: readonly ItemObject[],
): RefillOutcome {
  const stash = new StashPoints(sources);
  let points = 0;
  for (const m of mercs) {
    if (stash.spent) break;
    if (standsInStashSector(m, sector)) points += refillMerc(m, item, max, stash);
  }
  return { points, drawn: [...stash.drawn] };
}
