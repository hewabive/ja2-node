// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Items.cc InternalInitItemDescriptionBox (gpAttachSoldier: the cursor's holder, else
// @src the box's merc; the attachments the item had), DeleteItemDescriptionBox (AP_RELOAD_GUN to gpAttachSoldier once,
// @src in combat, when an original attachment is missing or a new one is there, item and status in any position; the
// @src same box on the map screen, MapScreen.cc MAPInternalInitItemDescriptionBox, with INCOMBAT for any merc, 2026-11-16).

import { NOTHING } from '../../content/items/items.ts';
import type { ItemObject } from '../items/object.ts';
import { AP_RELOAD_GUN } from './inventory.ts';
import { type BreathRules, deductPoints } from './points.ts';
import type { Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';

export interface AttachedPair {
  readonly item: number;
  readonly status: number;
}

export type AttachmentSnapshot = readonly AttachedPair[];

export interface ItemDescriptionSession {
  readonly soldier: number;
  readonly slot: number;
  readonly payer: number;
  readonly attachments: AttachmentSnapshot;
}

export interface ItemDescriptionHolder {
  itemDescription: ItemDescriptionSession | null;
}

export interface ItemDescriptionWorld extends BreathRules {
  soldier(id: number): Soldier | null | undefined;
}

export interface ItemDescriptionBox {
  holds(holder: Soldier, owner: Soldier, slot: number): boolean;
  open(owner: Soldier, slot: number, payer: Soldier): void;
  close(): number;
}

export function attachmentSnapshot(o: ItemObject | undefined): AttachmentSnapshot {
  return (o?.attachments ?? []).map((a) => ({ item: a.item, status: a.status }));
}

function allFoundIn(from: AttachmentSnapshot, within: AttachmentSnapshot): boolean {
  return from.every((a) => a.item === NOTHING || within.some((b) => b.item === a.item && b.status === a.status));
}

export function attachmentsChanged(before: AttachmentSnapshot, after: AttachmentSnapshot): boolean {
  return !allFoundIn(before, after) || !allFoundIn(after, before);
}

function closeSession(holder: ItemDescriptionHolder, world: ItemDescriptionWorld): number {
  const box = holder.itemDescription;
  if (!box) return 0;
  holder.itemDescription = null;
  const owner = world.soldier(box.soldier);
  const payer = world.soldier(box.payer);
  if (!world.inCombat || !owner || !payer) return 0;
  if (!attachmentsChanged(box.attachments, attachmentSnapshot(owner.inv[box.slot]))) return 0;
  const before = payer.actionPoints;
  deductPoints(world, payer, AP_RELOAD_GUN, 0);
  return before - payer.actionPoints;
}

function sessionHolds(box: ItemDescriptionSession | null, holder: Soldier, owner: Soldier, slot: number): boolean {
  return box !== null && box.soldier === owner.id && box.slot === slot && (holder.id === box.payer || holder.id === box.soldier);
}

export function itemDescriptionBox(holder: ItemDescriptionHolder, world: ItemDescriptionWorld): ItemDescriptionBox {
  const close = () => closeSession(holder, world);
  return {
    holds: (s, owner, slot) => sessionHolds(holder.itemDescription, s, owner, slot),
    open: (owner, slot, payer) => {
      close();
      holder.itemDescription = { soldier: owner.id, slot, payer: payer.id, attachments: attachmentSnapshot(owner.inv[slot]) };
    },
    close,
  };
}

export function tacticalItemDescriptionBox(t: TacticalState): ItemDescriptionBox {
  return itemDescriptionBox(t, { inCombat: t.inCombat, content: t.content, soldier: (id) => t.soldiers[id] });
}

export function openItemDescriptionBox(t: TacticalState, owner: Soldier, slot: number, payer: Soldier): void {
  tacticalItemDescriptionBox(t).open(owner, slot, payer);
}

export function closeItemDescriptionBox(t: TacticalState): number {
  return tacticalItemDescriptionBox(t).close();
}

export function itemDescriptionBoxHolds(t: TacticalState, holder: Soldier, owner: Soldier, slot: number): boolean {
  return tacticalItemDescriptionBox(t).holds(holder, owner, slot);
}
