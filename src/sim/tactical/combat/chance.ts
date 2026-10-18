// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Weapons.cc GunRange, CalcChanceToHitGun, AICalcChanceToHitGun; Soldier_Control.cc IsValidSecondHandShot;
// @src TileEngine/Isometric_Utils.cc GetRangeInCellCoordsFromGridNoDiff; TacticalAI/AIUtils.cc SoldierDifficultyLevel.
// @src See docs/11 §2.

import { ItemClass, ItemFlags, type ItemTable, NOTHING, WEAPON_CLASSES, WeaponClass } from '../../../content/items/items.ts';
import { CELL_X_SIZE, WORLD_COLS } from '../../../content/world/grid.ts';
import { findAttachment, type ItemObject, USABLE_STATUS } from '../../items/object.ts';
import { AnimHeight, endHeight, height, states } from '../animation.ts';
import { isGassed } from '../explosions/smoke.ts';
import { isValidSecondHandShot, wearsHeadGear } from '../inventory.ts';
import { lightTrueLevel, NORMAL_LIGHTLEVEL_DAY } from '../lighting/lighting.ts';
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
import { soldierTo3DLocationLos, soldierToBodyPartLos } from './positions.ts';
import { Aim, AimShot, CTH_MAXIMUM, CTH_MINIMUM, MIN_PRONE_RANGE, weaponStatusMod } from './types.ts';

const IRRELEVANT = -1;
export const ENEMY_TO_HIT_MOD = [-10, -5, 0, 5, 10];
const DIFFICULTY_EASY = 1;
const SIGHT_LIMIT = 52;

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
      : effectiveMarksmanship(s);
  mrk += moraleModifier(s);
  mrk -= Math.trunc(Math.trunc((mrk * fatiguePenaltyPercent(s)) / 100) / 2);
  let c = cond >= mrk ? mrk : Math.trunc((mrk + cond) / 2);
  if (g === s.lastTarget) c += Aim.BONUS_SAME_TARGET;
  if (s.personalityTrait === Personality.PSYCHO) c += Aim.BONUS_PSYCHO;
  const range = rangeInUnits(s.gridNo, g);
  const eh = endHeight(t.content, s.state);
  if (eh === AnimHeight.CROUCH) c += Math.min(Math.trunc(range / 10), 10);
  else if (eh === AnimHeight.PRONE && range > MIN_PRONE_RANGE) {
    let bonus = Math.min(Math.trunc(range / 10), 20);
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
    c += t.options.difficulty === DIFFICULTY_EASY ? -5 : Math.min(0, ENEMY_TO_HIT_MOD[soldierDifficultyLevel(t, s)] ?? 0);
  if (isGassed(t, s)) c -= Aim.PENALTY_GASSED;
  if (s.shock) c -= Aim.PENALTY_PER_SHOCK * s.shock;
  let maxRange = 10;
  if (def?.itemClass === ItemClass.GUN) {
    const extender = findAttachment(gun, items.byName.get('GUN_BARREL_EXTENDER')?.index ?? -2);
    if (extender !== -1 && modify) {
      const ext = gun.attachments[extender] as { item: number; status: number };
      ext.status -= t.rng.int(2);
      if (ext.status - t.rng.int(35) - t.rng.int(35) < USABLE_STATUS) {
        ext.item = NOTHING;
        ext.status = 0;
        c -= 30;
      }
    }
    maxRange = gunRange(items, gun);
  }
  if (sight > 0) {
    const sunGoggles = items.byName.get('SUNGOGGLES')?.index ?? -2;
    if (wearsHeadGear(s.inv, sunGoggles) && lightTrueLevel(t, g, s.targetLevel) < NORMAL_LIGHTLEVEL_DAY) sight -= Math.trunc(range / 10);
    const scope = findAttachment(gun, items.byName.get('SNIPERSCOPE')?.index ?? -2);
    if (scope !== -1 && range > 60 && aim > 0 && !s.doBurst) {
      let bonus = Math.trunc((20 * aim * (range - 60)) / 100);
      bonus = Math.trunc((bonus * weaponStatusMod(gun.attachments[scope]?.status ?? 0)) / 100);
      sight = Math.max(sight - bonus, 1);
    }
    const laser = findAttachment(gun, items.byName.get('LASERSCOPE')?.index ?? -2);
    const rocketRifle = def?.name === 'ROCKET_RIFLE' || def?.name === 'AUTO_ROCKET_RIFLE';
    if (laser !== -1 || rocketRifle) {
      const ls = weaponStatusMod(rocketRifle ? (gun.status[0] ?? 0) : (gun.attachments[laser]?.status ?? 0));
      c += ls > 50 ? Math.trunc((20 * (ls - 50)) / 50) : Math.trunc((-20 * (50 - ls)) / 50);
    }
  }
  if (aimPos === AimShot.HEAD) c -= Math.trunc((3 * sight) / 10);
  else if (aimPos === AimShot.LEGS) c -= Math.trunc(sight / 10);
  const rangePenalty = Math.trunc(((maxRange - 3 * range) * 10) / 170);
  if (rangePenalty < 0) c += rangePenalty;
  if (isTank(s) && Math.trunc(range / 10) < 26) c -= 2 * (26 - Math.trunc(range / 10));
  if (sight === 0) c -= Aim.PENALTY_BLIND;
  else c += Math.trunc((3 * (90 - sight)) / 10);
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
        if (isTank(s) && range < 120) c -= 13 * Math.trunc((120 - range) / 10);
        else if (range > 76) c -= Aim.PENALTY_TARGET_CROUCHED;
        else if (range > 16) c -= 3 * Math.trunc((range - 16) / 10);
        break;
      case AnimHeight.PRONE:
        if (isTank(s) && range < 120) c -= 25 * Math.trunc((120 - range) / 10);
        else if (range > 16) c -= Math.min(3 * Math.trunc((range - 16) / 10), Aim.PENALTY_TARGET_PRONE);
        break;
      case AnimHeight.STAND:
        if (range <= MIN_PRONE_RANGE && eh === AnimHeight.PRONE) {
          const a = aimPos === AimShot.RANDOM || aimPos === AimShot.GLAND ? AimShot.TORSO : aimPos;
          c -= (5 - a - Math.trunc(range / 10)) * 10;
        }
        break;
    }
    c -= Math.min(Math.trunc((target.tilesMoved * 3) / 2), 30);
    if (target.oppList[s.id] === Opp.SEEN_CURRENTLY && !isTank(target) && s.bodyType === Body.QUEENMONSTER) {
      let p = Math.trunc(effectiveAgility(target) / 5) + 2 * effectiveExpLevel(target);
      if (height(t.content, target.state) === AnimHeight.CROUCH) p = Math.trunc((p * 2) / 3);
      else if (height(t.content, target.state) === AnimHeight.PRONE) p = Math.trunc(p / 3);
      const b = Math.trunc(effectiveDexterity(s) / 5) + 2 * effectiveExpLevel(s);
      if (p > b) c -= p - b;
    }
  } else if (isTank(s) && range < 120) c -= 25 * Math.trunc((120 - range) / 10);
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
