// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/PanicButtons.cc MakeClosestEnemyChosenOne, PossiblyMakeThisEnemyChosenOne, PanicAI;
// @src TacticalAI/DecideAction.cc DecideActionRed and DecideActionBlack (the panic branches, NeedToRadioAboutPanicTrigger
// @src in the radio chances); AIMain.cc ExecuteAction (the red alert that sends the closest enemy), HandleInitialRedAlert,
// @src CheckForChangingOrders (the Warden).

import { pythSpacesAway } from '../../../content/world/grid.ts';
import { states } from '../animation.ts';
import { findObj } from '../doors/lock-attempts.ts';
import { NO_SLOT } from '../inventory.ts';
import { Profile } from '../narrative/constants.ts';
import { AP, calcActionPoints } from '../points.ts';
import { AlertStatus, NOWHERE, OKBREATH, OKLIFE, type Soldier, Team } from '../soldier.ts';
import { mercs, type TacticalState } from '../state.ts';
import { AiAction } from './actions.ts';
import { checkForChangingOrders, setNewSituation } from './decide.ts';
import { legalNPCDestination, PathMode } from './destinations.ts';
import {
  closestPanicTrigger,
  hasPanicTriggers,
  mayUsePanicButtons,
  NO_PANIC_TRIGGER,
  needToRadioAboutPanicTrigger,
  PanicFlags,
  panicTrigger,
  percentEnemiesKilled,
  popPanicKeys,
  pushPanicKeys,
} from './panic-triggers.ts';
import { plotPathCost } from './utils.ts';

export const NO_PANIC_ACTION = -1;

const FAR_AWAY = 1000;
const MAX_SHOCK = 2;
const BLACK_TRIGGER_RANGE = 10;
const RUNNING_BUDGET_FACTOR = 2;
const WATER_FORBIDDEN = false;

function pathCost(t: TacticalState, s: Soldier, g: number, mode: 'WALKING' | 'RUNNING'): number {
  return plotPathCost(t, s, g, states(t.content.animations)[mode]);
}

function mayGoForTrigger(t: TacticalState, s: Soldier): boolean {
  if (s.life < OKLIFE || s.breath < OKBREATH || !mayUsePanicButtons(t, s)) return false;
  return s.ai.oppCount <= 0 && s.shock <= MAX_SHOCK && s.level === 0;
}

function walkCostWithKeys(t: TacticalState, s: Soldier, g: number): number {
  pushPanicKeys(s);
  const cost = s.gridNo !== g ? pathCost(t, s, g, 'WALKING') : 0;
  popPanicKeys(s);
  return cost;
}

export function makeClosestEnemyChosenOne(t: TacticalState): void {
  if (!hasPanicTriggers(t) || !needToRadioAboutPanicTrigger(t)) return;
  let closest: Soldier | null = null;
  let shortest = FAR_AWAY;
  for (const s of mercs(t)) {
    if (!mayGoForTrigger(t, s)) continue;
    const index = closestPanicTrigger(t, s);
    if (index === NO_PANIC_TRIGGER) continue;
    const g = panicTrigger(t, index).gridNo;
    if (g === NOWHERE) continue;
    const cost = walkCostWithKeys(t, s, g);
    if ((cost !== 0 || s.gridNo === g) && cost < shortest) {
      shortest = cost;
      closest = s;
    }
  }
  if (!closest) return;
  t.panic.chosenOne = closest;
  if (closest.ai.alertStatus < AlertStatus.RED) {
    closest.ai.alertStatus = AlertStatus.RED;
    checkForChangingOrders(t, closest);
  }
  setNewSituation(t, closest);
  pushPanicKeys(closest);
}

export function possiblyMakeThisEnemyChosenOne(t: TacticalState, s: Soldier): void {
  if (!hasPanicTriggers(t) || s.level !== 0) return;
  const index = closestPanicTrigger(t, s);
  if (index === NO_PANIC_TRIGGER) return;
  const trigger = panicTrigger(t, index);
  if (trigger.tolerance > percentEnemiesKilled(t)) return;
  pushPanicKeys(s);
  let apCost = AP.PULL_TRIGGER;
  if (s.gridNo !== trigger.gridNo) {
    const runCost = pathCost(t, s, trigger.gridNo, 'RUNNING');
    if (runCost === 0) {
      popPanicKeys(s);
      return;
    }
    apCost += runCost;
  }
  if (apCost <= calcActionPoints(t, s) * RUNNING_BUDGET_FACTOR) {
    t.panic.chosenOne = s;
    return;
  }
  popPanicKeys(s);
}

function replaceChosenOne(t: TacticalState): void {
  t.panic.chosenOne = null;
  makeClosestEnemyChosenOne(t);
}

function waitATurn(s: Soldier): number {
  s.ai.actionData = NOWHERE;
  return AiAction.NONE;
}

function useDetonator(t: TacticalState, s: Soldier): number | null {
  if (!(t.panic.flags & PanicFlags.BOMBS_HERE)) return null;
  const detonator = t.content.items.byName.get('REMOTEBOMBTRIGGER')?.index ?? -1;
  if (findObj(s, detonator) === NO_SLOT) return null;
  return s.actionPoints >= AP.USE_REMOTE ? AiAction.USE_DETONATOR : waitATurn(s);
}

function goForTrigger(t: TacticalState, s: Soldier, canMove: boolean): number {
  const index = closestPanicTrigger(t, s);
  if (index === NO_PANIC_TRIGGER) return NO_PANIC_ACTION;
  const g = panicTrigger(t, index).gridNo;
  const onTrigger = s.gridNo === g;
  if (!onTrigger && pathCost(t, s, g, 'RUNNING') === 0) {
    replaceChosenOne(t);
    return NO_PANIC_ACTION;
  }
  if (onTrigger) {
    if (s.actionPoints < AP.PULL_TRIGGER) return waitATurn(s);
    s.ai.actionData = g;
    return AiAction.PULL_TRIGGER;
  }
  if (!canMove) return waitATurn(s);
  if (legalNPCDestination(t, s, g, PathMode.ENSURE_PATH, WATER_FORBIDDEN, 0)) {
    s.ai.actionData = g;
    s.pathStored = true;
    return AiAction.GET_CLOSER;
  }
  replaceChosenOne(t);
  return NO_PANIC_ACTION;
}

export function panicAI(t: TacticalState, s: Soldier, canMove: boolean): number {
  const detonator = useDetonator(t, s);
  if (detonator !== null) return detonator;
  if (!hasPanicTriggers(t) || s !== t.panic.chosenOne) return NO_PANIC_ACTION;
  return goForTrigger(t, s, canMove);
}

function alertedToPanic(t: TacticalState, s: Soldier): boolean {
  if (s.team === Team.CIV && s.profile !== Profile.WARDEN) return false;
  return t.perception.awareOfOpposition[s.team] === true || s === t.panic.chosenOne || s.profile === Profile.WARDEN;
}

export function redPanicAction(t: TacticalState, s: Soldier, canMove: boolean): number {
  if (!alertedToPanic(t, s) || !(t.panic.flags & (PanicFlags.BOMBS_HERE | PanicFlags.TRIGGERS_HERE))) return NO_PANIC_ACTION;
  if (s.profile === Profile.WARDEN && t.panic.chosenOne === null) possiblyMakeThisEnemyChosenOne(t, s);
  return panicAI(t, s, canMove);
}

function triggerWithinReach(t: TacticalState, s: Soldier): boolean {
  const index = closestPanicTrigger(t, s);
  if (index === NO_PANIC_TRIGGER) return false;
  const trigger = panicTrigger(t, index);
  if (trigger.isAlarm && t.perception.awareOfOpposition[s.team]) return false;
  return pythSpacesAway(s.gridNo, trigger.gridNo) < BLACK_TRIGGER_RANGE;
}

export function blackPanicAction(t: TacticalState, s: Soldier, canMove: boolean): number {
  const mayVolunteer = s.team === Team.ENEMY || s.profile === Profile.WARDEN;
  if (mayVolunteer && hasPanicTriggers(t) && t.panic.chosenOne === null && triggerWithinReach(t, s)) possiblyMakeThisEnemyChosenOne(t, s);
  return s === t.panic.chosenOne ? panicAI(t, s, canMove) : NO_PANIC_ACTION;
}

export function radioAsFirstRedAlert(t: TacticalState, team: number): boolean {
  return !t.perception.awareOfOpposition[team] || needToRadioAboutPanicTrigger(t);
}

export function radioIgnoresMorale(t: TacticalState, team: number): boolean {
  return hasPanicTriggers(t) && !t.perception.awareOfOpposition[team];
}

export function redAlertIsInitial(t: TacticalState, team: number): boolean {
  return !t.perception.awareOfOpposition[team] || (hasPanicTriggers(t) && t.panic.chosenOne === null);
}

export function sendClosestEnemyAfterRedAlert(t: TacticalState, team: number): void {
  if (team === Team.ENEMY && hasPanicTriggers(t)) makeClosestEnemyChosenOne(t);
}

export function wardenSendsClosestEnemy(t: TacticalState, s: Soldier): void {
  if (s.profile === Profile.WARDEN) makeClosestEnemyChosenOne(t);
}
