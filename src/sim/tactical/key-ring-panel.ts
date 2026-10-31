// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-31. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Panels.cc KeyRingSlotInvClickCallbackPrimary (only a key goes on the ring; an empty
// @src position or the same key: AddKeysToSlot, else SwapKeysToSlot; 2 AP checked and charged for each conscious merc when
// @src the key comes from another merc), SMInvClickCallbackPrimary and UIHandleItemPlacement (a key off the ring into a
// @src pocket: Nails' vest, the AP of a passed item, HandleTacticalEffectsOfEquipmentChange); Interface_Items.cc
// @src BeginItemPointer (one pocket key through GetObjFrom, which leaves a key taken off a stack lock 0),
// @src BeginKeyRingItemPointer (one key, SHIFT the whole position), CancelItemPointer; Items.cc RemoveKeysFromSlot,
// @src AddKeysToSlot (CollectKey, at most the key's ubPerPocket per position), SwapKeysToSlot, CreateKeyObject.

import { INVALID_KEY_NUMBER } from '../../content/formats/locks.ts';
import { ItemClass, NOTHING } from '../../content/items/items.ts';
import { cloneObject, type ItemObject, removeObjectAt, removeObjects } from '../items/object.ts';
import type { KeyOnRing } from './doors/key-ring.ts';
import { collectKey, createKeyObject } from './doors/keys.ts';
import { itemIn, placeObject } from './inventory.ts';
import {
  type Count,
  cancelCursor,
  chargeTransfer,
  clonedCarrier,
  dryContext,
  nailsRefuses,
  type PanelEnv,
  PanelRefusal,
  takeObjects,
  transferCheckRefusal,
} from './inventory-panel.ts';
import type { Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';

export const KeyRingRefusal = {
  NOT_A_KEY: 'notAKey',
  KEY_RING_FULL: 'keyRingFull',
  NO_KEY_RING: 'noKeyRing',
  SLOT_TO_SLOT: 'useMoveItem',
} as const;
export type KeyRingRefusal = (typeof KeyRingRefusal)[keyof typeof KeyRingRefusal];

export type KeySpot = { readonly ring: number } | { readonly slot: number };

export interface KeyMoveRequest {
  readonly mover: Soldier;
  readonly from: KeySpot;
  readonly count: Count;
  readonly index: number;
  readonly target: Soldier;
  readonly to: KeySpot;
}

export type KeyMoveOutcome =
  | { readonly ok: true; readonly data: { readonly item: string; readonly count: number } }
  | { readonly ok: false; readonly refusal: PanelRefusal | KeyRingRefusal };

const KEY_RING_TRANSFER_APS = 2;

const refuse = (refusal: PanelRefusal | KeyRingRefusal): KeyMoveOutcome => ({ ok: false, refusal });

function itemName(t: TacticalState, item: number): string {
  return t.content.items.byIndex.get(item)?.name ?? String(item);
}

function keysPerPosition(t: TacticalState, item: number): number {
  return t.content.items.byIndex.get(item)?.perPocket ?? 0;
}

function removeKeysFromSlot(ring: KeyOnRing, count: number): void {
  ring.count -= count;
  if (ring.count > 0) return;
  ring.count = 0;
  ring.keyId = INVALID_KEY_NUMBER;
}

function addToPosition(ring: KeyOnRing, keyId: number, count: number): void {
  if (ring.count === 0) ring.keyId = keyId;
  ring.count += count;
}

function holdsOtherKey(ring: KeyOnRing, keyId: number): boolean {
  return ring.count !== 0 && ring.keyId !== keyId;
}

function moved(env: PanelEnv, t: TacticalState, req: KeyMoveRequest, item: number, count: number): KeyMoveOutcome {
  const name = itemName(t, item);
  env.emit({
    type: 'keyMoved',
    soldier: req.mover.id,
    item: name,
    count,
    from: req.from,
    to: req.to,
    ...(req.target !== req.mover ? { toSoldier: req.target.id } : {}),
  });
  return { ok: true, data: { item: name, count } };
}

function placesWhole(env: PanelEnv, target: Soldier, slot: number, keys: ItemObject): boolean {
  const trial = cloneObject(keys);
  return placeObject(dryContext(env, target), clonedCarrier(target), slot, trial) && trial.count === 0;
}

function ringToSlot(t: TacticalState, env: PanelEnv, req: KeyMoveRequest, ring: KeyOnRing, slot: number): KeyMoveOutcome {
  const { mover, target } = req;
  const transfer = transferCheckRefusal(env, mover, target);
  if (transfer) return refuse(transfer);
  const keys = createKeyObject(t.content, req.count === 'all' ? ring.count : 1, ring.keyId);
  if (!keys) return refuse(PanelRefusal.DOES_NOT_FIT);
  const keyItem = keys.item;
  const count = keys.count;
  if (nailsRefuses(env.items, target, slot, keyItem)) return refuse(PanelRefusal.NAILS_VEST);
  if (!placesWhole(env, target, slot, keys)) return refuse(PanelRefusal.DOES_NOT_FIT);
  removeKeysFromSlot(ring, count);
  const oldItem = itemIn(target.inv, slot);
  placeObject(env.context(target), target, slot, keys);
  chargeTransfer(env, mover, target);
  env.equipmentChanged(target, slot, oldItem, keyItem);
  return moved(env, t, req, keyItem, count);
}

function ringToRing(t: TacticalState, env: PanelEnv, req: KeyMoveRequest, source: KeyOnRing, ring: KeyOnRing): KeyMoveOutcome {
  const transfer = transferCheckRefusal(env, req.mover, req.target, KEY_RING_TRANSFER_APS);
  if (transfer) return refuse(transfer);
  const keys = createKeyObject(t.content, req.count === 'all' ? source.count : 1, source.keyId);
  if (!keys) return refuse(PanelRefusal.DOES_NOT_FIT);
  if (holdsOtherKey(ring, source.keyId)) return refuse(PanelRefusal.DOES_NOT_FIT);
  const held = ring === source ? ring.count - keys.count : ring.count;
  if (keys.count > keysPerPosition(t, keys.item) - held) return refuse(KeyRingRefusal.KEY_RING_FULL);
  const keyId = source.keyId;
  collectKey(t, req.target, keys);
  removeKeysFromSlot(source, keys.count);
  addToPosition(ring, keyId, keys.count);
  chargeTransfer(env, req.mover, req.target);
  return moved(env, t, req, keys.item, keys.count);
}

function slotToRing(t: TacticalState, env: PanelEnv, req: KeyMoveRequest, slot: number, ring: KeyOnRing): KeyMoveOutcome {
  const { mover, target } = req;
  const source = mover.inv[slot] as ItemObject;
  if (source.item === NOTHING) return refuse(PanelRefusal.EMPTY_SLOT);
  if (t.content.items.byIndex.get(source.item)?.itemClass !== ItemClass.KEY) return refuse(KeyRingRefusal.NOT_A_KEY);
  const transfer = transferCheckRefusal(env, mover, target, KEY_RING_TRANSFER_APS);
  if (transfer) return refuse(transfer);
  const cursor = takeObjects(cloneObject(source), req.count, req.index) as ItemObject;
  const keyId = cursor.keyId;
  const keyItem = source.item;
  const wanted = cursor.count;
  if (holdsOtherKey(ring, keyId)) {
    const swapped = createKeyObject(t.content, ring.count, ring.keyId);
    takeObjects(source, req.count, req.index);
    env.equipmentChanged(mover, slot, keyItem, NOTHING);
    ring.count = wanted;
    ring.keyId = keyId;
    chargeTransfer(env, mover, target);
    if (swapped) cancelCursor(env, mover, slot, swapped);
    return moved(env, t, req, keyItem, wanted);
  }
  const added = Math.min(wanted, keysPerPosition(t, keyItem) - ring.count);
  if (added <= 0) return refuse(KeyRingRefusal.KEY_RING_FULL);
  collectKey(t, target, cursor);
  if (req.count === 1) removeObjectAt(source, req.index);
  else removeObjects(source, added);
  env.equipmentChanged(mover, slot, keyItem, NOTHING);
  addToPosition(ring, keyId, added);
  chargeTransfer(env, mover, target);
  return moved(env, t, req, keyItem, added);
}

function ringAt(s: Soldier, position: number): KeyOnRing | null {
  return s.keyRing?.[position] ?? null;
}

export function moveKey(t: TacticalState, env: PanelEnv, req: KeyMoveRequest): KeyMoveOutcome {
  const { from, to } = req;
  if ('slot' in from && 'slot' in to) return refuse(KeyRingRefusal.SLOT_TO_SLOT);
  const source = 'ring' in from ? ringAt(req.mover, from.ring) : null;
  if ('ring' in from && !source) return refuse(KeyRingRefusal.NO_KEY_RING);
  if (source && source.count === 0) return refuse(PanelRefusal.EMPTY_SLOT);
  if ('slot' in to) return ringToSlot(t, env, req, source as KeyOnRing, to.slot);
  const ring = ringAt(req.target, to.ring);
  if (!ring) return refuse(KeyRingRefusal.NO_KEY_RING);
  return source ? ringToRing(t, env, req, source, ring) : slotToRing(t, env, req, (from as { readonly slot: number }).slot, ring);
}
