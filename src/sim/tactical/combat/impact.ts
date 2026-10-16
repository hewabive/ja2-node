// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Weapons.cc AdjustImpactByHitLocation, BulletImpact. See docs/11 §4.2.

import { AmmoType, ItemClass } from '../../../content/items/items.ts';
import { pythSpacesAway } from '../../../content/world/grid.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import { AnimHeight, endHeight } from '../animation.ts';
import { InvSlot } from '../inventory.ts';
import { Opp } from '../perception/opp.ts';
import { Body, numSkillTraits, SkillTrait, type Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { totalArmourProtection } from './armour.ts';
import {
  AimShot,
  CRITICAL_HIT_THRESHOLD,
  HEAD_DAMAGE_MULTIPLIER,
  i8,
  LEGS_DAMAGE_MULTIPLIER,
  MAX_DISTANCE_FOR_MESSY_DEATH,
  MIN_DAMAGE_FOR_AUTO_FALL_OVER,
  MIN_DAMAGE_FOR_BLOWN_AWAY,
  MIN_DAMAGE_FOR_HEAD_EXPLOSION,
  MIN_DAMAGE_FOR_INSTANT_KILL,
  Special,
} from './types.ts';

export function adjustImpactByHitLocation(impact: number, location: number): { impact: number; crits: number } {
  if (location === AimShot.HEAD) {
    const crits = Math.trunc(Math.floor(Math.fround(Math.fround(HEAD_DAMAGE_MULTIPLIER) * Math.fround(impact))));
    return { impact: crits, crits };
  }
  if (location === AimShot.LEGS) {
    const m = Math.fround(LEGS_DAMAGE_MULTIPLIER);
    const crits = Math.floor(Math.fround(m * Math.fround(impact)));
    return { impact: Math.floor(Math.fround(m * Math.fround(crits))), crits };
  }
  return { impact, crits: impact };
}

export const isCreatureOrBloodcat = (s: Soldier): boolean =>
  (s.bodyType >= Body.ADULTFEMALEMONSTER && s.bodyType <= Body.QUEENMONSTER) || s.bodyType === Body.BLOODCAT;
export const isTankBody = (s: Soldier): boolean => s.bodyType === Body.TANK_NW || s.bodyType === Body.TANK_NE;
const inWater = (s: Soldier) => s.overTerrain >= Terrain.LOW_WATER && s.overTerrain <= Terrain.DEEP_WATER;

export function firerAmmoType(t: TacticalState, firer: Soldier): number {
  if (t.content.items.byIndex.get(firer.attackingWeapon)?.itemClass === ItemClass.THROWING_KNIFE) return AmmoType.KNIFE;
  return firer.inv[firer.attackingHand]?.gunAmmoType ?? AmmoType.REGULAR;
}

export interface ImpactResult {
  damage: number;
  special: number;
}

export function bulletImpact(
  t: TacticalState,
  firer: Soldier,
  target: Soldier,
  location: number,
  origImpactIn: number,
  hitBy: number,
  specialIn: number,
): ImpactResult {
  const ammo = firerAmmoType(t, firer);
  let special = specialIn;
  if (isTankBody(target) && ammo !== AmmoType.HEAT) return { damage: 0, special };
  const fluke = t.pre.int(51) - 25;
  let origImpact = Math.trunc((origImpactIn * (100 + fluke + Math.trunc(hitBy / 2))) / 100);
  if (origImpact < 1) origImpact = 1;
  if (ammo === AmmoType.HE || ammo === AmmoType.HEAT) {
    origImpact = Math.trunc((origImpact * 4) / 3);
    if (isTankBody(target)) origImpact = Math.trunc(origImpact / 2);
  }
  let impact =
    special === Special.BLINDED_BY_SPIT
      ? origImpact
      : origImpact - totalArmourProtection(t.content.items, t.pre, target, location, origImpact, ammo);
  if (ammo === AmmoType.HP || ammo === AmmoType.SLEEP_DART) impact = Math.max(impact, 0);
  else {
    impact = Math.max(impact, Math.trunc((origImpact + 5) / 10));
    if (ammo === AmmoType.BUCKSHOT && target.numPelletsHitBy > 0) impact += Math.trunc((target.numPelletsHitBy - 1) / 2);
  }
  let crits = 0;
  if (impact > 0 && !isTankBody(target)) {
    if (ammo === AmmoType.SLEEP_DART && hitBy > 20) return { damage: impact, special: Special.SLEEP_DART };
    if (ammo === AmmoType.HP) impact = Math.trunc((impact * 17) / 10);
    const adjusted = adjustImpactByHitLocation(impact, location);
    impact = adjusted.impact;
    crits = adjusted.crits;
    const close = pythSpacesAway(firer.gridNo, target.gridNo) <= MAX_DISTANCE_FOR_MESSY_DEATH;
    switch (location) {
      case AimShot.HEAD:
        if (close) {
          if (crits > MIN_DAMAGE_FOR_INSTANT_KILL && crits < target.life) {
            impact = target.life + t.rng.int(10);
            crits = impact;
          }
          if (crits >= target.life) {
            if (crits > MIN_DAMAGE_FOR_HEAD_EXPLOSION) special = Special.HEAD_EXPLODE;
            else if (
              crits > MIN_DAMAGE_FOR_HEAD_EXPLOSION / 2 &&
              t.pre.int(Math.trunc(MIN_DAMAGE_FOR_HEAD_EXPLOSION / 2)) < crits - Math.trunc(MIN_DAMAGE_FOR_HEAD_EXPLOSION / 2)
            )
              special = Special.HEAD_EXPLODE;
          }
        }
        break;
      case AimShot.LEGS:
        if (target.bodyType <= Body.REGFEMALE && endHeight(t.content, target.state) === AnimHeight.STAND && !inWater(target)) {
          if (crits > MIN_DAMAGE_FOR_AUTO_FALL_OVER) special = Special.LEG_FALLDOWN;
          else if (
            crits > MIN_DAMAGE_FOR_AUTO_FALL_OVER / 2 &&
            t.pre.int(MIN_DAMAGE_FOR_AUTO_FALL_OVER / 2) < crits - MIN_DAMAGE_FOR_AUTO_FALL_OVER / 2
          )
            special = Special.LEG_FALLDOWN;
        }
        break;
      case AimShot.TORSO:
        if (close) {
          if (impact > MIN_DAMAGE_FOR_INSTANT_KILL && impact < target.life) {
            impact = target.life + t.rng.int(10);
            crits = impact;
          } else if (impact + target.damageWindow > MIN_DAMAGE_FOR_BLOWN_AWAY + MIN_DAMAGE_FOR_INSTANT_KILL) {
            impact = target.life + t.rng.int(10);
            crits = impact;
          }
          if (impact > MIN_DAMAGE_FOR_BLOWN_AWAY && impact >= target.life) special = Special.CHEST_EXPLODE;
        }
        break;
    }
  }
  if (ammo === AmmoType.KNIFE && firer.oppList[target.id] === Opp.SEEN_CURRENTLY) {
    if (
      target.oppList[firer.id] === Opp.NOT_HEARD_OR_SEEN &&
      !isCreatureOrBloodcat(target) &&
      (location === AimShot.HEAD || location === AimShot.TORSO) &&
      t.pre.int(100) < (hitBy + 10 * numSkillTraits(firer, SkillTrait.THROWING)) >>> 0
    ) {
      impact = target.life + t.rng.int(10);
      crits = impact;
    }
  }
  if (crits > 0 && crits < target.life) {
    if (t.pre.int(Math.trunc(crits / 2) + firer.aimTime * 5) + 1 > CRITICAL_HIT_THRESHOLD) {
      let loss = i8(t.pre.int(Math.trunc(crits / 2)) + 1);
      const reduce = (stat: 'wisdom' | 'dexterity' | 'strength' | 'agility') => {
        if (loss >= target.stats[stat]) loss = target.stats[stat] - 1;
        if (loss > 0) {
          target.stats[stat] -= loss;
          target.statDamage[stat] += loss;
        }
      };
      switch (location) {
        case AimShot.HEAD:
          reduce('wisdom');
          break;
        case AimShot.TORSO:
          if (t.pre.int(100) < 50 && !target.monsterOrAnimal) reduce('dexterity');
          else reduce('strength');
          break;
        case AimShot.LEGS:
          reduce('agility');
          break;
      }
    }
  }
  return { damage: impact, special };
}

export const HEAD_SLOTS = [InvSlot.HEAD1, InvSlot.HEAD2] as const;
