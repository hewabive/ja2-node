// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.h InvSlotPos; Soldier_Create.cc gubItemDroppableFlag, CopyProfileItems,
// @src TryToAttach; Soldier_Profile.cc InitProfileFromContent (reduced gun list); Items.cc ItemSlotLimit, MoneySlotLimit,
// @src FindObjWithin, FindEmptySlotWithin, CanItemFitInPosition, DropObjIfThereIsRoom, FillMoneySlot, PlaceObject,
// @src InternalAutoPlaceObject, ReloadGun, Weight, CalculateCarriedWeight; Points.cc GetAPsToReloadGunWithAmmo;
// @src Soldier_Control.h IsWearingHeadGear

import type { MercProfile } from '../../content/formats/prof.ts';
import { ArmourClass, ItemClass, ItemFlags, type ItemTable, NOTHING } from '../../content/items/items.ts';
import { compatibleFaceItem, validAttachment, validLaunchable } from '../../content/items/rules.ts';
import { slotLimitOf } from '../../content/items/slot-limit.ts';
import { u8 } from '../../core/int.ts';
import {
  attachObject,
  cloneObject,
  copyObjectInto,
  createItems,
  createMoney,
  deleteObject,
  emptyObject,
  findReplacementMagazine,
  type ItemObject,
  MAX_MONEY_PER_SLOT,
  ObjectFlags,
  removeObjects,
  stackObjects,
  swapObjects,
  USABLE_STATUS,
} from '../items/object.ts';

export const InvSlot = {
  HELMET: 0,
  VEST: 1,
  LEGS: 2,
  HEAD1: 3,
  HEAD2: 4,
  HAND: 5,
  SECOND_HAND: 6,
  BIGPOCK1: 7,
  BIGPOCK2: 8,
  BIGPOCK3: 9,
  BIGPOCK4: 10,
  SMALLPOCK1: 11,
  SMALLPOCK2: 12,
  SMALLPOCK3: 13,
  SMALLPOCK4: 14,
  SMALLPOCK5: 15,
  SMALLPOCK6: 16,
  SMALLPOCK7: 17,
  SMALLPOCK8: 18,
} as const;

export const NUM_INV_SLOTS = 19;
export const NO_SLOT = -1;
export const AP_RELOAD_GUN = 5;
const AP_PICKUP_ITEM = 3;
const STRONG_CARRIER_STRENGTH = 80;
const GRAMS_PER_STRENGTH_POINT = 500;

const DROPPABLE_FLAG = [0x01, 0x02, 0x04, 0, 0, 0x08, 0, 0x10, 0x20, 0x40, 0x80, 0, 0, 0, 0, 0, 0, 0, 0];
const IMPRINTED_ON_CREATION: ReadonlySet<string> = new Set(['ROCKET_RIFLE', 'AUTO_ROCKET_RIFLE']);

export type Inventory = ItemObject[];

export interface Carrier {
  readonly inv: Inventory;
}

export interface InventoryContext {
  readonly items: ItemTable;
  readonly inCombat: boolean;
  readonly actionPoints: () => number;
  readonly spendActionPoints: (ap: number) => void;
  readonly dropAtFeet: (o: ItemObject) => void;
  readonly collectKey?: (o: ItemObject) => void;
  readonly placed?: (item: number) => void;
  readonly reloaded?: (gun: number) => void;
}

export function emptyInventory(): Inventory {
  return Array.from({ length: NUM_INV_SLOTS }, emptyObject);
}

export function itemIn(inv: Inventory, slot: number): number {
  return inv[slot]?.item ?? NOTHING;
}

export function wearsHeadGear(inv: Inventory, item: number): boolean {
  return itemIn(inv, InvSlot.HEAD1) === item || itemIn(inv, InvSlot.HEAD2) === item;
}

function slot(inv: Inventory, pos: number): ItemObject {
  const o = inv[pos];
  if (!o) throw new Error(`no inventory slot ${pos}`);
  return o;
}

const twoHanded = (items: ItemTable, item: number): boolean => ((items.byIndex.get(item)?.flags ?? 0) & ItemFlags.TWO_HANDED) !== 0;

export function itemSlotLimit(items: ItemTable, item: number, pos: number): number {
  return slotLimitOf(items.byIndex.get(item)?.perPocket ?? 0, pos);
}

export function moneySlotLimit(pos: number): number {
  return pos >= InvSlot.SMALLPOCK1 ? MAX_MONEY_PER_SLOT / 2 : MAX_MONEY_PER_SLOT;
}

export function findObjWithin(inv: Inventory, item: number, from: number, to: number): number {
  for (let pos = from; pos <= to; pos++) if (itemIn(inv, pos) === item) return pos;
  return NO_SLOT;
}

export function findEmptySlotWithin(items: ItemTable, inv: Inventory, from: number, to: number): number {
  for (let pos = from; pos <= to; pos++) {
    if (itemIn(inv, pos) !== NOTHING) continue;
    if (pos === InvSlot.SECOND_HAND && twoHanded(items, itemIn(inv, InvSlot.HAND))) continue;
    return pos;
  }
  return NO_SLOT;
}

export function canItemFitInPosition(items: ItemTable, inv: Inventory, o: ItemObject, pos: number, doingPlacement: boolean): boolean {
  const def = items.byIndex.get(o.item);
  switch (pos) {
    case InvSlot.SECOND_HAND:
      if (twoHanded(items, itemIn(inv, InvSlot.HAND))) return false;
      break;
    case InvSlot.HAND:
      if (twoHanded(items, o.item) && itemIn(inv, InvSlot.HAND) !== NOTHING && itemIn(inv, InvSlot.SECOND_HAND) !== NOTHING) {
        const secondPerPocket = items.byIndex.get(itemIn(inv, InvSlot.SECOND_HAND))?.perPocket ?? 0;
        const to = secondPerPocket === 0 ? InvSlot.BIGPOCK4 : InvSlot.SMALLPOCK8;
        const free = findEmptySlotWithin(items, inv, InvSlot.BIGPOCK1, to);
        if (free === NO_SLOT) return false;
        if (doingPlacement) {
          copyObjectInto(slot(inv, free), slot(inv, InvSlot.SECOND_HAND));
          deleteObject(slot(inv, InvSlot.SECOND_HAND));
        }
      }
      break;
    case InvSlot.VEST:
    case InvSlot.HELMET:
    case InvSlot.LEGS: {
      const wanted = pos === InvSlot.VEST ? ArmourClass.VEST : pos === InvSlot.HELMET ? ArmourClass.HELMET : ArmourClass.LEGGINGS;
      if (def?.armour?.armourClass !== wanted) return false;
      break;
    }
    case InvSlot.HEAD1:
    case InvSlot.HEAD2:
      if (def?.itemClass !== ItemClass.FACE) return false;
      break;
  }
  return !(itemSlotLimit(items, o.item, pos) === 0 && pos >= InvSlot.SMALLPOCK1);
}

function fillMoneySlot(inSlot: ItemObject, o: ItemObject, pos: number): void {
  if (inSlot.count === 0) {
    copyObjectInto(inSlot, o);
    inSlot.count = 1;
    inSlot.money = 0;
  }
  const room = Math.max(0, moneySlotLimit(pos) - inSlot.money);
  const moved = Math.min(o.money, room);
  inSlot.money += moved;
  o.money -= moved;
  if (o.money === 0) deleteObject(o);
}

function dropObjIfThereIsRoom(ctx: InventoryContext, c: Carrier, pos: number, o: ItemObject): boolean {
  const inSlot = slot(c.inv, pos);
  if (inSlot.count > 0 && internalAutoPlaceObject(ctx, c, inSlot, pos)) return placeObject(ctx, c, pos, o);
  return false;
}

export function placeObject(ctx: InventoryContext, c: Carrier, pos: number, o: ItemObject): boolean {
  const items = ctx.items;
  const inv = c.inv;
  const placedItem = o.item;
  if (!canItemFitInPosition(items, inv, o, pos, true)) return false;
  const def = items.byIndex.get(o.item);
  if (pos === InvSlot.HEAD1 && !compatibleFaceItem(items, o.item, itemIn(inv, InvSlot.HEAD2))) return false;
  if (pos === InvSlot.HEAD2 && !compatibleFaceItem(items, o.item, itemIn(inv, InvSlot.HEAD1))) return false;
  if (def?.itemClass === ItemClass.KEY) ctx.collectKey?.(o);
  const limit = itemSlotLimit(items, o.item, pos);
  const inSlot = slot(inv, pos);
  const isMoney = def?.itemClass === ItemClass.MONEY;
  if (inSlot.count === 0 && isMoney) fillMoneySlot(inSlot, o, pos);
  else if (inSlot.count === 0) {
    const toDrop = Math.min(o.count, Math.max(limit, 1));
    copyObjectInto(inSlot, o);
    for (let k = toDrop; k < o.count; k++) inSlot.status[k] = 0;
    inSlot.count = toDrop;
    removeObjects(o, toDrop);
    if (o.count === 0 && pos === InvSlot.HAND && twoHanded(items, inSlot.item) && itemIn(inv, InvSlot.SECOND_HAND) !== NOTHING)
      swapObjects(o, slot(inv, InvSlot.SECOND_HAND));
  } else if (o.item === inSlot.item) {
    if (isMoney) fillMoneySlot(inSlot, o, pos);
    else if (limit === 1 || (limit === 0 && pos >= InvSlot.HAND && pos <= InvSlot.BIGPOCK4)) {
      if (o.count <= 1) swapObjects(o, inSlot);
      else return dropObjIfThereIsRoom(ctx, c, pos, o);
    } else if (limit === 0) return dropObjIfThereIsRoom(ctx, c, pos, o);
    else stackObjects(o, inSlot, Math.min(limit - inSlot.count, o.count));
  } else {
    const slotDef = items.byIndex.get(inSlot.item);
    if (slotDef?.itemClass === ItemClass.GUN && def?.magazine) {
      if (slotDef.weapon?.calibre === def.magazine.calibre) return reloadGun(ctx, c, inSlot, o);
    } else if (slotDef?.itemClass === ItemClass.LAUNCHER && validLaunchable(items, o.item, inSlot.item)) {
      return reloadGun(ctx, c, inSlot, o);
    }
    if (twoHanded(items, o.item) && pos === InvSlot.HAND) {
      if (itemIn(inv, InvSlot.SECOND_HAND) !== NOTHING) return false;
      swapObjects(o, inSlot);
    } else if (o.count <= Math.max(limit, 1)) swapObjects(o, inSlot);
    else return dropObjIfThereIsRoom(ctx, c, pos, o);
  }
  ctx.placed?.(placedItem);
  return true;
}

function placeIfEmptied(ctx: InventoryContext, c: Carrier, pos: number, o: ItemObject): boolean {
  placeObject(ctx, c, pos, o);
  return o.count === 0;
}

function internalAutoPlaceObject(ctx: InventoryContext, c: Carrier, o: ItemObject, excludeSlot: number): boolean {
  const items = ctx.items;
  const inv = c.inv;
  const def = items.byIndex.get(o.item);
  if (!def) return false;
  const perPocket = def.perPocket;
  switch (def.itemClass) {
    case ItemClass.GUN:
    case ItemClass.BLADE:
    case ItemClass.LAUNCHER:
    case ItemClass.BOMB:
    case ItemClass.GRENADE:
      if (!twoHanded(items, o.item)) {
        if (itemIn(inv, InvSlot.HAND) === NOTHING) {
          if (placeIfEmptied(ctx, c, InvSlot.HAND, o)) return true;
        } else if (!twoHanded(items, itemIn(inv, InvSlot.HAND)) && itemIn(inv, InvSlot.SECOND_HAND) === NOTHING) {
          if (placeIfEmptied(ctx, c, InvSlot.SECOND_HAND, o)) return true;
        }
      }
      break;
    case ItemClass.ARMOUR: {
      const pos =
        def.armour?.armourClass === ArmourClass.VEST
          ? InvSlot.VEST
          : def.armour?.armourClass === ArmourClass.LEGGINGS
            ? InvSlot.LEGS
            : def.armour?.armourClass === ArmourClass.HELMET
              ? InvSlot.HELMET
              : NO_SLOT;
      if (pos !== NO_SLOT && itemIn(inv, pos) === NOTHING && placeIfEmptied(ctx, c, pos, o)) return true;
      break;
    }
    case ItemClass.FACE:
      if (itemIn(inv, InvSlot.HEAD1) === NOTHING && compatibleFaceItem(items, o.item, itemIn(inv, InvSlot.HEAD2))) {
        if (placeIfEmptied(ctx, c, InvSlot.HEAD1, o)) return true;
      } else if (itemIn(inv, InvSlot.HEAD2) === NOTHING && compatibleFaceItem(items, o.item, itemIn(inv, InvSlot.HEAD1))) {
        if (placeIfEmptied(ctx, c, InvSlot.HEAD2, o)) return true;
      }
      break;
  }
  if (perPocket === 0) {
    for (let pos: number = InvSlot.HAND; ; pos++) {
      pos = findEmptySlotWithin(items, inv, pos, InvSlot.BIGPOCK4);
      if (pos === NO_SLOT) return false;
      if (pos === InvSlot.SECOND_HAND && itemIn(inv, InvSlot.HAND) !== NOTHING) continue;
      if (placeIfEmptied(ctx, c, pos, o)) return true;
    }
  }
  if (perPocket > 1 || def.itemClass === ItemClass.KEY || def.itemClass === ItemClass.MONEY) {
    for (let pos: number = InvSlot.HAND; ; pos++) {
      pos = findObjWithin(inv, o.item, pos, InvSlot.SMALLPOCK8);
      if (pos === NO_SLOT) break;
      if (pos === excludeSlot) continue;
      const room =
        def.itemClass === ItemClass.MONEY
          ? slot(inv, pos).money < moneySlotLimit(pos)
          : slot(inv, pos).count < itemSlotLimit(items, o.item, pos);
      if (room && placeIfEmptied(ctx, c, pos, o)) return true;
    }
  }
  for (let pos: number = InvSlot.SMALLPOCK1; ; pos++) {
    pos = findEmptySlotWithin(items, inv, pos, InvSlot.SMALLPOCK8);
    if (pos === NO_SLOT) break;
    if (placeIfEmptied(ctx, c, pos, o)) return true;
  }
  for (let pos: number = InvSlot.HAND; ; pos++) {
    pos = findEmptySlotWithin(items, inv, pos, InvSlot.BIGPOCK4);
    if (pos === NO_SLOT) break;
    if (placeIfEmptied(ctx, c, pos, o)) return true;
  }
  return false;
}

export function autoPlaceObject(ctx: InventoryContext, c: Carrier, o: ItemObject): boolean {
  return internalAutoPlaceObject(ctx, c, o, NO_SLOT);
}

export function autoPlaceObjectExcluding(ctx: InventoryContext, c: Carrier, o: ItemObject, excludeSlot: number): boolean {
  return internalAutoPlaceObject(ctx, c, o, excludeSlot);
}

export function apsToReloadGunWithAmmo(items: ItemTable, gun: ItemObject, ammo: ItemObject): number {
  const gunDef = items.byIndex.get(gun.item);
  if (gunDef?.itemClass === ItemClass.LAUNCHER) return AP_RELOAD_GUN;
  return gunDef?.weapon?.magSize === items.byIndex.get(ammo.item)?.magazine?.capacity ? AP_RELOAD_GUN : 2 * AP_RELOAD_GUN;
}

const Reload = { PLACE: 0, SWAP: 1, TOPOFF: 2, AUTOPLACE_OLD: 3 } as const;

function neighbouringMagazineOfGunSize(ammoItem: number, capacity: number, magSize: number): number {
  return capacity > magSize ? ammoItem - 1 : ammoItem + 1;
}

export function reloadGun(ctx: InventoryContext, c: Carrier, gun: ItemObject, ammo: ItemObject): boolean {
  const items = ctx.items;
  const gunDef = items.byIndex.get(gun.item);
  if (!gunDef || gunDef.name === 'ROCKET_LAUNCHER') return false;
  let aps = 0;
  if (ctx.inCombat) {
    aps = apsToReloadGunWithAmmo(items, gun, ammo);
    if (ctx.actionPoints() - aps < 0) return false;
  }
  if (gunDef.itemClass === ItemClass.LAUNCHER || gunDef.name === 'TANK_CANNON') {
    if (!attachObject(items, gun, ammo)) return false;
  } else {
    const mag = items.byIndex.get(ammo.item)?.magazine;
    const magSize = gunDef.weapon?.magSize ?? 0;
    if (!mag) return false;
    const empty = gun.gunShotsLeft === 0;
    const withStack = ammo.count > 1;
    const sameType = gun.gunAmmoType === mag.ammoType;
    const sameSize = mag.capacity === magSize;
    let type: number;
    const old = emptyObject();
    if (empty) type = Reload.PLACE;
    else {
      old.item = gun.gunAmmoItem;
      old.count = 1;
      old.status = [gun.gunShotsLeft];
      if (sameSize) type = sameType ? (ctx.inCombat ? Reload.SWAP : Reload.TOPOFF) : withStack ? Reload.AUTOPLACE_OLD : Reload.SWAP;
      else type = sameType ? Reload.TOPOFF : Reload.AUTOPLACE_OLD;
    }
    const rounds = ammo.status[0] ?? 0;
    const newAmmoItem = sameSize ? ammo.item : neighbouringMagazineOfGunSize(ammo.item, mag.capacity, magSize);
    const toMove = type === Reload.TOPOFF ? Math.min(rounds, magSize - gun.gunShotsLeft) : sameSize ? rounds : Math.min(rounds, magSize);
    const load = () => {
      gun.gunShotsLeft = toMove;
      gun.gunAmmoType = mag.ammoType;
      gun.gunAmmoItem = newAmmoItem;
    };
    switch (type) {
      case Reload.PLACE:
        load();
        break;
      case Reload.SWAP:
        load();
        if (withStack) stackObjects(old, ammo, 1);
        else if (ctx.inCombat && ctx.actionPoints() - (aps + AP_PICKUP_ITEM) < 0) {
          if (!autoPlaceObject(ctx, c, old)) ctx.dropAtFeet(cloneObject(old));
          deleteObject(ammo);
        } else copyObjectInto(ammo, old);
        break;
      case Reload.AUTOPLACE_OLD:
        if (!autoPlaceObject(ctx, c, old)) return false;
        load();
        break;
      case Reload.TOPOFF:
        gun.gunShotsLeft += toMove;
        break;
    }
    if (!(type === Reload.SWAP && !withStack)) {
      ammo.status[0] = (ammo.status[0] ?? 0) - toMove;
      if (ammo.status[0] === 0) removeObjects(ammo, 1);
    }
  }
  ctx.spendActionPoints(aps);
  if (gun.gunAmmoStatus >= 0) gun.gunAmmoStatus = 100;
  ctx.reloaded?.(gun.item);
  return true;
}

export function objectGrams(items: ItemTable, o: ItemObject): number {
  const def = items.byIndex.get(o.item);
  if (!def || o.item === NOTHING) return 0;
  let grams = 100 * def.weight;
  if (def.perPocket <= 1) {
    for (const a of o.attachments) if (a.item !== NOTHING) grams += 100 * (items.byIndex.get(a.item)?.weight ?? 0);
    if (def.itemClass === ItemClass.GUN && o.gunShotsLeft > 0) grams += 100 * (items.byIndex.get(o.gunAmmoItem)?.weight ?? 0);
  }
  return grams;
}

export function objectWeight(items: ItemTable, o: ItemObject): number {
  const grams = objectGrams(items, o);
  return (items.byIndex.get(o.item)?.perPocket ?? 0) > 1 ? grams * o.count : grams;
}

export function carriedWeightPercent(items: ItemTable, inv: Inventory, effectiveStrength: number): number {
  let grams = 0;
  for (const o of inv) grams += objectWeight(items, o);
  const strength =
    effectiveStrength > STRONG_CARRIER_STRENGTH ? u8(effectiveStrength + effectiveStrength - STRONG_CARRIER_STRENGTH) : effectiveStrength;
  return Math.trunc((100 * grams) / (strength * GRAMS_PER_STRENGTH_POINT));
}

export function reducedGunListInventory(items: ItemTable, inventory: readonly number[]): number[] {
  const inv = [...inventory];
  for (let k = 0; k < inv.length; k++) {
    const oldDef = items.byIndex.get(inv[k] ?? NOTHING);
    if (oldDef?.itemClass !== ItemClass.GUN || !(oldDef.flags & ItemFlags.BIGGUNLIST) || !oldDef.weapon?.standardReplacement) continue;
    const newDef = items.byName.get(oldDef.weapon.standardReplacement);
    if (!newDef?.weapon) continue;
    inv[k] = newDef.index;
    for (let l = 0; l < inv.length; l++) {
      const mag = items.byIndex.get(inv[l] ?? NOTHING)?.magazine;
      if (!mag || oldDef.weapon.calibre === 0) continue;
      if (mag.calibre !== oldDef.weapon.calibre || mag.capacity !== oldDef.weapon.magSize) continue;
      const replacement = findReplacementMagazine(items, newDef.weapon.calibre, newDef.weapon.magSize, mag.ammoType);
      if (replacement !== NOTHING) inv[l] = replacement;
    }
  }
  return inv;
}

function tryToAttach(items: ItemTable, inv: Inventory, o: ItemObject): boolean {
  if (!((items.byIndex.get(o.item)?.flags ?? 0) & ItemFlags.ATTACHMENT)) return false;
  for (const target of inv) {
    if (target.item !== NOTHING && validAttachment(items, o.item, target.item)) {
      attachObject(items, target, o);
      return true;
    }
  }
  return false;
}

export function hiredMercInventory(ctx: InventoryContext, profile: MercProfile, reducedGuns: boolean): Inventory {
  const items = ctx.items;
  const carrier: Carrier = { inv: emptyInventory() };
  const ids = reducedGuns ? reducedGunListInventory(items, profile.inventory) : [...profile.inventory];
  for (let k = 0; k < NUM_INV_SLOTS; k++) {
    const item = ids[k] ?? NOTHING;
    if (item === NOTHING || !items.byIndex.has(item)) continue;
    const o = createItems(items, item, profile.inventoryStatus[k] ?? 100, profile.inventoryCount[k] ?? 1);
    if (!tryToAttach(items, carrier.inv, o)) autoPlaceObject(ctx, carrier, o);
  }
  return carrier.inv;
}

export function npcProfileInventory(items: ItemTable, profile: MercProfile, reducedGuns: boolean): Inventory {
  const inv = emptyInventory();
  const ids = reducedGuns ? reducedGunListInventory(items, profile.inventory) : [...profile.inventory];
  for (let k = 0; k < NUM_INV_SLOTS; k++) {
    const item = ids[k] ?? NOTHING;
    const def = items.byIndex.get(item);
    if (item === NOTHING || !def || def.itemClass === ItemClass.KEY) continue;
    const o = createItems(items, item, profile.inventoryStatus[k] ?? 100, profile.inventoryCount[k] ?? 1);
    if (IMPRINTED_ON_CREATION.has(def.name)) o.imprintId = profile.id;
    if (profile.inventoryUndroppable & (DROPPABLE_FLAG[k] ?? 0)) o.flags |= ObjectFlags.UNDROPPABLE;
    copyObjectInto(slot(inv, k), o);
  }
  for (let left = profile.money; left > 0; ) {
    const pos = findEmptySlotWithin(items, inv, InvSlot.BIGPOCK1, InvSlot.SMALLPOCK8);
    if (pos === NO_SLOT) break;
    const amount = Math.min(left, moneySlotLimit(pos));
    copyObjectInto(slot(inv, pos), createMoney(items, amount));
    left -= amount;
  }
  return inv;
}

export function isValidSecondHandShot(items: ItemTable, s: { readonly inv: Inventory; readonly doBurst: number }): boolean {
  const second = s.inv[InvSlot.SECOND_HAND] as ItemObject;
  const first = s.inv[InvSlot.HAND] as ItemObject;
  const secondDef = items.byIndex.get(second.item);
  return (
    secondDef?.itemClass === ItemClass.GUN &&
    !(secondDef.flags & ItemFlags.TWO_HANDED) &&
    !s.doBurst &&
    items.byIndex.get(first.item)?.itemClass === ItemClass.GUN &&
    (second.status[0] ?? 0) >= USABLE_STATUS &&
    second.gunShotsLeft > 0
  );
}
