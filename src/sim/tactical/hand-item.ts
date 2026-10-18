// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc ReLoadSoldierAnimationDueToHandItemChange, IsRifle;
// @src Interface_Panels.cc HandleTacticalEffectsOfEquipmentChange; Weapons.cc EnsureConsistentWeaponMode,
// @src IsGunBurstCapable, HasLauncher; Items.cc SwapHandItems, FindLaunchableAttachment. See docs/12 §3.4.

import { AnimFlags } from '../../content/anim/tables.ts';
import { ItemClass, ItemFlags, type ItemTable, NOTHING } from '../../content/items/items.ts';
import { validLaunchable } from '../../content/items/rules.ts';
import { findAttachment, type ItemObject, swapObjects } from '../items/object.ts';
import { anim } from './anim-states.ts';
import { AnimHeight, endHeight, hasAnimFlag, initNewSoldierAnim, soldierGotoStationaryStance } from './animation.ts';
import { WeaponMode } from './combat/types.ts';
import { givingSoldierCancelServices } from './first-aid.ts';
import { autoPlaceObjectExcluding, type InventoryContext, InvSlot, itemIn } from './inventory.ts';
import type { Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';

function isRifle(items: ItemTable, item: number): boolean {
  if (item === NOTHING || item === (items.byName.get('ROCKET_LAUNCHER')?.index ?? -2)) return false;
  const def = items.byIndex.get(item);
  return def?.itemClass === ItemClass.GUN && (def.flags & ItemFlags.TWO_HANDED) !== 0;
}

function isGunBurstCapable(items: ItemTable, s: Soldier, slot: number): boolean {
  return (items.byIndex.get(itemIn(s.inv, slot))?.weapon?.shotsPerBurst ?? 0) > 0;
}

function hasLauncher(items: ItemTable, s: Soldier): boolean {
  const hand = s.inv[InvSlot.HAND] as ItemObject;
  const ugl = items.byName.get('UNDER_GLAUNCHER')?.index ?? -2;
  return findAttachment(hand, ugl) !== -1 && hand.attachments.some((a) => a.item !== NOTHING && validLaunchable(items, a.item, ugl));
}

export function ensureConsistentWeaponMode(items: ItemTable, s: Soldier): void {
  if (s.weaponMode === WeaponMode.BURST && !isGunBurstCapable(items, s, InvSlot.HAND)) s.weaponMode = WeaponMode.NORMAL;
  else if (s.weaponMode === WeaponMode.ATTACHED && !hasLauncher(items, s)) s.weaponMode = WeaponMode.NORMAL;
  s.doBurst = s.weaponMode === WeaponMode.BURST ? 1 : 0;
}

export function reloadSoldierAnimationDueToHandItemChange(t: TacticalState, s: Soldier, oldItem: number, newItem: number): void {
  const items = t.content.items;
  const weapon = items.byIndex.get(newItem)?.weapon;
  if (weapon && weapon.shotsPerBurst === 0) {
    s.doBurst = 0;
    s.weaponMode = WeaponMode.NORMAL;
  }
  if (hasAnimFlag(t.content, s.state, AnimFlags.FIREREADY)) soldierGotoStationaryStance(t, s);
  givingSoldierCancelServices(t, s);
  if (endHeight(t.content, s.state) !== AnimHeight.STAND) return;
  const oldRifle = isRifle(items, oldItem);
  const newRifle = isRifle(items, newItem);
  if (oldRifle && !newRifle) initNewSoldierAnim(t, s, anim(t.content, 'LOWER_RIFLE'), 0, false);
  else if (!oldRifle && newRifle) initNewSoldierAnim(t, s, anim(t.content, 'RAISE_RIFLE'), 0, false);
}

export function handleTacticalEffectsOfEquipmentChange(t: TacticalState, s: Soldier, slot: number, oldItem: number, newItem: number): void {
  const items = t.content.items;
  const hand = s.inv[InvSlot.HAND] as ItemObject;
  if (s.weaponMode === WeaponMode.ATTACHED && findAttachment(hand, items.byName.get('UNDER_GLAUNCHER')?.index ?? -2) === -1) {
    s.weaponMode = WeaponMode.NORMAL;
    s.doBurst = 0;
  }
  if (!s.placed) return;
  if (slot === InvSlot.HAND || slot === InvSlot.SECOND_HAND) reloadSoldierAnimationDueToHandItemChange(t, s, oldItem, newItem);
}

export function swapHandItems(ctx: InventoryContext, s: Soldier): boolean {
  const hand = s.inv[InvSlot.HAND] as ItemObject;
  const second = s.inv[InvSlot.SECOND_HAND] as ItemObject;
  if (hand.item === NOTHING || second.item === NOTHING) {
    swapObjects(hand, second);
    return true;
  }
  const secondTwoHanded = ((ctx.items.byIndex.get(second.item)?.flags ?? 0) & ItemFlags.TWO_HANDED) !== 0;
  if (secondTwoHanded && !autoPlaceObjectExcluding(ctx, s, hand, InvSlot.HAND)) return false;
  swapObjects(hand, second);
  return true;
}
