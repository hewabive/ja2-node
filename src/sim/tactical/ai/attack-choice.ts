// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/Attacks.cc CalcBestShot, EstimateShotDamage, EstimateStabDamage, TryToReload, CanNPCAttack,
// @src CheckIfTossPossible (CalcBestThrow, CalcBestStab and CalcSpreadBurst as "not possible" hooks); AIMain.cc InitAttackType;
// @src TacticalAI/AIUtils.cc OKToAttack, ConsiderProne, StanceChange, ShootingStanceChange;
// @src Tactical/Items.cc WeaponInHand, HasObjectImprint, FindObj, FindLaunchable, FindAmmo,
// @src FindThrowableGrenade; Tactical/Weapons.cc CalcMaxTossRange (unarmed); TileEngine/Isometric_Utils.cc GetRangeFromGridNoDiff.
// @src See docs/13 §6.7, §7.

import { AmmoType, ItemClass, ItemFlags, NOTHING, WEAPON_CLASSES } from '../../../content/items/items.ts';
import { validLaunchable } from '../../../content/items/rules.ts';
import { CELL_X_SIZE, pythSpacesAway, WORLD_COLS } from '../../../content/world/grid.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import { i8, idiv, u8, u32 } from '../../../core/int.ts';
import { findAttachment, type ItemObject, swapObjects, USABLE_STATUS } from '../../items/object.ts';
import { AnimHeight, endHeight, height, states } from '../animation.ts';
import { calcAPsToBurst, minAPsToAttack, minAPsToShootOrStab } from '../combat/ap.ts';
import { aiSoldierToSoldierChanceToGetThrough, soldierToLocationChanceToGetThrough } from '../combat/bullets.ts';
import { aiCalcChanceToHitGun, calcChanceToHitGun, rangeInUnits } from '../combat/chance.ts';
import { isTankBody } from '../combat/impact.ts';
import { AiMorale, Aim, AimShot, MIN_PRONE_RANGE, POINT_BLANK_RANGE, PUNCH_REAL_DAMAGE_PORTION } from '../combat/types.ts';
import { findObjWithin, type InventoryContext, InvSlot, NO_SLOT, NUM_INV_SLOTS, reloadGun } from '../inventory.ts';
import { directionToward } from '../movement.ts';
import { closestKnownOpponent } from '../perception/knowledge.ts';
import { Opp } from '../perception/opp.ts';
import { animStructureDef, internalIsValidStance, isValidStance } from '../person-structure.ts';
import { AP, apsToReadyWeapon, calcActionPoints, deductPoints } from '../points.ts';
import { effectiveStrength } from '../skills.ts';
import {
  Attitude,
  Body,
  NO_PROFILE,
  NOWHERE,
  numSkillTraits,
  OKLIFE,
  SKILL_TRAIT_BONUS,
  SkillTrait,
  type Soldier,
  Team,
} from '../soldier.ts';
import { mercs, type TacticalState } from '../state.ts';
import { addItemToPool, Visibility } from '../world-items.ts';
import { calcManThreatValue, consideredNeutral } from './morale.ts';
import { findAIUsableObjClass, findAIUsableObjClassWithin, isExplosiveGun } from './utils.ts';

export const NoShoot = { WAITABIT: -1, WATER: -2, MYSELF: -3, HURT: -4, NOAMMO: -5, NOLOAD: -6, NOWEAPON: -7 } as const;
export const CANNOT_ATTACK = 0;
export const CAN_ATTACK = 1;
export const NO_STANCE_CHANGE = 0;

const PERCENT_TO_IGNORE_THREAT = 50;
const ATTACK_VALUE_DIVISOR = 1000;
const ASSASSIN_MILITIA_DIVISOR = 2;
const MIN_KNIFE_THROW_CHANCE = 30;
const MIN_ESTIMATED_DAMAGE = 1;
const NO_AIM_POSSIBLE = -1;
const ProfileId = { SLAY: 64, JIM: 140, TYRONE: 145 } as const;
const AIM_BONUS_CROUCHING = 10;
const CROUCH_FULL_BONUS_RANGE = POINT_BLANK_RANGE + CELL_X_SIZE * Math.trunc(Aim.PENALTY_TARGET_CROUCHED / 3);
const STANCE_PENALTY_PER_TILE = 3;
const MIN_STANCE_BONUS_BASE = 20;
const MIN_STANCE_BONUS_PER_AIM_AP = 3;
const PRONE_MIN_OPPONENT_RANGE = 10;
const SHOOTING_STANCES: readonly number[] = [AnimHeight.STAND, AnimHeight.CROUCH, AnimHeight.PRONE];
const HEAD_SHOT_SHARE = 15;
const TORSO_SHOT_SHARE = 75;
const LEG_SHOT_SHARE = 5;
const BASE_PUNCH_IMPACT = 5;

export interface AttackChoice {
  possible: boolean;
  opponent: Soldier | null;
  aimTime: number;
  chanceToReallyHit: number;
  attackValue: number;
  target: number;
  targetLevel: number;
  apCost: number;
  weaponIn: number;
}

export function emptyAttackChoice(): AttackChoice {
  return {
    possible: false,
    opponent: null,
    aimTime: 0,
    chanceToReallyHit: 0,
    attackValue: 0,
    target: NOWHERE,
    targetLevel: 0,
    apCost: 0,
    weaponIn: NO_SLOT,
  };
}

export function initAttackType(a: AttackChoice): void {
  a.possible = false;
  a.opponent = null;
  a.aimTime = 0;
  a.chanceToReallyHit = 0;
  a.target = NOWHERE;
  a.attackValue = 0;
  a.apCost = 0;
}

const itemDef = (t: TacticalState, item: number) => t.content.items.byIndex.get(item);
const itemIndex = (t: TacticalState, name: string) => t.content.items.byName.get(name)?.index ?? -2;
const handObject = (s: Soldier) => s.inv[InvSlot.HAND] as ItemObject;
const _isVehicle = (s: Soldier) => s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP;
const isMonster = (s: Soldier) => s.bodyType >= Body.ADULTFEMALEMONSTER && s.bodyType <= Body.QUEENMONSTER;
const isAssassin = (s: Soldier) => s.profile >= ProfileId.JIM && s.profile <= ProfileId.TYRONE;

export function rearrangePocket(s: Soldier, pocket1: number, pocket2: number): void {
  swapObjects(s.inv[pocket1] as ItemObject, s.inv[pocket2] as ItemObject);
}

const findObj = (s: Soldier, item: number) => findObjWithin(s.inv, item, 0, NUM_INV_SLOTS - 1);

function findLaunchable(t: TacticalState, s: Soldier, weapon: number): number {
  for (let slot = 0; slot < NUM_INV_SLOTS; slot++) if (validLaunchable(t.content.items, s.inv[slot]?.item ?? NOTHING, weapon)) return slot;
  return NO_SLOT;
}

function findAmmo(t: TacticalState, s: Soldier, calibre: number, magSize: number): number {
  for (let slot: number = InvSlot.HAND; slot < NUM_INV_SLOTS; slot++) {
    const def = itemDef(t, s.inv[slot]?.item ?? NOTHING);
    if (def?.itemClass !== ItemClass.AMMO || !def.magazine) continue;
    if (def.magazine.calibre !== calibre || def.magazine.capacity !== magSize) continue;
    return slot;
  }
  return NO_SLOT;
}

function findThrowableGrenade(t: TacticalState, s: Soldier): number {
  for (let slot = 0; slot < NUM_INV_SLOTS; slot++) {
    const def = itemDef(t, s.inv[slot]?.item ?? NOTHING);
    if (def?.itemClass === ItemClass.GRENADE && !def.explosive?.calibre) return slot;
  }
  return NO_SLOT;
}

function hasObjectImprint(t: TacticalState, o: ItemObject): boolean {
  return (o.item === itemIndex(t, 'ROCKET_RIFLE') || o.item === itemIndex(t, 'AUTO_ROCKET_RIFLE')) && o.imprintId !== NO_PROFILE;
}

export function weaponInHand(t: TacticalState, s: Soldier): boolean {
  const hand = handObject(s);
  const cls = itemDef(t, hand.item)?.itemClass ?? ItemClass.NONE;
  if (!(cls & (WEAPON_CLASSES | ItemClass.THROWN))) return false;
  if (hasObjectImprint(t, hand) && hand.imprintId !== (s.profile !== NO_PROFILE ? s.profile : NO_PROFILE + 1)) return false;
  return (hand.status[0] ?? 0) >= USABLE_STATUS;
}

export function waterTooDeepForAttacks(t: TacticalState, g: number): boolean {
  return t.world.terrain[g] === Terrain.DEEP_WATER;
}

export function okToAttack(t: TacticalState, s: Soldier, target: number): number {
  if (target === s.gridNo) return NoShoot.MYSELF;
  if (waterTooDeepForAttacks(t, s.gridNo)) return NoShoot.WATER;
  if (!weaponInHand(t, s)) return NoShoot.NOWEAPON;
  const hand = handObject(s);
  const cls = itemDef(t, hand.item)?.itemClass;
  if (cls === ItemClass.GUN) {
    if (hand.item === itemIndex(t, 'TANK_CANNON')) {
      if (findLaunchable(t, s, hand.item) === NO_SLOT) return NoShoot.NOLOAD;
    } else if (hand.gunShotsLeft === 0) return NoShoot.NOAMMO;
  } else if (cls === ItemClass.LAUNCHER && findLaunchable(t, s, hand.item) === NO_SLOT) return NoShoot.NOLOAD;
  return CAN_ATTACK;
}

export function soldierInventoryContext(t: TacticalState, s: Soldier): InventoryContext {
  return {
    items: t.content.items,
    inCombat: t.inCombat,
    actionPoints: () => s.actionPoints,
    spendActionPoints: (ap) => deductPoints(t.inCombat, s, ap, 0),
    dropAtFeet: (o) => {
      addItemToPool(t, s.gridNo, o, Visibility.VISIBLE, s.level);
    },
  };
}

function tryToReload(t: TacticalState, s: Soldier): number {
  const hand = handObject(s);
  const weapon = itemDef(t, hand.item)?.weapon;
  const slot = weapon ? findAmmo(t, s, weapon.calibre, weapon.magSize) : NO_SLOT;
  return slot !== NO_SLOT && reloadGun(soldierInventoryContext(t, s), s, hand, s.inv[slot] as ItemObject) ? CAN_ATTACK : NoShoot.NOAMMO;
}

function isOneHandedGun(t: TacticalState, item: number): boolean {
  const def = itemDef(t, item);
  return def?.itemClass === ItemClass.GUN && !(def.flags & ItemFlags.TWO_HANDED);
}

function drawWeaponFromPocket(t: TacticalState, s: Soldier, slot: number): void {
  rearrangePocket(s, InvSlot.HAND, slot);
  if (!isOneHandedGun(t, handObject(s).item)) return;
  const second = findAIUsableObjClassWithin(t, s, WEAPON_CLASSES, InvSlot.BIGPOCK1, InvSlot.SMALLPOCK8);
  if (second !== NO_SLOT && isOneHandedGun(t, s.inv[second]?.item ?? NOTHING)) rearrangePocket(s, InvSlot.SECOND_HAND, second);
}

export function canNPCAttack(t: TacticalState, s: Soldier): number {
  if (s.team === Team.CIV && s.neutral) return CANNOT_ATTACK;
  const readiness = okToAttack(t, s, NOWHERE);
  if (readiness === NoShoot.NOAMMO) return tryToReload(t, s);
  if (readiness !== NoShoot.NOWEAPON) return readiness;
  const slot = findAIUsableObjClass(t, s, WEAPON_CLASSES);
  if (slot === NO_SLOT) return readiness;
  drawWeaponFromPocket(t, s, slot);
  return canNPCAttack(t, s);
}

function shotAmmoType(t: TacticalState, s: Soldier): number {
  const o = s.inv[s.attackingHand] as ItemObject;
  return itemDef(t, o.item)?.itemClass === ItemClass.THROWING_KNIFE ? AmmoType.KNIFE : o.gunAmmoType;
}

function armourProtectionOf(t: TacticalState, item: number, status: number): number {
  const armour = itemDef(t, item)?.armour;
  return armour ? idiv(armour.protection * status, 100) : 0;
}

function wornProtection(t: TacticalState, o: ItemObject): number {
  return o.item !== NOTHING ? armourProtectionOf(t, o.item, o.status[0] ?? 0) : 0;
}

function averageProtection(t: TacticalState, opp: Soldier, ammo: number): number {
  const vestsIgnored = ammo === AmmoType.MONSTER || ammo === AmmoType.KNIFE;
  const vest = opp.inv[InvSlot.VEST] as ItemObject;
  const head = wornProtection(t, opp.inv[InvSlot.HELMET] as ItemObject);
  let torso = vestsIgnored ? 0 : wornProtection(t, vest);
  const plates = findAttachment(vest, itemIndex(t, 'CERAMIC_PLATES'));
  if (plates !== -1) torso += armourProtectionOf(t, vest.attachments[plates]?.item ?? NOTHING, vest.attachments[plates]?.status ?? 0);
  const legs = vestsIgnored ? 0 : wornProtection(t, opp.inv[InvSlot.LEGS] as ItemObject);
  const total = idiv(HEAD_SHOT_SHARE * head + TORSO_SHOT_SHARE * torso + LEG_SHOT_SHARE * legs, 100);
  switch (ammo) {
    case AmmoType.HP:
      return idiv(total * 3, 2);
    case AmmoType.AP:
      return idiv(total * 3, 4);
    case AmmoType.SUPER_AP:
      return idiv(total, 2);
    default:
      return total;
  }
}

function creatureGasDamageNotPorted(): number {
  return 0;
}

export function estimateShotDamage(t: TacticalState, s: Soldier, opp: Soldier, chanceToHit: number): number {
  const ammo = shotAmmoType(t, s);
  const weapon = itemDef(t, handObject(s).item)?.weapon;
  const powerLost = idiv(50 * rangeInUnits(s.gridNo, opp.gridNo), weapon?.range ?? 0);
  const bonus = u8(idiv(chanceToHit, 4));
  let damage = idiv((weapon?.impact ?? 0) * (100 - powerLost + bonus), 100);
  damage -= averageProtection(t, opp, ammo);
  if (ammo === AmmoType.HP) damage = idiv(damage * 17, 10);
  if (ammo === AmmoType.MONSTER) damage += creatureGasDamageNotPorted();
  return Math.max(damage, MIN_ESTIMATED_DAMAGE);
}

export function estimateStabDamage(t: TacticalState, s: Soldier, chanceToHit: number, blade: boolean): number {
  const weaponImpact = itemDef(t, s.attackingWeapon)?.weapon?.impact ?? 0;
  const martialArts = numSkillTraits(s, SkillTrait.MARTIALARTS);
  let impact: number;
  if (blade) impact = weaponImpact + idiv(effectiveStrength(s), 20);
  else impact = (s.attackingWeapon !== NOTHING && !martialArts ? weaponImpact : BASE_PUNCH_IMPACT) + idiv(effectiveStrength(s), 5);
  impact += idiv(s.stats.experience, 2);
  impact = idiv(impact * (100 + idiv(chanceToHit, 4)), 100);
  if (!blade) {
    impact = idiv(impact * (100 + (SKILL_TRAIT_BONUS[SkillTrait.MARTIALARTS] ?? 0) * martialArts), 100);
    impact = idiv(impact * (100 + (SKILL_TRAIT_BONUS[SkillTrait.HANDTOHAND] ?? 0) * numSkillTraits(s, SkillTrait.HANDTOHAND)), 100);
    impact = idiv(impact, PUNCH_REAL_DAMAGE_PORTION);
  }
  return Math.max(impact, MIN_ESTIMATED_DAMAGE);
}

export function calcUnarmedMaxTossRange(t: TacticalState, s: Soldier, item: number): number {
  const def = itemDef(t, item);
  if (isExplosiveGun(t, item)) return idiv(def?.weapon?.range ?? 0, CELL_X_SIZE);
  const weight = def?.weight ?? 0;
  let range: number;
  if ((def?.flags ?? 0) & ItemFlags.UNAERODYNAMIC) range = 1;
  else if (def?.itemClass === ItemClass.GRENADE)
    range = 2 + idiv(idiv(effectiveStrength(s) * 2 + 100, 3), Math.min(3 + idiv(weight, 3), 4));
  else range = 2 + idiv(effectiveStrength(s), 5 + weight);
  range -= idiv(range * (100 - s.breath), 200);
  range = idiv(range * (100 + (SKILL_TRAIT_BONUS[SkillTrait.THROWING] ?? 0) * numSkillTraits(s, SkillTrait.THROWING)), 100);
  return Math.max(range, 1);
}

function isShotCandidate(s: Soldier, opp: Soldier): boolean {
  if (!opp.life) return false;
  if (consideredNeutral(s, opp) || s.side === opp.side) return false;
  if (s.oppList[opp.id] !== Opp.SEEN_CURRENTLY) return false;
  return !(s.ai.attitude === Attitude.ATTACKSLAYONLY && opp.profile !== ProfileId.SLAY);
}

function creatureCanFaceTarget(t: TacticalState, s: Soldier, opp: Soldier): boolean {
  if (!isMonster(s) || s.bodyType === Body.QUEENMONSTER) return true;
  const def = animStructureDef(t, s, s.uiMovementMode, directionToward(s.gridNo, opp.gridNo));
  return !def || t.world.structures.okayToAdd(s.gridNo, s.level, def, s.id);
}

function maxPossibleAimTime(s: Soldier, minAPCost: number, burstAPs: number): number {
  if (!isTankBody(s)) return Math.min(AP.MAX_AIM_ATTACK, s.actionPoints - minAPCost);
  return u8(s.actionPoints - minAPCost) < burstAPs ? NO_AIM_POSSIBLE : 0;
}

interface AimChoice {
  readonly hitRate: number;
  readonly aimTime: number;
  readonly chanceToHit: number;
}

function bestAimAgainst(t: TacticalState, s: Soldier, target: number, rawAPCost: number, maxAim: number): AimChoice {
  let best: AimChoice = { hitRate: 0, aimTime: 0, chanceToHit: 0 };
  for (let aim = AP.MIN_AIM_ATTACK; aim <= maxAim; aim++) {
    const chanceToHit = u8(aiCalcChanceToHitGun(t, s, target, aim, AimShot.TORSO));
    const hitRate = idiv(s.actionPoints * chanceToHit, rawAPCost + aim);
    if (hitRate > best.hitRate) best = { hitRate, aimTime: aim, chanceToHit };
  }
  return best;
}

function throwingKnifeOutOfReach(t: TacticalState, s: Soldier, opp: Soldier, chanceToReallyHit: number): boolean {
  if (itemDef(t, s.attackingWeapon)?.itemClass !== ItemClass.THROWING_KNIFE) return false;
  if (chanceToReallyHit < MIN_KNIFE_THROW_CHANCE) return true;
  return pythSpacesAway(s.gridNo, opp.gridNo) > idiv(calcUnarmedMaxTossRange(t, s, itemIndex(t, 'THROWING_KNIFE')), 2);
}

export function keepsPreviousTarget(best: AttackChoice, chanceToReallyHit: number, attackValue: number): boolean {
  if (!(attackValue > 0 || chanceToReallyHit > best.chanceToReallyHit)) return true;
  if (best.chanceToReallyHit === 0) return false;
  const percentBetter = idiv(chanceToReallyHit * 100, best.chanceToReallyHit) - 100;
  if (percentBetter < -PERCENT_TO_IGNORE_THREAT && best.opponent !== null && best.opponent.life >= OKLIFE) return true;
  return percentBetter < PERCENT_TO_IGNORE_THREAT && attackValue < best.attackValue;
}

function shotAttackValue(damage: number, hitRate: number, chanceToReallyHit: number, threat: number): number {
  return idiv(Math.imul(Math.imul(Math.imul(damage, hitRate), chanceToReallyHit), threat), ATTACK_VALUE_DIVISOR);
}

export function calcBestShot(t: TacticalState, s: Soldier, best: AttackChoice = emptyAttackChoice()): AttackChoice {
  const hand = handObject(s);
  s.attackingWeapon = hand.item;
  const burstAPs = calcAPsToBurst(t, calcActionPoints(t.content, s), hand);
  initAttackType(best);
  const standing = states(t.content.animations).STANDING;
  for (const opp of mercs(t)) {
    if (!isShotCandidate(s, opp)) continue;
    const minAPCost = minAPsToAttack(t, s, opp.gridNo, true);
    if (minAPCost > s.actionPoints) continue;
    const chanceToGetThrough = aiSoldierToSoldierChanceToGetThrough(t, s, opp, standing);
    if (chanceToGetThrough === 0) continue;
    if (!creatureCanFaceTarget(t, s, opp)) continue;
    let rawAPCost = minAPsToShootOrStab(t, s, opp.gridNo, false);
    if (opp.gridNo !== s.lastTarget) rawAPCost = u8(rawAPCost - AP.CHANGE_TARGET);
    const maxAim = maxPossibleAimTime(s, minAPCost, burstAPs);
    if (maxAim === NO_AIM_POSSIBLE) continue;
    const aim = bestAimAgainst(t, s, opp.gridNo, rawAPCost, maxAim);
    if (aim.hitRate === 0) continue;
    const chanceToReallyHit = u8(idiv(aim.chanceToHit * chanceToGetThrough, 100));
    if (chanceToReallyHit === 0) continue;
    if (throwingKnifeOutOfReach(t, s, opp, chanceToReallyHit)) continue;
    const threat = calcManThreatValue(t, opp, s.gridNo, true, s);
    const damage = estimateShotDamage(t, s, opp, aim.chanceToHit);
    let attackValue = shotAttackValue(damage, aim.hitRate, chanceToReallyHit, threat);
    if (isAssassin(s) && opp.team === Team.MILITIA) attackValue = idiv(attackValue, ASSASSIN_MILITIA_DIVISOR);
    if (keepsPreviousTarget(best, chanceToReallyHit, attackValue)) continue;
    best.possible = true;
    best.opponent = opp;
    best.aimTime = aim.aimTime;
    best.chanceToReallyHit = chanceToReallyHit;
    best.target = opp.gridNo;
    best.targetLevel = opp.level;
    best.attackValue = attackValue;
    best.apCost = u8(minAPCost + aim.aimTime);
  }
  return best;
}

function calcBestThrowNotPorted(best: AttackChoice): void {
  initAttackType(best);
}

function tossWeaponSlot(t: TacticalState, s: Soldier): number {
  if (isTankBody(s)) return findObj(s, itemIndex(t, 'TANK_CANNON'));
  const launcher = findAIUsableObjClass(t, s, ItemClass.LAUNCHER);
  if (launcher !== NO_SLOT) return launcher;
  const rocketLauncher = findObj(s, itemIndex(t, 'ROCKET_LAUNCHER'));
  if (rocketLauncher === NO_SLOT) return findThrowableGrenade(t, s);
  if (s.ai.morale > AiMorale.WORRIED && t.pre.int(2)) return findThrowableGrenade(t, s);
  return rocketLauncher;
}

export function checkIfTossPossible(t: TacticalState, s: Soldier, best: AttackChoice = emptyAttackChoice()): AttackChoice {
  best.weaponIn = tossWeaponSlot(t, s);
  if (best.weaponIn === NO_SLOT) return best;
  if (best.weaponIn !== InvSlot.HAND) rearrangePocket(s, InvSlot.HAND, best.weaponIn);
  if (s.actionPoints >= minAPsToAttack(t, s, s.lastTarget, false)) calcBestThrowNotPorted(best);
  if (best.weaponIn !== InvSlot.HAND) rearrangePocket(s, InvSlot.HAND, best.weaponIn);
  return best;
}

export function calcBestStab(_t: TacticalState, s: Soldier, _blade: boolean, best: AttackChoice = emptyAttackChoice()): AttackChoice {
  initAttackType(best);
  s.attackingWeapon = handObject(s).item;
  return best;
}

export function calcSpreadBurst(_t: TacticalState, _s: Soldier, _firstTarget: number, _targetLevel: number): void {}

function rangeInTiles(a: number, b: number): number {
  const ay = Math.trunc(a / WORLD_COLS);
  const by = Math.trunc(b / WORLD_COLS);
  return Math.trunc(Math.hypot(b - by * WORLD_COLS - (a - ay * WORLD_COLS), by - ay));
}

function considerProne(t: TacticalState, s: Soldier): boolean {
  if (s.ai.morale >= AiMorale.NORMAL) return false;
  return rangeInTiles(s.gridNo, closestKnownOpponent(t, s)) > PRONE_MIN_OPPONENT_RANGE;
}

export function stanceChange(t: TacticalState, s: Soldier, attackAPCost: number): number {
  const left = s.actionPoints - attackAPCost;
  const h = height(t.content, s.state);
  if (h === AnimHeight.STAND) {
    if (left < AP.CROUCH) return NO_STANCE_CHANGE;
    if (left >= AP.CROUCH + AP.PRONE && isValidStance(t, s, AnimHeight.PRONE) && considerProne(t, s)) return AnimHeight.PRONE;
    if (isValidStance(t, s, AnimHeight.CROUCH)) return AnimHeight.CROUCH;
  } else if (h === AnimHeight.CROUCH) {
    if (left >= AP.PRONE && isValidStance(t, s, AnimHeight.PRONE) && considerProne(t, s)) return AnimHeight.PRONE;
  }
  return NO_STANCE_CHANGE;
}

function stanceAdjustedChance(chance: number, stance: number, range: number): number {
  if (chance === 0) return 0;
  const distancePenalty = () => STANCE_PENALTY_PER_TILE * idiv(range - POINT_BLANK_RANGE, CELL_X_SIZE);
  if (stance === AnimHeight.CROUCH) {
    if (range > CROUCH_FULL_BONUS_RANGE) return chance + AIM_BONUS_CROUCHING;
    return range > POINT_BLANK_RANGE ? chance + distancePenalty() : chance;
  }
  if (stance === AnimHeight.PRONE) return range <= MIN_PRONE_RANGE ? 0 : chance + distancePenalty();
  return chance;
}

function stanceState(t: TacticalState, stance: number): number {
  const st = states(t.content.animations);
  return stance === AnimHeight.STAND ? st.STANDING : stance === AnimHeight.CROUCH ? st.CROUCHING : st.PRONE;
}

function chanceOfDamageFromStance(t: TacticalState, s: Soldier, attack: AttackChoice, stance: number, range: number): number {
  const ctgt = soldierToLocationChanceToGetThrough(t, s, attack.target, s.targetLevel, s.targetCubeLevel, attack.opponent);
  const cth = calcChanceToHitGun(t, s, attack.target, attack.aimTime, AimShot.TORSO, false);
  return stanceAdjustedChance(u32(idiv(ctgt * cth, 100)), stance, range);
}

export function shootingStanceChange(t: TacticalState, s: Soldier, attack: AttackChoice, direction: number): number {
  const minBonusPerChange = u32(MIN_STANCE_BONUS_BASE - MIN_STANCE_BONUS_PER_AIM_AP * attack.aimTime);
  const apsAfterAttack = i8(s.actionPoints - attack.apCost - apsToReadyWeapon(t.content, s));
  if (apsAfterAttack < AP.CROUCH) return NO_STANCE_CHANGE;
  const realState = s.state;
  const range = rangeInUnits(s.gridNo, attack.target);
  const current = Math.max(0, SHOOTING_STANCES.indexOf(endHeight(t.content, realState)));
  let bestState = realState;
  let bestChance = 0;
  let bestDiff = -1;
  let currentChance = 0;
  for (const [k, stance] of SHOOTING_STANCES.entries()) {
    const diff = Math.abs(k - current);
    if (diff === 2 && apsAfterAttack < AP.CROUCH + AP.PRONE) continue;
    if (!internalIsValidStance(t, s, direction, stance)) continue;
    s.state = stanceState(t, stance);
    const chance = chanceOfDamageFromStance(t, s, attack, stance, range);
    if (diff === 0) currentChance = chance;
    if (chance > bestChance) {
      bestChance = chance;
      bestState = s.state;
      bestDiff = diff;
    }
  }
  s.state = realState;
  if (bestDiff === 0 || Math.trunc(u32(bestChance - currentChance) / u32(bestDiff)) < minBonusPerChange) return NO_STANCE_CHANGE;
  return endHeight(t.content, bestState);
}
