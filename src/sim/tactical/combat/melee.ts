// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Items.cc HandleItem (punch, blade and tentacle paths); Soldier_Control.cc EVENT_SoldierBeginBladeAttack,
// @src EVENT_SoldierBeginPunchAttack, DoNinjaAttack (2026-10-31, without Dr. Q's chop sound); externalized/Soldier.cc handlePendingAction (MERC_PUNCH, MERC_KNIFEATTACK);
// @src Weapons.cc UseBlade, UseHandToHand, HTHImpact, CalcChanceHTH, CalcChanceToStab, CalcChanceToPunch, DishoutQueenSwipeDamage;
// @src Soldier_Ani.cc opcodes 468 (end punch), 469 (martial arts attack), 492 (signal dodge), 755 (queen swipe) and 761 (eat flesh).

import type { OpOutcome } from '../../../content/anim/script.ts';
import { ItemClass, NOTHING, WeaponClass } from '../../../content/items/items.ts';
import { Direction, pythSpacesAway } from '../../../content/world/grid.ts';
import { i8, i16, idiv, u8 } from '../../../core/int.ts';
import { type ItemObject, USABLE_STATUS } from '../../items/object.ts';
import { AiAction } from '../ai/actions.ts';
import { anim, animName } from '../anim-states.ts';
import {
  AnimHeight,
  changeSoldierStance,
  changeSoldierState,
  endHeight,
  height,
  initNewSoldierAnim,
  setDesiredDirection,
  setSoldierDirection,
} from '../animation.ts';
import { isGassed } from '../explosions/smoke.ts';
import { InvSlot } from '../inventory.ts';
import { directionToward, getNewSoldierPath, stopMerc } from '../movement.ts';
import { inMeanwhile } from '../narrative/meanwhile-rules.ts';
import { isMercBody, newOKDestination } from '../pathfinding.ts';
import { Opp } from '../perception/opp.ts';
import { deductPoints } from '../points.ts';
import { StatKind } from '../profiles.ts';
import {
  effectiveAgility,
  effectiveDexterity,
  effectiveExpLevel,
  effectiveLife,
  effectiveStrength,
  moraleModifier,
  skillCheckFatiguePenalty,
} from '../skills.ts';
import {
  Body,
  isMonster,
  NO_PROFILE,
  NOWHERE,
  numSkillTraits,
  OKBREATH,
  OKLIFE,
  Personality,
  SKILL_TRAIT_BONUS,
  SkillTrait,
  type Soldier,
  Team,
} from '../soldier.ts';
import { mercs, type TacticalState, whoIsThere } from '../state.ts';
import { calcTotalAPsToAttack } from './ap.ts';
import { freeUpAttacker, reduceAttackBusyCount } from './barrier.ts';
import { ENEMY_TO_HIT_MOD, rangeInUnits, soldierDifficultyLevel } from './chance.ts';
import type { CombatContext } from './context.ts';
import { agilityForEnemyMissingPlayer, modifyExpGainByTarget, StatCause, statChange } from './experience.ts';
import { eventSoldierGotHit } from './hit.ts';
import { adjustImpactByHitLocation } from './impact.ts';
import { bladeApproach, directPunchApproach, findAdjacentGridEx, findSoldierAtGridNo, type MeleeApproach } from './melee-reach.ts';
import { Aim, AimShot, CTH_MAXIMUM, CTH_MINIMUM, ItemHandle, Special, weaponStatusMod } from './types.ts';

const MeleeMode = { STAB: 0, PUNCH: 1 } as const;
export const MeleeKind = { BLADE: 0, PUNCH: 1 } as const;
const SURPRISE_CHANCE_TO_HIT = 100;
const HTH_BASE_CHANCE = 67;
const HEAD_SHOT_MELEE_PENALTY = 20;
const BAD_DODGE_POSITION_PENALTY = 20;
const BASE_HTH_IMPACT = 5;
const MELEE_HIT_DELAY_MS = 20;
const MELEE_HIT_RANGE = 1;
const KNIFE_DIFFICULTY_XP_DIVISOR = 10;
const KNIFE_HIT_XP = 10;
const KNIFE_ATTEMPT_XP = 10;
const HTH_HIT_XP = 8;
const HTH_MISS_XP = 4;
const KNIFE_DODGE_AGILITY = 10;
const HTH_DODGE_AGILITY = 8;
const MONSTER_SMELL_FADE_CHANCE = 5;
const MIN_KNIFE_DULLING = 2;
const KNIFE_DULLING_IMPACT_DIVISOR = 20;
const KIDS_SPARED_DEFENCE = 10000;
const PRONE_TENTACLE_DEFENCE = 1000;
const NINJA_FINISH_THRESHOLD = 30;

const itemDef = (t: TacticalState, item: number) => t.content.items.byIndex.get(item);
const itemIndex = (t: TacticalState, name: string) => t.content.items.byName.get(name)?.index ?? -2;
const isRobot = (s: Soldier) => s.bodyType === Body.ROBOTNOWEAPON;
const isVehicle = (s: Soldier) => s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP;
const traitBonus = (s: Soldier, trait: number) => (SKILL_TRAIT_BONUS[trait] ?? 0) * numSkillTraits(s, trait);
const turnsFromAttacks = (s: Soldier) => !s.monsterOrAnimal && !isVehicle(s);

function attackRating(t: TacticalState, att: Soldier, aim: number, mode: number): number {
  let a = idiv(3 * effectiveDexterity(att) + effectiveAgility(att) + att.stats.strength + 10 * effectiveExpLevel(att), 6);
  if (att.profile !== NO_PROFILE && att.personalityTrait === Personality.PSYCHO) a += Aim.BONUS_PSYCHO;
  a += moraleModifier(att);
  a -= skillCheckFatiguePenalty(att, a);
  if (aim) a += idiv(Aim.BONUS_PER_AP * aim, 2);
  if (att.team !== Team.OUR) a += ENEMY_TO_HIT_MOD[soldierDifficultyLevel(t, att)] ?? 0;
  if (isGassed(t, att)) a -= Aim.PENALTY_GASSED;
  if (att.serviceCount > 0) a -= Aim.PENALTY_GETTINGAID;
  if (att.shock) a -= att.shock * Aim.PENALTY_PER_SHOCK;
  if (a > 0 && att.life < att.lifeMax) a -= idiv(2 * a * (att.lifeMax - effectiveLife(att)), 3 * att.lifeMax);
  if (a > 0 && att.breath < 100) a -= idiv(a * (100 - att.breath), 200);
  if (att.profile !== NO_PROFILE) {
    if (mode === MeleeMode.STAB) a += traitBonus(att, SkillTrait.KNIFING);
    else a += traitBonus(att, SkillTrait.MARTIALARTS) + traitBonus(att, SkillTrait.HANDTOHAND);
  }
  return Math.max(a, 1);
}

function tentacleDefence(def: Soldier, stance: number): number {
  let bonus = def.bodyType === Body.LARVAE_MONSTER || def.bodyType === Body.INFANT_MONSTER ? KIDS_SPARED_DEFENCE : 0;
  if (stance < AnimHeight.STAND) bonus += stance === AnimHeight.PRONE ? PRONE_TENTACLE_DEFENCE : 2 * BAD_DODGE_POSITION_PENALTY;
  return bonus;
}

function defenceRating(t: TacticalState, def: Soldier, mode: number, weapon: number): number {
  let d = idiv(3 * effectiveAgility(def) + effectiveDexterity(def) + def.stats.strength + 10 * effectiveExpLevel(def), 6);
  d += moraleModifier(def);
  d -= skillCheckFatiguePenalty(def, d);
  if (isGassed(t, def)) d -= Aim.PENALTY_GASSED;
  if (def.serviceCount > 0) d -= Aim.PENALTY_GETTINGAID;
  if (def.shock) d -= def.shock * Aim.PENALTY_PER_SHOCK;
  if (d > 0 && def.life < def.lifeMax) d -= idiv(2 * d * (def.lifeMax - effectiveLife(def)), 3 * def.lifeMax);
  if (d > 0 && def.breath < 100) d -= idiv(d * (100 - def.breath), 200);
  const stance = endHeight(t.content, def.state);
  if (weapon === itemIndex(t, 'CREATURE_QUEEN_TENTACLES')) d += tentacleDefence(def, stance);
  else if (stance < AnimHeight.STAND) {
    d -= BAD_DODGE_POSITION_PENALTY;
    if (stance === AnimHeight.PRONE) d -= BAD_DODGE_POSITION_PENALTY;
  }
  if (def.profile !== NO_PROFILE) {
    const holdsBlade = itemDef(t, def.inv[InvSlot.HAND]?.item ?? NOTHING)?.itemClass === ItemClass.BLADE;
    const knifing = traitBonus(def, SkillTrait.KNIFING);
    const martial = traitBonus(def, SkillTrait.MARTIALARTS);
    if (mode === MeleeMode.STAB) d += holdsBlade ? knifing + idiv(martial, 3) : idiv(knifing, 3) + idiv(martial, 2);
    else d += holdsBlade ? idiv(knifing, 2) : martial + traitBonus(def, SkillTrait.HANDTOHAND);
  }
  return Math.max(d, 1);
}

function weaponFitsMode(t: TacticalState, weapon: number, mode: number): boolean {
  const def = itemDef(t, weapon);
  if (mode === MeleeMode.STAB) return def?.weapon?.weaponClass === WeaponClass.KNIFE;
  return ((def?.itemClass ?? ItemClass.NONE) & (ItemClass.NONE | ItemClass.PUNCH)) !== 0;
}

function calcChanceHTH(t: TacticalState, att: Soldier, def: Soldier, aim: number, mode: number): number {
  const tentacles = att.attackingWeapon === itemIndex(t, 'CREATURE_QUEEN_TENTACLES');
  if (!tentacles && (def.life < OKLIFE || def.breath < OKBREATH)) return SURPRISE_CHANCE_TO_HIT;
  if (!weaponFitsMode(t, att.attackingWeapon, mode)) return 0;
  const a = attackRating(t, att, aim, mode);
  const d = defenceRating(t, def, mode, att.attackingWeapon);
  let chance = HTH_BASE_CHANCE + idiv(a - d, 3);
  if (att.aimShotLocation === AimShot.HEAD) chance -= HEAD_SHOT_MELEE_PENALTY;
  return Math.min(Math.max(chance, CTH_MINIMUM), CTH_MAXIMUM);
}

export function calcChanceToStab(t: TacticalState, att: Soldier, def: Soldier, aim: number): number {
  return calcChanceHTH(t, att, def, aim, MeleeMode.STAB);
}

export function calcChanceToPunch(t: TacticalState, att: Soldier, def: Soldier, aim: number): number {
  return calcChanceHTH(t, att, def, aim, MeleeMode.PUNCH);
}

function isSurpriseAttack(att: Soldier, def: Soldier): boolean {
  return def.oppList[att.id] === Opp.NOT_HEARD_OR_SEEN || def.life < OKLIFE || def.collapsed;
}

export function meleeChanceToHit(t: TacticalState, att: Soldier, def: Soldier, aim: number, blade: boolean): number {
  if (isSurpriseAttack(att, def)) return SURPRISE_CHANCE_TO_HIT;
  return blade ? calcChanceToStab(t, att, def, aim) : calcChanceToPunch(t, att, def, aim);
}

export function hthImpact(t: CombatContext, att: Soldier, tgt: Soldier, hitBy: number, blade: boolean): number {
  let impact = idiv(effectiveExpLevel(att), 2);
  const strength = effectiveStrength(att);
  const weapon = att.attackingWeapon;
  const weaponImpact = t.content.items.byIndex.get(weapon)?.weapon?.impact ?? 0;
  const martialArtist = numSkillTraits(att, SkillTrait.MARTIALARTS) > 0;
  if (blade) {
    impact += idiv(strength, 20) + weaponImpact;
    if (isRobot(tgt)) impact = idiv(impact, 4);
  } else {
    impact += idiv(strength, 5);
    if (weapon !== NOTHING && !martialArtist) {
      impact += weaponImpact;
      if (isRobot(tgt)) impact = idiv(impact, 2);
    } else {
      impact += BASE_HTH_IMPACT;
      if (isRobot(tgt)) impact = 0;
    }
  }
  const fluke = t.pre.int(51) - 25;
  impact = idiv(impact * (100 + fluke + idiv(hitBy, 2)), 100);
  if (!blade) {
    if (martialArtist) {
      impact = idiv(impact * (100 + traitBonus(att, SkillTrait.MARTIALARTS)), 100);
      if (animName(t.content, att.state) === 'NINJA_SPINKICK') impact *= 2;
    }
    impact = idiv(impact * (100 + 3 * traitBonus(att, SkillTrait.HANDTOHAND)), 100);
  }
  return impact;
}

function turnTowardAttacker(t: TacticalState, att: Soldier, tgt: Soldier): void {
  if (!turnsFromAttacks(tgt)) return;
  stopMerc(t, tgt);
  if (tgt.team !== Team.OUR) t.turnHooks.cancelAIAction(t, tgt);
  t.gameEvents.push({ kind: 'desiredDirection', soldier: tgt.id, direction: directionToward(tgt.gridNo, att.gridNo) });
}

function attackProneTarget(t: TacticalState, s: Soldier, lowAttack: string): void {
  if (endHeight(t.content, s.state) !== AnimHeight.CROUCH) {
    changeSoldierStance(t, s, AnimHeight.CROUCH);
    s.pendingAnimation = anim(t.content, lowAttack);
  } else initNewSoldierAnim(t, s, anim(t.content, lowAttack), 0, false);
}

function isHelplessPrey(tgt: Soldier): boolean {
  return (tgt.life < OKLIFE && tgt.life > 0) || (tgt.breath < OKBREATH && tgt.collapsed);
}

function beginMonsterBladeAttack(t: TacticalState, s: Soldier, g: number): void {
  const tgt = whoIsThere(t, g, s.targetLevel);
  if (tgt && isHelplessPrey(tgt)) {
    s.pendingActionData4 = tgt.id;
    s.regenerationCounter++;
    initNewSoldierAnim(t, s, anim(t.content, 'MONSTER_BEGIN_EATTING_FLESH'), 0, false);
    return;
  }
  const close = pythSpacesAway(s.gridNo, g) <= 1;
  initNewSoldierAnim(t, s, anim(t.content, close ? 'MONSTER_CLOSE_ATTACK' : 'ADULTMONSTER_ATTACKING'), 0, false);
}

function beginBloodcatBladeAttack(t: TacticalState, s: Soldier): void {
  const claws = s.inv[InvSlot.HAND]?.item === itemIndex(t, 'BLOODCAT_CLAW_ATTACK');
  initNewSoldierAnim(t, s, anim(t.content, claws ? 'BLOODCAT_SWIPE' : 'BLOODCAT_BITE_ANIM'), 0, false);
}

export function eventSoldierBeginBladeAttack(t: TacticalState, s: Soldier, g: number, direction: number): void {
  t.turn.attackBusyCount++;
  setDesiredDirection(t, s, direction);
  setSoldierDirection(t, s, direction);
  const tgt = whoIsThere(t, g, s.targetLevel);
  if (isMonster(s)) beginMonsterBladeAttack(t, s, g);
  else if (s.bodyType === Body.BLOODCAT) beginBloodcatBladeAttack(t, s);
  else if (tgt) {
    switch (endHeight(t.content, tgt.state)) {
      case AnimHeight.STAND:
      case AnimHeight.CROUCH:
        if (tgt.oppList[s.id] === Opp.NOT_HEARD_OR_SEEN && tgt.team !== s.team) initNewSoldierAnim(t, s, anim(t.content, 'STAB'), 0, false);
        else {
          initNewSoldierAnim(t, s, anim(t.content, t.rng.coinToss() ? 'STAB' : 'SLICE'), 0, false);
          turnTowardAttacker(t, s, tgt);
        }
        break;
      case AnimHeight.PRONE:
        attackProneTarget(t, s, 'CROUCH_STAB');
        break;
    }
  } else {
    const obstacle = !newOKDestination(t.pathEnv, s, g, false, s.level);
    initNewSoldierAnim(t, s, anim(t.content, obstacle ? 'STAB' : 'CROUCH_STAB'), 0, false);
  }
  s.targetGridNo = g;
  s.targetLevel = s.level;
  s.target = whoIsThere(t, g, s.targetLevel);
}

function finishesWithSpinKick(tgt: Soldier): boolean {
  return tgt.life <= NINJA_FINISH_THRESHOLD || tgt.breath <= NINJA_FINISH_THRESHOLD;
}

function turnUnawareTargetToward(t: TacticalState, s: Soldier, tgt: Soldier): void {
  if (tgt.oppList[s.id] !== Opp.NOT_HEARD_OR_SEEN || tgt.team === s.team || !turnsFromAttacks(tgt)) return;
  t.gameEvents.push({ kind: 'desiredDirection', soldier: tgt.id, direction: directionToward(tgt.gridNo, s.gridNo) });
}

function doNinjaAttack(t: TacticalState, s: Soldier): void {
  const tgt = whoIsThere(t, s.targetGridNo, s.level);
  if (!tgt) return;
  const stance = endHeight(t.content, tgt.state);
  if (stance === AnimHeight.PRONE) attackProneTarget(t, s, 'PUNCH_LOW');
  else if (finishesWithSpinKick(tgt)) changeSoldierState(t, s, anim(t.content, 'NINJA_SPINKICK'));
  else {
    changeSoldierState(t, s, anim(t.content, t.rng.int(2) === 0 ? 'NINJA_LOWKICK' : 'NINJA_PUNCH'));
    turnUnawareTargetToward(t, s, tgt);
  }
}

function fightsWithMartialArts(t: TacticalState, s: Soldier, crowbar: boolean): boolean {
  return numSkillTraits(s, SkillTrait.MARTIALARTS) > 0 && !inMeanwhile(t) && !crowbar;
}

function beginMartialArtsAttack(t: TacticalState, s: Soldier, tgt: Soldier): void {
  const notInStance = animName(t.content, s.state) !== 'NINJA_BREATH' && height(t.content, s.state) === AnimHeight.STAND;
  if (notInStance && height(t.content, tgt.state) !== AnimHeight.PRONE)
    initNewSoldierAnim(t, s, anim(t.content, 'NINJA_GOTOBREATH'), 0, false);
  else doNinjaAttack(t, s);
}

export function eventSoldierBeginPunchAttack(t: TacticalState, s: Soldier, g: number, direction: number): void {
  const hand = s.inv[InvSlot.HAND]?.item ?? NOTHING;
  const crowbar = hand === itemIndex(t, 'CROWBAR');
  t.turn.attackBusyCount++;
  const tgt = whoIsThere(t, s.targetGridNo, s.level);
  if (!tgt) {
    reduceAttackBusyCount(t, s, false);
    return;
  }
  setDesiredDirection(t, s, direction);
  setSoldierDirection(t, s, direction);
  if (fightsWithMartialArts(t, s, crowbar)) beginMartialArtsAttack(t, s, tgt);
  else beginPlainPunch(t, s, tgt, crowbar);
  s.targetGridNo = g;
  s.targetLevel = s.level;
  s.lastTarget = g;
  s.target = whoIsThere(t, g, s.targetLevel);
}

function beginPlainPunch(t: TacticalState, s: Soldier, tgt: Soldier, crowbar: boolean): void {
  switch (endHeight(t.content, tgt.state)) {
    case AnimHeight.STAND:
    case AnimHeight.CROUCH:
      initNewSoldierAnim(t, s, anim(t.content, crowbar ? 'CROWBAR_ATTACK' : 'PUNCH'), 0, false);
      if (tgt.oppList[s.id] === Opp.NOT_HEARD_OR_SEEN && tgt.team !== s.team) turnTowardAttacker(t, s, tgt);
      break;
    case AnimHeight.PRONE:
      if (!isMercBody(s)) initNewSoldierAnim(t, s, anim(t.content, 'PUNCH'), 0, false);
      else attackProneTarget(t, s, 'PUNCH_LOW');
      break;
  }
}

function walkUpForMelee(t: TacticalState, s: Soldier, kind: number, approach: MeleeApproach): void {
  s.pendingMelee = { kind, targetGridNo: approach.targetGridNo, direction: approach.direction, animCount: 0 };
  getNewSoldierPath(t, s, approach.actionGridNo, s.uiMovementMode, 0, true);
}

export function handlePunchAttack(t: TacticalState, s: Soldier, g: number, level: number): number {
  const tgt = whoIsThere(t, g, level);
  let approach = tgt ? directPunchApproach(t, s, tgt, level) : null;
  const adjacent = approach === null;
  approach ??= findAdjacentGridEx(t, s, g, true);
  if (!approach) return ItemHandle.CANNOT_GETTO_LOCATION;
  s.targetGridNo = g;
  s.ai.actionData = g;
  if (s.gridNo !== approach.actionGridNo && adjacent) walkUpForMelee(t, s, MeleeKind.PUNCH, approach);
  else {
    s.ai.action = AiAction.KNIFE_STAB;
    eventSoldierBeginPunchAttack(t, s, approach.targetGridNo, approach.direction);
  }
  return ItemHandle.OK;
}

export function handleBladeAttack(t: TacticalState, s: Soldier, g: number): number {
  const approach = bladeApproach(t, s, g);
  if (!approach) return ItemHandle.CANNOT_GETTO_LOCATION;
  s.ai.actionData = approach.actionGridNo;
  if (s.gridNo !== approach.actionGridNo) walkUpForMelee(t, s, MeleeKind.BLADE, approach);
  else {
    s.ai.action = AiAction.KNIFE_STAB;
    eventSoldierBeginBladeAttack(t, s, approach.targetGridNo, approach.direction);
  }
  return ItemHandle.OK;
}

export function handleTentacleAttack(t: TacticalState, s: Soldier, g: number): number {
  t.turn.attackBusyCount++;
  deductPoints(t.inCombat, s, calcTotalAPsToAttack(t, s, g, false, s.aimTime), 0);
  initNewSoldierAnim(t, s, anim(t.content, 'QUEEN_SWIPE'), 0, false);
  s.ai.action = AiAction.KNIFE_STAB;
  return ItemHandle.OK;
}

export function handlePendingMeleeOnArrival(t: TacticalState, s: Soldier): boolean {
  const pending = s.pendingMelee;
  if (!pending) return false;
  s.ai.action = AiAction.KNIFE_STAB;
  if (pending.kind === MeleeKind.PUNCH) eventSoldierBeginPunchAttack(t, s, pending.targetGridNo, pending.direction);
  else eventSoldierBeginBladeAttack(t, s, pending.targetGridNo, pending.direction);
  s.pendingMelee = null;
  return true;
}

const DISHOUT_DIRECTIONS: readonly (readonly number[])[] = [
  [Direction.NORTH, Direction.NORTHEAST],
  [Direction.EAST, Direction.SOUTHEAST],
  [Direction.SOUTH],
];
const QUEEN_SWIPE_RANGE = 50;
const EATING_DAMAGE = 25;
const EATING_RANGE = 50;
const EATING_DAMAGE_ITEM = 2;

function dishoutQueenSwipeDamage(t: TacticalState, queen: Soldier): void {
  const directions = DISHOUT_DIRECTIONS[queen.pendingActionData1] ?? [];
  const reach = t.content.items.byName.get('CREATURE_QUEEN_TENTACLES')?.weapon?.range ?? 0;
  for (const victim of mercs(t)) {
    if (victim === queen || victim.life < OKLIFE || victim.gridNo === NOWHERE) continue;
    if (rangeInUnits(queen.gridNo, victim.gridNo) > reach) continue;
    const direction = directionToward(queen.gridNo, victim.gridNo);
    if (!directions.includes(direction)) continue;
    const hitBy = calcChanceToStab(t, queen, victim, 0) - t.pre.int(100);
    if (hitBy <= 0) continue;
    const impact = hthImpact(t, queen, victim, hitBy, true);
    const tentacles = itemIndex(t, 'CREATURE_QUEEN_TENTACLES');
    eventSoldierGotHit(t, victim, tentacles, impact, impact, (direction + 4) % 8, QUEEN_SWIPE_RANGE, queen, Special.NONE, AimShot.LEGS);
  }
  queen.pendingActionData1++;
}

function biteHelplessPrey(t: TacticalState, s: Soldier): void {
  const prey = t.soldiers[s.pendingActionData4];
  if (!prey) return;
  const direction = (s.direction + 4) % 8;
  eventSoldierGotHit(t, prey, EATING_DAMAGE_ITEM, EATING_DAMAGE, EATING_DAMAGE, direction, EATING_RANGE, s, Special.NONE, AimShot.HEAD);
}

function queueWeaponHit(t: TacticalState, att: Soldier, tgt: Soldier, damage: number): void {
  t.gameEvents.push({
    kind: 'weaponHit',
    soldier: tgt.id,
    attacker: att.id,
    weapon: att.attackingWeapon,
    damage: i16(damage),
    breathLoss: 0,
    direction: directionToward(tgt.gridNo, att.gridNo),
    range: MELEE_HIT_RANGE,
    special: Special.NONE,
    delay: MELEE_HIT_DELAY_MS,
  });
}

function dullBlade(t: TacticalState, blade: ItemObject, impact: number): void {
  const status = blade.status[0] ?? 0;
  if (status <= USABLE_STATUS) return;
  const statusTenths = idiv(status, 10);
  const maxDrop =
    statusTenths > 2 ? Math.min(Math.max(idiv(impact, KNIFE_DULLING_IMPACT_DIVISOR), MIN_KNIFE_DULLING), statusTenths) : MIN_KNIFE_DULLING;
  blade.status[0] = i8(status - i8(t.rng.int(maxDrop)));
}

function reduceMonsterSmell(t: TacticalState, s: Soldier): void {
  if (s.monsterSmell > 0 && t.rng.int(MONSTER_SMELL_FADE_CHANCE) === 0) s.monsterSmell--;
}

function knifeExperience(chance: number, hit: boolean, aimTime: number): number {
  let xp = 0;
  if (hit) {
    xp += idiv(u8(100 - chance), KNIFE_DIFFICULTY_XP_DIVISOR);
    if (aimTime) xp += 2 * Math.min(aimTime, xp);
    xp += KNIFE_HIT_XP;
  }
  return xp + KNIFE_ATTEMPT_XP;
}

function noticeStrike(s: Soldier, tgt: Soldier): void {
  s.attackNoticed = true;
  tgt.intendedTarget = true;
  s.opponent = tgt;
}

export function useBlade(t: TacticalState, s: Soldier, g: number): void {
  deductPoints(t.inCombat, s, calcTotalAPsToAttack(t, s, g, false, s.aimTime), 0);
  const tgt = whoIsThere(t, g, s.targetLevel);
  if (tgt) {
    noticeStrike(s, tgt);
    const surprise = isSurpriseAttack(s, tgt);
    const chance = meleeChanceToHit(t, s, tgt, s.aimTime, true);
    const roll = t.pre.int(100);
    const hit = roll <= chance;
    t.events.push({ type: 'meleeStrike', soldier: s.id, target: g, weapon: 'blade', chance, hit });
    if (hit) {
      const blade = s.inv[s.attackingHand] as ItemObject;
      let impact = hthImpact(t, s, tgt, chance - roll, true);
      impact = idiv(impact * weaponStatusMod(blade.status[0] ?? 0), 100);
      impact = adjustImpactByHitLocation(impact, s.aimShotLocation).impact;
      if (surprise) impact = idiv(impact * 3, 2);
      impact = Math.max(impact, 1);
      dullBlade(t, blade, impact);
      queueWeaponHit(t, s, tgt, impact);
    } else {
      agilityForEnemyMissingPlayer(t, s, tgt, KNIFE_DODGE_AGILITY);
      freeUpAttacker(t, s);
    }
    if (s.team === Team.OUR && s.target) {
      const xp = modifyExpGainByTarget(knifeExperience(chance, hit, s.aimTime), s.target);
      statChange(t, s, StatKind.DEXTERITY, xp, hit ? StatCause.SUCCESS : StatCause.FAILURE);
    }
  } else freeUpAttacker(t, s);
  reduceMonsterSmell(t, s);
}

export function useHandToHand(t: TacticalState, s: Soldier, g: number): void {
  deductPoints(t.inCombat, s, calcTotalAPsToAttack(t, s, g, false, s.aimTime), 0);
  const tgt = whoIsThere(t, g, s.targetLevel);
  if (tgt) {
    noticeStrike(s, tgt);
    const chance = meleeChanceToHit(t, s, tgt, s.aimTime, false);
    let roll = t.pre.int(100);
    if (animName(t.content, s.state) === 'NINJA_SPINKICK') roll = t.pre.int(chance);
    const hit = roll <= chance;
    t.events.push({ type: 'meleeStrike', soldier: s.id, target: g, weapon: 'punch', chance, hit });
    if (s.team === Team.OUR && tgt.team !== Team.OUR) {
      const xp = u8(modifyExpGainByTarget(hit ? HTH_HIT_XP : HTH_MISS_XP, tgt));
      const cause = hit ? StatCause.SUCCESS : StatCause.FAILURE;
      statChange(t, s, StatKind.STRENGTH, xp, cause);
      statChange(t, s, StatKind.DEXTERITY, xp, cause);
    } else if (!hit) agilityForEnemyMissingPlayer(t, s, tgt, HTH_DODGE_AGILITY);
    if (hit || inMeanwhile(t)) {
      let impact = hthImpact(t, s, tgt, chance - roll, false);
      impact = adjustImpactByHitLocation(impact, s.aimShotLocation).impact;
      queueWeaponHit(t, s, tgt, Math.max(impact, 1));
    } else freeUpAttacker(t, s);
  } else freeUpAttacker(t, s);
  reduceMonsterSmell(t, s);
}

function signalDodge(t: TacticalState, s: Soldier): void {
  if (s.npcPunch) return;
  const tgt = findSoldierAtGridNo(t, s.targetGridNo, s.targetLevel);
  if (!tgt || !isMercBody(tgt)) return;
  if ((tgt.oppList[s.id] ?? 0) === Opp.NOT_HEARD_OR_SEEN && tgt.team !== s.team) return;
  if (height(t.content, tgt.state) !== AnimHeight.STAND) return;
  stopMerc(t, tgt);
  if (tgt.team !== Team.OUR) t.turnHooks.cancelAIAction(t, tgt);
  setDesiredDirection(t, tgt, directionToward(tgt.gridNo, s.gridNo));
  changeSoldierState(t, tgt, anim(t.content, 'DODGE_ONE'));
}

function endNpcPunch(t: TacticalState, s: Soldier): void {
  const punch = s.npcPunch;
  if (!punch) return;
  s.npcPunch = null;
  t.narrative.triggerNpcWithGivenApproach(s.profile, punch.approach);
}

function endPunch(t: TacticalState, s: Soldier): OpOutcome {
  endNpcPunch(t, s);
  const martialArtist = s.profile !== NO_PROFILE && numSkillTraits(s, SkillTrait.MARTIALARTS) > 0 && !inMeanwhile(t);
  const crouched = height(t.content, s.state) === AnimHeight.CROUCH;
  changeSoldierState(t, s, anim(t.content, crouched ? 'CROUCHING' : martialArtist ? 'NINJA_BREATH' : 'PUNCH_BREATH'));
  return 'stop';
}

export function meleeOpcode(t: TacticalState, s: Soldier, code: number): OpOutcome | null {
  switch (code) {
    case 468:
      return endPunch(t, s);
    case 469:
      doNinjaAttack(t, s);
      return 'stop';
    case 492:
      signalDodge(t, s);
      return 'continue';
    case 755:
      dishoutQueenSwipeDamage(t, s);
      return 'continue';
    case 761:
      biteHelplessPrey(t, s);
      return 'continue';
    default:
      return null;
  }
}
