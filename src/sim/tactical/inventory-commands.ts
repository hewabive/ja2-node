// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Panels.cc CheckForDisabledForGiveItem, SetNewPanel (no panel for escorts and
// @src vehicles); Interface_Items.cc HandleItemPointerClick (the drop on the soldier's own tile), CancelItemPointer;
// @src Handle_Items.cc HandleItem (the medkit branch); Handle_UI.cc the medkit checks of the item cursor.
// @src See docs/04 §6.23, docs/12 §3–§5.

import { pythSpacesAway } from '../../content/world/grid.ts';
import type { CommandResult } from '../command.ts';
import type { ItemObject } from '../items/object.ts';
import { soldierTo3DLocationLos } from './combat/positions.ts';
import { autoReload } from './combat/reload.ts';
import { beginFirstAid, FirstAidRefusal, firstAidTargetRefusal } from './first-aid.ts';
import { handleTacticalEffectsOfEquipmentChange } from './hand-item.ts';
import { InvSlot, NUM_INV_SLOTS } from './inventory.ts';
import {
  applyItem,
  attachItem,
  type Count,
  detachItem,
  moveItem,
  type PanelEnv,
  type PanelOutcome,
  PanelRefusal,
  reloadWeapon,
  swapHands,
  unloadGun,
} from './inventory-panel.ts';
import { removePendingAction } from './pending-action.ts';
import { distanceVisible } from './perception/sight.ts';
import { Body, OKLIFE, type Soldier, Team } from './soldier.ts';
import { soldierInventoryContext } from './soldier-inventory.ts';
import { type TacticalState, teamMembers } from './state.ts';
import { addItemToPool, FORCE_ON_GROUND, Visibility } from './world-items.ts';

export interface InventoryCommand {
  readonly type: string;
  readonly [key: string]: unknown;
}

export const INVENTORY_COMMANDS: ReadonlySet<string> = new Set([
  'moveItem',
  'attach',
  'detach',
  'unload',
  'reload',
  'swapHands',
  'applyItem',
  'bandage',
]);

export const SLOT_NAMES: Readonly<Record<string, number>> = {
  helmet: InvSlot.HELMET,
  vest: InvSlot.VEST,
  legs: InvSlot.LEGS,
  head1: InvSlot.HEAD1,
  head2: InvSlot.HEAD2,
  hand: InvSlot.HAND,
  secondHand: InvSlot.SECOND_HAND,
  bigPocket1: InvSlot.BIGPOCK1,
  bigPocket2: InvSlot.BIGPOCK2,
  bigPocket3: InvSlot.BIGPOCK3,
  bigPocket4: InvSlot.BIGPOCK4,
  smallPocket1: InvSlot.SMALLPOCK1,
  smallPocket2: InvSlot.SMALLPOCK2,
  smallPocket3: InvSlot.SMALLPOCK3,
  smallPocket4: InvSlot.SMALLPOCK4,
  smallPocket5: InvSlot.SMALLPOCK5,
  smallPocket6: InvSlot.SMALLPOCK6,
  smallPocket7: InvSlot.SMALLPOCK7,
  smallPocket8: InvSlot.SMALLPOCK8,
};

export const InventoryRefusal = {
  ...PanelRefusal,
  BAD_SLOT: 'badSlot',
  BAD_COUNT: 'badCount',
  BAD_INDEX: 'badIndex',
  NO_SUCH_TARGET: 'noSuchTarget',
  NO_INVENTORY: 'noInventory',
  TOO_FAR: 'tooFar',
  NO_LINE_OF_SIGHT: 'noLineOfSight',
  ...FirstAidRefusal,
} as const;

export type InventoryRefusal = (typeof InventoryRefusal)[keyof typeof InventoryRefusal];

export const INVENTORY_REFUSAL_TEXT: Readonly<Record<InventoryRefusal, string>> = {
  emptySlot: 'that slot is empty',
  sameSlot: 'the item is already in that slot',
  nailsVest: 'Nails will not take off his leather jacket',
  notEnoughAP: 'not enough APs',
  useAttach: 'the item attaches to the one in that slot: use attach',
  mergePrompt: 'the two items can be merged: repeat with merge true to merge them or merge false to swap them',
  doesNotFit: 'the item does not fit into that slot',
  noRoom: 'no free pocket for the item',
  cannotAttach: 'the item cannot be attached to or merged with that item',
  permanentAttachment: 'this attachment cannot be removed again: repeat with permanent true to attach it',
  noAttachment: 'there is no attachment at that position',
  inseparable: 'that attachment cannot be removed',
  notAGun: 'that slot holds no gun or launcher',
  gunEmpty: 'the gun is not loaded',
  wrongAmmo: 'that ammunition does not fit the weapon',
  noAmmo: 'no matching ammunition in the inventory',
  cannotReload: 'the weapon cannot be reloaded with that',
  robot: 'the robot cannot do that',
  unconsciousTarget: 'the target is unconscious',
  cannotApply: 'that item cannot be applied',
  notPorted: 'drugs and alcohol are not simulated yet',
  badSlot: 'slot must be 0..18 or a slot name such as hand, secondHand, head1, bigPocket1, smallPocket1',
  badCount: 'count must be 1 or "all"',
  badIndex: 'index must point to an object in the stack',
  noSuchTarget: 'no such soldier of yours in the sector',
  noInventory: 'that soldier has no inventory panel (escort or vehicle)',
  tooFar: 'the other merc must stand within 3 tiles (2 when unconscious)',
  noLineOfSight: 'the other merc cannot be seen from here',
  noKit: 'put a first aid kit or medical kit into the hand first',
  noTarget: 'nobody to bandage there',
  mechanical: 'vehicles and the robot cannot be bandaged',
  noMedicalSkill: 'the merc has no medical skill',
  notBleeding: 'the patient is not bleeding: first aid only stops bleeding',
  noNeed: 'the patient needs no first aid',
  cannotGetThere: 'cannot get next to the patient',
};

const PASSING_ITEM_DISTANCE_OKLIFE = 3;
const PASSING_ITEM_DISTANCE_NOTOKLIFE = 2;
const LOS_CUBE_LEVEL = 3;
const IRRELEVANT = -1;

export function parseSlot(value: unknown): number | null {
  if (typeof value === 'string') return SLOT_NAMES[value] ?? null;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < NUM_INV_SLOTS ? value : null;
}

export function parseCount(value: unknown, fallback: Count): Count | null {
  if (value === undefined) return fallback;
  if (value === 'all') return 'all';
  return value === 1 ? 1 : null;
}

export function refusal(code: InventoryRefusal): CommandResult {
  return { ok: false, reason: `${code}: ${INVENTORY_REFUSAL_TEXT[code]}`, data: { refusal: code } };
}

export function outcomeResult(outcome: PanelOutcome): CommandResult {
  if (!outcome.ok) return refusal(outcome.refusal);
  return outcome.data ? { ok: true, data: outcome.data } : { ok: true };
}

const isVehicle = (s: Soldier) => s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP;
const isMechanical = (s: Soldier) => isVehicle(s) || s.bodyType === Body.ROBOTNOWEAPON;

export function tacticalPanelEnv(t: TacticalState): PanelEnv {
  return {
    items: t.content.items,
    combat: t,
    inCombat: t.inCombat,
    mapScreen: false,
    context: (s) => soldierInventoryContext(t, s),
    equipmentChanged: (s, slot, oldItem, newItem) => handleTacticalEffectsOfEquipmentChange(t, s, slot, oldItem, newItem),
    leftover: (s: Soldier, o: ItemObject) => {
      addItemToPool(t, s.gridNo, o, Visibility.VISIBLE, s.level, 0, FORCE_ON_GROUND);
    },
    emit: (event) => {
      t.events.push(event);
    },
  };
}

function seesTile(t: TacticalState, viewer: Soldier, target: Soldier): boolean {
  const range = distanceVisible(t, viewer, IRRELEVANT, IRRELEVANT, target.gridNo, target.level);
  return soldierTo3DLocationLos(t, viewer, target.gridNo, target.level, LOS_CUBE_LEVEL, range, true) > 0;
}

function panelRangeRefusal(t: TacticalState, holder: Soldier, target: Soldier): InventoryRefusal | null {
  if (holder === target) return null;
  if (target.life < OKLIFE) {
    const helper = teamMembers(t, Team.OUR).some(
      (m) =>
        m.life >= OKLIFE &&
        !isMechanical(m) &&
        pythSpacesAway(target.gridNo, m.gridNo) <= PASSING_ITEM_DISTANCE_NOTOKLIFE &&
        seesTile(t, m, target),
    );
    return helper ? null : InventoryRefusal.TOO_FAR;
  }
  if (!seesTile(t, holder, target)) return InventoryRefusal.NO_LINE_OF_SIGHT;
  return pythSpacesAway(holder.gridNo, target.gridNo) <= PASSING_ITEM_DISTANCE_OKLIFE ? null : InventoryRefusal.TOO_FAR;
}

function otherMerc(t: TacticalState, value: unknown, fallback: Soldier): Soldier | InventoryRefusal {
  if (value === undefined) return fallback;
  const s = typeof value === 'number' ? t.soldiers[value] : undefined;
  if (!s?.placed || s.team !== Team.OUR || s.life <= 0) return InventoryRefusal.NO_SUCH_TARGET;
  if (t.narrative.isEpc(s) || isVehicle(s)) return InventoryRefusal.NO_INVENTORY;
  return s;
}

function panelTarget(t: TacticalState, s: Soldier, value: unknown): Soldier | InventoryRefusal {
  const target = otherMerc(t, value, s);
  if (typeof target === 'string') return target;
  return panelRangeRefusal(t, s, target) ?? target;
}

function optionalSlot(value: unknown): number | null | InventoryRefusal {
  if (value === undefined) return null;
  return parseSlot(value) ?? InventoryRefusal.BAD_SLOT;
}

function stackIndex(value: unknown, o: ItemObject | undefined): number | InventoryRefusal {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= Math.max(1, o?.count ?? 0))
    return InventoryRefusal.BAD_INDEX;
  return value;
}

function moveCommand(t: TacticalState, s: Soldier, cmd: InventoryCommand): CommandResult {
  const from = parseSlot(cmd.from);
  const to = parseSlot(cmd.to);
  if (from === null || to === null) return refusal(InventoryRefusal.BAD_SLOT);
  const count = parseCount(cmd.count, 'all');
  if (count === null) return refusal(InventoryRefusal.BAD_COUNT);
  const index = stackIndex(cmd.index, s.inv[from]);
  if (typeof index === 'string') return refusal(index);
  const target = panelTarget(t, s, cmd.toSoldier);
  if (typeof target === 'string') return refusal(target);
  const merge = typeof cmd.merge === 'boolean' ? cmd.merge : undefined;
  return outcomeResult(moveItem(tacticalPanelEnv(t), { mover: s, from, target, to, count, index, merge }));
}

function attachCommand(t: TacticalState, s: Soldier, cmd: InventoryCommand): CommandResult {
  const from = parseSlot(cmd.item);
  const slot = parseSlot(cmd.to);
  if (from === null || slot === null) return refusal(InventoryRefusal.BAD_SLOT);
  const count = parseCount(cmd.count, 1);
  if (count === null) return refusal(InventoryRefusal.BAD_COUNT);
  const owner = panelTarget(t, s, cmd.toSoldier);
  if (typeof owner === 'string') return refusal(owner);
  const index = stackIndex(cmd.index, owner.inv[slot]);
  if (typeof index === 'string') return refusal(index);
  const env = tacticalPanelEnv(t);
  return outcomeResult(attachItem(env, { attacher: s, from, owner, slot, index, count, permanent: cmd.permanent === true }));
}

function attachmentPosition(t: TacticalState, o: ItemObject | undefined, value: unknown): number | InventoryRefusal {
  if (typeof value === 'string') {
    const item = t.content.items.byName.get(value)?.index;
    const position = o?.attachments.findIndex((a) => a.item === item) ?? -1;
    return position >= 0 ? position : InventoryRefusal.NO_ATTACHMENT;
  }
  if (value === undefined) return 0;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 4 ? value : InventoryRefusal.NO_ATTACHMENT;
}

function detachCommand(t: TacticalState, s: Soldier, cmd: InventoryCommand): CommandResult {
  const slot = parseSlot(cmd.slot);
  if (slot === null) return refusal(InventoryRefusal.BAD_SLOT);
  const to = optionalSlot(cmd.to);
  if (typeof to === 'string') return refusal(to);
  const position = attachmentPosition(t, s.inv[slot], cmd.attachment);
  if (typeof position === 'string') return refusal(position);
  return outcomeResult(detachItem(tacticalPanelEnv(t), s, slot, position, to));
}

function unloadCommand(t: TacticalState, s: Soldier, cmd: InventoryCommand): CommandResult {
  const slot = cmd.slot === undefined ? InvSlot.HAND : parseSlot(cmd.slot);
  if (slot === null) return refusal(InventoryRefusal.BAD_SLOT);
  const to = optionalSlot(cmd.to);
  if (typeof to === 'string') return refusal(to);
  return outcomeResult(unloadGun(tacticalPanelEnv(t), s, slot, to));
}

function reloadCommand(t: TacticalState, s: Soldier, cmd: InventoryCommand): CommandResult {
  const slot = cmd.slot === undefined ? InvSlot.HAND : parseSlot(cmd.slot);
  if (slot === null) return refusal(InventoryRefusal.BAD_SLOT);
  const ammo = optionalSlot(cmd.ammo);
  if (typeof ammo === 'string') return refusal(ammo);
  const env = tacticalPanelEnv(t);
  return outcomeResult(reloadWeapon(env, s, slot, ammo, (soldier) => autoReload(soldierInventoryContext(t, soldier), soldier)));
}

function applyCommand(t: TacticalState, s: Soldier, cmd: InventoryCommand): CommandResult {
  const slot = parseSlot(cmd.slot);
  if (slot === null) return refusal(InventoryRefusal.BAD_SLOT);
  const target = panelTarget(t, s, cmd.target);
  if (typeof target === 'string') return refusal(target);
  return outcomeResult(applyItem(tacticalPanelEnv(t), s, slot, target));
}

function bandageCommand(t: TacticalState, s: Soldier, cmd: InventoryCommand): CommandResult {
  const patient = typeof cmd.target === 'number' ? (t.soldiers[cmd.target] ?? null) : s;
  const target = patient?.placed && patient.level === s.level ? patient : null;
  const refused = firstAidTargetRefusal(t, s, target);
  if (refused) return refusal(refused);
  removePendingAction(t, s);
  const started = beginFirstAid(t, s, (target as Soldier).gridNo);
  if (started) return refusal(started);
  return { ok: true, data: s.pendingAid ? { walking: true } : { started: true } };
}

export function dispatchInventoryCommand(t: TacticalState, s: Soldier, cmd: InventoryCommand): CommandResult {
  switch (cmd.type) {
    case 'moveItem':
      return moveCommand(t, s, cmd);
    case 'attach':
      return attachCommand(t, s, cmd);
    case 'detach':
      return detachCommand(t, s, cmd);
    case 'unload':
      return unloadCommand(t, s, cmd);
    case 'reload':
      return reloadCommand(t, s, cmd);
    case 'swapHands':
      return outcomeResult(swapHands(tacticalPanelEnv(t), t, s));
    case 'applyItem':
      return applyCommand(t, s, cmd);
    default:
      return bandageCommand(t, s, cmd);
  }
}
