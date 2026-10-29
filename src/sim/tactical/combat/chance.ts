// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Weapons.cc GunRange, CalcChanceToHitGun, AICalcChanceToHitGun; Soldier_Control.cc IsValidSecondHandShot;
// @src TileEngine/Isometric_Utils.cc GetRangeInCellCoordsFromGridNoDiff; TacticalAI/AIUtils.cc SoldierDifficultyLevel;
// @src Soldier_Control.cc GetRobotController.

import { ItemClass, ItemFlags, type ItemTable, NOTHING, WEAPON_CLASSES, WeaponClass } from '../../../content/items/items.ts';
import { CELL_X_SIZE, WORLD_COLS } from '../../../content/world/grid.ts';
import { i8, u32 } from '../../../core/int.ts';
import { createItem, findAttachment, type ItemObject, USABLE_STATUS } from '../../items/object.ts';
import { AnimHeight, endHeight, height, states } from '../animation.ts';
import { isGassed } from '../explosions/smoke.ts';
import { isValidSecondHandShot, wearsHeadGear } from '../inventory.ts';
import { lightTrueLevel, NORMAL_LIGHTLEVEL_DAY } from '../lighting/lighting.ts';
import { isRobot } from '../narrative/robot.ts';
import { Opp } from '../perception/opp.ts';
import { distanceVisible } from '../perception/sight.ts';
import {
  effectiveAgility,
  effectiveDexterity,
  effectiveExpLevel,
  effectiveLife,
  effectiveMarksmanship,
  effectiveWisdom,
  fatiguePenaltyPercent,
  moraleModifier,
} from '../skills.ts';
import { Body, numSkillTraits, Personality, SKILL_TRAIT_BONUS, SkillTrait, type Soldier, SoldierClass, Team } from '../soldier.ts';
import { type TacticalState, whoIsThere } from '../state.ts';
import { addItemToPool, Visibility } from '../world-items.ts';
import { soldierTo3DLocationLos, soldierToBodyPartLos } from './positions.ts';
import { Aim, AimShot, CTH_MAXIMUM, CTH_MINIMUM, MIN_PRONE_RANGE, NORMAL_RANGE, POINT_BLANK_RANGE, weaponStatusMod } from './types.ts';

const IRRELEVANT = -1;
export const ENEMY_TO_HIT_MOD = [-10, -5, 0, 5, 10];
const DIFFICULTY_EASY = 1;
const EASY_ENEMY_PENALTY = 5;
const MAX_DISTANCE_VISIBLE = 26;
const SIGHT_LIMIT = 2 * MAX_DISTANCE_VISIBLE;
const AIM_BONUS_CROUCHING = 10;
const AIM_BONUS_PRONE = 20;
const MIN_SCOPE_RANGE = 60;
const SNIPERSCOPE_AIM_BONUS = 20;
const LASERSCOPE_BONUS = 20;
const LASERSCOPE_NEUTRAL_STATUS = 50;
const RANGE_PENALTY_DIVISOR = 17 * CELL_X_SIZE;
const TANK_CLOSE_PENALTY_PER_TILE = 2;
const MIN_TANK_RANGE = 120;
const TANK_CROUCHED_TARGET_PENALTY_PER_TILE = 13;
const TANK_PRONE_TARGET_PENALTY_PER_TILE = 25;
const LOW_TARGET_PENALTY_PER_TILE = 3;
const CROUCHED_TARGET_FULL_PENALTY_RANGE = POINT_BLANK_RANGE + CELL_X_SIZE * Math.trunc(Aim.PENALTY_TARGET_CROUCHED / 3);
const MAX_TARGET_MOVED_PENALTY = 30;
const PRONE_CLOSE_SHOT_HEIGHT_STEPS = 5;
const PENALTY_PER_HEIGHT_STEP = 10;

export function rangeInUnits(a: number, b: number): number {
  const dx = (a % WORLD_COLS) - (b % WORLD_COLS);
  const dy = Math.trunc(a / WORLD_COLS) - Math.trunc(b / WORLD_COLS);
  return Math.trunc(Math.sqrt(dx * dx + dy * dy) * 10);
}

export function gunRange(items: ItemTable, gun: ItemObject): number {
  const def = items.byIndex.get(gun.item);
  if (!def || !(def.itemClass & WEAPON_CLASSES)) return CELL_X_SIZE;
  let range = def.weapon?.range ?? 0;
  const extender = findAttachment(gun, items.byName.get('GUN_BARREL_EXTENDER')?.index ?? -2);
  if (extender !== -1) range += Math.trunc((100 * weaponStatusMod(gun.attachments[extender]?.status ?? 0)) / 100);
  return range;
}

export function soldierDifficultyLevel(t: Pick<TacticalState, 'campaign'>, s: Soldier): number {
  const base = 1 + Math.trunc(t.campaign.difficultyModifier / 34);
  let d: number;
  switch (s.soldierClass) {
    case SoldierClass.ADMINISTRATOR:
      d = base - 1;
      break;
    case SoldierClass.ARMY:
      d = base;
      break;
    case SoldierClass.ELITE:
      d = base + 1;
      break;
    case SoldierClass.GREEN_MILITIA:
      d = 2;
      break;
    case SoldierClass.REG_MILITIA:
      d = 3;
      break;
    case SoldierClass.ELITE_MILITIA:
      d = 4;
      break;
    default:
      d = s.team === Team.CREATURE ? base + Math.trunc(s.level / 4) : base + Math.trunc(s.level / 4) - 1;
  }
  return Math.min(4, Math.max(0, d));
}

const isTank = (s: Soldier) => s.bodyType === Body.TANK_NW || s.bodyType === Body.TANK_NE;

const tilesInside = (outer: number, inner: number) => Math.trunc((outer - inner) / CELL_X_SIZE);

function proneShooterCloseShotPenalty(aimPos: number, range: number): number {
  const heightStep = aimPos === AimShot.RANDOM || aimPos === AimShot.GLAND ? AimShot.TORSO : aimPos;
  return (PRONE_CLOSE_SHOT_HEIGHT_STEPS - heightStep - Math.trunc(range / CELL_X_SIZE)) * PENALTY_PER_HEIGHT_STEP;
}

function queenShotDodge(t: TacticalState, shooter: Soldier, target: Soldier): number {
  if (shooter.bodyType !== Body.QUEENMONSTER || isTank(target) || target.oppList[shooter.id] !== Opp.SEEN_CURRENTLY) return 0;
  let dodge = Math.trunc(effectiveAgility(target) / 5) + 2 * effectiveExpLevel(target);
  const stance = height(t.content, target.state);
  if (stance === AnimHeight.CROUCH) dodge = Math.trunc((dodge * 2) / 3);
  else if (stance === AnimHeight.PRONE) dodge = Math.trunc(dodge / 3);
  const tracking = Math.trunc(effectiveDexterity(shooter) / 5) + 2 * effectiveExpLevel(shooter);
  return Math.max(0, dodge - tracking);
}

function aimingMarksmanship(t: TacticalState, s: Soldier): number {
  const controller = isRobot(s) ? t.narrative.robotController(s) : null;
  const own = effectiveMarksmanship(s);
  return controller ? Math.max(own, effectiveMarksmanship(controller)) : own;
}

const EXTENDER_WEAR_RANGE = 2;
const EXTENDER_HOLD_RANGE = 35;
const EXTENDER_FALL_OFF_PENALTY = 30;

function barrelExtenderFallsOff(t: TacticalState, s: Soldier, gun: ItemObject): boolean {
  const extender = t.content.items.byName.get('GUN_BARREL_EXTENDER')?.index ?? -2;
  const slot = findAttachment(gun, extender);
  const attached = gun.attachments[slot];
  if (!attached) return false;
  attached.status = i8(attached.status - t.rng.int(EXTENDER_WEAR_RANGE));
  const hold = u32(attached.status - t.rng.int(EXTENDER_HOLD_RANGE) - t.rng.int(EXTENDER_HOLD_RANGE));
  if (hold >= USABLE_STATUS) return false;
  addItemToPool(t, s.gridNo, createItem(t.content.items, extender, attached.status), Visibility.VISIBLE, s.level);
  attached.item = NOTHING;
  attached.status = 0;
  return true;
}

export function calcChanceToHitGun(t: TacticalState, s: Soldier, g: number, aim: number, aimPos: number, modify: boolean): number {
  const items = t.content.items;
  if (s.stats.marksmanship === 0) return CTH_MINIMUM;
  const gun = s.inv[s.attackingHand] as ItemObject;
  const item = s.attackingWeapon;
  const def = items.byIndex.get(item);
  const cond = weaponStatusMod(gun.status[0] ?? 0);
  let mrk =
    def?.name === 'ROCKET_LAUNCHER'
      ? Math.trunc((effectiveDexterity(s) + effectiveMarksmanship(s) + effectiveWisdom(s) + 10 * effectiveExpLevel(s)) / 4) +
        (SKILL_TRAIT_BONUS[SkillTrait.HEAVY_WEAPS] ?? 0) * numSkillTraits(s, SkillTrait.HEAVY_WEAPS)
      : aimingMarksmanship(t, s);
  mrk += moraleModifier(s);
  mrk -= Math.trunc(Math.trunc((mrk * fatiguePenaltyPercent(s)) / 100) / 2);
  let c = cond >= mrk ? mrk : Math.trunc((mrk + cond) / 2);
  if (g === s.lastTarget) c += Aim.BONUS_SAME_TARGET;
  if (s.personalityTrait === Personality.PSYCHO) c += Aim.BONUS_PSYCHO;
  const range = rangeInUnits(s.gridNo, g);
  const eh = endHeight(t.content, s.state);
  if (eh === AnimHeight.CROUCH) c += Math.min(Math.trunc(range / 10), AIM_BONUS_CROUCHING);
  else if (eh === AnimHeight.PRONE && range > MIN_PRONE_RANGE) {
    let bonus = Math.min(Math.trunc(range / 10), AIM_BONUS_PRONE);
    const bipod = findAttachment(gun, items.byName.get('BIPOD')?.index ?? -2);
    if (bipod !== -1) bonus += Math.trunc(Math.trunc((bonus * weaponStatusMod(gun.attachments[bipod]?.status ?? 0)) / 100) / 2);
    c += bonus;
  }
  if (def && def.itemClass & (ItemClass.GUN | ItemClass.BLADE | ItemClass.THROWING_KNIFE | ItemClass.LAUNCHER | ItemClass.TENTACLES)) {
    if (!(def.flags & ItemFlags.TWO_HANDED)) {
      if (def.weapon?.weaponClass === WeaponClass.SMG) c -= Aim.PENALTY_SMG;
      if (!numSkillTraits(s, SkillTrait.AMBIDEXT) && isValidSecondHandShot(items, s)) c -= Aim.PENALTY_DUAL_PISTOLS;
    }
  }
  if (s.doBurst) {
    let penalty = (def?.weapon?.burstPenalty ?? 0) * (s.doBurst - 1);
    const auto = numSkillTraits(s, SkillTrait.AUTO_WEAPS);
    if (auto) penalty = Math.trunc(penalty / (2 * auto));
    c -= penalty;
  }
  const distVis = distanceVisible(t, s, IRRELEVANT, IRRELEVANT, g, 0);
  let sight = -1;
  const seenTarget = whoIsThere(t, g, s.targetLevel);
  if (
    seenTarget &&
    (s.oppList[seenTarget.id] === Opp.SEEN_CURRENTLY || (t.perception.publicOpp[s.team]?.[seenTarget.id] ?? 0) === Opp.SEEN_CURRENTLY)
  )
    sight = soldierToBodyPartLos(t, s, g, s.targetLevel, s.aimShotLocation, SIGHT_LIMIT, true);
  if (sight === -1) sight = soldierTo3DLocationLos(t, s, g, s.targetLevel, s.targetCubeLevel, SIGHT_LIMIT, true);
  sight *= 2;
  if (sight > distVis * 10) sight += sight - distVis * 10;
  if (sight > 0 && aim && !s.doBurst) c += Aim.BONUS_PER_AP * aim;
  if (s.team !== Team.OUR)
    c += t.options.difficulty === DIFFICULTY_EASY ? -EASY_ENEMY_PENALTY : Math.min(0, ENEMY_TO_HIT_MOD[soldierDifficultyLevel(t, s)] ?? 0);
  if (isGassed(t, s)) c -= Aim.PENALTY_GASSED;
  if (s.serviceCount > 0) c -= Aim.PENALTY_GETTINGAID;
  if (s.shock) c -= Aim.PENALTY_PER_SHOCK * s.shock;
  let maxRange = CELL_X_SIZE;
  if (def?.itemClass === ItemClass.GUN) {
    if (modify && barrelExtenderFallsOff(t, s, gun)) c -= EXTENDER_FALL_OFF_PENALTY;
    maxRange = gunRange(items, gun);
  }
  if (sight > 0) {
    const sunGoggles = items.byName.get('SUNGOGGLES')?.index ?? -2;
    if (wearsHeadGear(s.inv, sunGoggles) && lightTrueLevel(t, g, s.targetLevel) < NORMAL_LIGHTLEVEL_DAY) sight -= Math.trunc(range / 10);
    const scope = findAttachment(gun, items.byName.get('SNIPERSCOPE')?.index ?? -2);
    if (scope !== -1 && range > MIN_SCOPE_RANGE && aim > 0 && !s.doBurst) {
      let bonus = Math.trunc((SNIPERSCOPE_AIM_BONUS * aim * (range - MIN_SCOPE_RANGE)) / 100);
      bonus = Math.trunc((bonus * weaponStatusMod(gun.attachments[scope]?.status ?? 0)) / 100);
      sight = Math.max(sight - bonus, 1);
    }
    const laser = findAttachment(gun, items.byName.get('LASERSCOPE')?.index ?? -2);
    const rocketRifle = def?.name === 'ROCKET_RIFLE' || def?.name === 'AUTO_ROCKET_RIFLE';
    if (laser !== -1 || rocketRifle) {
      const ls = weaponStatusMod(rocketRifle ? (gun.status[0] ?? 0) : (gun.attachments[laser]?.status ?? 0));
      c +=
        ls > LASERSCOPE_NEUTRAL_STATUS
          ? Math.trunc((LASERSCOPE_BONUS * (ls - LASERSCOPE_NEUTRAL_STATUS)) / LASERSCOPE_NEUTRAL_STATUS)
          : Math.trunc((-LASERSCOPE_BONUS * (LASERSCOPE_NEUTRAL_STATUS - ls)) / LASERSCOPE_NEUTRAL_STATUS);
    }
  }
  if (aimPos === AimShot.HEAD) c -= Math.trunc((3 * sight) / 10);
  else if (aimPos === AimShot.LEGS) c -= Math.trunc(sight / 10);
  const rangePenalty = Math.trunc(((maxRange - 3 * range) * 10) / RANGE_PENALTY_DIVISOR);
  if (rangePenalty < 0) c += rangePenalty;
  const tiles = Math.trunc(range / CELL_X_SIZE);
  if (isTank(s) && tiles < MAX_DISTANCE_VISIBLE) c -= TANK_CLOSE_PENALTY_PER_TILE * (MAX_DISTANCE_VISIBLE - tiles);
  if (sight === 0) c -= Aim.PENALTY_BLIND;
  else c += Math.trunc((3 * (NORMAL_RANGE - sight)) / CELL_X_SIZE);
  if (s.level === 0) {
    if (s.targetLevel > 0) c -= Aim.PENALTY_FIRING_UP;
  } else {
    if (s.targetLevel === 0) c += Aim.BONUS_FIRING_DOWN;
    c += (SKILL_TRAIT_BONUS[SkillTrait.ONROOF] ?? 0) * numSkillTraits(s, SkillTrait.ONROOF);
  }
  const target = whoIsThere(t, g, s.targetLevel);
  if (target) {
    switch (height(t.content, target.state)) {
      case AnimHeight.CROUCH:
        if (isTank(s) && range < MIN_TANK_RANGE) c -= TANK_CROUCHED_TARGET_PENALTY_PER_TILE * tilesInside(MIN_TANK_RANGE, range);
        else if (range > CROUCHED_TARGET_FULL_PENALTY_RANGE) c -= Aim.PENALTY_TARGET_CROUCHED;
        else if (range > POINT_BLANK_RANGE) c -= LOW_TARGET_PENALTY_PER_TILE * tilesInside(range, POINT_BLANK_RANGE);
        break;
      case AnimHeight.PRONE:
        if (isTank(s) && range < MIN_TANK_RANGE) c -= TANK_PRONE_TARGET_PENALTY_PER_TILE * tilesInside(MIN_TANK_RANGE, range);
        else if (range > POINT_BLANK_RANGE)
          c -= Math.min(LOW_TARGET_PENALTY_PER_TILE * tilesInside(range, POINT_BLANK_RANGE), Aim.PENALTY_TARGET_PRONE);
        break;
      case AnimHeight.STAND:
        if (range <= MIN_PRONE_RANGE && eh === AnimHeight.PRONE) c -= proneShooterCloseShotPenalty(aimPos, range);
        break;
    }
    c -= Math.min(Math.trunc((target.tilesMoved * 3) / 2), MAX_TARGET_MOVED_PENALTY);
    c -= queenShotDodge(t, s, target);
  } else if (isTank(s) && range < MIN_TANK_RANGE) c -= TANK_PRONE_TARGET_PENALTY_PER_TILE * tilesInside(MIN_TANK_RANGE, range);
  if (c > 0 && s.life < s.lifeMax) {
    const p = Math.trunc((c * 2 * (s.lifeMax - effectiveLife(s))) / (3 * s.lifeMax));
    c -= Math.trunc((p * (100 - 10 * (effectiveExpLevel(s) - 1))) / 100);
  }
  if (c > 0 && s.breath < 100) {
    const p = Math.trunc((c * (100 - s.breath)) / 200);
    c -= Math.trunc((p * (100 - (effectiveDexterity(s) - 10))) / 100);
  }
  if (range > maxRange) c = Math.trunc(c / 2);
  if (sight > distVis * 10) c = Math.trunc(c / 2);
  return c < CTH_MINIMUM ? (isTank(s) ? 0 : CTH_MINIMUM) : Math.min(c, CTH_MAXIMUM);
}

export function aiCalcChanceToHitGun(t: TacticalState, s: Soldier, g: number, aim: number, aimPos: number): number {
  const saved = s.state;
  s.state = states(t.content.animations).STANDING;
  const chance = calcChanceToHitGun(t, s, g, aim, aimPos, false);
  s.state = saved;
  return chance;
}
