// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Items.cc HandleItemPointerClick (the give branch, the alternative cursor),
// @src InternalBeginItemPointer, RemoveMoney (the money box in steps of 10), BeginItemPointer; Interface_Panels.cc
// @src SMInvClickCallbackPrimary; Items.cc GetObjFrom, PlaceObject (the object put back into its slot); Handle_UI.cc
// @src SelectedGuyInBusyAnimation; BeginKeyRingItemPointer (keys given off the ring leave it with the order, as money
// @src split off a pocket does, 2026-11-03); the put-back that also stands when the robot refuses the object (2026-11-16);
// @src ItemPopupRegionCallbackPrimary's GetObjFrom (the object of a stack the popup picks, given with its own status and
// @src put back at the stack's end, 2026-11-16).

import { ItemClass } from '../../content/items/items.ts';
import { Terrain } from '../../content/world/terrain.ts';
import { cloneObject, createMoney, deleteObject, type ItemObject } from '../items/object.ts';
import { createKeyObject } from '../tactical/doors/keys.ts';
import { apsToGiveItem } from '../tactical/give.ts';
import { InvSlot, NO_SLOT, NUM_INV_SLOTS } from '../tactical/inventory.ts';
import { parseKeySpot } from '../tactical/inventory-commands.ts';
import { inBusyAnimation } from '../tactical/item-pointer.ts';
import { removeKeysFromPosition } from '../tactical/key-ring-panel.ts';
import { enoughPoints } from '../tactical/points.ts';
import { OKLIFE, type Soldier } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';

const MONEY_BOX_STEP = 10;

export interface GiveRequest {
  readonly slot: number;
  readonly preview: ItemObject;
  take(): ItemObject;
  putBack(): void;
}

export type GiveRefusal =
  | 'needItemOrMoney'
  | 'noSlot'
  | 'emptySlot'
  | 'badCount'
  | 'badIndex'
  | 'badMoney'
  | 'notEnoughMoney'
  | 'giverCannotGive'
  | 'giverBusy';

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function slotOf(value: unknown): number | null {
  if (value === 'hand') return InvSlot.HAND;
  return isInt(value) && value >= 0 && value < NUM_INV_SLOTS ? value : null;
}

export function giverRefusal(t: TacticalState, merc: Soldier, isEpc: boolean): GiveRefusal | null {
  if (isEpc || merc.life < OKLIFE || merc.overTerrain === Terrain.DEEP_WATER) return 'giverCannotGive';
  if (inBusyAnimation(t, merc) || merc.tempObject !== null || merc.pendingGive !== null) return 'giverBusy';
  return null;
}

function isMoneyItem(t: TacticalState, o: ItemObject): boolean {
  return t.content.items.byIndex.get(o.item)?.itemClass === ItemClass.MONEY;
}

function nothingToPutBack(): void {}

function stackIndex(value: unknown, o: ItemObject): number | null {
  if (value === undefined) return 0;
  return isInt(value) && value >= 0 && value < Math.max(1, o.count) ? value : null;
}

function putBackAtTheEnd(o: ItemObject, index: number): void {
  const picked = o.status[index] ?? 0;
  o.status = [...o.status.slice(0, index), ...o.status.slice(index + 1, o.count), picked];
}

function slotRequest(merc: Soldier, slot: number, countArg: unknown, indexArg: unknown): GiveRequest | GiveRefusal {
  const o = merc.inv[slot];
  if (!o || o.count === 0) return 'emptySlot';
  const count = countArg === undefined ? o.count : countArg;
  if (!isInt(count) || (count !== 1 && count !== o.count)) return 'badCount';
  const index = stackIndex(indexArg, o);
  if (index === null) return 'badIndex';
  const preview = cloneObject(o);
  if (count < o.count) {
    preview.count = 1;
    preview.status = [o.status[index] ?? 0];
  }
  const putBack = () => {
    if (count < o.count) putBackAtTheEnd(o, index);
  };
  return {
    slot,
    preview,
    putBack,
    take: () => {
      putBack();
      return cloneObject(preview);
    },
  };
}

function moneyPocket(t: TacticalState, merc: Soldier, slotArg: unknown, amount: number): number | GiveRefusal {
  if (slotArg !== undefined) {
    const slot = slotOf(slotArg);
    if (slot === null) return 'noSlot';
    const o = merc.inv[slot];
    if (!o || !isMoneyItem(t, o) || t.content.items.byIndex.get(o.item)?.name !== 'MONEY') return 'notEnoughMoney';
    return o.money >= amount ? slot : 'notEnoughMoney';
  }
  const slot = merc.inv.findIndex((o) => t.content.items.byIndex.get(o.item)?.name === 'MONEY' && o.money >= amount);
  return slot >= 0 ? slot : 'notEnoughMoney';
}

function moneyRequest(t: TacticalState, merc: Soldier, slotArg: unknown, amount: unknown): GiveRequest | GiveRefusal {
  if (!isInt(amount) || amount <= 0 || amount % MONEY_BOX_STEP !== 0) return 'badMoney';
  const pocket = moneyPocket(t, merc, slotArg, amount);
  if (typeof pocket === 'string') return pocket;
  const preview = createMoney(t.content.items, amount);
  return {
    slot: NO_SLOT,
    preview,
    putBack: nothingToPutBack,
    take: () => {
      const o = merc.inv[pocket];
      if (o) {
        o.money -= amount;
        if (o.money === 0) deleteObject(o);
      }
      return cloneObject(preview);
    },
  };
}

export function withdrawnMoneyRequest(money: ItemObject, withdrawn: () => void): GiveRequest {
  return {
    slot: NO_SLOT,
    preview: money,
    putBack: nothingToPutBack,
    take: () => {
      withdrawn();
      return cloneObject(money);
    },
  };
}

function ringRequest(t: TacticalState, merc: Soldier, position: number, countArg: unknown, indexArg: unknown): GiveRequest | GiveRefusal {
  const ring = merc.keyRing?.[position];
  if (!ring || ring.count === 0) return 'emptySlot';
  const count = countArg === undefined ? ring.count : countArg;
  if (!isInt(count) || (count !== 1 && count !== ring.count)) return 'badCount';
  if (indexArg !== undefined && indexArg !== 0) return 'badIndex';
  const preview = createKeyObject(t.content, count, ring.keyId);
  if (!preview) return 'emptySlot';
  return {
    slot: NO_SLOT,
    preview,
    putBack: nothingToPutBack,
    take: () => {
      removeKeysFromPosition(ring, count);
      return cloneObject(preview);
    },
  };
}

function ringOf(value: unknown): number | null {
  const spot = typeof value === 'object' && value !== null ? parseKeySpot(value) : null;
  return spot && 'ring' in spot ? spot.ring : null;
}

export function giveRequest(t: TacticalState, merc: Soldier, cmd: Readonly<Record<string, unknown>>): GiveRequest | GiveRefusal {
  if (cmd.money !== undefined) return moneyRequest(t, merc, cmd.slot, cmd.money);
  if (cmd.slot === undefined) return 'needItemOrMoney';
  const ring = ringOf(cmd.slot);
  if (ring !== null) return ringRequest(t, merc, ring, cmd.count, cmd.index);
  const slot = slotOf(cmd.slot);
  if (slot === null) return 'noSlot';
  return slotRequest(merc, slot, cmd.count, cmd.index);
}

export type GiveApRefusal = 'noPath' | 'notEnoughAP';

export function giveApRefusal(t: TacticalState, merc: Soldier, target: Soldier, adjacent: number | null): GiveApRefusal | null {
  const shown = apsToGiveItem(t, merc, adjacent ?? target.gridNo);
  if (shown === 0) return 'noPath';
  if (!enoughPoints(t.inCombat, merc, shown)) return 'notEnoughAP';
  if (!enoughPoints(t.inCombat, merc, apsToGiveItem(t, merc, target.gridNo))) return 'notEnoughAP';
  return null;
}
