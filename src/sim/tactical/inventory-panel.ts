// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Panels.cc SMInvClickCallbackPrimary, UIHandleItemPlacement, MergeMessageBoxCallBack,
// @src HandleNailsVestFetish, SMInvClickCamoCallback, TMClickFirstHandInvCallbackSecondary; Interface_Items.cc
// @src BeginItemPointer, CancelItemPointer, ItemDescAttachmentsCallbackPrimary, DoAttachment, ItemDescAmmoCallback,
// @src DeleteItemDescriptionBox (AP_RELOAD_GUN when the attachments changed, charged per command),
// @src ItemPopupRegionCallbackPrimary (one object of a stack), CompatibleItemForApplyingOnMerc; Turn_Based_Input.cc
// @src HandleUIReloading; Points.cc GetAPsToAutoReload; Items.cc RemoveObjectFromSlot, ApplyCamo, ApplyCanteen,
// @src ApplyElixir; Strategic/MapScreen.cc MAPInvClickCallbackPrimary (no APs, attachments through the description box);
// @src Interface_Items.cc RemoveMoney, BtnMoneyButtonCallback* (the money box splits money off a pocket into the cursor,
// @src then the drop places it: one command).

import { ItemClass, ItemFlags, type ItemTable, NOTHING } from '../../content/items/items.ts';
import { validAttachment, validLaunchable } from '../../content/items/rules.ts';
import { idiv } from '../../core/int.ts';
import {
  attachmentPosition,
  canAttachAsAttachment,
  cloneObject,
  createItem,
  deleteObject,
  emptyWeaponMagazine,
  getObjFrom,
  type ItemObject,
  NO_ATTACHMENT_POSITION,
  removeAttachment,
} from '../items/object.ts';
import { totalPoints, useKitPoints } from '../strategic/economy/kits.ts';
import type { CombatContext } from './combat/context.ts';
import { findAmmoToReload, isValidSecondHandShotForReloading } from './combat/reload.ts';
import { CONSCIOUSNESS } from './combat/types.ts';
import { reloadSoldierAnimationDueToHandItemChange, swapHandItems } from './hand-item.ts';
import {
  AP_RELOAD_GUN,
  apsToReloadGunWithAmmo,
  autoPlaceObject,
  type InventoryContext,
  InvSlot,
  itemIn,
  NO_SLOT,
  placeObject,
} from './inventory.ts';
import { attachSucceeded, evaluateValidMerge, MergeAction, soldierAttachObject, validMerge } from './item-merge.ts';
import { AP, deductPoints, enoughPoints } from './points.ts';
import { Body, OKLIFE, type Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';

export interface PanelEnv {
  readonly items: ItemTable;
  readonly combat: CombatContext;
  readonly inCombat: boolean;
  readonly mapScreen: boolean;
  context(s: Soldier): InventoryContext;
  equipmentChanged(s: Soldier, slot: number, oldItem: number, newItem: number): void;
  leftover(s: Soldier, o: ItemObject): void;
  emit(event: PanelEvent): void;
}

export type PanelEvent =
  | {
      readonly type: 'itemMoved';
      readonly soldier: number;
      readonly item: string;
      readonly count: number;
      readonly from: number | 'ground';
      readonly to: number | 'ground';
      readonly toSoldier?: number;
    }
  | { readonly type: 'itemAttached'; readonly soldier: number; readonly item: string; readonly to: string; readonly result: string }
  | { readonly type: 'itemDetached'; readonly soldier: number; readonly item: string; readonly from: string }
  | { readonly type: 'gunUnloaded'; readonly soldier: number; readonly item: string; readonly magazine: string; readonly rounds: number }
  | { readonly type: 'itemApplied'; readonly soldier: number; readonly target: number; readonly item: string }
  | {
      readonly type: 'moneySplit';
      readonly soldier: number;
      readonly slot: number;
      readonly to: number;
      readonly toSoldier?: number;
      readonly amount: number;
    }
  | { readonly type: 'handsSwapped'; readonly soldier: number };

export const PanelRefusal = {
  EMPTY_SLOT: 'emptySlot',
  SAME_SLOT: 'sameSlot',
  NAILS_VEST: 'nailsVest',
  NOT_ENOUGH_AP: 'notEnoughAP',
  USE_ATTACH: 'useAttach',
  MERGE_PROMPT: 'mergePrompt',
  DOES_NOT_FIT: 'doesNotFit',
  NO_ROOM: 'noRoom',
  CANNOT_ATTACH: 'cannotAttach',
  PERMANENT: 'permanentAttachment',
  NO_ATTACHMENT: 'noAttachment',
  INSEPARABLE: 'inseparable',
  NOT_A_GUN: 'notAGun',
  GUN_EMPTY: 'gunEmpty',
  WRONG_AMMO: 'wrongAmmo',
  NO_AMMO: 'noAmmo',
  CANNOT_RELOAD: 'cannotReload',
  ROBOT: 'robot',
  UNCONSCIOUS_TARGET: 'unconsciousTarget',
  CANNOT_APPLY: 'cannotApply',
  NOT_PORTED: 'notPorted',
  NOT_MONEY: 'notMoney',
  NOT_ENOUGH_MONEY: 'notEnoughMoney',
} as const;

export type PanelRefusal = (typeof PanelRefusal)[keyof typeof PanelRefusal];

export type PanelOutcome =
  | { readonly ok: true; readonly data?: Record<string, unknown> }
  | { readonly ok: false; readonly refusal: PanelRefusal };

export type Count = 'all' | 1;

const NAILS = 34;
const NAILS_VEST_REFUSAL_EXEMPT = [
  'LEATHER_JACKET',
  'LEATHER_JACKET_W_KEVLAR',
  'LEATHER_JACKET_W_KEVLAR_18',
  'LEATHER_JACKET_W_KEVLAR_Y',
  'COMPOUND18',
  'JAR_QUEEN_CREATURE_BLOOD',
];
const ATTACH_SLOTS: readonly number[] = [InvSlot.HAND, InvSlot.SECOND_HAND, InvSlot.HELMET, InvSlot.VEST, InvSlot.LEGS];
const TRANSFER_CHECK_APS = 3;
const TRANSFER_CHARGE_APS = 2;
const DRUG_ITEMS = ['ADRENALINE_BOOSTER', 'REGEN_BOOSTER', 'SYRINGE_3', 'SYRINGE_4', 'SYRINGE_5', 'ALCOHOL', 'WINE', 'BEER'];
const FULL_CAMO = 100;
const CANTEEN_POINTS_PER_DRINK = 20;
const MAX_HUMAN_CREATURE_SMELL = 9;

const refuse = (refusal: PanelRefusal): PanelOutcome => ({ ok: false, refusal });
const name = (items: ItemTable, item: number) => items.byIndex.get(item)?.name ?? String(item);

export function nailsRefuses(items: ItemTable, s: Soldier, slot: number, newItem: number): boolean {
  if (s.profile !== NAILS || slot !== InvSlot.VEST) return false;
  return !NAILS_VEST_REFUSAL_EXEMPT.includes(name(items, newItem));
}

export function takeObjects(o: ItemObject, count: Count, index: number): ItemObject | null {
  if (count === 1) return getObjFrom(o, index);
  if (o.count === 0) return null;
  const whole = cloneObject(o);
  deleteObject(o);
  return whole;
}

export function dryInventoryContext(items: ItemTable, inCombat: boolean, s: Soldier): InventoryContext {
  return {
    items,
    inCombat,
    actionPoints: () => s.actionPoints,
    spendActionPoints: () => {},
    dropAtFeet: () => {},
  };
}

function dryContext(env: PanelEnv, s: Soldier): InventoryContext {
  return dryInventoryContext(env.items, env.inCombat, s);
}

function clonedCarrier(s: Soldier): { inv: ItemObject[] } {
  return { inv: s.inv.map(cloneObject) };
}

export function cancelCursor(env: PanelEnv, owner: Soldier, sourceSlot: number, cursor: ItemObject): void {
  if (cursor.count === 0) return;
  const ctx = env.context(owner);
  if (sourceSlot !== NO_SLOT) placeObject(ctx, owner, sourceSlot, cursor);
  if (cursor.count > 0) autoPlaceObject(ctx, owner, cursor);
  if (cursor.count > 0) env.leftover(owner, cursor);
}

function transferCheckRefusal(env: PanelEnv, mover: Soldier, target: Soldier): PanelRefusal | null {
  if (mover === target || !env.inCombat) return null;
  if (mover.life >= CONSCIOUSNESS && !enoughPoints(env.inCombat, mover, TRANSFER_CHECK_APS)) return PanelRefusal.NOT_ENOUGH_AP;
  if (target.life >= CONSCIOUSNESS && !enoughPoints(env.inCombat, target, TRANSFER_CHECK_APS)) return PanelRefusal.NOT_ENOUGH_AP;
  return null;
}

function chargeTransfer(env: PanelEnv, mover: Soldier, target: Soldier): void {
  if (mover === target) return;
  if (mover.life >= CONSCIOUSNESS) deductPoints(env.inCombat, mover, TRANSFER_CHARGE_APS, 0);
  if (target.life >= CONSCIOUSNESS) deductPoints(env.inCombat, target, TRANSFER_CHARGE_APS, 0);
}

function placementFits(env: PanelEnv, mover: Soldier, from: number, target: Soldier, to: number, count: Count, index: number): boolean {
  const source = clonedCarrier(mover);
  const destination = target === mover ? source : clonedCarrier(target);
  const cursor = takeObjects(source.inv[from] as ItemObject, count, index);
  if (!cursor) return false;
  return placeObject(dryContext(env, target), destination, to, cursor);
}

export interface MoveRequest {
  readonly mover: Soldier;
  readonly from: number;
  readonly target: Soldier;
  readonly to: number;
  readonly count: Count;
  readonly index: number;
  readonly merge: boolean | undefined;
}

function attachPrecheck(env: PanelEnv, s: Soldier, target: ItemObject, cursor: ItemObject): PanelRefusal | null {
  if (canAttachAsAttachment(env.items, target, cursor.item))
    return attachmentPosition(env.items, target, cursor) === NO_ATTACHMENT_POSITION ? PanelRefusal.CANNOT_ATTACH : null;
  const merge = evaluateValidMerge(env.items, cursor.item, target.item);
  if (!merge) return PanelRefusal.CANNOT_ATTACH;
  if (merge.action !== MergeAction.COMBINE_POINTS && !enoughPoints(env.combat.inCombat, s, AP.MERGE)) return PanelRefusal.NOT_ENOUGH_AP;
  return null;
}

function attachOrMergeRefusal(env: PanelEnv, req: MoveRequest, cursorItem: number): PanelRefusal | null {
  if (!ATTACH_SLOTS.includes(req.to)) return null;
  const slotItem = itemIn(req.target.inv, req.to);
  if (slotItem === NOTHING) return null;
  if (validAttachment(env.items, cursorItem, slotItem)) return PanelRefusal.USE_ATTACH;
  if (!validMerge(env.items, cursorItem, slotItem)) return null;
  if (env.mapScreen) return PanelRefusal.USE_ATTACH;
  return req.merge === undefined ? PanelRefusal.MERGE_PROMPT : null;
}

export function moveItem(env: PanelEnv, req: MoveRequest): PanelOutcome {
  const { mover, from, target, to } = req;
  const source = mover.inv[from] as ItemObject;
  if (source.item === NOTHING) return refuse(PanelRefusal.EMPTY_SLOT);
  if (mover === target && from === to) return refuse(PanelRefusal.SAME_SLOT);
  if (nailsRefuses(env.items, mover, from, NOTHING)) return refuse(PanelRefusal.NAILS_VEST);
  const transfer = transferCheckRefusal(env, mover, target);
  if (transfer) return refuse(transfer);
  const cursorItem = source.item;
  if (nailsRefuses(env.items, target, to, cursorItem)) return refuse(PanelRefusal.NAILS_VEST);
  const attach = attachOrMergeRefusal(env, req, cursorItem);
  if (attach) return refuse(attach);
  const merging =
    !env.mapScreen && req.merge === true && ATTACH_SLOTS.includes(to) && validMerge(env.items, cursorItem, itemIn(target.inv, to));
  if (!merging && !placementFits(env, mover, from, target, to, req.count, req.index)) return refuse(PanelRefusal.DOES_NOT_FIT);
  const mergeRefusal = merging
    ? attachPrecheck(env, mover, target.inv[to] as ItemObject, takeObjects(cloneObject(source), req.count, req.index) as ItemObject)
    : null;
  if (mergeRefusal) return refuse(mergeRefusal);
  const cursor = takeObjects(source, req.count, req.index) as ItemObject;
  const moved = cursor.count;
  env.equipmentChanged(mover, from, cursorItem, NOTHING);
  if (merging) return mergeIntoSlot(env, req, cursor, cursorItem);
  const oldTarget = itemIn(target.inv, to);
  const placed = placeObject(env.context(target), target, to, cursor);
  let owner = mover;
  if (placed) {
    chargeTransfer(env, mover, target);
    env.equipmentChanged(target, to, oldTarget, cursorItem);
    owner = env.mapScreen ? mover : target;
  }
  cancelCursor(env, owner, from, cursor);
  if (!placed) return refuse(PanelRefusal.DOES_NOT_FIT);
  env.emit({
    type: 'itemMoved',
    soldier: mover.id,
    item: name(env.items, cursorItem),
    count: moved,
    from,
    to,
    ...(target !== mover ? { toSoldier: target.id } : {}),
  });
  return { ok: true, data: { item: name(env.items, cursorItem), count: moved } };
}

export interface SplitMoneyRequest {
  readonly mover: Soldier;
  readonly from: number;
  readonly amount: number;
  readonly target: Soldier;
  readonly to: number;
}

function takeMoney(o: ItemObject, amount: number): ItemObject {
  if (amount >= o.money) {
    const whole = cloneObject(o);
    deleteObject(o);
    return whole;
  }
  const part = cloneObject(o);
  part.money = amount;
  o.money -= amount;
  return part;
}

export function splitMoney(env: PanelEnv, req: SplitMoneyRequest): PanelOutcome {
  const { mover, from, amount, target, to } = req;
  const source = mover.inv[from] as ItemObject;
  if (source.item === NOTHING) return refuse(PanelRefusal.EMPTY_SLOT);
  if (env.items.byIndex.get(source.item)?.itemClass !== ItemClass.MONEY) return refuse(PanelRefusal.NOT_MONEY);
  if (amount > source.money) return refuse(PanelRefusal.NOT_ENOUGH_MONEY);
  if (mover === target && from === to) return refuse(PanelRefusal.SAME_SLOT);
  const transfer = transferCheckRefusal(env, mover, target);
  if (transfer) return refuse(transfer);
  const sourceCopy = clonedCarrier(mover);
  const destination = target === mover ? sourceCopy : clonedCarrier(target);
  const trial = takeMoney(sourceCopy.inv[from] as ItemObject, amount);
  if (!placeObject(dryContext(env, target), destination, to, trial) || trial.count > 0) return refuse(PanelRefusal.DOES_NOT_FIT);
  const money = source.item;
  const oldTarget = itemIn(target.inv, to);
  const cursor = takeMoney(source, amount);
  if (source.item === NOTHING) env.equipmentChanged(mover, from, money, NOTHING);
  placeObject(env.context(target), target, to, cursor);
  if (oldTarget === NOTHING) env.equipmentChanged(target, to, NOTHING, money);
  chargeTransfer(env, mover, target);
  env.emit({ type: 'moneySplit', soldier: mover.id, slot: from, to, ...(target !== mover ? { toSoldier: target.id } : {}), amount });
  return { ok: true, data: { amount } };
}

function mergeIntoSlot(env: PanelEnv, req: MoveRequest, cursor: ItemObject, cursorItem: number): PanelOutcome {
  const slotObject = req.target.inv[req.to] as ItemObject;
  const into = name(env.items, slotObject.item);
  const result = soldierAttachObject(env.combat, req.mover, slotObject, cursor, 0);
  cancelCursor(env, req.mover, req.from, cursor);
  if (result === 'noAPs') return refuse(PanelRefusal.NOT_ENOUGH_AP);
  env.emit({ type: 'itemAttached', soldier: req.mover.id, item: name(env.items, cursorItem), to: into, result });
  return { ok: true, data: { result } };
}

type AttachmentSnapshot = readonly { readonly item: number; readonly status: number }[];

function attachmentSnapshot(o: ItemObject): AttachmentSnapshot {
  return o.attachments.map((a) => ({ item: a.item, status: a.status }));
}

function allFoundIn(from: AttachmentSnapshot, within: AttachmentSnapshot): boolean {
  return from.every((a) => a.item === NOTHING || within.some((b) => b.item === a.item && b.status === a.status));
}

export function attachmentsChanged(before: AttachmentSnapshot, after: AttachmentSnapshot): boolean {
  return !allFoundIn(before, after) || !allFoundIn(after, before);
}

function chargeAttachmentChange(env: PanelEnv, payer: Soldier, before: AttachmentSnapshot, host: ItemObject): void {
  if (env.inCombat && attachmentsChanged(before, attachmentSnapshot(host))) deductPoints(env.inCombat, payer, AP_RELOAD_GUN, 0);
}

export interface AttachRequest {
  readonly attacher: Soldier;
  readonly from: number;
  readonly owner: Soldier;
  readonly slot: number;
  readonly index: number;
  readonly count: Count;
  readonly permanent: boolean;
}

export function attachItem(env: PanelEnv, req: AttachRequest): PanelOutcome {
  const { attacher, from, owner, slot } = req;
  const source = attacher.inv[from] as ItemObject;
  const target = owner.inv[slot] as ItemObject;
  if (source.item === NOTHING || target.item === NOTHING) return refuse(PanelRefusal.EMPTY_SLOT);
  if (attacher === owner && from === slot) return refuse(PanelRefusal.SAME_SLOT);
  if (!enoughPoints(env.inCombat, attacher, AP_RELOAD_GUN)) return refuse(PanelRefusal.NOT_ENOUGH_AP);
  if (!canAttachAsAttachment(env.items, target, source.item) && !validMerge(env.items, source.item, target.item))
    return refuse(PanelRefusal.CANNOT_ATTACH);
  const inseparable = ((env.items.byIndex.get(source.item)?.flags ?? 0) & ItemFlags.INSEPARABLE) !== 0;
  if (inseparable && validAttachment(env.items, source.item, target.item) && !req.permanent) return refuse(PanelRefusal.PERMANENT);
  if (req.index < 0 || req.index >= Math.max(1, target.count)) return refuse(PanelRefusal.CANNOT_ATTACH);
  const precheck = attachPrecheck(env, attacher, target, takeObjects(cloneObject(source), req.count, 0) as ItemObject);
  if (precheck) return refuse(precheck);
  const cursorItem = source.item;
  const into = name(env.items, target.item);
  const cursor = takeObjects(source, req.count, 0) as ItemObject;
  env.equipmentChanged(attacher, from, cursorItem, NOTHING);
  const before = attachmentSnapshot(target);
  const result = soldierAttachObject(env.combat, attacher, target, cursor, req.index);
  cancelCursor(env, attacher, from, cursor);
  if (result === 'noAPs') return refuse(PanelRefusal.NOT_ENOUGH_AP);
  if (result === 'impossible') return refuse(PanelRefusal.CANNOT_ATTACH);
  chargeAttachmentChange(env, attacher, before, target);
  env.emit({ type: 'itemAttached', soldier: attacher.id, item: name(env.items, cursorItem), to: into, result });
  return { ok: true, data: { result, succeeded: attachSucceeded(result) } };
}

function placeNewObject(env: PanelEnv, s: Soldier, o: ItemObject, to: number | null): boolean {
  const ctx = env.context(s);
  if (to === null) return autoPlaceObject(ctx, s, o) || o.count === 0;
  placeObject(ctx, s, to, o);
  return true;
}

function newObjectFits(env: PanelEnv, s: Soldier, o: ItemObject, to: number | null): boolean {
  const carrier = clonedCarrier(s);
  const copy = cloneObject(o);
  if (to === null) return autoPlaceObject(dryContext(env, s), carrier, copy);
  return placeObject(dryContext(env, s), carrier, to, copy);
}

export function detachItem(env: PanelEnv, s: Soldier, slot: number, position: number, to: number | null): PanelOutcome {
  const host = s.inv[slot] as ItemObject;
  if (host.item === NOTHING) return refuse(PanelRefusal.EMPTY_SLOT);
  const attachment = host.attachments[position];
  if (!attachment || attachment.item === NOTHING) return refuse(PanelRefusal.NO_ATTACHMENT);
  if (!enoughPoints(env.inCombat, s, AP_RELOAD_GUN + AP.PICKUP_ITEM)) return refuse(PanelRefusal.NOT_ENOUGH_AP);
  if ((env.items.byIndex.get(attachment.item)?.flags ?? 0) & ItemFlags.INSEPARABLE) return refuse(PanelRefusal.INSEPARABLE);
  const preview = createItem(env.items, attachment.item, attachment.status);
  if (!newObjectFits(env, s, preview, to)) return refuse(to === null ? PanelRefusal.NO_ROOM : PanelRefusal.DOES_NOT_FIT);
  const before = attachmentSnapshot(host);
  const removed = removeAttachment(env.items, host, position) as ItemObject;
  placeNewObject(env, s, removed, to);
  cancelCursor(env, s, NO_SLOT, removed);
  chargeAttachmentChange(env, s, before, host);
  env.emit({ type: 'itemDetached', soldier: s.id, item: name(env.items, preview.item), from: name(env.items, host.item) });
  return { ok: true, data: { item: name(env.items, preview.item) } };
}

export function unloadGun(env: PanelEnv, s: Soldier, slot: number, to: number | null): PanelOutcome {
  const gun = s.inv[slot] as ItemObject;
  if (gun.item === NOTHING) return refuse(PanelRefusal.EMPTY_SLOT);
  if (env.items.byIndex.get(gun.item)?.itemClass !== ItemClass.GUN) return refuse(PanelRefusal.NOT_A_GUN);
  if (gun.gunShotsLeft <= 0) return refuse(PanelRefusal.GUN_EMPTY);
  const preview = cloneObject(gun);
  const magazine = emptyWeaponMagazine(preview) as ItemObject;
  if (!newObjectFits(env, s, magazine, to)) return refuse(to === null ? PanelRefusal.NO_ROOM : PanelRefusal.DOES_NOT_FIT);
  const taken = emptyWeaponMagazine(gun) as ItemObject;
  const rounds = taken.status[0] ?? 0;
  placeNewObject(env, s, taken, to);
  cancelCursor(env, s, NO_SLOT, taken);
  env.emit({ type: 'gunUnloaded', soldier: s.id, item: name(env.items, gun.item), magazine: name(env.items, magazine.item), rounds });
  return { ok: true, data: { magazine: name(env.items, magazine.item), rounds } };
}

function isReloadable(items: ItemTable, item: number): boolean {
  const cls = items.byIndex.get(item)?.itemClass;
  return cls === ItemClass.GUN || cls === ItemClass.LAUNCHER;
}

function ammoFits(items: ItemTable, gun: number, ammo: number): boolean {
  const gunDef = items.byIndex.get(gun);
  if (gunDef?.itemClass === ItemClass.LAUNCHER) return validLaunchable(items, ammo, gun);
  const ammoDef = items.byIndex.get(ammo);
  return ammoDef?.itemClass === ItemClass.AMMO && !!ammoDef.magazine && gunDef?.weapon?.calibre === ammoDef.magazine.calibre;
}

export function apsToAutoReload(env: PanelEnv, s: Soldier): number {
  const items = env.items;
  if (!isReloadable(items, itemIn(s.inv, InvSlot.HAND))) return 0;
  const slot = findAmmoToReload(items, s, InvSlot.HAND, NO_SLOT);
  if (slot === NO_SLOT) return 0;
  let cost = apsToReloadGunWithAmmo(items, s.inv[InvSlot.HAND] as ItemObject, s.inv[slot] as ItemObject);
  if (!isValidSecondHandShotForReloading(items, s)) return cost;
  const second = s.inv[InvSlot.SECOND_HAND] as ItemObject;
  let secondSlot = NO_SLOT;
  let exclude = NO_SLOT;
  if (ammoFits(items, second.item, itemIn(s.inv, slot))) {
    if ((s.inv[slot]?.count ?? 0) === 1) exclude = slot;
    else secondSlot = slot;
  }
  if (secondSlot === NO_SLOT) secondSlot = findAmmoToReload(items, s, InvSlot.SECOND_HAND, exclude);
  if (secondSlot !== NO_SLOT) {
    const secondCost = apsToReloadGunWithAmmo(items, second, s.inv[secondSlot] as ItemObject);
    if (enoughPoints(env.inCombat, s, cost + secondCost)) cost += secondCost;
  }
  return cost;
}

function reloadWithAmmo(env: PanelEnv, s: Soldier, slot: number, ammoSlot: number): PanelOutcome {
  const gun = s.inv[slot] as ItemObject;
  const ammo = s.inv[ammoSlot] as ItemObject;
  if (ammo.item === NOTHING) return refuse(PanelRefusal.EMPTY_SLOT);
  if (!ammoFits(env.items, gun.item, ammo.item)) return refuse(PanelRefusal.WRONG_AMMO);
  if (name(env.items, gun.item) === 'ROCKET_LAUNCHER') return refuse(PanelRefusal.CANNOT_RELOAD);
  if (!enoughPoints(env.inCombat, s, apsToReloadGunWithAmmo(env.items, gun, ammo))) return refuse(PanelRefusal.NOT_ENOUGH_AP);
  const ammoItem = ammo.item;
  const cursor = takeObjects(ammo, 1, 0) as ItemObject;
  env.equipmentChanged(s, ammoSlot, ammoItem, NOTHING);
  const reloaded = placeObject(env.context(s), s, slot, cursor);
  cancelCursor(env, s, ammoSlot, cursor);
  if (!reloaded) return refuse(PanelRefusal.CANNOT_RELOAD);
  return { ok: true, data: { item: name(env.items, gun.item), shots: gun.gunShotsLeft } };
}

export function reloadWeapon(
  env: PanelEnv,
  s: Soldier,
  slot: number,
  ammoSlot: number | null,
  autoReload: (s: Soldier) => boolean,
): PanelOutcome {
  const gun = s.inv[slot] as ItemObject;
  if (gun.item === NOTHING) return refuse(PanelRefusal.EMPTY_SLOT);
  if (!isReloadable(env.items, gun.item)) return refuse(PanelRefusal.NOT_A_GUN);
  if (ammoSlot !== null) return reloadWithAmmo(env, s, slot, ammoSlot);
  if (slot === InvSlot.HAND && !env.mapScreen) {
    const aps = apsToAutoReload(env, s);
    if (aps === 0) return refuse(PanelRefusal.NO_AMMO);
    if (!enoughPoints(env.inCombat, s, aps)) return refuse(PanelRefusal.NOT_ENOUGH_AP);
    if (!autoReload(s)) return refuse(PanelRefusal.CANNOT_RELOAD);
    return { ok: true, data: { item: name(env.items, gun.item), shots: gun.gunShotsLeft } };
  }
  const found = findAmmoToReload(env.items, s, slot, NO_SLOT);
  if (found === NO_SLOT) return refuse(PanelRefusal.NO_AMMO);
  return reloadWithAmmo(env, s, slot, found);
}

export function swapHands(env: PanelEnv, t: TacticalState | null, s: Soldier): PanelOutcome {
  if (s.bodyType === Body.ROBOTNOWEAPON) return refuse(PanelRefusal.ROBOT);
  const oldHand = itemIn(s.inv, InvSlot.HAND);
  if (!swapHandItems(env.context(s), s)) return refuse(PanelRefusal.NO_ROOM);
  if (t && s.placed) reloadSoldierAnimationDueToHandItemChange(t, s, oldHand, itemIn(s.inv, InvSlot.HAND));
  env.emit({ type: 'handsSwapped', soldier: s.id });
  return { ok: true };
}

type ApplyCheck = 'applies' | 'noAPs' | 'notThis';

interface MercApplication {
  readonly item: string;
  check(env: PanelEnv, target: Soldier, o: ItemObject): ApplyCheck;
  apply(env: PanelEnv, target: Soldier, o: ItemObject): void;
}

const CAMO: MercApplication = {
  item: 'CAMOUFLAGEKIT',
  check: (env, target, o) => {
    if (!enoughPoints(env.inCombat, target, AP.CAMOFLAGE)) return 'noAPs';
    return totalPoints(o) === 0 || target.camo === FULL_CAMO ? 'notThis' : 'applies';
  },
  apply: (env, target, o) => {
    const points = Math.min(idiv(FULL_CAMO - target.camo + 1, 2), totalPoints(o));
    target.camo = Math.min(target.camo + points * 2, FULL_CAMO);
    useKitPoints(o, points);
    deductPoints(env.inCombat, target, AP.CAMOFLAGE, 0);
  },
};

const CANTEEN: MercApplication = {
  item: 'CANTEEN',
  check: (env, target, o) => {
    if (totalPoints(o) === 0) return 'notThis';
    const collapsedFromBreathAlone = target.collapsed && target.life >= OKLIFE && target.sleepDrugCounter === 0;
    return collapsedFromBreathAlone || enoughPoints(env.inCombat, target, AP.DRINK) ? 'applies' : 'noAPs';
  },
  apply: (env, target, o) => {
    const points = Math.min(CANTEEN_POINTS_PER_DRINK, totalPoints(o));
    deductPoints(env.inCombat, target, AP.DRINK, 2 * points * -(100 - target.breath));
    useKitPoints(o, points);
  },
};

const ELIXIR: MercApplication = {
  item: 'JAR_ELIXIR',
  check: (env, target, o) => {
    if (totalPoints(o) === 0) return 'notThis';
    return enoughPoints(env.inCombat, target, AP.CAMOFLAGE) ? 'applies' : 'noAPs';
  },
  apply: (env, target, o) => {
    deductPoints(env.inCombat, target, AP.CAMOFLAGE, 0);
    const points = Math.min((MAX_HUMAN_CREATURE_SMELL - target.monsterSmell) * 2, totalPoints(o));
    useKitPoints(o, points);
    target.monsterSmell += idiv(points, 2);
  },
};

const MERC_APPLICATIONS: readonly MercApplication[] = [CAMO, CANTEEN, ELIXIR];

export function applyItem(env: PanelEnv, user: Soldier, slot: number, target: Soldier): PanelOutcome {
  const source = user.inv[slot] as ItemObject;
  if (source.item === NOTHING) return refuse(PanelRefusal.EMPTY_SLOT);
  if (target.life < CONSCIOUSNESS) return refuse(PanelRefusal.UNCONSCIOUS_TARGET);
  const item = source.item;
  const itemName = name(env.items, item);
  const application = MERC_APPLICATIONS.find((a) => a.item === itemName);
  if (!application) return refuse(DRUG_ITEMS.includes(itemName) ? PanelRefusal.NOT_PORTED : PanelRefusal.CANNOT_APPLY);
  const preview = takeObjects(cloneObject(source), 1, 0) as ItemObject;
  const check = application.check(env, target, preview);
  if (check === 'noAPs') return refuse(PanelRefusal.NOT_ENOUGH_AP);
  if (check === 'notThis') return refuse(PanelRefusal.CANNOT_APPLY);
  const cursor = takeObjects(source, 1, 0) as ItemObject;
  env.equipmentChanged(user, slot, item, NOTHING);
  application.apply(env, target, cursor);
  cancelCursor(env, user, slot, cursor);
  env.emit({ type: 'itemApplied', soldier: user.id, target: target.id, item: itemName });
  return { ok: true, data: { item: itemName } };
}
