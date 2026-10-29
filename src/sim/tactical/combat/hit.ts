// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/LOS.cc BulletHitMerc (with the blood spewed behind a pass-through); Weapons.cc WeaponHit; Soldier_Control.cc EVENT_SoldierGotHit,
// @src CalcScreamVolume, DoGenericHit, SoldierGotHitGunFire, SoldierGotHitExplosion, SoldierGotHitBlade,
// @src SoldierGotHitPunch, SoldierTakeDamage (with the Kingpin civilian rule of the Maria quest and
// @src QUOTE_TAKEN_A_BREATING), HandleTakeDamageDeath, CalcSoldierNextBleed, ReleaseSoldiersAttacker,
// @src CheckForFreeupFromHit, SoldierCollapse, ChangeToFlybackAnimation, ChangeToFallbackAnimation, BeginTyingToFall;
// @src Soldier_Ani.cc OKFallDirection; Weapons.cc DoSpecialEffectAmmoMiss (the miniboom of HE and HEAT rounds, creature
// @src spit gas).

import { AnimFlags } from '../../../content/anim/tables.ts';
import { AmmoType, ItemClass, ItemFlags, NOTHING } from '../../../content/items/items.ts';
import { DIRECTION_INCREMENT, newGridNo, pythSpacesAway, spacesAway } from '../../../content/world/grid.ts';
import { TravelCost } from '../../../content/world/movement-costs.ts';
import type { StructureInstance } from '../../../content/world/structures.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import { copyObjectInto, createItem, deleteObject, type ItemObject, ObjectFlags } from '../../items/object.ts';
import { Fact, Quest } from '../../strategic/narrative/fact-ids.ts';
import { QuestStatus } from '../../strategic/narrative/facts.ts';
import { Npc } from '../../strategic/narrative/npc-ids.ts';
import { anim, animName } from '../anim-states.ts';
import { AnimHeight, endHeight, hasAnimFlag, initNewSoldierAnim, setDesiredDirection, setSoldierDirection } from '../animation.ts';
import { igniteExplosionXY } from '../explosions/explosion.ts';
import { checkEquipmentForDamage } from '../explosions/item-damage.ts';
import { newSmokeEffect } from '../explosions/smoke.ts';
import { isRoofPresentAt } from '../explosions/trajectory.ts';
import { cancelAllServices, receivingSoldierCancelServices } from '../first-aid.ts';
import { cancelGiveOnCollapse } from '../give.ts';
import { InvSlot } from '../inventory.ts';
import { directionToward, setSoldierDestination, worldIndexFromCoords } from '../movement.ts';
import { boxingActive } from '../narrative/boxing-state.ts';
import { inInterrogation, inMeanwhile } from '../narrative/meanwhile-rules.ts';
import { newOKDestination } from '../pathfinding.ts';
import { makeNoise, NoiseKind } from '../perception/noise.ts';
import { SightFlags } from '../perception/opp.ts';
import { decayIndividualOpplist, handleSight } from '../perception/sight.ts';
import { animStructureDef, isValidStance } from '../person-structure.ts';
import { deductPoints } from '../points.ts';
import { profileProgress, StatKind } from '../profiles.ts';
import { effectiveLife, effectiveStrength } from '../skills.ts';
import { BLOOD_DIVISOR, BloodKind, DROPPED_IN_SIGHT, dropBlood, internalDropBlood, MAX_BLOOD_QUANTITY } from '../smell.ts';
import { Body, CivilianGroup, NO_PROFILE, OKLIFE, Side, type Soldier, shownToPlayer, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { screamVolume, soundPlace, unseenVictim } from '../unseen-sources.ts';
import { addItemToPool, Visibility } from '../world-items.ts';
import { calcBodyImpactReduction, totalArmourProtection } from './armour.ts';
import { freeUpAttackerGivenTarget, reduceAttackBusyCount, reduceAttackBusyGivenTarget } from './barrier.ts';
import { type Bullet, bulletWorldXY, removeBullet } from './bullets.ts';
import { checkForAndHandleSoldierDyingNotFromHit } from './death.ts';
import { StatCause, statChange } from './experience.ts';
import { bulletImpact, isCreatureOrBloodcat } from './impact.ts';
import { handleMoraleEvent, MoraleEvent } from './morale.ts';
import {
  AimShot,
  BP_GET_HIT,
  BP_GET_WOUNDED,
  CONSCIOUSNESS,
  DamageReason,
  i8,
  i16,
  MAX_DISTANCE_FOR_MESSY_DEATH,
  PUNCH_REAL_DAMAGE_PORTION,
  Special,
  u8,
} from './types.ts';

const STANDING_HEAD_BOTTOM_POS = 159;
const STANDING_TORSO_BOTTOM_POS = 95;
const CROUCHED_HEAD_BOTTOM_POS = 95;
const CROUCHED_TORSO_BOTTOM_POS = 47;
const HEIGHT_UNITS = 256;
const AP_GET_WOUNDED_DIVISOR = 4;
const DAMAGE_DISPLAY_DELAY = 250;
const DAMAGE_DISPLAY_STEPS = 8;
const MIN_GORE_BLAST_RADIUS = 3;

const LOCATION_NAMES = ['random', 'head', 'torso', 'legs', 'gland'] as const;

const isVehicle = (s: Soldier) => s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP;
const isRobot = (s: Soldier) => s.bodyType === Body.ROBOTNOWEAPON;
const isMonster = (s: Soldier) => s.bodyType >= Body.ADULTFEMALEMONSTER && s.bodyType <= Body.QUEENMONSTER;
const isMercBody = (s: Soldier) => s.bodyType <= Body.REGFEMALE;
const oneC = (d: number) => (d + 1) % 8;
const oneCC = (d: number) => (d + 7) % 8;
const opposite = (d: number) => (d + 4) % 8;
const inWater = (s: Soldier) => s.overTerrain >= Terrain.LOW_WATER && s.overTerrain <= Terrain.DEEP_WATER;
const itemIndex = (t: TacticalState, name: string) => t.content.items.byName.get(name)?.index ?? -2;
const _itemClassOf = (t: TacticalState, item: number) => t.content.items.byIndex.get(item)?.itemClass ?? ItemClass.NONE;

function hitLocationFromZ(t: TacticalState, b: Bullet, tgt: Soldier): number {
  if (tgt.overTerrain === Terrain.DEEP_WATER) return AimShot.HEAD;
  const end = endHeight(t.content, tgt.state);
  if (end === AnimHeight.PRONE) return AimShot.TORSO;
  let z = Math.fround(Math.fround(Math.fround(b.z) / (1 << 20)) - Math.trunc(((t.world.level.heights[b.gridNo] ?? 0) * 256) / 50));
  if (z > HEIGHT_UNITS) z = Math.fround(z - HEIGHT_UNITS);
  if (end === AnimHeight.STAND)
    return z > STANDING_HEAD_BOTTOM_POS ? AimShot.HEAD : z < STANDING_TORSO_BOTTOM_POS ? AimShot.LEGS : AimShot.TORSO;
  return z > CROUCHED_HEAD_BOTTOM_POS ? AimShot.HEAD : z < CROUCHED_TORSO_BOTTOM_POS ? AimShot.LEGS : AimShot.TORSO;
}

export function bulletHitMerc(t: TacticalState, b: Bullet, structure: StructureInstance, intended: boolean): boolean {
  const firer = b.firer;
  const tgt = t.soldiers[structure.id];
  if (!tgt) return false;
  let location: number = AimShot.RANDOM;
  let special: number = Special.NONE;
  let headSlot = -1;
  let ammo: number;
  if (b.flags & 0x0002) {
    const slot = tgt.inv.findIndex((o, k) => k >= InvSlot.BIGPOCK1 && k <= InvSlot.SMALLPOCK8 && o.item === NOTHING);
    const knife = createItem(t.content.items, itemIndex(t, 'BLOODY_THROWING_KNIFE'), b.itemStatus);
    if (slot === -1) addItemToPool(t, tgt.gridNo, knife, Visibility.INVISIBLE, tgt.level);
    else copyObjectInto(knife, tgt.inv[slot] as ItemObject);
    ammo = AmmoType.KNIFE;
  } else ammo = firer.inv[firer.attackingHand]?.gunAmmoType ?? AmmoType.REGULAR;
  if (isVehicle(tgt) || tgt.bodyType === Body.COW || tgt.bodyType === Body.CROW || tgt.bodyType === Body.BLOODCAT) location = AimShot.TORSO;
  else {
    if (isCreatureOrBloodcat(tgt)) {
      location = AimShot.TORSO;
      if (tgt.bodyType >= Body.ADULTFEMALEMONSTER && tgt.bodyType <= Body.YAM_MONSTER) {
        const dir = directionToward(firer.gridNo, tgt.gridNo);
        if ((dir === tgt.direction || dir === oneCC(tgt.direction) || dir === oneC(tgt.direction)) && t.pre.int(100) < 1)
          location = AimShot.GLAND;
      }
    }
    if (location === AimShot.RANDOM) location = hitLocationFromZ(t, b, tgt);
    if (ammo === AmmoType.MONSTER && location === AimShot.HEAD && !isMonster(tgt)) {
      const dir = directionToward(firer.gridNo, tgt.gridNo);
      const goggles = (slot: number) => {
        const o = tgt.inv[slot];
        const names = ['NIGHTGOGGLES', 'SUNGOGGLES', 'GASMASK'];
        return o !== undefined && names.some((n) => itemIndex(t, n) === o.item) && i8(t.pre.int(100)) < (o.status[0] ?? 0);
      };
      if (opposite(dir) !== tgt.direction && dir !== oneCC(tgt.direction) && dir !== oneC(tgt.direction)) {
      } else if (goggles(InvSlot.HEAD1)) headSlot = InvSlot.HEAD1;
      else if (goggles(InvSlot.HEAD2)) headSlot = InvSlot.HEAD2;
      else special = Special.BLINDED_BY_SPIT;
    }
  }
  const range = Math.trunc(
    Math.sqrt(((firer.gridNo % 160) - (tgt.gridNo % 160)) ** 2 + (Math.trunc(firer.gridNo / 160) - Math.trunc(tgt.gridNo / 160)) ** 2) * 10,
  );
  let impact = Math.max(0, b.impact - b.impactReduction);
  let damage: number;
  if (intended) {
    const hitBy = firer.oppList[tgt.id] === 1 ? b.hitBy : Math.trunc(b.hitBy / 2);
    const r = bulletImpact(t, firer, tgt, location, impact, hitBy, special);
    damage = r.damage;
    special = r.special;
    if (firer.team === Team.OUR && firer.target && firer.target.life > 0) {
      const p = profileProgress(t, firer.profile);
      if (p) p.shotsHit++;
    }
    tgt.intendedTarget = true;
    if (b.flags & 0x0040 && tgt === firer.target) tgt.numPelletsHitBy++;
  } else {
    const r = bulletImpact(t, firer, tgt, location, impact, 0, special);
    damage = r.damage;
    special = r.special;
    tgt.intendedTarget = false;
  }
  if (ammo === AmmoType.MONSTER) {
    if (headSlot !== -1) {
      const o = tgt.inv[headSlot];
      if (o) {
        o.status[0] = i8((o.status[0] ?? 0) - i8(Math.trunc(impact / 2) + t.rng.int(Math.trunc(impact / 2))));
        if ((o.status[0] ?? 0) <= 0) deleteObject(o);
      }
    }
  } else if (location === AimShot.HEAD) {
    const slot = InvSlot.HEAD1 + t.rng.int(2);
    const o = tgt.inv[slot];
    if (o && o.item !== NOTHING) {
      o.status[0] = i8((o.status[0] ?? 0) - i8(t.rng.int(Math.trunc(impact / 2))));
      if ((o.status[0] ?? 0) < 0) o.status[0] = 1;
    }
  }
  if (tgt.team === Team.OUR) {
    const p = profileProgress(t, tgt.profile);
    if (p) p.timesWounded++;
  }
  if (firer.team === Team.OUR && !firer.target && tgt.neutral) {
    if (tgt.civilianGroup === CivilianGroup.KINGPIN || tgt.civilianGroup === CivilianGroup.HICKS) firer.target = tgt;
    else if (t.rng.int(100) < 60) firer.target = tgt;
  }
  if (firer.doBurst && special === Special.NONE) special = Special.BURST;
  const breathLoss = i16(Math.trunc((impact * BP_GET_WOUNDED * (tgt.breathMax * 100 - tgt.breathRed)) / 10000));
  const hitDirection = directionToward(tgt.gridNo, firer.gridNo);
  let stopped = true;
  if (
    !isVehicle(tgt) &&
    (ammo === AmmoType.REGULAR || ammo === AmmoType.AP || ammo === AmmoType.SUPER_AP) &&
    !isExplosiveGun(t, firer.attackingWeapon)
  ) {
    if (damage < impact) impact = damage;
    const chanceThrough = u8(Math.max(0, impact - 20));
    if (t.pre.int(100) < chanceThrough) {
      impact -= calcBodyImpactReduction(ammo, location);
      impact -= totalArmourProtection(t.content.items, t.pre, tgt, location, impact, ammo);
      if (impact > 0) {
        b.impact = i8(impact);
        stopped = false;
      }
    }
  }
  if (stopped) removeBullet(t, b);
  else spewBloodBehind(t, b, tgt, hitDirection);
  if (t.turn.currentTeam !== Team.OUR && tgt.team === Team.OUR) t.turn.someoneHit = true;
  weaponHit(t, tgt, firer.attackingWeapon, damage, breathLoss, hitDirection, range, firer, special, location, bulletWorldXY(b));
  return stopped;
}

function spewBloodBehind(t: TacticalState, b: Bullet, tgt: Soldier, hitDirection: number): void {
  const away = opposite(hitDirection);
  const behind = newGridNo(b.gridNo, DIRECTION_INCREMENT[away] ?? 0);
  let level = tgt.level;
  if (level === 0) {
    if (t.world.costs.get(behind, away, 0) >= TravelCost.BLOCKED) return;
  } else if (!isRoofPresentAt(t, behind)) level = 0;
  internalDropBlood(t, behind, level, BloodKind.HUMAN, MAX_BLOOD_QUANTITY, DROPPED_IN_SIGHT);
}

function isExplosiveGun(t: TacticalState, item: number): boolean {
  return item === itemIndex(t, 'ROCKET_LAUNCHER') || item === itemIndex(t, 'TANK_CANNON');
}

export interface ImpactPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const EXPLOSIVE_AMMO: ReadonlySet<number> = new Set([AmmoType.HE, AmmoType.HEAT]);
const WEAPON_HIT_Z = 20;

export function doSpecialEffectAmmoMiss(t: TacticalState, attacker: Soldier, g: number, at: ImpactPoint): boolean {
  const hand = attacker.inv[attacker.attackingHand];
  const ammo = hand?.gunAmmoType;
  if (ammo !== undefined && EXPLOSIVE_AMMO.has(ammo)) {
    t.events.push({ type: 'bulletImpact', soldier: attacker.id, gridNo: g, ...at, effect: 'miniboom' });
    return true;
  }
  if (ammo !== AmmoType.MONSTER || !hand) return false;
  const gas = t.content.items.byIndex.get(hand.item)?.weapon?.smokeEffect ?? NOTHING;
  if (gas === NOTHING) return false;
  t.events.push({ type: 'creatureGas', gridNo: g });
  newSmokeEffect(t, g, gas, 0, attacker);
  return false;
}

export function weaponHit(
  t: TacticalState,
  tgt: Soldier,
  weapon: number,
  damage: number,
  breathLoss: number,
  direction: number,
  range: number,
  attacker: Soldier,
  special: number,
  location: number,
  at: { readonly x: number; readonly y: number } | null = null,
): void {
  makeNoise(t, attacker, tgt.gridNo, tgt.level, t.content.items.byIndex.get(weapon)?.weapon?.hitVolume ?? 0, NoiseKind.BULLET_IMPACT);
  if (isExplosiveGun(t, weapon)) {
    const payload = itemIndex(t, weapon === itemIndex(t, 'ROCKET_LAUNCHER') ? 'C1' : 'TANK_SHELL');
    if (at) igniteExplosionXY(t, attacker, at.x, at.y, 0, worldIndexFromCoords(at.x, at.y), payload, tgt.level);
    freeUpAttackerGivenTarget(t, tgt);
    return;
  }
  doSpecialEffectAmmoMiss(t, attacker, tgt.gridNo, { x: Math.trunc(tgt.x), y: Math.trunc(tgt.y), z: WEAPON_HIT_Z });
  if (tgt.doingExternalDeath) {
    reduceAttackBusyCount(t, tgt.attacker, false);
    return;
  }
  eventSoldierGotHit(t, tgt, weapon, damage, breathLoss, direction, range, attacker, special, location);
}

export function sleepDartSuccumbChance(s: Soldier): number {
  const str = effectiveStrength(s);
  const base = str > 90 ? 110 - str : str > 80 ? 120 - str : str > 70 ? 130 - str : 140 - str;
  return base + 10 - s.sleepDrugCounter;
}

export function eventSoldierGotHit(
  t: TacticalState,
  target: Soldier,
  weapon: number,
  damageIn: number,
  breathIn: number,
  direction: number,
  range: number,
  att: Soldier | null,
  special: number,
  location: number,
): void {
  let s = target;
  let damage = i16(damageIn);
  let breath = i16(breathIn);
  let reason = 0;
  const name = animName(t.content, s.state);
  if (name === 'SHOOT_ROCKET' || name === 'SHOOT_MORTAR' || name === 'THROW_ITEM' || name === 'LOB_ITEM')
    reduceAttackBusyCount(t, s, false);
  if (att) att.lastAttackHit = true;
  s.attacker = att;
  if (!isVehicle(s)) {
    s.beingAttackedCount++;
    t.turn.attackBusyCount++;
  }
  s.hitLocation = location;
  if (damage > 25) {
    if (att?.team === Team.OUR) handleMoraleEvent(t, att, MoraleEvent.DID_LOTS_OF_DAMAGE);
    if (s.team === Team.OUR) handleMoraleEvent(t, s, MoraleEvent.TOOK_LOTS_OF_DAMAGE);
  }
  const def = t.content.items.byIndex.get(weapon);
  const cls = def?.itemClass ?? ItemClass.NONE;
  if (special === Special.TOSSED_OBJECT) reason = DamageReason.OBJECT;
  else if (cls === ItemClass.TENTACLES) reason = DamageReason.TENTACLES;
  else if (cls & (ItemClass.GUN | ItemClass.THROWING_KNIFE)) {
    if (special === Special.SLEEP_DART) {
      s.sleepDrugCounter = 10;
      if (t.pre.int(100) < sleepDartSuccumbChance(s)) breath = i16(s.breathMax * 100);
    } else if (special === Special.BLINDED_BY_SPIT) {
      if (s.blindedCounter === 0) decayIndividualOpplist(t, s);
      s.blindedCounter += Math.trunc(damage / 8) + 1;
    }
    breath = i16(breath + BP_GET_HIT);
    reason = DamageReason.GUNFIRE;
  } else if (cls === ItemClass.BLADE) {
    breath = BP_GET_HIT;
    reason = DamageReason.BLADE;
  } else if (cls === ItemClass.PUNCH || weapon === NOTHING) {
    breath = i16(damage * 100);
    damage = Math.trunc(damage / PUNCH_REAL_DAMAGE_PORTION);
    if (inInterrogation(t)) {
      breath = 0;
      damage = Math.trunc(damage / 2);
    }
    reason = DamageReason.HANDTOHAND;
  } else if (cls & (ItemClass.GRENADE | ItemClass.BOMB)) {
    reason = weapon === itemIndex(t, 'STRUCTURE_EXPLOSION') ? DamageReason.STRUCTURE_EXPLOSION : DamageReason.EXPLOSION;
  }
  if (reason !== DamageReason.TENTACLES && reason !== DamageReason.OBJECT) {
    const changed = cls === ItemClass.GUN ? freeUpAttackerGivenTarget(t, s) : reduceAttackBusyGivenTarget(t, s);
    if (changed) s = changed;
  }
  const combined = soldierTakeDamage(t, s, damage, breath, reason, att);
  const volume = screamVolume(s, combined);
  const attackerShown = att !== null && shownToPlayer(att);
  t.events.push({
    type: 'soldierHit',
    soldier: s.id,
    attacker: att?.id ?? null,
    location: LOCATION_NAMES[location] ?? 'random',
    special,
    conscious: s.life >= CONSCIOUSNESS,
    ...(shownToPlayer(s)
      ? { gridNo: s.gridNo, damage, breathLoss: breath, life: s.life }
      : { unseen: unseenVictim(s), ...soundPlace(t, s, attackerShown, volume, NoiseKind.SCREAM) }),
  });
  if (isVehicle(s)) return;
  if (!hasAnimFlag(t.content, s.state, AnimFlags.HITSTOP) || animName(t.content, s.state) !== 'JFK_HITDEATH_STOP')
    makeNoise(t, s, s.gridNo, s.level, volume, NoiseKind.SCREAM);
  const before = s.state;
  const locked = animationLocked(t, s);
  startHitAnimation(t, s, cls, weapon, direction, range, att, special);
  if (locked && hitAnimationDropped(t, s, before)) releaseSoldiersAttacker(t, s);
}

function animationLocked(t: TacticalState, s: Soldier): boolean {
  return s.inNonInterruptibleAnimation || (s.rtNonInterruptible && !t.inCombat);
}

function hitAnimationDropped(t: TacticalState, s: Soldier, before: number): boolean {
  return s.state === before && s.beingAttackedCount > 0 && !hasAnimFlag(t.content, s.state, AnimFlags.HITSTART | AnimFlags.HITSTOP);
}

function startHitAnimation(
  t: TacticalState,
  s: Soldier,
  cls: number,
  weapon: number,
  direction: number,
  range: number,
  att: Soldier | null,
  special: number,
): void {
  if (hasAnimFlag(t.content, s.state, AnimFlags.HITSTOP)) {
    const twitch = TWITCHES[animName(t.content, s.state)];
    if (twitch) initNewSoldierAnim(t, s, anim(t.content, twitch), 0, false);
    return;
  }
  if (hasAnimFlag(t.content, s.state, AnimFlags.FIREREADY)) s.goBackToAimAfterHit = true;
  if (s.cowering) {
    initNewSoldierAnim(t, s, anim(t.content, s.life === 0 || isMercBody(s) ? 'GENERIC_HIT_STAND' : 'CIV_COWER_HIT'), 0, false);
    return;
  }
  const bodyHit = BODY_HIT[s.bodyType];
  if (bodyHit) {
    initNewSoldierAnim(t, s, anim(t.content, bodyHit), 0, false);
    return;
  }
  if (s.bodyType >= Body.MANCIV && s.bodyType <= Body.KIDCIV) {
    if (!s.dead && s.life === 0 && t.rng.int(2)) {
      initNewSoldierAnim(t, s, anim(t.content, 'CIV_DIE2'), 0, false);
      return;
    }
    initNewSoldierAnim(t, s, anim(t.content, 'GENERIC_HIT_STAND'), 0, false);
    return;
  }
  if (s.overTerrain === Terrain.LOW_WATER) {
    initNewSoldierAnim(t, s, anim(t.content, 'WATER_HIT'), 0, false);
    return;
  }
  if (s.overTerrain === Terrain.DEEP_WATER) {
    initNewSoldierAnim(t, s, anim(t.content, 'DEEP_WATER_HIT'), 0, false);
    return;
  }
  if (cls & (ItemClass.GUN | ItemClass.THROWING_KNIFE)) soldierGotHitGunFire(t, s, direction, att, special);
  if (cls === ItemClass.BLADE) soldierGotHitByMelee(t, s, direction);
  if (cls & (ItemClass.GRENADE | ItemClass.BOMB) || cls === ItemClass.TENTACLES) soldierGotHitExplosion(t, s, weapon, direction, range);
  if (cls === ItemClass.PUNCH || weapon === NOTHING) soldierGotHitByMelee(t, s, direction);
}

function soldierGotHitByMelee(t: TacticalState, s: Soldier, direction: number): void {
  if (s.dead) return;
  doGenericHit(t, s, Special.NONE, direction);
}

const TWITCHES: Readonly<Record<string, string>> = {
  FLYBACKHIT_STOP: 'FALLBACK_DEATHTWICH',
  STAND_FALLFORWARD_STOP: 'GENERIC_HIT_DEATHTWITCHNB',
  JFK_HITDEATH_STOP: 'JFK_HITDEATH_TWITCHB',
  FALLBACKHIT_STOP: 'FALLBACK_HIT_DEATHTWITCHNB',
  PRONE_LAYFROMHIT_STOP: 'PRONE_HIT_DEATHTWITCHNB',
  PRONE_HITDEATH_STOP: 'PRONE_HIT_DEATHTWITCHB',
  FALLFORWARD_HITDEATH_STOP: 'GENERIC_HIT_DEATHTWITCHB',
  FALLBACK_HITDEATH_STOP: 'FALLBACK_HIT_DEATHTWITCHB',
  FALLOFF_DEATH_STOP: 'FALLOFF_TWITCHB',
  FALLOFF_STOP: 'FALLOFF_TWITCHNB',
  FALLOFF_FORWARD_DEATH_STOP: 'FALLOFF_FORWARD_TWITCHB',
  FALLOFF_FORWARD_STOP: 'FALLOFF_FORWARD_TWITCHNB',
};

const BODY_HIT: Readonly<Record<number, string>> = {
  [Body.COW]: 'COW_HIT',
  [Body.BLOODCAT]: 'BLOODCAT_HIT',
  [Body.ADULTFEMALEMONSTER]: 'ADULTMONSTER_HIT',
  [Body.AM_MONSTER]: 'ADULTMONSTER_HIT',
  [Body.YAF_MONSTER]: 'ADULTMONSTER_HIT',
  [Body.YAM_MONSTER]: 'ADULTMONSTER_HIT',
  [Body.LARVAE_MONSTER]: 'LARVAE_HIT',
  [Body.QUEENMONSTER]: 'QUEEN_HIT',
  [Body.CRIPPLECIV]: 'CRIPPLE_HIT',
  [Body.ROBOTNOWEAPON]: 'ROBOTNW_HIT',
  [Body.INFANT_MONSTER]: 'INFANT_HIT',
  [Body.CROW]: 'CROW_DIE',
};

function carriesTwoHandedWeapon(t: TacticalState, s: Soldier): boolean {
  const def = t.content.items.byIndex.get(s.inv[InvSlot.HAND]?.item ?? NOTHING);
  return def !== undefined && def.itemClass === ItemClass.GUN && (def.flags & ItemFlags.TWO_HANDED) !== 0;
}

function doGenericHit(t: TacticalState, s: Soldier, special: number, direction: number): void {
  switch (endHeight(t.content, s.state)) {
    case AnimHeight.STAND:
      if (special === Special.BURST && s.bodyType <= Body.REGFEMALE) {
        setSoldierDirection(t, s, direction);
        setDesiredDirection(t, s, s.direction);
        initNewSoldierAnim(t, s, anim(t.content, 'STANDING_BURST_HIT'), 0, false);
      } else initNewSoldierAnim(t, s, anim(t.content, carriesTwoHandedWeapon(t, s) ? 'RIFLE_STAND_HIT' : 'GENERIC_HIT_STAND'), 0, false);
      break;
    case AnimHeight.PRONE:
      initNewSoldierAnim(t, s, anim(t.content, 'GENERIC_HIT_PRONE'), 0, false);
      break;
    case AnimHeight.CROUCH:
      initNewSoldierAnim(t, s, anim(t.content, 'GENERIC_HIT_CROUCH'), 0, false);
      break;
  }
}

function soldierGotHitGunFire(t: TacticalState, s: Soldier, direction: number, att: Soldier | null, special: number): void {
  let blownAway = false;
  let headHit = false;
  let fallenOver = false;
  if (!isMonster(s) && endHeight(t.content, s.state) === AnimHeight.STAND && att) {
    if (special === Special.HEAD_EXPLODE) {
      if (t.options.bloodAndGore && spacesAway(s.gridNo, att.gridNo) <= MAX_DISTANCE_FOR_MESSY_DEATH) {
        const g1 = newGridNo(s.gridNo, DIRECTION_INCREMENT[s.direction] ?? 0);
        if (okFallDirection(t, s, g1, s.level, s.direction, anim(t.content, 'JFK_HITDEATH'))) {
          const g2 = newGridNo(g1, DIRECTION_INCREMENT[s.direction] ?? 0);
          if (okFallDirection(t, s, g2, s.level, s.direction, s.state)) headHit = true;
        }
      }
    } else if (special === Special.CHEST_EXPLODE) {
      if (t.options.bloodAndGore && spacesAway(s.gridNo, att.gridNo) <= MAX_DISTANCE_FOR_MESSY_DEATH && s.direction === direction) {
        const opp = opposite(direction);
        const g1 = newGridNo(s.gridNo, DIRECTION_INCREMENT[opp] ?? 0);
        if (okFallDirection(t, s, g1, s.level, opp, anim(t.content, 'FLYBACK_HIT'))) {
          const g2 = newGridNo(g1, DIRECTION_INCREMENT[opp] ?? 0);
          if (okFallDirection(t, s, g2, s.level, opp, s.state)) blownAway = true;
        }
      }
    } else if (special === Special.LEG_FALLDOWN) {
      if (isValidStance(t, s, AnimHeight.PRONE) && endHeight(t.content, s.state) === AnimHeight.STAND && !inWater(s)) fallenOver = true;
    }
  }
  if (s.dead) {
    releaseSoldiersAttacker(t, s);
    return;
  }
  if (fallenOver) {
    soldierCollapse(t, s);
    return;
  }
  if (blownAway && s.bodyType <= Body.REGFEMALE) {
    changeToFlybackAnimation(t, s, direction);
    return;
  }
  if (headHit && (s.bodyType <= Body.REGFEMALE || s.bodyType === Body.HATKIDCIV || s.bodyType === Body.KIDCIV)) {
    initNewSoldierAnim(t, s, anim(t.content, 'JFK_HITDEATH'), 0, false);
    return;
  }
  doGenericHit(t, s, special, direction);
}

function soldierGotHitExplosion(t: TacticalState, s: Soldier, weapon: number, direction: number, range: number): void {
  if (s.dead) return;
  cancelAllServices(t, s);
  if (hasAnimFlag(t.content, s.state, AnimFlags.HITSTART) && endHeight(t.content, s.state) !== AnimHeight.PRONE) {
    s.pendingAnimation = -1;
    s.inNonInterruptibleAnimation = false;
    s.rtNonInterruptible = false;
  }
  const goreDeath = explosionGoreDeath(t, s, weapon, range);
  if (goreDeath) {
    initNewSoldierAnim(t, s, anim(t.content, goreDeath), 0, false);
    return;
  }
  if (!isMercBody(s)) {
    doGenericHit(t, s, 0, direction);
    return;
  }
  const end = endHeight(t.content, s.state);
  if (end === AnimHeight.STAND || end === AnimHeight.CROUCH) {
    setSoldierDirection(t, s, direction);
    setDesiredDirection(t, s, s.direction);
    const behind = newGridNo(s.gridNo, DIRECTION_INCREMENT[opposite(direction)] ?? 0);
    if (okFallDirection(t, s, behind, s.level, opposite(direction), anim(t.content, 'FLYBACK_HIT')))
      changeToFallbackAnimation(t, s, direction);
    else if (end === AnimHeight.STAND) {
      beginTryingToFall(t, s);
      initNewSoldierAnim(t, s, anim(t.content, 'FALLFORWARD_FROMHIT_STAND'), 0, false);
    } else soldierCollapse(t, s);
  } else soldierCollapse(t, s);
}

function explosionGoreDeath(t: TacticalState, s: Soldier, weapon: number, range: number): string | null {
  if (!t.options.bloodAndGore || s.life !== 0 || endHeight(t.content, s.state) === AnimHeight.PRONE) return null;
  if ((t.content.items.byIndex.get(weapon)?.explosive?.blast?.radius ?? 0) < MIN_GORE_BLAST_RADIUS) return null;
  if (range >= 2 && range <= 4) return 'CHARIOTS_OF_FIRE';
  return range <= 1 ? 'BODYEXPLODING' : null;
}

export function okFallDirection(t: TacticalState, s: Soldier, g: number, level: number, dir: number, state: number): boolean {
  if (t.world.costs.get(g, dir, level) > TravelCost.SHORE) return false;
  const terrain = t.world.terrain[g] ?? 0;
  if (terrain >= Terrain.LOW_WATER && terrain <= Terrain.DEEP_WATER) return false;
  if (!newOKDestination(t.pathEnv, s, g, true, level)) return false;
  const def = animStructureDef(t, s, state, dir);
  if (def) {
    const test = newGridNo(g, DIRECTION_INCREMENT[opposite(dir)] ?? 0);
    if (!t.world.structures.okayToAdd(test, level, def, s.id)) return false;
  }
  return true;
}

export function beginTryingToFall(t: TacticalState, s: Soldier): void {
  s.startFallDir = s.direction;
  s.tryingToFall = true;
  s.fallClockwise = t.rng.int(50) < 25;
}

export function soldierCollapse(t: TacticalState, s: Soldier): void {
  if (isMonster(s)) {
    deductPoints(t.inCombat, s, 0, -5000);
    return;
  }
  s.collapsed = true;
  receivingSoldierCancelServices(t, s);
  handleSight(t, s, SightFlags.LOOK);
  cancelGiveOnCollapse(t, s);
  switch (endHeight(t.content, s.state)) {
    case AnimHeight.STAND:
      if (s.overTerrain === Terrain.DEEP_WATER) initNewSoldierAnim(t, s, anim(t.content, 'DEEP_WATER_DIE'), 0, false);
      else if (s.overTerrain === Terrain.LOW_WATER) initNewSoldierAnim(t, s, anim(t.content, 'WATER_DIE'), 0, false);
      else {
        beginTryingToFall(t, s);
        initNewSoldierAnim(t, s, anim(t.content, 'FALLFORWARD_FROMHIT_STAND'), 0, false);
      }
      break;
    case AnimHeight.CROUCH:
      beginTryingToFall(t, s);
      initNewSoldierAnim(t, s, anim(t.content, isMercBody(s) ? 'FALLFORWARD_FROMHIT_CROUCH' : 'FALLFORWARD_FROMHIT_STAND'), 0, false);
      break;
    case AnimHeight.PRONE: {
      const name = animName(t.content, s.state);
      if (name === 'FALLFORWARD_FROMHIT_STAND' || name === 'ENDFALLFORWARD_FROMHIT_CROUCH')
        initNewSoldierAnim(t, s, anim(t.content, 'STAND_FALLFORWARD_STOP'), 0, false);
      else if (name === 'FALLBACK_HIT_STAND') initNewSoldierAnim(t, s, anim(t.content, 'FALLBACKHIT_STOP'), 0, false);
      else initNewSoldierAnim(t, s, anim(t.content, 'PRONE_LAY_FROMHIT'), 0, false);
      break;
    }
  }
  if (s.team === Team.ENEMY && t.inCombat && s.aiTurnControl) t.hooks.endAiGuysTurn(t, s);
}

function setSpecialMovePath(t: TacticalState, s: Soldier, steps: number, destination: number, state: number): void {
  s.pendingAnimation = -1;
  s.pathSize = 0;
  s.pathIndex = 0;
  s.path.length = 0;
  for (let i = 0; i < steps; i++) s.path.push(opposite(s.direction));
  s.pathSize = steps;
  s.finalDestination = destination;
  setSoldierDestination(t, s, s.path[0] ?? 0, state);
}

function changeToFlybackAnimation(t: TacticalState, s: Soldier, direction: number): void {
  const away = DIRECTION_INCREMENT[opposite(direction)] ?? 0;
  const dest = newGridNo(newGridNo(s.gridNo, away), away);
  setSpecialMovePath(t, s, 2, dest, anim(t.content, 'FLYBACK_HIT'));
  initNewSoldierAnim(t, s, anim(t.content, 'FLYBACK_HIT'), 0, false);
}

export function changeToFallbackAnimation(t: TacticalState, s: Soldier, direction: number): void {
  const dest = newGridNo(s.gridNo, DIRECTION_INCREMENT[opposite(direction)] ?? 0);
  setSpecialMovePath(t, s, 1, dest, anim(t.content, 'FALLBACK_HIT_STAND'));
  initNewSoldierAnim(t, s, anim(t.content, 'FALLBACK_HIT_STAND'), 0, false);
}

function menInSector(t: TacticalState, team: number): number {
  let n = 0;
  for (const m of t.mercSlots) if (m?.placed && m.team === team && !m.dead) n++;
  return n;
}

function calcNextBleed(s: Soldier): number {
  return Math.fround(1 + Math.fround(effectiveLife(s)) / (10 + s.tilesMoved));
}

function checkForBreathCollapse(s: Soldier): void {
  if (s.breath === 0 && !s.collapsed && !isVehicle(s) && !isRobot(s) && !s.monsterOrAnimal) s.breathCollapsed = true;
}

function noticeMariaEscapeWhenKingpinsManIsHurt(t: TacticalState, s: Soldier): void {
  if (s.team !== Team.CIV || s.civilianGroup !== CivilianGroup.KINGPIN || boxingActive(t)) return;
  if (t.narrative.questStatus(Quest.RESCUE_MARIA) !== QuestStatus.IN_PROGRESS) return;
  if (t.soldiers.some((x) => x?.placed && x.profile === Npc.MARIA)) t.narrative.setFactTrue(Fact.MARIA_ESCAPE_NOTICED);
}

export function soldierTakeDamage(
  t: TacticalState,
  s: Soldier,
  lifeIn: number,
  breathIn: number,
  reason: number,
  attacker: Soldier | null,
): number {
  let life = i16(lifeIn);
  let breath = i16(breathIn);
  s.lastDamageReason = reason;
  t.sectorHooks.soldierTakingDamage(t, s);
  noticeMariaEscapeWhenKingpinsManIsHurt(t, s);
  const oldLife = s.life;
  if (isVehicle(s)) return 0;
  if (s.npcShooting) {
    life = i16(s.life - 1);
    s.npcShooting = false;
  }
  if (reason === DamageReason.BLOODLOSS && inMeanwhile(t)) return 0;
  const bandage = i8(s.lifeMax - s.life - s.bleeding);
  if (isCreatureOrBloodcat(s)) {
    let factor = 0;
    if (s.bodyType === Body.BLOODCAT) factor = 2;
    else if (s.bodyType === Body.LARVAE_MONSTER || s.bodyType === Body.INFANT_MONSTER) factor = 1;
    else if (s.bodyType === Body.YAF_MONSTER || s.bodyType === Body.YAM_MONSTER) factor = 4;
    else if (s.bodyType === Body.ADULTFEMALEMONSTER || s.bodyType === Body.AM_MONSTER) factor = 6;
    else if (s.bodyType === Body.QUEENMONSTER) factor = attacker ? 4 + Math.trunc(pythSpacesAway(attacker.gridNo, s.gridNo) / 2) : 8;
    if (reason === DamageReason.EXPLOSION) factor = Math.trunc(factor / 4);
    if (factor > 1) life = Math.trunc((life + Math.trunc(factor / 2)) / factor);
    else if (reason === DamageReason.EXPLOSION) life = Math.trunc((life * 2) / 3);
    factor = s.bodyType === Body.QUEENMONSTER ? Math.min(factor, 8) * 2 : Math.trunc(factor / 2);
    if (factor > 1) breath = Math.trunc((breath + Math.trunc(factor / 2)) / factor);
  }
  s.life = life > s.life ? 0 : i8(s.life - life);
  if (s.side !== Side.FRIENDLY && !s.neutral && s.profile === NO_PROFILE && s.life > 0 && s.life < OKLIFE - 1) {
    if (reason === DamageReason.BLOODLOSS) {
      if (t.rng.int(2) === 0 || menInSector(t, s.team) === 1) s.life = 0;
    } else if (s.life < OKLIFE - 3) s.life = 0;
  }
  s.damageWindow = i16(s.damageWindow + life);
  if (s.life < 0) s.life = 0;
  if (s.life < oldLife && s.visible !== -1) t.events.push({ type: 'lifeLost', soldier: s.id, amount: oldLife - s.life });
  if (reason === DamageReason.EXPLOSION || reason === DamageReason.STRUCTURE_EXPLOSION) checkEquipmentForDamage(t, s, life);
  if (reason !== DamageReason.GAS && !isRobot(s)) {
    if (reason === DamageReason.HANDTOHAND) {
      if (life > 0) s.bleeding = i8(s.bleeding + 1);
    } else s.bleeding = i8(s.lifeMax - (s.life + bandage));
  }
  const apCost = Math.trunc(life / AP_GET_WOUNDED_DIVISOR);
  if (!isRobot(s)) deductPoints(t.inCombat, s, apCost, breath);
  const combined = u8(Math.trunc(u8(life) / 10) + Math.trunc(breath / 2000));
  if (!isRobot(s)) s.shock = i8(s.shock + combined);
  s.nextBleed = calcNextBleed(s);
  if (s.placed && s.visible !== -1 && oldLife !== 0 && life !== 0 && life < 1000) {
    s.displayDamage = true;
    s.damageWindowSteps = 0;
  }
  if (reason !== DamageReason.BLOODLOSS && !isRobot(s)) {
    let drop = Math.max(
      0,
      2 * Math.max(life, Math.trunc(breath / 100)) + (s.attacker?.bodyType === Body.BLOODCAT ? 20 : 0) - effectiveStrength(s),
    );
    const hand = s.inv[InvSlot.HAND];
    const undroppable = hand !== undefined && (hand.flags & ObjectFlags.UNDROPPABLE) !== 0;
    if (undroppable) drop -= 30;
    if (t.rng.int(100) < (drop & 0xffff) && hand && hand.item !== NOTHING && !undroppable) {
      addItemToPool(t, s.gridNo, hand, s.team === Team.OUR ? Visibility.VISIBLE : Visibility.INVISIBLE, s.level);
      deleteObject(hand);
    }
  }
  const blood = Math.min(u8(Math.trunc(life / BLOOD_DIVISOR)), MAX_BLOOD_QUANTITY);
  if (!isRobot(s) && blood !== 0 && s.placed) dropBlood(t, s, blood);
  if (s.placed) checkForBreathCollapse(s);
  if (attacker && attacker.team === Team.OUR && s.team !== Team.OUR && reason === DamageReason.EXPLOSION)
    statChange(t, attacker, StatKind.EXPLOSIVES, 10 * combined, StatCause.SUCCESS);
  if (s.team === Team.OUR) {
    statChange(t, s, StatKind.EXPERIENCE, 5 * combined, StatCause.FAILURE);
    if (!s.pummeledQuoteSaid && attacker && attacker !== s) countHitForBeatingQuote(t, s);
  }
  handleTakeDamageDeath(t, s, reason);
  if (s.life < OKLIFE) decayIndividualOpplist(t, s);
  return combined;
}

const TAKEN_A_BEATING_QUOTE = 21;
const BEATING_HITS = 3;
const BEATING_LIFE_GAIN = 20;
const BEATING_CHANCE_PER_HIT = 40;

function countHitForBeatingQuote(t: TacticalState, s: Soldier): void {
  s.numHitsThisTurn++;
  if (s.numHitsThisTurn < BEATING_HITS || s.life - s.oldLife <= BEATING_LIFE_GAIN) return;
  if (t.rng.int(100) >= BEATING_CHANCE_PER_HIT * (s.numHitsThisTurn - 2)) return;
  t.narrative.sayQuote(s, TAKEN_A_BEATING_QUOTE, true);
  s.pummeledQuoteSaid = true;
  s.numHitsThisTurn = 0;
}

function handleTakeDamageDeath(t: TacticalState, s: Soldier, reason: number): void {
  if (reason === DamageReason.BLOODLOSS || reason === DamageReason.ELECTRICITY || reason === DamageReason.GAS) {
    if (s.placed) {
      if (reason === DamageReason.ELECTRICITY && s.life < OKLIFE) s.inNonInterruptibleAnimation = false;
      if (s.life < OKLIFE && s.life !== 0 && !s.collapsed) soldierCollapse(t, s);
      if (s.life === 0) s.doingExternalDeath = true;
      checkForAndHandleSoldierDyingNotFromHit(t, s);
    }
  }
  if (reason === DamageReason.ELECTRICITY && s.life >= OKLIFE) releaseSoldiersAttacker(t, s);
}

export function releaseSoldiersAttacker(t: TacticalState, s: Soldier): void {
  if (s.previousAttacker !== s.attacker) s.nextToPreviousAttacker = s.previousAttacker;
  s.previousAttacker = s.attacker;
  const n = s.beingAttackedCount;
  s.beingAttackedCount = 0;
  for (let i = 0; i < n; i++) reduceAttackBusyCount(t, s.attacker, false);
  if (s.life !== 0 && s.bodyType !== Body.QUEENMONSTER) s.attacker = null;
}

export function checkForFreeupFromHit(
  t: TacticalState,
  s: Soldier,
  oldFlags: number,
  newFlags: number,
  oldState: number,
  newState: number,
): void {
  const queenHit = anim(t.content, 'QUEEN_HIT');
  if (oldState === queenHit && newState === queenHit) return;
  if (
    oldState !== newState &&
    (oldFlags & AnimFlags.HITSTART) >>> 0 !== 0 &&
    (newFlags & AnimFlags.HITFINISH) >>> 0 === 0 &&
    (newFlags & AnimFlags.IGNOREHITFINISH) >>> 0 === 0 &&
    !s.turningFromHit
  ) {
    releaseSoldiersAttacker(t, s);
    s.gettingHit = 0;
  }
  if ((oldFlags & AnimFlags.HITWHENDOWN) >>> 0 !== 0 && (s.dead || s.life !== 0)) {
    releaseSoldiersAttacker(t, s);
    s.gettingHit = 0;
    if (s.life === 0) s.attacker = s.previousAttacker;
  }
}

export function updateDamageDisplay(t: TacticalState, s: Soldier): void {
  if (!s.displayDamage) return;
  if (t.clockMs >= s.nextDamageStepAt) {
    s.nextDamageStepAt = t.clockMs + DAMAGE_DISPLAY_DELAY;
    s.damageWindowSteps++;
  }
  if (s.damageWindowSteps >= DAMAGE_DISPLAY_STEPS) {
    s.damageWindowSteps = 0;
    s.damageWindow = 0;
    s.displayDamage = false;
  }
}
