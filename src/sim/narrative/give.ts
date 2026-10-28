// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Items.cc PlaceObjectInSoldierProfile, RemoveObjectFromSoldierProfile, SetMoneyInSoldierProfile,
// @src RemoveInvObject, RemoveAttachment, RenumberAttachments; TacticalAI/NPC.cc ReturnItemToPlayer, ConverseFull (taking
// @src the object); Tactical/Interface_Dialogue.cc HandleNPCItemGiven; Tactical/Handle_Items.cc SoldierGiveItemFromAnimation
// @src (the dealer branch, InitiateConversationFull with APPROACH_GIVINGITEM).

import { ItemClass, ItemFlags, type ItemTable, NOTHING } from '../../content/items/items.ts';
import { Approach, NO_PROFILE } from '../../content/narrative/npc-constants.ts';
import { u32 } from '../../core/int.ts';
import { cloneObject, createItem, createMoney, deleteObject, type ItemObject, MAX_ATTACHMENTS } from '../items/object.ts';
import { Npc } from '../strategic/narrative/npc-ids.ts';
import { givenItemRef, soldierGiveItem } from '../tactical/give.ts';
import { autoPlaceObject, InvSlot, NO_SLOT, NUM_INV_SLOTS } from '../tactical/inventory.ts';
import type { ProfileProgress } from '../tactical/profiles.ts';
import { type Soldier, Team } from '../tactical/soldier.ts';
import { soldierInventoryContext } from '../tactical/soldier-inventory.ts';
import type { TacticalState } from '../tactical/state.ts';
import { addItemToPool, FORCE_ON_GROUND, Visibility } from '../tactical/world-items.ts';
import {
  deleteTalkingMenu,
  initiateConversationFull,
  npcHasUnusedRecordWithGivenApproach,
  npcWillingToAcceptItem,
  panelSoldier,
  sourceSoldierValidAndReachableForGive,
  talkerSoldier,
  triggerNpcWithGivenApproach,
} from './converse.ts';
import { soldierByProfile } from './dialogue-queue.ts';
import type { NarrativeHost } from './host.ts';

const NO_FLAGS = 0;
const GROUND_LEVEL = 0;
const GROUND_HEIGHT = 0;

function isMoney(items: ItemTable, item: number): boolean {
  return items.byIndex.get(item)?.itemClass === ItemClass.MONEY;
}

function moneyItem(items: ItemTable): number {
  return items.byName.get('MONEY')?.index ?? NOTHING;
}

function renumberAttachments(o: ItemObject): void {
  const kept = o.attachments.filter((a) => a.item !== NOTHING);
  o.attachments = Array.from({ length: MAX_ATTACHMENTS }, (_, k) => kept[k] ?? { item: NOTHING, status: 0 });
}

export function removeAttachment(items: ItemTable, o: ItemObject, pos: number): ItemObject | null {
  const a = o.attachments[pos];
  if (!a || a.item === NOTHING) return null;
  if ((items.byIndex.get(a.item)?.flags ?? 0) & ItemFlags.INSEPARABLE) return null;
  const removed = createItem(items, a.item, a.status);
  a.item = NOTHING;
  a.status = 0;
  if (items.byIndex.get(removed.item)?.name === 'UNDER_GLAUNCHER') {
    const grenade = o.attachments.findIndex((x) => items.byIndex.get(x.item)?.itemClass === ItemClass.GRENADE);
    const found = o.attachments[grenade];
    const slot = removed.attachments[0];
    if (found && slot) {
      slot.item = found.item;
      slot.status = found.status;
      found.item = NOTHING;
      found.status = 0;
    }
  }
  renumberAttachments(o);
  return removed;
}

function removeInvObject(s: Soldier, item: number): void {
  const pos = s.inv.findIndex((o) => o.item === item);
  const o = s.inv[pos];
  if (o) deleteObject(o);
}

export function removeObjectFromSoldierProfile(host: NarrativeHost, profile: number, item: number): boolean {
  if (item === NOTHING) return true;
  const p = host.profile(profile);
  let found = false;
  if (p) {
    const k = p.inventory.indexOf(item);
    if (k >= 0) {
      p.inventory[k] = NOTHING;
      p.inventoryStatus[k] = 0;
      p.inventoryCount[k] = 0;
      found = true;
    }
  }
  const s = soldierByProfile(host, profile);
  if (s) removeInvObject(s, item);
  return found;
}

function setMoneyInSoldierProfile(host: NarrativeHost, t: TacticalState, profile: number, money: number): void {
  const items = t.content.items;
  while (removeObjectFromSoldierProfile(host, profile, moneyItem(items))) {}
  const p = host.profile(profile);
  if (p) p.money = 0;
  if (money > 0) placeObjectInSoldierProfile(host, t, profile, createMoney(items, money));
}

function freeProfileSlot(p: ProfileProgress, s: Soldier | null): number {
  for (let k: number = InvSlot.BIGPOCK1; k < InvSlot.SMALLPOCK8; k++)
    if ((p.inventoryCount[k] ?? 0) === 0 && (!s || (s.inv[k]?.item ?? NOTHING) === NOTHING)) return k;
  return -1;
}

function dropMadlabAttachments(t: TacticalState, madlab: Soldier, object: ItemObject): void {
  for (let pos = MAX_ATTACHMENTS - 1; pos >= 0; pos--) {
    const removed = removeAttachment(t.content.items, object, pos);
    if (removed) addItemToPool(t, madlab.gridNo, removed, Visibility.VISIBLE, GROUND_LEVEL, NO_FLAGS, GROUND_HEIGHT);
  }
}

export function placeObjectInSoldierProfile(host: NarrativeHost, t: TacticalState, profile: number, object: ItemObject): boolean {
  const items = t.content.items;
  const p = host.profile(profile);
  if (!p) return false;
  let item = object.item;
  const status = object.status[0] ?? 0;
  const s = soldierByProfile(host, profile);
  if (isMoney(items, item) && p.money > 0) {
    p.money = u32(p.money + object.money);
    setMoneyInSoldierProfile(host, t, profile, p.money);
    return true;
  }
  const slot = freeProfileSlot(p, s);
  if (slot < 0) return false;
  if (isMoney(items, item)) {
    p.money = u32(p.money + object.money);
    item = moneyItem(items);
  } else {
    p.inventory[slot] = item;
    p.inventoryStatus[slot] = status;
    p.inventoryCount[slot] = object.count;
  }
  const target = s?.inv[slot];
  if (!s || !target) return true;
  if (item === moneyItem(items)) Object.assign(target, createMoney(items, p.money));
  else {
    if (s.profile === Npc.MADLAB) dropMadlabAttachments(t, s, object);
    Object.assign(target, createItem(items, item, status));
  }
  return true;
}

export function takeGivenObject(host: NarrativeHost, npc: number, object: ItemObject, giver: number): void {
  const t = host.tactical();
  if (!t) return;
  const ref = givenItemRef(t, object);
  placeObjectInSoldierProfile(host, t, npc, object);
  const from = giver === NO_PROFILE ? null : soldierByProfile(host, giver);
  if (giver !== NO_PROFILE && from?.team !== Team.OUR) removeObjectFromSoldierProfile(host, giver, object.item);
  host.emit({ type: 'npcTookItem', npc: soldierByProfile(host, npc)?.id ?? null, profile: npc, from: from?.id ?? null, ...ref });
}

export function returnItemToPlayer(host: NarrativeHost, merc: number, object: ItemObject): void {
  const t = host.tactical();
  const s = soldierByProfile(host, merc);
  if (!t || !s) return;
  const ref = givenItemRef(t, object);
  const copy = cloneObject(object);
  const placed = autoPlaceObject(soldierInventoryContext(t, s), s, copy);
  if (!placed) addItemToPool(t, s.gridNo, copy, Visibility.VISIBLE, s.level, NO_FLAGS, FORCE_ON_GROUND);
  host.emit({ type: 'itemReturned', to: s.id, ...ref, dropped: !placed });
}

export function handleNpcItemGiven(host: NarrativeHost, npc: number, slot: number): void {
  const t = host.tactical();
  if (!t || slot < 0 || slot >= NUM_INV_SLOTS) return;
  const dest = panelSoldier(host);
  const src = talkerSoldier(host);
  if (!dest || !src || !sourceSoldierValidAndReachableForGive(host, dest)) {
    const s = soldierByProfile(host, npc);
    const o = s?.inv[slot];
    if (!s || !o) return;
    addItemToPool(t, s.gridNo, cloneObject(o), Visibility.VISIBLE, GROUND_LEVEL, NO_FLAGS, GROUND_HEIGHT);
    host.emit({ type: 'npcGaveItem', npc: s.id, profile: npc, to: null, ...givenItemRef(t, o), dropped: true });
    triggerNpcWithGivenApproach(host, npc, Approach.DONE_GIVING_ITEM);
    return;
  }
  deleteTalkingMenu(host, 'script');
  const o = dest.inv[slot];
  if (o) soldierGiveItem(t, dest, src, o, slot);
}

export function dealerTakesGive(
  host: NarrativeHost,
  giver: Soldier,
  dealer: Soldier,
  object: ItemObject,
  slot: number,
  openShop: (dealer: number, giver: Soldier) => void,
): boolean {
  if (npcHasUnusedRecordWithGivenApproach(host, dealer.profile, Approach.BUYSELL)) {
    triggerNpcWithGivenApproach(host, dealer.profile, Approach.BUYSELL);
    return true;
  }
  if (npcWillingToAcceptItem(host, dealer.profile, giver.profile, object)) return false;
  openShop(dealer.profile, giver);
  const t = host.tactical();
  if (t && slot === NO_SLOT) autoPlaceObject(soldierInventoryContext(t, giver), giver, cloneObject(object));
  return true;
}

export function giveToNpc(host: NarrativeHost, giver: Soldier, target: Soldier, object: ItemObject): void {
  initiateConversationFull(host, target, giver, Approach.GIVINGITEM, 0, cloneObject(object), 'player');
}
