// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Items.cc HandleItem (gun path), HandItemWorks; Soldier_Control.cc EVENT_FireSoldierWeapon,
// @src SelectFireAnimation, SoldierReadyWeapon, InternalSoldierReadyWeapon, PickSoldierReadyAnimation, SendBeginFireWeaponEvent;
// @src Weapons.cc CheckForGunJam, OKFireWeapon, FireWeapon, UseGun, GetTargetWorldPositions;
// @src Soldier_Ani.cc opcodes 430, 441, 448, 449, 458, 459, 470, 473, 476, 753, 757, CheckForImproperFireGunEnd,
// @src HandleUnjamAnimation; Handle_Items.cc HandleItem dispatch to the punch and blade paths. See docs/11 §1, §6.

import type { OpOutcome } from '../../../content/anim/script.ts';
import { AnimFlags } from '../../../content/anim/tables.ts';
import { AmmoType, ItemClass, ItemCursor, ItemFlags, NOTHING } from '../../../content/items/items.ts';
import { DIRECTION_INCREMENT, newGridNo, pythSpacesAway, WORLD_COLS } from '../../../content/world/grid.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import { createItem, findAttachment, type ItemObject, USABLE_STATUS } from '../../items/object.ts';
import { anim, animName } from '../anim-states.ts';
import {
  AnimHeight,
  changeSoldierStance,
  changeSoldierState,
  endHeight,
  hasAnimFlag,
  height,
  initNewSoldierAnim,
  setDesiredDirection,
  setSoldierDirection,
} from '../animation.ts';
import { igniteExplosion } from '../explosions/explosion.ts';
import { useLauncher, useThrown, willExplosiveWeaponFail } from '../explosions/throwing.ts';
import { InvSlot, isValidSecondHandShot } from '../inventory.ts';
import { putOutMuzzleFlash, showMuzzleFlash } from '../lighting/muzzle-flash.ts';
import { directionToward } from '../movement.ts';
import { makeNoise, NoiseKind } from '../perception/noise.ts';
import { isValidStance } from '../person-structure.ts';
import { deductPoints, enoughPoints } from '../points.ts';
import { StatKind } from '../profiles.ts';
import { Body, NO_PROFILE, OKLIFE, Personality, type Soldier, Team } from '../soldier.ts';
import { type TacticalState, whoIsThere } from '../state.ts';
import { apChargeForShootOrStab, calcTotalAPsToAttack, enoughAmmo, minAPsToAttack } from './ap.ts';
import { freeUpAttacker, reduceAttackBusyCount } from './barrier.ts';
import { fireBulletGivenTarget, soldierToSoldierBodyPartChanceToGetThrough } from './bullets.ts';
import { calcChanceToHitGun } from './chance.ts';
import { modifyExpGainByTarget, StatCause, statChange } from './experience.ts';
import { eventSoldierGotHit, okFallDirection } from './hit.ts';
import { handleBladeAttack, handlePunchAttack, meleeOpcode, useBlade, useHandToHand } from './melee.ts';
import { calculateSoldierZPos, targetZFromStructureHeight, ZPos } from './positions.ts';
import { SkillCheckReason, skillCheck } from './skill-check.ts';
import { AimShot, ItemHandle, NUM_BUCKSHOT_PELLETS, WeaponMode } from './types.ts';

export { ItemHandle };

export const FireResult = { FIREABLE: 0, JAMMED: 1, UNJAMMED: 2, FAILED: 3, FIRED: 4 } as const;

const INVALID_ANIMATION = -1;
const BASIC_DEPRECIATE_CHANCE = 15;
const TurningFromProne = { OFF: 0, ON: 1, START_UP_FROM_MOVE: 2, ENDING_UP_FROM_MOVE: 3 } as const;

const itemIndex = (t: TacticalState, name: string) => t.content.items.byName.get(name)?.index ?? -2;
const def = (t: TacticalState, item: number) => t.content.items.byIndex.get(item);
const isMonster = (s: Soldier) => s.bodyType >= Body.ADULTFEMALEMONSTER && s.bodyType <= Body.QUEENMONSTER;
const isTank = (s: Soldier) => s.bodyType === Body.TANK_NW || s.bodyType === Body.TANK_NE;
const isRobot = (s: Soldier) => s.bodyType === Body.ROBOTNOWEAPON;
const isCreatureOrBloodcat = (s: Soldier) => isMonster(s) || s.bodyType === Body.BLOODCAT;
const inWater = (s: Soldier) => s.overTerrain >= Terrain.LOW_WATER && s.overTerrain <= Terrain.DEEP_WATER;
const i8 = (v: number) => ((v & 0xff) << 24) >> 24;

export function handItemWorks(t: TacticalState, s: Soldier, slot: number): boolean {
  const o = s.inv[slot] as ItemObject;
  const d = def(t, o.item);
  let works = true;
  const pressureMine = d?.explosive?.pressureTriggered ?? false;
  if (d && d.flags & ItemFlags.DAMAGEABLE && !pressureMine && d.itemClass !== ItemClass.MEDKIT && o.item !== itemIndex(t, 'GAS_CAN')) {
    if ((o.status[0] ?? 0) >= USABLE_STATUS) {
      if (t.rng.int(80) + 20 >= (o.status[0] ?? 0) + 50) {
        works = false;
        o.status[0] = 1 + t.rng.int(USABLE_STATUS - 1);
      }
    } else works = false;
  }
  if (works && slot === InvSlot.HAND && d?.itemClass === ItemClass.GUN) {
    const second = s.inv[InvSlot.SECOND_HAND] as ItemObject;
    if (def(t, second.item)?.itemClass === ItemClass.GUN && (second.status[0] ?? 0) >= USABLE_STATUS && second.gunShotsLeft > 0)
      return handItemWorks(t, s, InvSlot.SECOND_HAND);
  }
  return works;
}

function isGunBurstCapable(t: TacticalState, s: Soldier, slot: number): boolean {
  return (def(t, s.inv[slot]?.item ?? NOTHING)?.weapon?.shotsPerBurst ?? 0) > 0;
}

export function sendBeginFireWeaponEvent(t: TacticalState, s: Soldier, target: number): void {
  t.gameEvents.push({ kind: 'beginFireWeapon', soldier: s.id, target, level: s.targetLevel, cubeLevel: s.targetCubeLevel });
}

export function handleItem(t: TacticalState, s: Soldier, g: number, level: number, handItem: number): number {
  s.pendingAnimation = -1;
  s.attackingWeapon = handItem;
  s.targetLevel = level;
  const tgt = whoIsThere(t, g, level);
  if (!t.inCombat) t.turn.attackBusyCount = 0;
  if (tgt) tgt.beingAttackedCount = 0;
  if (s.life < OKLIFE) return ItemHandle.UNCONSCIOUS;
  if (!handItemWorks(t, s, InvSlot.HAND)) return ItemHandle.BROKEN;
  const cls = def(t, handItem)?.itemClass ?? ItemClass.NONE;
  if (cls === ItemClass.GUN || cls === ItemClass.THROWING_KNIFE) return handleGunAttack(t, s, g, tgt, handItem);
  if (cls & (ItemClass.NONE | ItemClass.PUNCH)) return handlePunchAttack(t, s, g, level);
  if (cls === ItemClass.BLADE) return handleBladeAttack(t, s, g);
  if (cls === ItemClass.GRENADE || cls === ItemClass.LAUNCHER || cls === ItemClass.THROWN)
    return handleThrowOrLaunch(t, s, g, level, tgt, handItem);
  return ItemHandle.BROKEN;
}

function mortarHasRoom(t: TacticalState, s: Soldier, targetGrid: number): boolean {
  const direction = directionToward(s.gridNo, targetGrid);
  const ahead = newGridNo(s.gridNo, DIRECTION_INCREMENT[direction] ?? 0);
  return okFallDirection(t, s, ahead, s.level, direction, s.state);
}

function handleThrowOrLaunch(t: TacticalState, s: Soldier, g: number, level: number, tgt: Soldier | null, handItem: number): number {
  const d = def(t, handItem);
  if (!d) return ItemHandle.BROKEN;
  const targetGrid = tgt ? tgt.gridNo : g;
  const apCost = minAPsToAttack(t, s, targetGrid, true);
  if (handItem === itemIndex(t, 'MORTAR')) {
    if (!mortarHasRoom(t, s, targetGrid)) return ItemHandle.NOROOM;
  } else if (d.itemClass === ItemClass.LAUNCHER) {
    const charge = apChargeForShootOrStab(t, s, targetGrid, true, false);
    if (height(t.content, s.state) === AnimHeight.STAND) {
      if (charge.raise) s.dontChargeTurningAPs = true;
    } else if (charge.turning) s.dontChargeReadyAPs = true;
  }
  if (!enoughPoints(t.inCombat, s, apCost)) return ItemHandle.NOAPS;
  s.attackingHand = InvSlot.HAND;
  s.attackingWeapon = handItem;
  s.targetLevel = level;
  if (d.cursor === ItemCursor.TOSS) {
    s.targetGridNo = targetGrid;
    s.target = whoIsThere(t, targetGrid, s.targetLevel);
    t.turn.attackBusyCount++;
    s.dontChargeTurningAPs = true;
    fireWeapon(t, s, targetGrid);
  } else sendBeginFireWeaponEvent(t, s, targetGrid);
  return ItemHandle.OK;
}

function handleGunAttack(t: TacticalState, s: Soldier, g: number, tgt: Soldier | null, handItem: number): number {
  const d = def(t, handItem);
  if (!d) return ItemHandle.BROKEN;
  if (d.itemClass !== ItemClass.THROWING_KNIFE && !enoughAmmo(t, s, InvSlot.HAND)) {
    s.doSpread = 0;
    return ItemHandle.NOAMMO;
  }
  const targetGrid = tgt ? tgt.gridNo : g;
  const apCost = calcTotalAPsToAttack(t, s, targetGrid, true, s.aimTime);
  const charge = apChargeForShootOrStab(t, s, targetGrid, true, false);
  if (height(t.content, s.state) === AnimHeight.STAND) {
    if (charge.raise) s.dontChargeTurningAPs = true;
  } else if (charge.turning) s.dontChargeReadyAPs = true;
  if (!enoughPoints(t.inCombat, s, apCost)) return ItemHandle.NOAPS;
  if (s.profile !== NO_PROFILE && s.personalityTrait === Personality.PSYCHO && !s.doBurst && isGunBurstCapable(t, s, InvSlot.HAND)) {
    s.doBurst = 1;
    const burstCost = calcTotalAPsToAttack(t, s, targetGrid, true, 0);
    s.doBurst = 0;
    if (enoughPoints(t.inCombat, s, burstCost) && t.rng.int(3 + s.aimTime) === 0) {
      s.doBurst = 1;
      s.weaponMode = WeaponMode.BURST;
    }
  }
  if (d.itemClass === ItemClass.THROWING_KNIFE) return ItemHandle.BROKEN;
  sendBeginFireWeaponEvent(t, s, !s.doSpread || !s.spreadLocations[0] ? targetGrid : s.spreadLocations[0]);
  return ItemHandle.OK;
}

export function pickSoldierReadyAnimation(t: TacticalState, s: Soldier, endReady: boolean): number {
  const hand = s.inv[InvSlot.HAND] as ItemObject;
  if (hand.item === NOTHING || s.overTerrain === Terrain.DEEP_WATER || isRobot(s)) return INVALID_ANIMATION;
  const d = def(t, hand.item);
  if (d?.itemClass !== ItemClass.GUN && d?.itemClass !== ItemClass.LAUNCHER) return INVALID_ANIMATION;
  if (hand.item === itemIndex(t, 'ROCKET_LAUNCHER') || isTank(s)) return INVALID_ANIMATION;
  const dual = isValidSecondHandShot(t.content.items, s);
  const drawn = hasAnimFlag(t.content, s.state, AnimFlags.FIREREADY | AnimFlags.FIRE);
  const names: Record<number, [string, string]> = endReady
    ? {
        [AnimHeight.STAND]: ['END_RIFLE_STAND', 'END_DUAL_STAND'],
        [AnimHeight.PRONE]: ['END_RIFLE_PRONE', 'END_DUAL_PRONE'],
        [AnimHeight.CROUCH]: ['END_RIFLE_CROUCH', 'END_DUAL_CROUCH'],
      }
    : {
        [AnimHeight.STAND]: ['READY_RIFLE_STAND', 'READY_DUAL_STAND'],
        [AnimHeight.PRONE]: ['READY_RIFLE_PRONE', 'READY_DUAL_PRONE'],
        [AnimHeight.CROUCH]: ['READY_RIFLE_CROUCH', 'READY_DUAL_CROUCH'],
      };
  if (endReady !== drawn) return INVALID_ANIMATION;
  const pair = names[endHeight(t.content, s.state)];
  if (!pair) return INVALID_ANIMATION;
  return anim(t.content, dual ? pair[1] : pair[0]);
}

export function internalSoldierReadyWeapon(t: TacticalState, s: Soldier, facing: number, endReady: boolean): boolean {
  if (isMonster(s)) {
    if (!endReady) setDesiredDirection(t, s, facing);
    return false;
  }
  let state = pickSoldierReadyAnimation(t, s, endReady);
  let changed = false;
  if (state !== INVALID_ANIMATION) {
    initNewSoldierAnim(t, s, state, 0, false);
    changed = true;
  }
  if (!endReady) {
    if (state === INVALID_ANIMATION) state = s.state;
    setDesiredDirection(t, s, facing, state);
  }
  return changed;
}

export function soldierReadyWeapon(t: TacticalState, s: Soldier, targetGrid: number, endReady: boolean): boolean {
  return internalSoldierReadyWeapon(t, s, directionToward(s.gridNo, targetGrid), endReady);
}

export function selectFireAnimation(t: TacticalState, s: Soldier, stance: number): number {
  const a = (name: string) => anim(t.content, name);
  if (isMonster(s)) {
    if (s.bodyType <= Body.YAM_MONSTER) return a('MONSTER_SPIT_ATTACK');
    if (s.bodyType === Body.INFANT_MONSTER) return a('INFANT_ATTACK');
    if (s.bodyType === Body.QUEENMONSTER) return a('QUEEN_SPIT');
    return 1;
  }
  if (isRobot(s)) return a(s.doBurst > 0 ? 'ROBOT_BURST_SHOOT' : 'ROBOT_SHOOT');
  const hand = s.inv[InvSlot.HAND]?.item ?? NOTHING;
  if (hand === itemIndex(t, 'ROCKET_LAUNCHER')) return a('SHOOT_ROCKET');
  if (hand === itemIndex(t, 'MORTAR')) return a('SHOOT_MORTAR');
  if (hand === itemIndex(t, 'TANK_CANNON')) return a('TANK_SHOOT');
  if (isTank(s)) return a('TANK_BURST');
  const dual = isValidSecondHandShot(t.content.items, s);
  switch (stance) {
    case AnimHeight.STAND: {
      if (dual) return a('SHOOT_DUAL_STAND');
      const dist = pythSpacesAway(s.gridNo, s.targetGridNo);
      const target = getTargetWorldPositions(t, s, s.targetGridNo);
      let low = dist <= 2 && target.z <= 100;
      if (inWater(s)) low = false;
      if (s.doBurst > 0) return a(low ? 'FIRE_BURST_LOW_STAND' : 'STANDING_BURST');
      return a(low ? 'FIRE_LOW_STAND' : 'SHOOT_RIFLE_STAND');
    }
    case AnimHeight.PRONE:
      if (s.doBurst > 0) return a('PRONE_BURST');
      return a(dual ? 'SHOOT_DUAL_PRONE' : 'SHOOT_RIFLE_PRONE');
    default:
      if (dual) return a('SHOOT_DUAL_CROUCH');
      return a(s.doBurst > 0 ? 'CROUCHED_BURST' : 'SHOOT_RIFLE_CROUCH');
  }
}

export function eventFireSoldierWeapon(t: TacticalState, s: Soldier, target: number): void {
  if (s.gridNo === target) return;
  t.turn.attackBusyCount++;
  s.targetGridNo = target;
  s.target = whoIsThere(t, target, s.targetLevel);
  const hand = def(t, s.inv[InvSlot.HAND]?.item ?? NOTHING);
  if (hand?.itemClass === ItemClass.GUN) {
    const gun = s.inv[s.attackingHand] as ItemObject;
    if (s.doBurst) s.bulletsLeft = Math.min(def(t, gun.item)?.weapon?.shotsPerBurst ?? 0, gun.gunShotsLeft);
    else if (isValidSecondHandShot(t.content.items, s)) s.bulletsLeft = 2;
    else s.bulletsLeft = 1;
    if (gun.gunAmmoType === AmmoType.BUCKSHOT) s.bulletsLeft *= NUM_BUCKSHOT_PELLETS;
  }
  soldierReadyWeapon(t, s, target, false);
  if (isMonster(s)) {
    setSoldierDirection(t, s, s.desiredDirection);
    initNewSoldierAnim(t, s, selectFireAnimation(t, s, endHeight(t.content, s.state)), 0, false);
    return;
  }
  if (hand?.itemClass === ItemClass.LAUNCHER || hand?.index === itemIndex(t, 'ROCKET_LAUNCHER')) {
    s.dontUnsetLastTargetFromTurn = true;
    s.turningFromPronePosition = TurningFromProne.OFF;
    setSoldierDirection(t, s, s.desiredDirection);
    initNewSoldierAnim(t, s, selectFireAnimation(t, s, endHeight(t.content, s.state)), 0, false);
  } else s.turningToShoot = true;
}

export function turnToShoot(t: TacticalState, s: Soldier): void {
  if (!s.turningToShoot || s.direction !== s.desiredDirection) return;
  if ((hasAnimFlag(t.content, s.state, AnimFlags.FIREREADY) && !s.turningFromPronePosition) || isRobot(s) || isTank(s)) {
    initNewSoldierAnim(t, s, selectFireAnimation(t, s, endHeight(t.content, s.state)), 0, false);
    s.turningToShoot = false;
  } else if (s.turningFromPronePosition) {
    if (isValidStance(t, s, AnimHeight.PRONE)) {
      changeSoldierStance(t, s, AnimHeight.PRONE);
      s.pendingAnimation = selectFireAnimation(t, s, AnimHeight.PRONE);
    } else initNewSoldierAnim(t, s, selectFireAnimation(t, s, AnimHeight.CROUCH), 0, false);
    s.turningToShoot = false;
    s.turningFromPronePosition = TurningFromProne.OFF;
  }
}

export function checkForGunJam(t: TacticalState, s: Soldier): number {
  if (s.team !== Team.OUR) return FireResult.FIREABLE;
  const d = def(t, s.attackingWeapon);
  if (d?.itemClass !== ItemClass.GUN || isExplosiveGun(t, s.attackingWeapon)) return FireResult.FIREABLE;
  const o = s.inv[s.attackingHand] as ItemObject;
  if (o.gunAmmoStatus > 0) {
    let chance = 80 - (o.status[0] ?? 0);
    chance -= s.doBurst > 1 ? t.pre.int(80) : t.pre.int(100);
    if (t.pre.int(100) < chance) {
      o.gunAmmoStatus = -o.gunAmmoStatus;
      deductAmmo(t, s, s.attackingHand);
      t.events.push({ type: 'gunJammed', soldier: s.id, unjammed: false });
      return FireResult.JAMMED;
    }
  } else if (o.gunAmmoStatus < 0) {
    if (skillCheck(t, s, SkillCheckReason.UNJAM_GUN, (d.reliability ?? 0) * 4) > 0) {
      o.gunAmmoStatus = -o.gunAmmoStatus;
      statChange(t, s, StatKind.MECHANICAL, 5, StatCause.SUCCESS);
      statChange(t, s, StatKind.DEXTERITY, 5, StatCause.SUCCESS);
      t.events.push({ type: 'gunJammed', soldier: s.id, unjammed: true });
      return FireResult.UNJAMMED;
    }
    return FireResult.JAMMED;
  }
  return FireResult.FIREABLE;
}

function okFireWeapon(t: TacticalState, s: Soldier): number {
  if (s.attackingHand === InvSlot.SECOND_HAND && !enoughAmmo(t, s, s.attackingHand) && s.team === Team.OUR) return FireResult.FAILED;
  return checkForGunJam(t, s);
}

function isExplosiveGun(t: TacticalState, item: number): boolean {
  return item === itemIndex(t, 'ROCKET_LAUNCHER') || item === itemIndex(t, 'TANK_CANNON');
}

function deductAmmo(t: TacticalState, s: Soldier, slot: number): void {
  const o = s.inv[slot] as ItemObject;
  if (isTank(s) && o.item !== itemIndex(t, 'TANK_CANNON')) return;
  if (o.item === NOTHING || o.item === itemIndex(t, 'TANK_CANNON')) return;
  if (def(t, o.item)?.itemClass === ItemClass.GUN && s.attackingWeapon === o.item && o.gunShotsLeft !== 0) o.gunShotsLeft--;
}

export interface TargetPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function getTargetWorldPositions(t: TacticalState, s: Soldier, g: number): TargetPosition {
  const target = whoIsThere(t, g, s.targetLevel);
  if (!target) {
    return {
      x: Math.fround((g % WORLD_COLS) * 10 + 5),
      y: Math.fround(Math.trunc(g / WORLD_COLS) * 10 + 5),
      z: targetZFromStructureHeight(t, g, s.targetLevel, s.targetCubeLevel),
    };
  }
  s.opponent = target;
  if (s.aimShotLocation === AimShot.RANDOM) {
    const roll = t.pre.int(100);
    s.aimShotLocation = roll < 15 ? AimShot.LEGS : roll > 94 ? AimShot.HEAD : AimShot.TORSO;
    if (s.aimShotLocation !== AimShot.HEAD) {
      const ctgt = soldierToSoldierBodyPartChanceToGetThrough(t, s, target, s.aimShotLocation);
      if (ctgt < 25 && soldierToSoldierBodyPartChanceToGetThrough(t, s, target, AimShot.HEAD) > ctgt * 2) s.aimShotLocation = AimShot.HEAD;
    }
  }
  const pos =
    s.aimShotLocation === AimShot.HEAD
      ? ZPos.HEAD_TARGET
      : s.aimShotLocation === AimShot.TORSO
        ? ZPos.TORSO_TARGET
        : s.aimShotLocation === AimShot.LEGS
          ? ZPos.LEGS_TARGET
          : ZPos.TARGET;
  return {
    x: Math.fround((target.gridNo % WORLD_COLS) * 10 + 5),
    y: Math.fround(Math.trunc(target.gridNo / WORLD_COLS) * 10 + 5),
    z: calculateSoldierZPos(t, target, pos),
  };
}

function useGun(t: TacticalState, s: Soldier, target: number): void {
  const items = t.content.items;
  const ap = calcTotalAPsToAttack(t, s, target, false, s.aimTime);
  const item = s.attackingWeapon;
  const d = def(t, item);
  const hand = s.inv[InvSlot.HAND] as ItemObject;
  if (s.doBurst) {
    if (s.doBurst === 1) deductPoints(t.inCombat, s, ap, 0);
  } else if (isValidSecondHandShot(items, s) && (hand.status[0] ?? 0) >= USABLE_STATUS && hand.gunAmmoStatus > 0) {
    if (s.attackingHand === InvSlot.HAND) deductPoints(t.inCombat, s, ap, 0);
  } else deductPoints(t.inCombat, s, ap, 0);
  const pos = getTargetWorldPositions(t, s, target);
  const knife = d?.itemClass === ItemClass.THROWING_KNIFE;
  const chance = knife ? 0 : calcChanceToHitGun(t, s, target, s.aimTime, s.aimShotLocation, true);
  const roll = t.pre.int(100);
  const hit = roll <= chance;
  let buckshot = false;
  if (!knife) {
    deductAmmo(t, s, s.attackingHand);
    if ((s.inv[s.attackingHand]?.gunShotsLeft ?? 0) === 0 && item !== itemIndex(t, 'ROCKET_LAUNCHER') && s.team === Team.OUR)
      s.sayAmmoQuotePending = true;
    const tgt = s.target;
    if (s.team === Team.OUR && tgt && (!s.doBurst || s.doBurst === 2) && t.inCombat) {
      if (soldierToSoldierBodyPartChanceToGetThrough(t, s, tgt, s.aimShotLocation) > 0) {
        let xp = 0;
        if (hit) {
          xp += Math.trunc(((100 - chance) & 0xff) / 25);
          if (s.aimTime && !s.doBurst) xp += Math.min(s.aimTime, xp);
          xp += 3;
        }
        xp += 3;
        if (isValidSecondHandShot(items, s) && (hand.status[0] ?? 0) >= USABLE_STATUS && hand.gunAmmoStatus > 0)
          xp = Math.trunc((xp * 2) / 3);
        xp = modifyExpGainByTarget(xp, tgt);
        statChange(t, s, StatKind.MARKSMANSHIP, xp, hit ? StatCause.SUCCESS : StatCause.FAILURE);
      }
    }
    if (!isCreatureOrBloodcat(s)) {
      s.muzzleFlash = true;
      const ammo = s.inv[s.attackingHand]?.gunAmmoType;
      if (ammo === AmmoType.BUCKSHOT) buckshot = true;
      else if (ammo === AmmoType.SLEEP_DART) s.muzzleFlash = false;
    }
  }
  const law = item === itemIndex(t, 'ROCKET_LAUNCHER');
  if (law && willExplosiveWeaponFail(t, s, hand)) {
    discardLaw(t, s);
    igniteExplosion(t, s, 0, s.gridNo, itemIndex(t, 'C1'), s.level);
    reduceAttackBusyCount(t, s, false);
  }
  t.events.push({ type: 'shotFired', soldier: s.id, target, chance, hit });
  fireBulletGivenTarget(t, s, pos.x, pos.y, pos.z, item, ((chance - roll) << 16) >> 16, buckshot, false);
  let volume = d?.weapon?.attackVolume ?? 0;
  const gun = s.inv[s.attackingHand] as ItemObject;
  const silencer = findAttachment(gun, itemIndex(t, 'SILENCER'));
  if (law) {
    discardLaw(t, s);
    lawBackblast(t, s);
  } else if (silencer !== -1) {
    const status = gun.attachments[silencer]?.status ?? 0;
    const wsm = status >= 85 ? 100 : Math.trunc((status * 100) / 85);
    volume = 1 + Math.trunc((100 - wsm) / Math.trunc(100 / (volume - 1)));
  }
  makeNoise(t, s, s.gridNo, s.level, volume, NoiseKind.GUNFIRE);
  if (s.doBurst) s.doBurst++;
  if (!t.pre.int(BASIC_DEPRECIATE_CHANCE + 3 * (d?.reliability ?? 0)) && (gun.status[0] ?? 0) > 1) gun.status[0] = (gun.status[0] ?? 0) - 1;
  if (s.monsterSmell > 0 && t.rng.int(2) === 0) s.monsterSmell--;
}

const LAW_BACKBLAST_DAMAGE = 10;
const LAW_BACKBLAST_BREATH = 200;

function discardLaw(t: TacticalState, s: Soldier): void {
  const hand = s.inv[InvSlot.HAND] as ItemObject;
  Object.assign(hand, createItem(t.content.items, itemIndex(t, 'DISCARDED_LAW'), hand.status[0] ?? 0));
}

function lawBackblast(t: TacticalState, s: Soldier): void {
  const back = (s.direction + 4) % 8;
  const behind = newGridNo(s.gridNo, DIRECTION_INCREMENT[back] ?? 0);
  const tgt = whoIsThere(t, behind, s.level);
  if (!tgt || height(t.content, tgt.state) === AnimHeight.PRONE) return;
  t.turn.attackBusyCount++;
  eventSoldierGotHit(
    t,
    tgt,
    itemIndex(t, 'MINI_GRENADE'),
    LAW_BACKBLAST_DAMAGE,
    LAW_BACKBLAST_BREATH,
    s.direction,
    0,
    s,
    0,
    AnimHeight.CROUCH,
  );
}

export function fireWeapon(t: TacticalState, s: Soldier, target: number): number {
  if (target === s.gridNo) {
    freeUpAttacker(t, s);
    return FireResult.FAILED;
  }
  s.opponent = null;
  const cls = def(t, s.attackingWeapon)?.itemClass ?? ItemClass.NONE;
  if (cls === ItemClass.GUN || cls === ItemClass.THROWING_KNIFE) {
    if (s.doSpread && !s.doBurst) s.doSpread = 0;
    if (s.doSpread > 6) s.doSpread = 0;
    if (s.doSpread) {
      useGun(t, s, s.spreadLocations[s.doSpread - 1] || target);
      s.doSpread++;
    } else useGun(t, s, target);
  } else if (cls === ItemClass.BLADE) useBlade(t, s, target);
  else if (cls & (ItemClass.NONE | ItemClass.PUNCH)) useHandToHand(t, s, target);
  else if (cls === ItemClass.LAUNCHER) useLauncher(t, s, target);
  else useThrown(t, s, target);
  return FireResult.FIRED;
}

function checkForImproperFireGunEnd(t: TacticalState, s: Soldier): boolean {
  if (isRobot(s)) return false;
  const hand = s.inv[InvSlot.HAND] as ItemObject;
  if (hand.gunAmmoStatus < 0 || hand.gunShotsLeft === 0) {
    if (def(t, s.inv[InvSlot.SECOND_HAND]?.item ?? NOTHING)?.itemClass !== ItemClass.GUN) {
      internalSoldierReadyWeapon(t, s, s.direction, true);
      return true;
    }
  }
  return false;
}

const UNJAM_STATES: Readonly<Record<string, string>> = {
  SHOOT_RIFLE_STAND: 'STANDING_SHOOT_UNJAM',
  STANDING_BURST: 'STANDING_SHOOT_UNJAM',
  FIRE_STAND_BURST_SPREAD: 'STANDING_SHOOT_UNJAM',
  PRONE_BURST: 'PRONE_SHOOT_UNJAM',
  SHOOT_RIFLE_PRONE: 'PRONE_SHOOT_UNJAM',
  CROUCHED_BURST: 'CROUCH_SHOOT_UNJAM',
  SHOOT_RIFLE_CROUCH: 'CROUCH_SHOOT_UNJAM',
  SHOOT_DUAL_STAND: 'STANDING_SHOOT_DWEL_UNJAM',
  SHOOT_DUAL_PRONE: 'PRONE_SHOOT_DWEL_UNJAM',
  SHOOT_DUAL_CROUCH: 'CROUCH_SHOOT_DWEL_UNJAM',
  FIRE_LOW_STAND: 'STANDING_SHOOT_LOW_UNJAM',
  FIRE_BURST_LOW_STAND: 'STANDING_SHOOT_LOW_UNJAM',
};

function handleUnjamAnimation(t: TacticalState, s: Soldier): boolean {
  const next = UNJAM_STATES[animName(t.content, s.state)];
  if (!next) return false;
  s.pendingActionData1 = s.pc;
  s.pendingActionData2 = s.state;
  changeSoldierState(t, s, anim(t.content, next));
  return true;
}

function burstController(t: TacticalState, s: Soldier): OpOutcome {
  let stop = s.doBurst > (def(t, s.attackingWeapon)?.weapon?.shotsPerBurst ?? 0);
  if (!enoughAmmo(t, s, s.attackingHand)) stop = true;
  else if (s.doBurst === 1) {
    const jam = checkForGunJam(t, s);
    if (jam === FireResult.JAMMED) {
      stop = true;
      s.bulletsLeft = 0;
      freeUpAttacker(t, s);
    } else if (jam === FireResult.UNJAMMED && handleUnjamAnimation(t, s)) return 'stop';
  }
  if (stop) {
    putOutMuzzleFlash(t, s);
    s.muzzleFlashCount = 0;
    s.muzzleFlash = false;
    s.doSpread = 0;
    s.doBurst = 1;
    reduceAttackBusyCount(t, s, false);
    if (checkForImproperFireGunEnd(t, s)) return 'stop';
    const end = endHeight(t.content, s.state);
    const name = isRobot(s)
      ? 'STANDING'
      : end === AnimHeight.STAND
        ? 'AIM_RIFLE_STAND'
        : end === AnimHeight.PRONE
          ? 'AIM_RIFLE_PRONE'
          : end === AnimHeight.CROUCH
            ? 'AIM_RIFLE_CROUCH'
            : null;
    if (name) changeSoldierState(t, s, anim(t.content, name));
    return 'stop';
  }
  if (s.doSpread) {
    const spot = s.spreadLocations[s.doSpread - 1] ?? 0;
    if (spot !== 0) {
      setSoldierDirection(t, s, directionToward(s.gridNo, spot));
      setDesiredDirection(t, s, s.direction);
    }
  }
  return 'continue';
}

export function attackOpcode(t: TacticalState, s: Soldier, code: number): OpOutcome | null {
  switch (code) {
    case 430:
      t.gameEvents.push({ kind: 'fireWeapon', soldier: s.id, target: s.targetGridNo, level: s.targetLevel, cubeLevel: s.targetCubeLevel });
      return 'continue';
    case 441:
      return showMuzzleFlash(t, s) ? 'continue' : 'stop';
    case 448:
      return burstController(t, s);
    case 449:
      s.doSpread = 0;
      s.doBurst = 1;
      return 'continue';
    case 458:
      s.attackingHand = InvSlot.SECOND_HAND;
      s.attackingWeapon = s.inv[InvSlot.SECOND_HAND]?.item ?? NOTHING;
      return 'continue';
    case 459:
      s.attackingHand = InvSlot.HAND;
      s.attackingWeapon = s.inv[InvSlot.HAND]?.item ?? NOTHING;
      return 'continue';
    case 470: {
      const ok = okFireWeapon(t, s);
      if (ok === FireResult.JAMMED) {
        const pellets = s.inv[s.attackingHand]?.gunAmmoType === AmmoType.BUCKSHOT ? NUM_BUCKSHOT_PELLETS : 1;
        s.bulletsLeft = i8(s.bulletsLeft - pellets);
        freeUpAttacker(t, s);
        return { skip: 4 };
      }
      if (ok === FireResult.UNJAMMED && handleUnjamAnimation(t, s)) return 'stop';
      return 'continue';
    }
    case 473:
      return checkForImproperFireGunEnd(t, s) ? 'stop' : 'continue';
    case 476:
      changeSoldierState(t, s, s.pendingActionData2, (s.pendingActionData1 + 1) & 0xff);
      return 'stop';
    case 477:
      return 'continue';
    case 753:
      reduceAttackBusyCount(t, s, false);
      if (animName(t.content, s.state) === 'QUEEN_SWIPE') reduceAttackBusyCount(t, s, false);
      return 'continue';
    case 757:
      t.turn.attackBusyCount++;
      return 'continue';
    default:
      return meleeOpcode(t, s, code);
  }
}
