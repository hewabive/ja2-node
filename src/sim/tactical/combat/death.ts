// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Ani.cc opcodes 433, 437, 440, 447, 465, 472, 478, 480, 496, 497, 721, 722, 765,
// @src CheckForAndHandleSoldierIncompacitated, CheckForAndHandleSoldierDyingNotFromHit, HandleSoldierDeath,
// @src CheckForAndHandleSoldierDeath, HandleCheckForDeathCommonCode; Soldier_Control.cc BeginSoldierGetup (with the boxer's
// @src knock-out); Overhead.cc HandleNPCTeamMemberDeath (with BeginHandleQueenBitchDeath); OppList.cc CheckForAlertWhenEnemyDies;
// @src Rotting_Corpses.cc TurnSoldierIntoCorpse, ReduceAmmoDroppedByNonPlayerSoldiers, AddRottingCorpse (blood under the
// @src corpse), RemoveCorpse, FindCorpseBasedOnStructure.

import { corpseFileBase, corpseStructIndex, corpseTypeFor, NO_CORPSE } from '../../../content/anim/corpses.ts';
import type { OpOutcome } from '../../../content/anim/script.ts';
import { AnimFlags } from '../../../content/anim/tables.ts';
import { ItemClass, ItemFlags, NOTHING } from '../../../content/items/items.ts';
import { DIRECTION_INCREMENT, newGridNo, pythSpacesAway, WORLD_COLS } from '../../../content/world/grid.ts';
import { STRUCTURE_ON_ROOF, type StructureInstance } from '../../../content/world/structures.ts';
import { createItem, ObjectFlags } from '../../items/object.ts';
import { NarrativeHistory } from '../../strategic/narrative/history-codes.ts';
import { anim, animName } from '../anim-states.ts';
import {
  AnimHeight,
  changeSoldierStance,
  changeSoldierState,
  hasAnimFlag,
  initNewSoldierAnim,
  setDesiredDirection,
  setSoldierDirection,
} from '../animation.ts';
import { dropKeysInKeyRing } from '../doors/keys.ts';
import { checkEquipmentForFragileItemDamage } from '../explosions/item-damage.ts';
import { worldSeconds } from '../explosions/state.ts';
import { cancelAllServices } from '../first-aid.ts';
import { putOutMuzzleFlash } from '../lighting/muzzle-flash.ts';
import { directionToward } from '../movement.ts';
import { endBoxingMatch } from '../narrative/boxing.ts';
import { boxingFight } from '../narrative/boxing-state.ts';
import { Profile, TERRORISTS } from '../narrative/constants.ts';
import { civilianDeathRules, playerTeamDeathRules } from '../narrative/death-rules.ts';
import { inMeanwhile, slapCheckWhenIncapacitated } from '../narrative/meanwhile-rules.ts';
import { NoiseKind } from '../perception/noise.ts';
import { atan8Of, SightFlags } from '../perception/opp.ts';
import { distanceVisible, handleSight, removeManAsTarget, verifyPublicOpplistDueToDeath } from '../perception/sight.ts';
import { removeMercStructure } from '../person-structure.ts';
import { deductPoints } from '../points.ts';
import { MercStatus, profileProgress, StatKind } from '../profiles.ts';
import { checkSoldierHitRoof } from '../roofs.ts';
import { BloodKind, DROPPED_IN_SIGHT, internalDropBlood, MAX_BLOOD_QUANTITY, removeBlood } from '../smell.ts';
import { AlertStatus, Body, NO_PROFILE, OKBREATH, OKLIFE, type Soldier, shownToPlayer, Team } from '../soldier.ts';
import { removeOccupant, type TacticalState, unregisterSoldier } from '../state.ts';
import { betweenTurnsVisibilityAdjustments, checkForEndOfBattle } from '../turns/turns.ts';
import { loudestScream, soundPlace, unseenVictim } from '../unseen-sources.ts';
import { addItemToPool, Visibility } from '../world-items.ts';
import { internalSoldierReadyWeapon } from './attack.ts';
import { StatCause, statChange } from './experience.ts';
import {
  beginTryingToFall,
  changeToFallbackAnimation,
  okFallDirection,
  releaseSoldiersAttacker,
  sleepDartSuccumbChance,
  soldierCollapse,
} from './hit.ts';
import { handleMoraleEvent, MoraleEvent } from './morale.ts';
import { soldierTo3DLocationLos } from './positions.ts';
import { AimShot, DamageReason, i16 } from './types.ts';

export interface Corpse {
  readonly gridNo: number;
  readonly level: number;
  readonly bodyType: number;
  readonly direction: number;
  readonly state: number;
  readonly profile: number;
  readonly type: number;
  readonly timeOfDeath: number;
  readonly findSweetSpot?: boolean;
  readonly entryPoint?: number;
  readonly palettes?: readonly [hair: string, skin: string, vest: string, pants: string];
  readonly camo?: boolean;
}

export function corpseLook(s: Soldier): Pick<Corpse, 'palettes' | 'camo'> {
  const p = s.palettes;
  return { palettes: [p.hair, p.skin, p.vest, p.pants], ...(s.camo !== 0 ? { camo: true } : {}) };
}

const isMercBody = (s: Soldier) => s.bodyType <= Body.REGFEMALE;
const isVehicleOrTank = (s: Soldier) => s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP;
const oneC = (d: number) => (d + 1) % 8;
const oneCC = (d: number) => (d + 7) % 8;
const opposite = (d: number) => (d + 4) % 8;
const VEHICLE_CORPSE_DIRECTION = 7;
const COLLAPSED_TURNS_BEFORE_KNOCKOUT = 1;
const FALL_TO_GROUND_CODE = 721;
const HEAVY_FALL_CODE = 722;
const STANDING_FALL_JAR_DAMAGE = 20;
const CROUCHED_FALL_JAR_DAMAGE = 15;
const QUEEN_MONSTER_DEAD = 'QUEEN_MONSTER_DEAD';
const QUEEN_BLOOD_JAR = 'JAR_QUEEN_CREATURE_BLOOD';
const QUEEN_BLOOD_JAR_STATUS = 100;
const QUEEN_BLOOD_JARS_ON_EASY = 6;
const QUEEN_BLOOD_ROWS_SOUTH = 2;
const DIFFICULTY_EASY = 1;

const DEATH_FROM_FALL: Readonly<Record<string, string>> = {
  FLYBACK_HIT: 'FLYBACK_HIT_DEATH',
  GENERIC_HIT_DEATHTWITCHNB: 'GENERIC_HIT_DEATH',
  FALLFORWARD_FROMHIT_STAND: 'GENERIC_HIT_DEATH',
  ENDFALLFORWARD_FROMHIT_CROUCH: 'GENERIC_HIT_DEATH',
  FALLBACK_HIT_DEATHTWITCHNB: 'FALLBACK_HIT_DEATH',
  FALLBACK_HIT_STAND: 'FALLBACK_HIT_DEATH',
  PRONE_HIT_DEATHTWITCHNB: 'PRONE_HIT_DEATH',
  PRONE_LAY_FROMHIT: 'PRONE_HIT_DEATH',
  FALLOFF: 'FALLOFF_DEATH',
  FALLFORWARD_ROOF: 'FALLOFF_FORWARD_DEATH',
  ADULTMONSTER_DYING: 'ADULTMONSTER_DYING_STOP',
  LARVAE_DIE: 'LARVAE_DIE_STOP',
  QUEEN_DIE: 'QUEEN_DIE_STOP',
  INFANT_DIE: 'INFANT_DIE_STOP',
  CRIPPLE_DIE: 'CRIPPLE_DIE_STOP',
  ROBOTNW_DIE: 'ROBOTNW_DIE_STOP',
  CRIPPLE_DIE_FLYBACK: 'CRIPPLE_DIE_FLYBACK_STOP',
};

const DEATH_STOP: Readonly<Record<string, string>> = {
  FLYBACK_HIT_DEATH: 'FLYBACK_HITDEATH_STOP',
  GENERIC_HIT_DEATH: 'FALLFORWARD_HITDEATH_STOP',
  FALLBACK_HIT_DEATH: 'FALLBACK_HITDEATH_STOP',
  PRONE_HIT_DEATH: 'PRONE_HITDEATH_STOP',
  JFK_HITDEATH: 'JFK_HITDEATH_STOP',
  FALLOFF_DEATH: 'FALLOFF_DEATH_STOP',
  FALLOFF_FORWARD_DEATH: 'FALLOFF_FORWARD_DEATH_STOP',
  WATER_DIE: 'WATER_DIE_STOP',
  DEEP_WATER_DIE: 'DEEP_WATER_DIE_STOPPING',
  COW_DYING: 'COW_DYING_STOP',
  BLOODCAT_DYING: 'BLOODCAT_DYING_STOP',
};

const UNCONSCIOUS_STOP: Readonly<Record<string, string>> = {
  FLYBACK_HIT: 'FLYBACKHIT_STOP',
  GENERIC_HIT_DEATHTWITCHNB: 'STAND_FALLFORWARD_STOP',
  FALLFORWARD_FROMHIT_STAND: 'STAND_FALLFORWARD_STOP',
  ENDFALLFORWARD_FROMHIT_CROUCH: 'STAND_FALLFORWARD_STOP',
  FALLBACK_HIT_DEATHTWITCHNB: 'FALLBACKHIT_STOP',
  FALLBACK_HIT_STAND: 'FALLBACKHIT_STOP',
  PRONE_HIT_DEATHTWITCHNB: 'PRONE_LAYFROMHIT_STOP',
  PRONE_LAY_FROMHIT: 'PRONE_LAYFROMHIT_STOP',
  FALLOFF: 'FALLOFF_STOP',
  FALLFORWARD_ROOF: 'FALLOFF_FORWARD_STOP',
};

const NOT_FROM_HIT_DEATH: Readonly<Record<string, string>> = {
  FLYBACKHIT_STOP: 'FLYBACK_HIT_DEATH',
  FALLFORWARD_FROMHIT_STAND: 'GENERIC_HIT_DEATH',
  FALLFORWARD_FROMHIT_CROUCH: 'GENERIC_HIT_DEATH',
  STAND_FALLFORWARD_STOP: 'GENERIC_HIT_DEATH',
  FALLBACKHIT_STOP: 'FALLBACK_HIT_DEATH',
  PRONE_LAYFROMHIT_STOP: 'PRONE_HIT_DEATH',
  PRONE_LAY_FROMHIT: 'PRONE_HIT_DEATH',
  FALLOFF_STOP: 'FALLOFF_DEATH',
  FALLOFF_FORWARD_STOP: 'FALLOFF_FORWARD_DEATH',
  ADULTMONSTER_HIT: 'ADULTMONSTER_DYING',
  LARVAE_HIT: 'LARVAE_DIE',
  QUEEN_HIT: 'QUEEN_DIE',
  CRIPPLE_HIT: 'CRIPPLE_DIE',
  ROBOTNW_HIT: 'ROBOTNW_DIE',
  INFANT_HIT: 'INFANT_DIE',
  COW_HIT: 'COW_DYING',
  BLOODCAT_HIT: 'BLOODCAT_DYING',
};

const INCAPACITATED_FROM: Readonly<Record<string, string>> = {
  GENERIC_HIT_PRONE: 'PRONE_LAY_FROMHIT',
  ADULTMONSTER_HIT: 'ADULTMONSTER_DYING',
  LARVAE_HIT: 'LARVAE_DIE',
  QUEEN_HIT: 'QUEEN_DIE',
  CRIPPLE_HIT: 'CRIPPLE_DIE',
  ROBOTNW_HIT: 'ROBOTNW_DIE',
  INFANT_HIT: 'INFANT_DIE',
  COW_HIT: 'COW_DYING',
  BLOODCAT_HIT: 'BLOODCAT_DYING',
  WATER_HIT: 'WATER_DIE',
  DEEP_WATER_HIT: 'DEEP_WATER_DIE',
};

const NO_UNCONSCIOUS_BODIES = new Set<number>([
  Body.ADULTFEMALEMONSTER,
  Body.AM_MONSTER,
  Body.YAF_MONSTER,
  Body.YAM_MONSTER,
  Body.LARVAE_MONSTER,
  Body.INFANT_MONSTER,
  Body.CRIPPLECIV,
  Body.ROBOTNOWEAPON,
  Body.QUEENMONSTER,
  Body.TANK_NW,
  Body.TANK_NE,
]);

const state = (t: TacticalState, name: string) => anim(t.content, name);

function checkForAndHandleSoldierIncapacitated(t: TacticalState, s: Soldier): void {
  if (s.life >= OKLIFE) return;
  cancelAllServices(t, s);
  if (NO_UNCONSCIOUS_BODIES.has(s.bodyType)) s.life = 0;
  slapCheckWhenIncapacitated(t);
  if (checkSoldierHitRoof(t, s)) return;
  if (s.life === 0 && !inMeanwhile(t)) s.deadSoundPlayed = true;
  const name = animName(t.content, s.state);
  if (name === 'GENERIC_HIT_STAND' || name === 'STANDING_BURST_HIT' || name === 'RIFLE_STAND_HIT' || name === 'CIV_COWER_HIT') {
    let testDirection = s.direction;
    let forced = false;
    if (t.rng.int(100) > 40 && isMercBody(s) && !TERRORISTS.has(s.profile)) {
      if (s.attacker) {
        testDirection = directionToward(s.gridNo, s.attacker.gridNo);
        forced = true;
      }
      const fallback = state(t, 'FALLBACK_HIT_STAND');
      if (okFallDirection(t, s, s.gridNo, s.level, testDirection, fallback)) {
        const second = newGridNo(s.gridNo, DIRECTION_INCREMENT[opposite(testDirection)] ?? 0);
        if (okFallDirection(t, s, second, s.level, testDirection, fallback)) {
          if (forced) {
            setDesiredDirection(t, s, testDirection);
            setSoldierDirection(t, s, testDirection);
          }
          changeToFallbackAnimation(t, s, s.direction);
          return;
        }
      }
    }
    beginTryingToFall(t, s);
    changeSoldierState(t, s, state(t, 'FALLFORWARD_FROMHIT_STAND'));
    return;
  }
  if (name === 'GENERIC_HIT_CROUCH') {
    changeSoldierState(t, s, state(t, 'FALLFORWARD_FROMHIT_CROUCH'));
    beginTryingToFall(t, s);
    return;
  }
  const next = INCAPACITATED_FROM[name];
  if (next) changeSoldierState(t, s, state(t, next));
}

export function checkForAndHandleSoldierDyingNotFromHit(t: TacticalState, s: Soldier): boolean {
  if (s.life !== 0) return false;
  s.deadSoundPlayed = true;
  s.beingAttackedCount++;
  if (t.options.bloodAndGore) {
    const next = NOT_FROM_HIT_DEATH[animName(t.content, s.state)];
    if (next) changeSoldierState(t, s, state(t, next));
    else checkForAndHandleSoldierDeath(t, s);
  } else checkForAndHandleSoldierDeath(t, s);
  return true;
}

function checkForAlertWhenEnemyDies(t: TacticalState, dying: Soldier): void {
  for (const s of t.mercSlots) {
    if (!s?.placed || s.team !== dying.team || s === dying || s.life < OKLIFE || s.ai.alertStatus >= AlertStatus.RED) continue;
    const dir = atan8Of(s, dying);
    const visible = distanceVisible(t, s, s.desiredDirection, dir, dying.gridNo, dying.level);
    if (pythSpacesAway(s.gridNo, dying.gridNo) > visible) continue;
    if (soldierTo3DLocationLos(t, s, dying.gridNo, dying.level, 0, visible, true)) {
      s.ai.alertStatus = AlertStatus.RED;
      t.turnHooks.checkForChangingOrders(t, s);
    }
  }
}

function npcDeathHistory(killer: Soldier | null): number {
  return killer?.team === Team.OUR ? NarrativeHistory.MERC_KILLED_CHARACTER : NarrativeHistory.NPC_KILLED;
}

function handleNPCTeamMemberDeath(t: TacticalState, old: Soldier): void {
  old.dead = true;
  verifyPublicOpplistDueToDeath(t, old);
  const killer = old.attacker;
  if (old.profile !== NO_PROFILE) {
    const p = profileProgress(t, old.profile);
    if (p) {
      p.mercStatus = MercStatus.IS_DEAD;
      p.life = 0;
    }
    if (!isVehicleOrTank(old)) t.narrative.addHistory(npcDeathHistory(killer), old.profile);
  }
  if (old.team === Team.CIV) {
    civilianDeathRules(t, old, killer);
    if (old.bodyType !== Body.CROW && old.bodyType !== Body.COW) t.sectorHooks.murderOfCivilian(t, old);
  }
  if (old.team !== Team.CIV && old.team !== Team.MILITIA) {
    if (old.bodyType === Body.QUEENMONSTER && killer) t.narrative.creatureQueenDied(killer, old.gridNo, old.level);
    if (killer?.team === Team.OUR) handleMoraleEvent(t, killer, MoraleEvent.KILLED_ENEMY);
    checkForAlertWhenEnemyDies(t, old);
  }
  if (old.bodyType !== Body.CROW && old.bodyType !== Body.COW && old.lastDamageReason !== DamageReason.BLOODLOSS) {
    if (killer?.team === Team.OUR) statChange(t, killer, StatKind.EXPERIENCE, 10 * old.stats.experience, StatCause.SUCCESS);
    let assister = old.previousAttacker;
    if (assister === killer) assister = old.nextToPreviousAttacker;
    if (assister?.placed && assister.team === Team.OUR)
      statChange(t, assister, StatKind.EXPERIENCE, 5 * old.stats.experience, StatCause.SUCCESS);
  }
  if (killer?.team === Team.MILITIA) killer.militiaKills++;
  t.sectorHooks.soldierDied(t, old);
  checkForEndOfBattle(t);
}

function reduceAmmoDroppedByNonPlayerSoldiers(t: TacticalState, s: Soldier, o: Soldier['inv'][number]): void {
  if (s.team === Team.OUR) return;
  if (t.content.items.byIndex.get(o.item)?.itemClass !== ItemClass.AMMO) return;
  o.count = 1 + t.rng.int(o.count);
}

function dropsVisible(s: Soldier): number {
  return s.team === Team.OUR || s.profile === Profile.QUEEN ? Visibility.VISIBLE : Visibility.INVISIBLE;
}

function dropInventory(t: TacticalState, s: Soldier, visible: number): void {
  for (const o of s.inv) {
    if (o.item === NOTHING) continue;
    if (!(o.flags & ObjectFlags.UNDROPPABLE) || s.team === Team.OUR) {
      if (!((t.content.items.byIndex.get(o.item)?.flags ?? 0) & ItemFlags.DEFAULT_UNDROPPABLE)) {
        reduceAmmoDroppedByNonPlayerSoldiers(t, s, o);
        addItemToPool(t, s.gridNo, o, visible, s.level);
      }
    }
  }
  dropKeysInKeyRing(t, s, s.gridNo, s.level, visible);
}

function queenBloodJars(t: TacticalState): number {
  return QUEEN_BLOOD_JARS_ON_EASY - (t.options.difficulty - DIFFICULTY_EASY);
}

function dropQueenBlood(t: TacticalState, s: Soldier, visible: number): void {
  const jar = t.content.items.byName.get(QUEEN_BLOOD_JAR)?.index ?? NOTHING;
  const below = s.gridNo + WORLD_COLS * QUEEN_BLOOD_ROWS_SOUTH;
  const count = queenBloodJars(t);
  for (let k = 0; k < count; k++) addItemToPool(t, below, createItem(t.content.items, jar, QUEEN_BLOOD_JAR_STATUS), visible, s.level);
}

function isQueenMonsterCorpse(t: TacticalState, type: number): boolean {
  return t.content.corpses.table.types[type] === QUEEN_MONSTER_DEAD;
}

function turnSoldierIntoCorpse(t: TacticalState, s: Soldier): boolean {
  if (s.gridNo < 0) return false;
  const type = corpseTypeFor(t.content.corpses.table, s.bodyType, s.state);
  const visible = dropsVisible(s);
  if (s.bodyType !== Body.ROBOTNOWEAPON) {
    if (isQueenMonsterCorpse(t, type)) dropQueenBlood(t, s, visible);
    else dropInventory(t, s, visible);
  }
  const direction = corpseDirection(s);
  removeOccupant(t, s);
  removeMercStructure(t, s);
  if (s.team !== Team.OUR) unregisterSoldier(t, s);
  s.placed = false;
  if (type === NO_CORPSE) return true;
  t.corpses.push({
    gridNo: s.gridNo,
    level: s.level,
    bodyType: s.bodyType,
    direction,
    state: s.state,
    profile: s.profile,
    type,
    timeOfDeath: Math.trunc(worldSeconds(t) / SECONDS_PER_MINUTE),
    ...corpseLook(s),
  });
  addCorpseStructure(t, s.gridNo, s.level, type, direction);
  return true;
}

function corpseDirection(s: Soldier): number {
  if (s.bodyType < Body.HUMVEE) return s.direction;
  if (s.bodyType !== Body.ICECREAMTRUCK && s.bodyType !== Body.HUMVEE) return VEHICLE_CORPSE_DIRECTION;
  return s.direction === 0 || s.direction === 4 ? 0 : VEHICLE_CORPSE_DIRECTION;
}

export function addCorpseStructure(t: TacticalState, g: number, level: number, type: number, direction: number): void {
  const corpses = t.content.corpses;
  const file = corpses.structures.get(corpseFileBase(corpses.table, type, t.options.bloodAndGore));
  const def = file?.structures[corpseStructIndex(corpses.table, type, direction)];
  if (!def) return;
  t.world.structures.add(g, level, def);
  for (const tile of def.tiles) removeBlood(t, g + tile.posRelToBase, level);
}

export function isVehicleCorpse(c: Corpse): boolean {
  return c.bodyType >= Body.HUMVEE && c.bodyType <= Body.JEEP;
}

export function corpseOfStructure(t: TacticalState, base: StructureInstance): Corpse | null {
  const level = base.cubeOffset >= STRUCTURE_ON_ROOF ? 1 : 0;
  return t.corpses.find((c) => c.gridNo === base.gridNo && c.level === level) ?? null;
}

export function removeCorpse(t: TacticalState, corpse: Corpse, base: StructureInstance): void {
  t.corpses.splice(t.corpses.indexOf(corpse), 1);
  t.world.structures.remove(base);
}

export function handleSoldierDeath(t: TacticalState, s: Soldier): { buddyJustDead: boolean; madeCorpse: boolean } {
  let madeCorpse = false;
  let buddyJustDead = false;
  if (s.life === 0 && !s.dead) {
    cancelAllServices(t, s);
    putOutMuzzleFlash(t, s);
    s.gettingHit = 0;
    if (s.team === Team.OUR) s.dead = true;
    else {
      const attacker = s.attacker;
      if (attacker) {
        if (attacker.team === Team.OUR && t.turn.attackBusyCount > 0) {
          t.turn.killedEnemyOnAttack = true;
          t.turn.lastMercKill = s;
        }
      }
      handleNPCTeamMemberDeath(t, s);
      if (attacker?.team === Team.OUR) {
        const p = profileProgress(t, attacker.profile);
        if (p) p.kills++;
      } else if (attacker?.team === Team.MILITIA) attacker.militiaKills += MILITIA_KILL_POINTS;
      let assister = s.previousAttacker;
      if (assister === attacker) assister = s.nextToPreviousAttacker;
      if (assister?.placed && assister !== attacker && assister.team === Team.OUR) {
        const p = profileProgress(t, assister.profile);
        if (p) p.assists++;
      } else if (assister?.placed && assister !== attacker && assister.team === Team.MILITIA)
        assister.militiaKills += MILITIA_ASSIST_POINTS;
    }
    const killerShown = s.attacker !== null && shownToPlayer(s.attacker);
    t.events.push({
      type: 'soldierDied',
      soldier: s.id,
      killer: s.attacker?.id ?? null,
      ...(shownToPlayer(s)
        ? { gridNo: s.gridNo }
        : { unseen: unseenVictim(s), ...soundPlace(t, s, killerShown, loudestScream(s), NoiseKind.SCREAM) }),
    });
    madeCorpse = turnSoldierIntoCorpse(t, s);
    removeManAsTarget(t, s);
    betweenTurnsVisibilityAdjustments(t);
    if (s.team !== Team.OUR && !s.doingExternalDeath) releaseSoldiersAttacker(t, s);
    if (s.team === Team.OUR) t.pendingSkullReleases.push({ soldier: s, at: t.clockMs + SKULL_UI_MS });
    if (!madeCorpse) buddyJustDead = true;
  }
  return { buddyJustDead, madeCorpse };
}

const SKULL_UI_MS = 1920;
const SECONDS_PER_MINUTE = 60;
const MILITIA_KILL_POINTS = 2;
const MILITIA_ASSIST_POINTS = 1;

export function updateSkullReleases(t: TacticalState): void {
  if (t.pendingSkullReleases.length === 0) return;
  const due = t.pendingSkullReleases.filter((r) => t.clockMs >= r.at);
  if (due.length === 0) return;
  t.pendingSkullReleases.splice(0, t.pendingSkullReleases.length, ...t.pendingSkullReleases.filter((r) => t.clockMs < r.at));
  for (const r of due) {
    if (!r.soldier.doingExternalDeath) releaseSoldiersAttacker(t, r.soldier);
    playerTeamDeathRules(t, r.soldier);
    t.sectorHooks.mercDied(t, r.soldier);
    checkForEndOfBattle(t);
  }
}

export function checkForAndHandleSoldierDeath(t: TacticalState, s: Soldier): boolean {
  const r = handleSoldierDeath(t, s);
  if (!r.buddyJustDead) return r.madeCorpse;
  const stop = DEATH_STOP[animName(t.content, s.state)];
  if (stop) changeSoldierState(t, s, state(t, stop));
  return r.madeCorpse;
}

export function beginSoldierGetup(t: TacticalState, s: Soldier): void {
  if (s.serviceCount > 0) return;
  if (inMeanwhile(t)) return;
  if (s.collapsed) {
    if (s.life >= OKLIFE && s.breath >= OKBREATH && s.sleepDrugCounter === 0) {
      s.collapsed = false;
      s.collapsedTurns = 0;
      if (isMercBody(s)) {
        const name = animName(t.content, s.state);
        if (['FALLBACKHIT_STOP', 'FALLOFF_STOP', 'FLYBACKHIT_STOP', 'FALLBACK_HIT_STAND', 'FALLOFF', 'FLYBACK_HIT'].includes(name))
          initNewSoldierAnim(t, s, state(t, 'ROLLOVER'), 0, false);
        else changeSoldierStance(t, s, AnimHeight.CROUCH);
      } else initNewSoldierAnim(t, s, state(t, 'END_COWER'), 0, false);
    } else {
      s.collapsedTurns++;
      if (boxingFight(t) && s.boxer && s.collapsedTurns > COLLAPSED_TURNS_BEFORE_KNOCKOUT) endBoxingMatch(t, s);
    }
  } else if (s.sleepDrugCounter > 0 && t.pre.int(100) < sleepDartSuccumbChance(s)) {
    deductPoints(t.inCombat, s, 0, i16(s.breathMax * 100));
    soldierCollapse(t, s);
  }
  if (s.sleepDrugCounter > 0) s.sleepDrugCounter--;
}

function handleCheckForDeathCommonCode(t: TacticalState, s: Soldier): void {
  if (s.pendingAnimation !== -1) {
    const pending = s.pendingAnimation;
    changeSoldierState(t, s, pending);
    s.pendingAnimation = -1;
    return;
  }
  for (let pass = 0; pass < 2; pass++) {
    s.collapsed = true;
    if (pass === 0) handleSight(t, s, SightFlags.LOOK);
    if (t.turn.currentTeam === s.team) {
      beginSoldierGetup(t, s);
      if (!s.collapsed) return;
    }
    const stop = UNCONSCIOUS_STOP[animName(t.content, s.state)];
    if (!stop) return;
    changeSoldierState(t, s, state(t, stop));
  }
}

function tryToFall(t: TacticalState, s: Soldier): OpOutcome {
  if (!s.tryingToFall) return 'continue';
  const ahead = newGridNo(s.gridNo, DIRECTION_INCREMENT[s.direction] ?? 0);
  if (okFallDirection(t, s, ahead, s.level, s.direction, state(t, 'FALLFORWARD_HITDEATH_STOP'))) {
    s.tryingToFall = false;
    return 'continue';
  }
  setSoldierDirection(t, s, s.fallClockwise ? oneC(s.direction) : oneCC(s.direction));
  setDesiredDirection(t, s, s.direction);
  if (s.direction === s.startFallDir) {
    s.tryingToFall = false;
    return 'continue';
  }
  return 'stop';
}

function decideTurnFromHit(t: TacticalState, s: Soldier): void {
  if (s.bodyType > Body.REGFEMALE || s.life < OKLIFE || s.breath <= 0 || s.level !== 0) return;
  s.pendingActionData1 = s.direction;
  if (s.hitLocation !== AimShot.HEAD) {
    const chance = t.rng.int(100);
    const next = chance < 30 ? oneC(s.direction) : chance < 60 ? oneCC(s.direction) : s.direction;
    setSoldierDirection(t, s, next);
    setDesiredDirection(t, s, s.direction);
  } else if (t.rng.int(100) < 50) {
    s.turningFromHit = true;
    const cw = t.rng.int(50) < 25;
    let d = s.direction;
    for (let i = 0; i < 3; i++) d = cw ? oneC(d) : oneCC(d);
    setDesiredDirection(t, s, d);
  }
}

function backToAim(t: TacticalState, s: Soldier): OpOutcome {
  const back = s.goBackToAimAfterHit;
  s.goBackToAimAfterHit = false;
  if (!back) return 'continue';
  if (s.life >= OKLIFE) internalSoldierReadyWeapon(t, s, s.direction, false);
  return 'stop';
}

function deathOrRelease(t: TacticalState, s: Soldier): OpOutcome {
  if (s.life === 0) {
    if (!s.deadSoundPlayed && animName(t.content, s.state) !== 'JFK_HITDEATH') s.deadSoundPlayed = true;
    if (t.options.bloodAndGore) {
      const next = DEATH_FROM_FALL[animName(t.content, s.state)];
      if (!next) return 'stop';
      changeSoldierState(t, s, state(t, next));
    } else checkForAndHandleSoldierDeath(t, s);
    return 'stop';
  }
  if (hasAnimFlag(t.content, s.state, AnimFlags.HITFINISH)) {
    releaseSoldiersAttacker(t, s);
    if (!s.placed) return 'stop';
    s.gettingHit = 0;
  }
  handleCheckForDeathCommonCode(t, s);
  return 'stop';
}

function fallOnFragileItems(t: TacticalState, s: Soldier, fallState: string, damage: number): void {
  if (animName(t.content, s.state) === fallState) checkEquipmentForFragileItemDamage(t, s, damage);
}

function dropFlybackBlood(t: TacticalState, s: Soldier): void {
  internalDropBlood(t, s.gridNo, s.level, BloodKind.HUMAN, MAX_BLOOD_QUANTITY, DROPPED_IN_SIGHT);
  const behind = newGridNo(s.gridNo, DIRECTION_INCREMENT[(s.direction + 4) % 8] ?? 0);
  internalDropBlood(t, behind, s.level, BloodKind.HUMAN, MAX_BLOOD_QUANTITY, DROPPED_IN_SIGHT);
}

export function deathOpcode(t: TacticalState, s: Soldier, code: number): OpOutcome | null {
  switch (code) {
    case 433:
      checkForAndHandleSoldierIncapacitated(t, s);
      return animName(t.content, s.state) === '' ? 'stop' : null;
    case 437:
      setSoldierDirection(t, s, (s.direction + 4) % 8);
      setDesiredDirection(t, s, s.direction);
      changeSoldierState(t, s, anim(t.content, 'GETUP_FROM_ROLLOVER'));
      return 'stop';
    case 440:
      checkForAndHandleSoldierDeath(t, s);
      return 'stop';
    case 447:
      return tryToFall(t, s);
    case 465:
      s.life = 0;
      return 'continue';
    case 472:
      return backToAim(t, s);
    case 478:
      decideTurnFromHit(t, s);
      return 'continue';
    case 765:
      dropFlybackBlood(t, s);
      return 'continue';
    case FALL_TO_GROUND_CODE:
      fallOnFragileItems(t, s, 'FALLFORWARD_FROMHIT_STAND', STANDING_FALL_JAR_DAMAGE);
      return 'continue';
    case HEAVY_FALL_CODE:
      fallOnFragileItems(t, s, 'FALLFORWARD_FROMHIT_CROUCH', CROUCHED_FALL_JAR_DAMAGE);
      return 'continue';
    case 480:
      releaseSoldiersAttacker(t, s);
      s.gettingHit = 0;
      return 'continue';
    case 496:
      changeSoldierState(t, s, s.oldState, s.oldPc);
      return 'stop';
    case 497:
      return deathOrRelease(t, s);
    default:
      return null;
  }
}
