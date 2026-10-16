// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Points.cc CalcAPsToBurst, CalcTotalAPsToAttack, MinAPsToAttack, CalcAimSkill, BaseAPsToShootOrStab,
// @src GetAPChargeForShootOrStabWRTGunRaises, MinAPsToShootOrStab, EnoughAmmo. See docs/11 §1.5.

import { AnimFlags } from '../../../content/anim/tables.ts';
import { ItemClass, NOTHING } from '../../../content/items/items.ts';
import { findAttachment, findAttachmentByClass, type ItemObject } from '../../items/object.ts';
import { AnimHeight, hasAnimFlag, height } from '../animation.ts';
import { InvSlot, isValidSecondHandShot } from '../inventory.ts';
import { directionToward } from '../movement.ts';
import { AP, AP_LIMITS, apsToChangeStance, apsToLook, apsToReadyWeapon, calcActionPoints } from '../points.ts';
import { effectiveAgility, effectiveDexterity, effectiveMarksmanship } from '../skills.ts';
import { Body, NOWHERE, type Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { WeaponMode } from './types.ts';

const itemIndex = (t: TacticalState, name: string) => t.content.items.byName.get(name)?.index ?? -2;
const isRobot = (s: Soldier) => s.bodyType === Body.ROBOTNOWEAPON;

export function calcAPsToBurst(t: TacticalState, baseAPs: number, o: ItemObject): number {
  if (o.item === itemIndex(t, 'G11')) return 1;
  const base = Math.max(3, Math.trunc((AP.BURST * baseAPs + (AP_LIMITS.MAXIMUM - 1)) / AP_LIMITS.MAXIMUM));
  const spring = findAttachment(o, itemIndex(t, 'SPRING_AND_BOLT_UPGRADE'));
  if (spring === -1) return base;
  return Math.trunc((base * 100) / (100 + Math.trunc((o.attachments[spring]?.status ?? 0) / 5))) & 0xff;
}

function aimSkill(t: TacticalState, s: Soldier, item: number): number {
  const cls = t.content.items.byIndex.get(item)?.itemClass ?? 0;
  if (cls === ItemClass.GUN || cls === ItemClass.LAUNCHER) return effectiveMarksmanship(s);
  return Math.trunc((effectiveDexterity(s) + effectiveAgility(s)) / 2);
}

export function baseAPsToShootOrStab(t: TacticalState, aps: number, skill: number, o: ItemObject): number {
  const top = 2 * aps;
  const rate = t.content.items.byIndex.get(o.item)?.weapon?.shotsPer4Turns ?? 0;
  let bottom = Math.trunc(((50 + Math.trunc(skill / 2)) * rate) / 4);
  const spring = findAttachment(o, itemIndex(t, 'SPRING_AND_BOLT_UPGRADE'));
  if (spring !== -1) bottom = Math.trunc((bottom * (100 + Math.trunc((o.attachments[spring]?.status ?? 0) / 5))) / 100);
  return Math.trunc((Math.trunc((100 * top) / bottom) + 1) / 2) & 0xff;
}

export function apChargeForShootOrStab(
  t: TacticalState,
  s: Soldier,
  g: number,
  addTurning: boolean,
  afterMoving: boolean,
): { turning: boolean; raise: boolean } {
  let turning = false;
  if (addTurning) turning = g !== NOWHERE ? directionToward(s.gridNo, g) !== s.direction : true;
  const hand = t.content.items.byIndex.get(s.inv[InvSlot.HAND]?.item ?? NOTHING);
  const raise =
    hand?.itemClass !== ItemClass.THROWING_KNIFE && (afterMoving || !hasAnimFlag(t.content, s.state, AnimFlags.FIREREADY | AnimFlags.FIRE));
  return { turning, raise };
}

export function minAPsToShootOrStab(t: TacticalState, s: Soldier, g: number, addTurning: boolean, afterMoving = false): number {
  const items = t.content.items;
  const inHand = s.inv[InvSlot.HAND] as ItemObject;
  const item = s.weaponMode === WeaponMode.ATTACHED ? itemIndex(t, 'UNDER_GLAUNCHER') : inHand.item;
  const charge = apChargeForShootOrStab(t, s, g, addTurning, afterMoving);
  let turning = charge.turning;
  let raise = charge.raise;
  let cost = AP.MIN_AIM_ATTACK;
  const cls = items.byIndex.get(item)?.itemClass ?? 0;
  const rocketLauncher = item === itemIndex(t, 'ROCKET_LAUNCHER');
  if (cls === ItemClass.THROWING_KNIFE || rocketLauncher) cost += apsToChangeStance(t.content, s, AnimHeight.STAND);
  if (height(t.content, s.state) === AnimHeight.STAND) {
    if (raise) turning = false;
  } else if (turning) raise = false;
  if (isRobot(s)) raise = false;
  if (turning) cost += cls === ItemClass.THROWING_KNIFE ? AP.LOOK_STANDING : apsToLook(t.content, s);
  if (raise) {
    cost += apsToReadyWeapon(t.content, s);
    if (!afterMoving) s.dontChargeReadyAPs = false;
  }
  if (g !== s.lastTarget && !rocketLauncher) cost += AP.CHANGE_TARGET;
  const full = calcActionPoints(t.content, s);
  const skill = aimSkill(t, s, item);
  if (s.weaponMode === WeaponMode.ATTACHED) {
    const slot = findAttachment(inHand, itemIndex(t, 'UNDER_GLAUNCHER'));
    const launcher: ItemObject = {
      ...inHand,
      item: itemIndex(t, 'UNDER_GLAUNCHER'),
      status: [slot !== -1 ? (inHand.attachments[slot]?.status ?? 100) : 100],
    };
    cost += baseAPsToShootOrStab(t, full, skill, launcher);
  } else if (isValidSecondHandShot(items, s)) {
    cost += Math.max(
      baseAPsToShootOrStab(t, full, skill, inHand),
      baseAPsToShootOrStab(t, full, skill, s.inv[InvSlot.SECOND_HAND] as ItemObject),
    );
  } else cost += baseAPsToShootOrStab(t, full, skill, inHand);
  return Math.min(Math.max(cost, 1), full > 0 ? full : 1);
}

export function minAPsToAttack(t: TacticalState, s: Soldier, g: number, addTurning: boolean, afterMoving = false): number {
  const inHand = s.inv[InvSlot.HAND] as ItemObject;
  let item = inHand.item;
  if (s.weaponMode === WeaponMode.ATTACHED && findAttachment(inHand, itemIndex(t, 'UNDER_GLAUNCHER')) !== -1)
    item = itemIndex(t, 'UNDER_GLAUNCHER');
  switch (t.content.items.byIndex.get(item)?.itemClass ?? ItemClass.NONE) {
    case ItemClass.BLADE:
    case ItemClass.GUN:
    case ItemClass.LAUNCHER:
    case ItemClass.TENTACLES:
    case ItemClass.THROWING_KNIFE:
      return minAPsToShootOrStab(t, s, g, addTurning, afterMoving);
    default:
      return 0;
  }
}

export function calcTotalAPsToAttack(t: TacticalState, s: Soldier, g: number, addTurning: boolean, aimTime: number): number {
  const inHand = s.inv[InvSlot.HAND] as ItemObject;
  switch (t.content.items.byIndex.get(inHand.item)?.itemClass ?? ItemClass.NONE) {
    case ItemClass.GUN:
    case ItemClass.LAUNCHER:
    case ItemClass.TENTACLES:
    case ItemClass.THROWING_KNIFE:
      return (
        (minAPsToAttack(t, s, g, addTurning) +
          (s.doBurst ? calcAPsToBurst(t, calcActionPoints(t.content, s), inHand) : s.weaponMode === WeaponMode.ATTACHED ? 0 : aimTime)) &
        0xff
      );
    case ItemClass.GRENADE:
    case ItemClass.BOMB:
      return 5;
    default:
      return 0;
  }
}

export function enoughAmmo(t: TacticalState, s: Soldier, slot: number): boolean {
  const o = s.inv[slot] as ItemObject;
  if (o.item === NOTHING) return false;
  if (s.weaponMode === WeaponMode.ATTACHED) return true;
  if (o.item === itemIndex(t, 'ROCKET_LAUNCHER')) return true;
  const def = t.content.items.byIndex.get(o.item);
  if (def?.itemClass === ItemClass.LAUNCHER || o.item === itemIndex(t, 'TANK_CANNON')) {
    if (findAttachmentByClass(t.content.items, o, ItemClass.GRENADE) !== -1) return true;
    if (findAttachmentByClass(t.content.items, o, ItemClass.BOMB) !== -1) return true;
    return false;
  }
  if (def?.itemClass === ItemClass.GUN) return o.gunShotsLeft !== 0;
  return true;
}
