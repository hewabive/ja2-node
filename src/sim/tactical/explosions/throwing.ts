// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Points.cc MinAPsToThrow, DeductAmmo (launchers); Weapons.cc CalcMaxTossRange,
// @src CalcThrownChanceToHit, UseThrown, UseLauncher, WillExplosiveWeaponFail; Items.cc GetLauncherFromLaunchable,
// @src RemoveAttachment; Handle_Items.cc HandleSoldierThrowItem; Soldier_Ani.cc opcodes 460/461.

import type { OpOutcome } from '../../../content/anim/script.ts';
import { ItemClass, ItemFlags, NOTHING } from '../../../content/items/items.ts';
import { DIRECTION_INCREMENT, newGridNo, pythSpacesAway } from '../../../content/world/grid.ts';
import { clamp, i8, idiv } from '../../../core/int.ts';
import { createItem, findAttachmentByClass, type ItemObject, removeObjects } from '../../items/object.ts';
import { anim } from '../anim-states.ts';
import { AnimHeight, changeSoldierState, height, setDesiredDirection, soldierGotoStationaryStance } from '../animation.ts';
import { enoughAmmo, minAPsToAttack, minAPsToThrow } from '../combat/ap.ts';
import { reduceAttackBusyCount } from '../combat/barrier.ts';
import { rangeInUnits } from '../combat/chance.ts';
import { StatCause, statChange } from '../combat/experience.ts';
import { Aim, CTH_MAXIMUM, CTH_MINIMUM, WeaponMode, weaponStatusMod } from '../combat/types.ts';
import { findObjWithin, InvSlot, NUM_INV_SLOTS, wearsHeadGear } from '../inventory.ts';
import { lightTrueLevel, NORMAL_LIGHTLEVEL_DAY } from '../lighting/lighting.ts';
import { directionToward } from '../movement.ts';
import { deductPoints } from '../points.ts';
import { StatKind } from '../profiles.ts';
import {
  effectiveDexterity,
  effectiveExpLevel,
  effectiveLife,
  effectiveMarksmanship,
  effectiveStrength,
  effectiveWisdom,
  moraleModifier,
  skillCheckFatiguePenalty,
} from '../skills.ts';
import { numSkillTraits, SKILL_TRAIT_BONUS, SkillTrait, type Soldier, Team } from '../soldier.ts';
import { type TacticalState, whoIsThere } from '../state.ts';
import { addItemToPool, FORCE_ON_GROUND, Visibility } from '../world-items.ts';
import { igniteExplosion } from './explosion.ts';
import { createPhysicalObject, HEIGHT_UNITS } from './physics.ts';
import { isGassed } from './smoke.ts';
import { type RealObject, ThrowAction, type ThrowParams } from './state.ts';
import { calculateLaunchItemParamsForThrow } from './trajectory.ts';
import { vec3 } from './vec3.ts';

const MIN_MORTAR_RANGE = 150;
const MIN_LOB_RANGE = 6;
const AP_TOSS_ITEM = 8;
const FAILURE_DICE = 40;
const THROWING_BONUS = SKILL_TRAIT_BONUS[SkillTrait.THROWING] ?? 0;
const HEAVY_WEAPONS_BONUS = SKILL_TRAIT_BONUS[SkillTrait.HEAVY_WEAPS] ?? 0;

export interface ThrowRoll {
  readonly chance: number;
  readonly roll: number;
}

const itemIndex = (t: TacticalState, name: string) => t.content.items.byName.get(name)?.index ?? -2;
const itemDef = (t: TacticalState, item: number) => t.content.items.byIndex.get(item);

export function launcherOf(t: TacticalState, launchable: number): number {
  const calibre = itemDef(t, launchable)?.explosive?.calibre;
  if (!calibre) return NOTHING;
  for (const w of t.content.items.ordered) if (w.weapon?.explosiveCalibre === calibre) return w.index;
  return NOTHING;
}

function isExplosiveGun(t: TacticalState, item: number): boolean {
  return item === itemIndex(t, 'ROCKET_LAUNCHER') || item === itemIndex(t, 'TANK_CANNON');
}

export function calcMaxTossRange(t: TacticalState, s: Soldier, itemIn: number, armed: boolean): number {
  if (isExplosiveGun(t, itemIn)) return idiv(itemDef(t, itemIn)?.weapon?.range ?? 0, 10);
  const launcher = launcherOf(t, itemIn);
  const item = armed && launcher !== NOTHING ? launcher : itemIn;
  const def = itemDef(t, item);
  let range: number;
  if (def?.itemClass === ItemClass.LAUNCHER && armed) range = idiv(def.weapon?.range ?? 0, 10);
  else {
    const weight = def?.weight ?? 0;
    if ((def?.flags ?? 0) & ItemFlags.UNAERODYNAMIC) range = 1;
    else if (def?.itemClass === ItemClass.GRENADE)
      range = 2 + idiv(idiv(effectiveStrength(s) * 2 + 100, 3), Math.min(3 + idiv(weight, 3), 4));
    else range = 2 + idiv(effectiveStrength(s), 5 + weight);
    range -= idiv(range * (100 - s.breath), 200);
    range = idiv(range * (100 + THROWING_BONUS * numSkillTraits(s, SkillTrait.THROWING)), 100);
  }
  return Math.max(range, 1);
}

function handItem(t: TacticalState, s: Soldier): number {
  return s.weaponMode === WeaponMode.ATTACHED ? itemIndex(t, 'UNDER_GLAUNCHER') : (s.inv[InvSlot.HAND]?.item ?? NOTHING);
}

function baseThrownChance(s: Soldier, mechanical: boolean): number {
  if (!mechanical)
    return idiv(effectiveDexterity(s) + effectiveMarksmanship(s), 2) + THROWING_BONUS * numSkillTraits(s, SkillTrait.THROWING);
  return (
    idiv(effectiveDexterity(s) + effectiveMarksmanship(s) + effectiveWisdom(s) + 10 * effectiveExpLevel(s), 4) +
    HEAVY_WEAPONS_BONUS * numSkillTraits(s, SkillTrait.HEAVY_WEAPS)
  );
}

export function calcThrownChanceToHit(t: TacticalState, s: Soldier, g: number, aimTime: number): number {
  const hand = handItem(t, s);
  const launcher = itemDef(t, hand)?.itemClass === ItemClass.LAUNCHER;
  let c = baseThrownChance(s, launcher || s.weaponMode === WeaponMode.ATTACHED);
  c += moraleModifier(s);
  c -= skillCheckFatiguePenalty(s, c);
  if (g === s.lastTarget) c += Aim.BONUS_SAME_TARGET;
  if (aimTime) c += Aim.BONUS_PER_AP * aimTime;
  if (isGassed(t, s)) c -= Aim.PENALTY_GASSED;
  if (s.serviceCount > 0) c -= Aim.PENALTY_GETTINGAID;
  if (s.shock) c -= s.shock * Aim.PENALTY_PER_SHOCK;
  let range = rangeInUnits(s.gridNo, g);
  if (wearsHeadGear(s.inv, itemIndex(t, 'SUNGOGGLES')) && lightTrueLevel(t, g, s.targetLevel) < NORMAL_LIGHTLEVEL_DAY)
    range -= idiv(range, 10);
  if (hand === itemIndex(t, 'MORTAR') && range < MIN_MORTAR_RANGE) return 0;
  const maxRange = calcMaxTossRange(t, s, hand, true) * 10;
  c += idiv(50 * 2 * (idiv(maxRange, 2) - range), maxRange);
  if (range > maxRange) c = idiv(c, 2);
  if (c > 0 && s.life < s.lifeMax) {
    let penalty = i8(idiv(2 * c * (s.lifeMax - effectiveLife(s)), 3 * s.lifeMax));
    if (launcher) penalty = idiv(penalty, 2);
    c -= idiv(penalty * (100 - 10 * (effectiveExpLevel(s) - 1)), 100);
  }
  if (c > 0 && s.breath < 100) {
    let penalty = i8(idiv(c * (100 - s.breath), 200));
    if (launcher) penalty = idiv(penalty, 2);
    c -= idiv(penalty * (100 - (effectiveDexterity(s) - 10)), 100);
  }
  if (c > 0 && launcher) c = idiv(c * weaponStatusMod(s.inv[InvSlot.HAND]?.status[0] ?? 0), 100);
  return clamp(c, CTH_MINIMUM, CTH_MAXIMUM);
}

function throwVictim(t: TacticalState, s: Soldier): Soldier | null {
  let victim = whoIsThere(t, s.targetGridNo, s.targetLevel);
  if (victim && victim.team === s.team) victim = null;
  if (victim) return victim;
  for (let dir = 0; dir < DIRECTION_INCREMENT.length; dir++) {
    victim = whoIsThere(t, newGridNo(s.targetGridNo, DIRECTION_INCREMENT[dir] ?? 0), s.targetLevel);
    if (victim !== null && victim.team !== s.team) break;
  }
  return victim;
}

function grantThrowExperience(t: TacticalState, s: Soldier, roll: number, chance: number): void {
  if (s.team !== Team.OUR || !t.inCombat || !throwVictim(t, s)) return;
  statChange(t, s, StatKind.STRENGTH, 5, StatCause.SUCCESS);
  if (roll < chance) {
    statChange(t, s, StatKind.DEXTERITY, 5, StatCause.SUCCESS);
    statChange(t, s, StatKind.MARKSMANSHIP, 5, StatCause.SUCCESS);
  } else {
    statChange(t, s, StatKind.DEXTERITY, 2, StatCause.FAILURE);
    statChange(t, s, StatKind.MARKSMANSHIP, 2, StatCause.FAILURE);
  }
}

export function handleSoldierThrowItem(t: TacticalState, s: Soldier, g: number): void {
  s.target = null;
  if (g === s.gridNo) {
    if (s.tempObject) addItemToPool(t, g, s.tempObject, Visibility.VISIBLE, s.level, 0, FORCE_ON_GROUND);
    s.tempObject = null;
    return;
  }
  const direction = directionToward(s.gridNo, g);
  if (height(t.content, s.state) === AnimHeight.STAND) {
    soldierGotoStationaryStance(t, s);
    setDesiredDirection(t, s, direction);
    s.turningUntilDone = true;
    s.pendingAnimation = anim(t.content, pythSpacesAway(g, s.gridNo) < MIN_LOB_RANGE ? 'LOB_ITEM' : 'THROW_ITEM');
    return;
  }
  s.reverse = false;
  setDesiredDirection(t, s, direction);
  changeSoldierState(t, s, anim(t.content, 'THROW_ITEM'));
}

function removeThrownFromHand(t: TacticalState, s: Soldier): void {
  const hand = s.inv[InvSlot.HAND] as ItemObject;
  const thrown = hand.item;
  removeObjects(hand, 1);
  if (hand.item !== NOTHING) return;
  const slot = findObjWithin(s.inv, thrown, 0, NUM_INV_SLOTS - 1);
  if (slot < 0) return;
  const source = s.inv[slot] as ItemObject;
  Object.assign(hand, createItem(t.content.items, source.item, source.status[0] ?? 0));
  removeObjects(source, 1);
}

export function useThrown(t: TacticalState, s: Soldier, g: number): ThrowRoll {
  const chance = calcThrownChanceToHit(t, s, g, s.aimTime);
  const roll = t.pre.int(100);
  grantThrowExperience(t, s, roll, chance);
  const hand = s.inv[InvSlot.HAND] as ItemObject;
  calculateLaunchItemParamsForThrow(
    t,
    s,
    g,
    s.targetLevel,
    s.targetLevel * HEIGHT_UNITS,
    hand,
    i8(roll - chance),
    ThrowAction.ARM_ITEM,
    null,
  );
  handleSoldierThrowItem(t, s, s.targetGridNo);
  removeThrownFromHand(t, s);
  return { chance, roll };
}

function launchTempObject(t: TacticalState, s: Soldier, object: ItemObject, p: ThrowParams): RealObject {
  const o = createPhysicalObject(t, object, p.lifeSpan, vec3(p.x, p.y, p.z), vec3(p.forceX, p.forceY, p.forceZ), s, p.action, p.target);
  s.tempObject = null;
  t.explosives.throwParams.delete(s.id);
  return o;
}

export function releaseThrow(t: TacticalState, s: Soldier): RealObject | null {
  const params = t.explosives.throwParams.get(s.id);
  if (!s.tempObject || !params) return null;
  const ap = params.action === ThrowAction.ARM_ITEM ? minAPsToThrow(t, s, s.targetGridNo) : AP_TOSS_ITEM;
  deductPoints(t.inCombat, s, ap, 0);
  return launchTempObject(t, s, s.tempObject, params);
}

export function throwOpcode(t: TacticalState, s: Soldier, code: number): OpOutcome | null {
  if (code !== 460 && code !== 461) return null;
  releaseThrow(t, s);
  return 'continue';
}

export function cancelPendingThrow(s: Soldier): ItemObject | null {
  const object = s.tempObject;
  s.tempObject = null;
  return object;
}

export function willExplosiveWeaponFail(t: TacticalState, s: Soldier, weapon: ItemObject): boolean {
  if (s.team !== Team.OUR && s.visible !== 1) return false;
  if (i8(t.pre.int(FAILURE_DICE) + t.pre.int(FAILURE_DICE)) <= (weapon.status[0] ?? 0)) return false;
  return t.pre.int(2) === 1;
}

function launchableSlot(t: TacticalState, launcher: ItemObject): number {
  return launcher.attachments.findIndex(
    (a) => a.item !== NOTHING && ((itemDef(t, a.item)?.itemClass ?? 0) & (ItemClass.GRENADE | ItemClass.BOMB)) !== 0,
  );
}

function removeLaunchable(t: TacticalState, s: Soldier, launcher: ItemObject, slot: number): void {
  if (s.attackingWeapon !== launcher.item) {
    removeAttachment(t, launcher, slot);
    return;
  }
  if (itemDef(t, launcher.item)?.itemClass !== ItemClass.LAUNCHER && launcher.item !== itemIndex(t, 'TANK_CANNON')) return;
  let pos = findAttachmentByClass(t.content.items, launcher, ItemClass.GRENADE);
  if (pos === -1) pos = findAttachmentByClass(t.content.items, launcher, ItemClass.BOMB);
  if (pos !== -1) removeAttachment(t, launcher, pos);
}

function removeAttachment(t: TacticalState, o: ItemObject, slot: number): void {
  const a = o.attachments[slot];
  if (!a || a.item === NOTHING) return;
  if ((itemDef(t, a.item)?.flags ?? 0) & ItemFlags.INSEPARABLE) return;
  a.item = NOTHING;
  a.status = 0;
}

export function useLauncher(t: TacticalState, s: Soldier, g: number): RealObject | null {
  if (!enoughAmmo(t, s, s.attackingHand)) return null;
  const launcher = s.inv[InvSlot.HAND] as ItemObject;
  const slot = launchableSlot(t, launcher);
  if (slot === -1) return null;
  const attached = launcher.attachments[slot] as { item: number; status: number };
  const launchable = createItem(t.content.items, attached.item, attached.status);
  removeLaunchable(t, s, launcher, slot);
  if (willExplosiveWeaponFail(t, s, launcher)) {
    igniteExplosion(t, s, 0, s.gridNo, launchable.item, s.level);
    reduceAttackBusyCount(t, s, false);
    return null;
  }
  const chance = calcThrownChanceToHit(t, s, g, s.aimTime);
  const roll = t.pre.int(100);
  const ap = itemDef(t, s.attackingWeapon)?.itemClass === ItemClass.LAUNCHER ? minAPsToAttack(t, s, g, true) : minAPsToThrow(t, s, g);
  deductPoints(t.inCombat, s, ap, 0);
  const params = calculateLaunchItemParamsForThrow(
    t,
    s,
    s.targetGridNo,
    s.targetLevel,
    s.targetLevel * HEIGHT_UNITS,
    launchable,
    i8(roll - chance),
    ThrowAction.ARM_ITEM,
    null,
  );
  return launchTempObject(t, s, launchable, params);
}
