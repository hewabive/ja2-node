// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Ani.cc opcodes 433, 437, 440, 447, 465, 472, 478, 480, 496, 497,
// @src CheckForAndHandleSoldierIncompacitated, CheckForAndHandleSoldierDyingNotFromHit, HandleSoldierDeath,
// @src CheckForAndHandleSoldierDeath, HandleCheckForDeathCommonCode; Soldier_Control.cc BeginSoldierGetup;
// @src Overhead.cc HandleNPCTeamMemberDeath; OppList.cc CheckForAlertWhenEnemyDies;
// @src Rotting_Corpses.cc TurnSoldierIntoCorpse, ReduceAmmoDroppedByNonPlayerSoldiers. See docs/11 §5.

import { corpseFileBase, corpseStructIndex, corpseTypeFor, NO_CORPSE } from '../../../content/anim/corpses.ts';
import type { OpOutcome } from '../../../content/anim/script.ts';
import { AnimFlags } from '../../../content/anim/tables.ts';
import { ItemClass, ItemFlags, NOTHING } from '../../../content/items/items.ts';
import { DIRECTION_INCREMENT, newGridNo, pythSpacesAway } from '../../../content/world/grid.ts';
import { ObjectFlags } from '../../items/object.ts';
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
import { directionToward } from '../movement.ts';
import { atan8Of, SightFlags } from '../perception/opp.ts';
import { distanceVisible, handleSight, removeManAsTarget, verifyPublicOpplistDueToDeath } from '../perception/sight.ts';
import { removeMercStructure } from '../person-structure.ts';
import { profileProgress, StatKind } from '../profiles.ts';
import { checkSoldierHitRoof } from '../roofs.ts';
import { AlertStatus, Body, NO_PROFILE, OKBREATH, OKLIFE, type Soldier, Team } from '../soldier.ts';
import { removeOccupant, type TacticalState, unregisterSoldier } from '../state.ts';
import { betweenTurnsVisibilityAdjustments, checkForEndOfBattle } from '../turns/turns.ts';
import { addItemToPool, Visibility } from '../world-items.ts';
import { internalSoldierReadyWeapon } from './attack.ts';
import { StatCause, statChange } from './experience.ts';
import { beginTryingToFall, changeToFallbackAnimation, okFallDirection, releaseSoldiersAttacker } from './hit.ts';
import { handleMoraleEvent, MoraleEvent } from './morale.ts';
import { soldierTo3DLocationLos } from './positions.ts';
import { AimShot, DamageReason } from './types.ts';

export interface Corpse {
  readonly gridNo: number;
  readonly level: number;
  readonly bodyType: number;
  readonly direction: number;
  readonly state: number;
  readonly profile: number;
  readonly type: number;
}

const isMercBody = (s: Soldier) => s.bodyType <= Body.REGFEMALE;
const oneC = (d: number) => (d + 1) % 8;
const oneCC = (d: number) => (d + 7) % 8;
const opposite = (d: number) => (d + 4) % 8;
const TERRORIST_PROFILES = new Set<number>();
const VEHICLE_CORPSE_DIRECTION = 7;

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
  if (NO_UNCONSCIOUS_BODIES.has(s.bodyType)) s.life = 0;
  if (checkSoldierHitRoof(t, s)) return;
  if (s.life === 0) s.deadSoundPlayed = true;
  const name = animName(t.content, s.state);
  if (name === 'GENERIC_HIT_STAND' || name === 'STANDING_BURST_HIT' || name === 'RIFLE_STAND_HIT' || name === 'CIV_COWER_HIT') {
    let testDirection = s.direction;
    let forced = false;
    if (t.rng.int(100) > 40 && isMercBody(s) && !TERRORIST_PROFILES.has(s.profile)) {
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

function handleNPCTeamMemberDeath(t: TacticalState, old: Soldier): void {
  old.dead = true;
  verifyPublicOpplistDueToDeath(t, old);
  const killer = old.attacker;
  if (old.profile !== NO_PROFILE) {
    const p = profileProgress(t, old.profile);
    if (p) {
      p.dead = true;
      p.life = 0;
    }
  }
  if (old.team !== Team.CIV && old.team !== Team.MILITIA) {
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
  checkForEndOfBattle(t);
}

function reduceAmmoDroppedByNonPlayerSoldiers(t: TacticalState, s: Soldier, o: Soldier['inv'][number]): void {
  if (s.team === Team.OUR) return;
  if (t.content.items.byIndex.get(o.item)?.itemClass !== ItemClass.AMMO) return;
  o.count = 1 + t.rng.int(o.count);
}

function turnSoldierIntoCorpse(t: TacticalState, s: Soldier): boolean {
  if (s.gridNo < 0) return false;
  const visible = s.team === Team.OUR ? Visibility.VISIBLE : Visibility.INVISIBLE;
  if (s.bodyType !== Body.ROBOTNOWEAPON) {
    for (const o of s.inv) {
      if (o.item === NOTHING) continue;
      if (!(o.flags & ObjectFlags.UNDROPPABLE) || s.team === Team.OUR) {
        if (!((t.content.items.byIndex.get(o.item)?.flags ?? 0) & ItemFlags.DEFAULT_UNDROPPABLE)) {
          reduceAmmoDroppedByNonPlayerSoldiers(t, s, o);
          addItemToPool(t, s.gridNo, o, visible, s.level);
        }
      }
    }
  }
  const type = corpseTypeFor(t.content.corpses.table, s.bodyType, s.state);
  const direction = corpseDirection(s);
  removeOccupant(t, s);
  removeMercStructure(t, s);
  if (s.team !== Team.OUR) unregisterSoldier(t, s);
  s.placed = false;
  if (type === NO_CORPSE) return true;
  t.corpses.push({ gridNo: s.gridNo, level: s.level, bodyType: s.bodyType, direction, state: s.state, profile: s.profile, type });
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
  if (def) t.world.structures.add(g, level, def);
}

export function handleSoldierDeath(t: TacticalState, s: Soldier): { buddyJustDead: boolean; madeCorpse: boolean } {
  let madeCorpse = false;
  let buddyJustDead = false;
  if (s.life === 0 && !s.dead) {
    s.muzzleFlash = false;
    s.gettingHit = 0;
    if (s.team === Team.OUR) s.dead = true;
    else {
      const attacker = s.attacker;
      if (attacker) {
        if (attacker.team === Team.OUR && t.turn.attackBusyCount > 0) t.turn.killedEnemyOnAttack = true;
      }
      handleNPCTeamMemberDeath(t, s);
      if (attacker?.team === Team.OUR) {
        const p = profileProgress(t, attacker.profile);
        if (p) p.kills++;
      }
      let assister = s.previousAttacker;
      if (assister === attacker) assister = s.nextToPreviousAttacker;
      if (assister?.placed && assister !== attacker && assister.team === Team.OUR) {
        const p = profileProgress(t, assister.profile);
        if (p) p.assists++;
      }
    }
    t.events.push({ type: 'soldierDied', soldier: s.id, killer: s.attacker?.id ?? null, gridNo: s.gridNo });
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

export function updateSkullReleases(t: TacticalState): void {
  if (t.pendingSkullReleases.length === 0) return;
  const due = t.pendingSkullReleases.filter((r) => t.clockMs >= r.at);
  if (due.length === 0) return;
  t.pendingSkullReleases.splice(0, t.pendingSkullReleases.length, ...t.pendingSkullReleases.filter((r) => t.clockMs < r.at));
  for (const r of due) {
    if (!r.soldier.doingExternalDeath) releaseSoldiersAttacker(t, r.soldier);
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
    } else s.collapsedTurns++;
  } else if (s.sleepDrugCounter > 0) {
    t.pre.int(100);
  }
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
    case 480:
      releaseSoldiersAttacker(t, s);
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
