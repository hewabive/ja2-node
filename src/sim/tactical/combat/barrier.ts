// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc InternalReduceAttackBusyCount, ReduceAttackBusyCount, FreeUpAttacker,
// @src FreeUpAttackerGivenTarget, ReduceAttackBusyGivenTarget, CalcSuppressionTolerance, HandleSuppressionFire,
// @src OppList.cc NoticeUnseenAttacker (with ReevaluateEnemyStance); the EndBoxingMatch of InternalReduceAttackBusyCount. See docs/11 §8, docs/25 §7.2.

import { ItemClass } from '../../../content/items/items.ts';
import { pythSpacesAway, spacesAway } from '../../../content/world/grid.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import { AnimHeight, changeSoldierStance, endHeight } from '../animation.ts';
import { InvSlot } from '../inventory.ts';
import { endBoxingMatch } from '../narrative/boxing.ts';
import { boxingFight } from '../narrative/boxing-state.ts';
import { processImplicationsOfPCAttack } from '../narrative/civ-hostility.ts';
import { calcInterruptDuelPts, interruptDuel, standardInterruptConditionsMet } from '../perception/duel.ts';
import { reevaluateEnemyStance } from '../perception/enemy-stance.ts';
import { closestKnownOpponent } from '../perception/knowledge.ts';
import { dequeueDeferredNoises } from '../perception/noise.ts';
import { Caller, Opp } from '../perception/opp.ts';
import { allTeamsLookForAll, distanceVisible, manSeesMan, radioSightings, updatePersonal, updatePublic } from '../perception/sight.ts';
import { isValidStance } from '../person-structure.ts';
import { AP } from '../points.ts';
import { profileProgress, StatKind } from '../profiles.ts';
import { AlertStatus, Body, NO_INTERRUPT, NO_PROFILE, NOWHERE, OKLIFE, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { addToIntList, checkForEndOfBattle, doneAddingToIntList, enterCombatMode } from '../turns/turns.ts';
import { handleAnyStatChangesAfterAttack, StatCause, statChange } from './experience.ts';
import { handleMoraleEvent, MoraleEvent } from './morale.ts';
import { soldierToSoldierLos } from './positions.ts';
import { SkillCheckReason, skillCheck } from './skill-check.ts';
import { AiMorale, WeaponMode } from './types.ts';

const SUPPRESSION_FIRE_MODIFIER = 6;
const SUPPRESSION_FIRE_REACTION_THRESHOLD = 130;
const MAX_APS_SUPPRESSED = 8;
const MAX_DISTANCE_VISIBLE = 26;
const IRRELEVANT = -1;
const ProfileAttitude = { AGGRESSIVE: 5, COWARD: 9 } as const;
const AiAttitude = { DEFENSIVE: 0, BRAVESOLO: 1, BRAVEAID: 2, AGGRESSIVE: 4 } as const;

const isMercBody = (s: Soldier) => s.bodyType <= Body.REGFEMALE;

function isGunInHand(t: TacticalState, s: Soldier): boolean {
  const def = t.content.items.byIndex.get(s.inv[InvSlot.HAND]?.item ?? 0);
  return def !== undefined && def.itemClass === ItemClass.GUN;
}

function calcSuppressionTolerance(t: TacticalState, s: Soldier): number {
  let tol = s.stats.experience * 2;
  if (s.team === Team.OUR) tol += Math.trunc((s.morale - 50) / 10);
  else tol += (s.ai.morale - AiMorale.NORMAL) * 2;
  if (s.profile !== NO_PROFILE) {
    const attitude = profileProgress(t, s.profile)?.attitude;
    if (attitude === ProfileAttitude.AGGRESSIVE) tol += 2;
    else if (attitude === ProfileAttitude.COWARD) tol -= 2;
  } else {
    if (s.ai.attitude === AiAttitude.BRAVESOLO || s.ai.attitude === AiAttitude.BRAVEAID) tol += 2;
    else if (s.ai.attitude === AiAttitude.AGGRESSIVE) tol += 1;
    else if (s.ai.attitude === AiAttitude.DEFENSIVE) tol -= 1;
  }
  return Math.max(0, tol);
}

function closestKnownOpponentFar(t: TacticalState, s: Soldier): boolean {
  const g = closestKnownOpponent(t, s);
  return g === NOWHERE || spacesAway(s.gridNo, g) > 8;
}

export function handleSuppressionFire(t: TacticalState, caused: Soldier | null): void {
  for (const s of t.mercSlots) {
    if (!s?.placed || !isMercBody(s) || s.life < OKLIFE || s.suppressionPoints === 0) continue;
    const tol = calcSuppressionTolerance(t, s);
    let lost = Math.trunc((Math.trunc((s.suppressionPoints * SUPPRESSION_FIRE_MODIFIER) / (tol + 6)) * 2 + 1) / 2) & 0xff;
    if (lost > MAX_APS_SUPPRESSED) lost = MAX_APS_SUPPRESSED;
    const total = lost;
    if (s.apsLostToSuppression >= lost) continue;
    const moraleHits = Math.trunc(total / 2) - Math.trunc(s.apsLostToSuppression / 2);
    for (let i = 0; i < moraleHits; i++) handleMoraleEvent(t, s, MoraleEvent.SUPPRESSED);
    lost -= s.apsLostToSuppression;
    let stance = 0;
    if (s.suppressionPoints >= Math.trunc(SUPPRESSION_FIRE_REACTION_THRESHOLD / (6 + tol))) {
      const end = endHeight(t.content, s.state);
      if (end === AnimHeight.CROUCH) {
        if (total >= AP.PRONE && isValidStance(t, s, AnimHeight.PRONE) && closestKnownOpponentFar(t, s)) stance = AnimHeight.PRONE;
      } else if (end !== AnimHeight.PRONE && s.overTerrain !== Terrain.LOW_WATER && s.overTerrain !== Terrain.DEEP_WATER) {
        if (total >= AP.CROUCH + AP.PRONE && isValidStance(t, s, AnimHeight.PRONE)) {
          if (closestKnownOpponentFar(t, s)) stance = end === AnimHeight.STAND ? AnimHeight.CROUCH : AnimHeight.PRONE;
          else if (end === AnimHeight.STAND && isValidStance(t, s, AnimHeight.CROUCH)) stance = AnimHeight.CROUCH;
        } else if (total >= AP.CROUCH && end !== AnimHeight.CROUCH && isValidStance(t, s, AnimHeight.CROUCH)) stance = AnimHeight.CROUCH;
      }
    }
    s.actionPoints = ((s.actionPoints - lost) << 24) >> 24;
    s.apsLostToSuppression = total;
    if (stance) {
      if (t.inCombat) {
        t.turn.attackBusyCount++;
        s.suppressor = caused;
      }
      s.changingStanceDueToSuppression = true;
      s.dontChargeAPsForStanceChange = true;
      if (s.team !== Team.OUR) t.turnHooks.suppressedStanceChange(t, s, stance);
      s.pendingAnimation = -1;
      s.inNonInterruptibleAnimation = false;
      s.rtNonInterruptible = false;
      changeSoldierStance(t, s, stance);
    }
  }
}

export function noticeUnseenAttacker(t: TacticalState, att: Soldier, def: Soldier): void {
  if (!t.inCombat) return;
  if (att.attackingWeapon === (t.content.items.byName.get('DART_GUN')?.index ?? -2)) {
    if (skillCheck(t, def, SkillCheckReason.NOTICE_DART, 0) < 0) return;
  }
  if (def.bodyType === Body.LARVAE_MONSTER) return;
  const oldOpp = def.oppList[att.id] ?? 0;
  let sees = false;
  if (pythSpacesAway(att.gridNo, def.gridNo) <= MAX_DISTANCE_VISIBLE) {
    const limit = distanceVisible(t, def, IRRELEVANT, 0, att.gridNo, att.level);
    sees = soldierToSoldierLos(t, def, att, limit, true) !== 0;
  }
  if (sees) {
    manSeesMan(t, def, att, Caller.UNKNOWN);
    def.newOppCnt = 0;
    if (def.team === Team.OUR) {
      statChange(t, def, StatKind.EXPERIENCE, 5, StatCause.SUCCESS);
      radioSightings(t, def, att, def.team);
    } else reevaluateEnemyStance(t, def, def.state);
  } else {
    t.turnHooks.setNewSituation(t, def);
    if (def.ai.alertStatus < AlertStatus.RED) {
      def.ai.alertStatus = AlertStatus.RED;
      t.turnHooks.checkForChangingOrders(t, def);
    }
    updatePersonal(def, att, Opp.HEARD_THIS_TURN, att.gridNo);
    if (def.team === Team.OUR) updatePublic(t, def.team, att, Opp.HEARD_THIS_TURN, att.gridNo);
  }
  def.interruptDuelPts = standardInterruptConditionsMet(t, def, att, oldOpp) ? calcInterruptDuelPts(t, def, att, false) : NO_INTERRUPT;
  if (def.interruptDuelPts !== NO_INTERRUPT) {
    att.interruptDuelPts = calcInterruptDuelPts(t, att, def, false);
    if (interruptDuel(def, att)) {
      addToIntList(t, att, false);
      addToIntList(t, def, true);
      doneAddingToIntList(t);
    }
    def.interruptDuelPts = NO_INTERRUPT;
    att.interruptDuelPts = NO_INTERRUPT;
  }
}

export function internalReduceAttackBusyCount(
  t: TacticalState,
  soldier: Soldier | null,
  calledByAttacker: boolean,
  targetIn: Soldier | null,
): Soldier | null {
  const target = soldier ? targetIn : null;
  if (calledByAttacker && soldier && isGunInHand(t, soldier) && soldier.bulletsLeft > 0) return target;
  if (t.turn.attackBusyCount > 0) t.turn.attackBusyCount--;
  if (t.turn.attackBusyCount > 0) return target;
  if (t.inCombat) {
    handleSuppressionFire(t, soldier);
    if (t.turn.attackBusyCount > 0) return target;
  }
  if (target) target.numPelletsHitBy = 0;
  let enterCombat = false;
  if (soldier) {
    soldier.attackingHand = InvSlot.HAND;
    if (target && soldier.attackNoticed) {
      if (target.bodyType !== Body.CROW && soldier.team === Team.OUR) enterCombat = processImplicationsOfPCAttack(t, soldier, target);
      if (target.bodyType === Body.CROW) enterCombat = false;
      if (boxingFight(t) && target.life <= 0) endBoxingMatch(t, target);
      if (soldier.team !== Team.OUR || target.team !== Team.OUR) {
        if ((target.oppList[soldier.id] ?? 0) !== Opp.SEEN_CURRENTLY) noticeUnseenAttacker(t, soldier, target);
        target.ai.underFire = 2;
      }
    }
    soldier.sayAmmoQuotePending = false;
    if (soldier.team !== Team.OUR) t.turnHooks.freeUpFromAttacking(t, soldier);
    if (enterCombat && !t.inCombat) enterCombatMode(t, soldier.team);
    soldier.attackNoticed = false;
  }
  t.turn.killedEnemyOnAttack = false;
  handleAnyStatChangesAfterAttack(t);
  if (t.turn.checkSightAtEndOfAttack) {
    allTeamsLookForAll(t);
    t.turn.checkSightAtEndOfAttack = false;
  }
  dequeueDeferredNoises(t);
  checkForEndOfBattle(t);
  if (!t.inCombat && soldier) soldier.muzzleFlash = false;
  if (soldier && soldier.weaponMode === WeaponMode.ATTACHED) soldier.weaponMode = WeaponMode.NORMAL;
  if (soldier) soldier.lastTarget = soldier.targetGridNo;
  t.events.push({ type: 'attackResolved', soldier: soldier?.id ?? null });
  return target;
}

export function reduceAttackBusyCount(t: TacticalState, attacker: Soldier | null, byAttacker: boolean): Soldier | null {
  return internalReduceAttackBusyCount(t, attacker, byAttacker, attacker?.target ?? null);
}

export function freeUpAttacker(t: TacticalState, attacker: Soldier | null): Soldier | null {
  return reduceAttackBusyCount(t, attacker, true);
}

export function freeUpAttackerGivenTarget(t: TacticalState, target: Soldier): Soldier | null {
  return internalReduceAttackBusyCount(t, target.attacker, true, target);
}

export function reduceAttackBusyGivenTarget(t: TacticalState, target: Soldier): Soldier | null {
  return internalReduceAttackBusyCount(t, target.attacker, false, target);
}
