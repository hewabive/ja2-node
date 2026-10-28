// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Items.cc HandleItemPointerClick (the give branch, the alternative cursor),
// @src InternalBeginItemPointer, RemoveMoney (the money box in steps of 10), BeginItemPointer; Interface_Panels.cc
// @src SMInvClickCallbackPrimary; Items.cc GetObjFrom, PlaceObject (the object put back into its slot); Handle_UI.cc
// @src SelectedGuyInBusyAnimation.

import { ItemClass } from '../../content/items/items.ts';
import { Terrain } from '../../content/world/terrain.ts';
import { cloneObject, createMoney, deleteObject, type ItemObject } from '../items/object.ts';
import { animName } from '../tactical/anim-states.ts';
import { apsToGiveItem } from '../tactical/give.ts';
import { InvSlot, NO_SLOT, NUM_INV_SLOTS } from '../tactical/inventory.ts';
import { enoughPoints } from '../tactical/points.ts';
import { OKLIFE, type Soldier } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';

const MONEY_BOX_STEP = 10;
const BUSY_STATES: ReadonlySet<string> = new Set([
  'LOB_ITEM',
  'THROW_ITEM',
  'PICKUP_ITEM',
  'DROP_ITEM',
  'OPEN_DOOR',
  'OPEN_STRUCT',
  'END_OPEN_DOOR',
  'END_OPEN_LOCKED_DOOR',
  'ADJACENT_GET_ITEM',
  'DROP_ADJACENT_OBJECT',
  'OPEN_DOOR_CROUCHED',
  'BEGIN_OPENSTRUCT_CROUCHED',
  'CLOSE_DOOR_CROUCHED',
  'OPEN_STRUCT_CROUCHED',
  'END_OPENSTRUCT_CROUCHED',
  'END_OPEN_DOOR_CROUCHED',
  'END_OPEN_LOCKED_DOOR_CROUCHED',
  'END_OPENSTRUCT_LOCKED_CROUCHED',
  'BEGIN_OPENSTRUCT',
]);

export interface GiveRequest {
  readonly slot: number;
  readonly preview: ItemObject;
  take(): ItemObject;
}

export type GiveRefusal =
  | 'needItemOrMoney'
  | 'noSlot'
  | 'emptySlot'
  | 'badCount'
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
  if (BUSY_STATES.has(animName(t.content, merc.state)) || merc.tempObject !== null || merc.pendingGive !== null) return 'giverBusy';
  return null;
}

function isMoneyItem(t: TacticalState, o: ItemObject): boolean {
  return t.content.items.byIndex.get(o.item)?.itemClass === ItemClass.MONEY;
}

function putFirstBackAtTheEnd(o: ItemObject): void {
  const first = o.status[0] ?? 0;
  o.status = [...o.status.slice(1, o.count), first];
}

function slotRequest(merc: Soldier, slot: number, countArg: unknown): GiveRequest | GiveRefusal {
  const o = merc.inv[slot];
  if (!o || o.count === 0) return 'emptySlot';
  const count = countArg === undefined ? o.count : countArg;
  if (!isInt(count) || (count !== 1 && count !== o.count)) return 'badCount';
  const preview = cloneObject(o);
  if (count < o.count) {
    preview.count = 1;
    preview.status = [o.status[0] ?? 0];
  }
  return {
    slot,
    preview,
    take: () => {
      if (count < o.count) putFirstBackAtTheEnd(o);
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

export function giveRequest(t: TacticalState, merc: Soldier, cmd: Readonly<Record<string, unknown>>): GiveRequest | GiveRefusal {
  if (cmd.money !== undefined) return moneyRequest(t, merc, cmd.slot, cmd.money);
  if (cmd.slot === undefined) return 'needItemOrMoney';
  const slot = slotOf(cmd.slot);
  if (slot === null) return 'noSlot';
  return slotRequest(merc, slot, cmd.count);
}

export type GiveApRefusal = 'noPath' | 'notEnoughAP';

export function giveApRefusal(t: TacticalState, merc: Soldier, target: Soldier, adjacent: number | null): GiveApRefusal | null {
  const shown = apsToGiveItem(t, merc, adjacent ?? target.gridNo);
  if (shown === 0) return 'noPath';
  if (!enoughPoints(t.inCombat, merc, shown)) return 'notEnoughAP';
  if (!enoughPoints(t.inCombat, merc, apsToGiveItem(t, merc, target.gridNo))) return 'notEnoughAP';
  return null;
}
