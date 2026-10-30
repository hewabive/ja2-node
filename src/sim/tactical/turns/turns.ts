// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/TeamTurns.cc SayCloseCallQuotes (Random(3) from the gameplay stream), ClearIntList,
// @src StartPlayerTeamTurn, EndTurn, EndAITurn, EndAllAITurns, EndTurnEvents, BeginTeamTurn, DisplayHiddenInterrupt,
// @src DisplayHiddenTurnbased (2026-10-30),
// @src EveryoneInInterruptListOnSameTeam, StartInterrupt, EndInterrupt, DeleteFromIntList, AddToIntList,
// @src VerifyOutOfTurnOrderArray, DoneAddingToIntList, ResolveInterruptsVs; Overhead.cc CommonEnterCombatModeCode,
// @src EnterCombatMode, ExitCombatMode, CheckForEndOfCombatMode, SoldierHasSeenEnemiesLastFewTurns,
// @src CheckForEndOfBattle, NumCapableEnemyInSector, CheckForLosingEndOfBattle; Soldier_Control.cc EVENT_BeginMercTurn
// @src (the heard-noise pause and the per-turn quote flags), CheckForBreathCollapse; OppList.cc
// @src BetweenTurnsVisibilityAdjustments, NonCombatDecayPublicOpplist; Tactical_Turns.cc HandleTacticalEndTurn;
// @src Drugs_And_Alcohol.cc HandleEndTurnDrugAdjustments (regeneration only); the boxing gates of BeginTeamTurn,
// @src CheckForEndOfCombatMode and CheckForEndOfBattle; the first-aid services of EndTurnEvents and
// @src HandleTacticalEndTurn; the usBattlesFought count of CheckForEndOfBattle (2026-10-24); Overhead.cc
// @src CheckForPotentialAddToBattleIncrement, the opplist decay stamp of ExitCombatMode (2026-10-28); Soldier_Control.cc
// @src SetSoldierAsUnderAiControl.

import { WEAPON_CLASSES } from '../../../content/items/items.ts';
import { pythSpacesAway } from '../../../content/world/grid.ts';
import { u8, u32 } from '../../../core/int.ts';
import { Situation } from '../ai/actions.ts';
import { pauseAiTemporarily } from '../ai/pause.ts';
import { adjustNoAPToFinishMove, soldierGotoStationaryStance, TurningFromProne } from '../animation.ts';
import { bleedsAtTurnStart, checkBleeding, NO_BLOOD } from '../combat/bleeding.ts';
import { beginSoldierGetup } from '../combat/death.ts';
import { soldierTakeDamage } from '../combat/hit.ts';
import { findObjClass } from '../combat/reload.ts';
import { DamageReason } from '../combat/types.ts';
import { decayLightEffects } from '../explosions/light.ts';
import { clearGassedAtTurnStart, decaySmokeEffects } from '../explosions/smoke.ts';
import { worldSeconds } from '../explosions/state.ts';
import { handlePlayerServices, handleTeamServices } from '../first-aid.ts';
import { NO_SLOT } from '../inventory.ts';
import { getNewSoldierPath, stopMerc } from '../movement.ts';
import { boxingActive, boxingFight, boxingHalvesPoints, boxingRoundDecided } from '../narrative/boxing-state.ts';
import { inMeanwhile } from '../narrative/meanwhile-rules.ts';
import { removePendingAction } from '../pending-action.ts';
import { AUTOMATIC_INTERRUPT, calcInterruptDuelPts, interruptDuel } from '../perception/duel.ts';
import { Opp, SightFlags } from '../perception/opp.ts';
import {
  decayPublicOpplist,
  handleSight,
  teamNoLongerSeesMan,
  turnOffEveryonesMuzzleFlashes,
  verifyAndDecayOpplist,
} from '../perception/sight.ts';
import {
  calcNewActionPoints,
  carriedWeightPercentOf,
  enoughPoints,
  type PointsContext,
  ptsToMoveDirection,
  unusedAPsToBreath,
} from '../points.ts';
import { profileProgress } from '../profiles.ts';
import { decayBloodAndSmells, decaySmells, dropBlood } from '../smell.ts';
import {
  AlertStatus,
  Body,
  CivilianGroup,
  consideredNeutral,
  isMonster,
  NO_INTERRUPT,
  NO_PENDING_ANIMATION,
  NO_PENDING_DIRECTION,
  NO_PROFILE,
  NOWHERE,
  OKLIFE,
  Orders,
  ReasonCantFinishMove,
  Side,
  type Soldier,
  Team,
} from '../soldier.ts';
import { mercs, type RealtimeClock, soldiersById, type TacticalState, teamMembers } from '../state.ts';
import { buildAIListForTeam, moveToFrontOfAIList, removeFirstAIListEntry } from './ai-list.ts';
import { addTopMessage, endTopMessage, initPlayerUIBar, TopMessageKind } from './top-message.ts';
import { TEAM_COUNT } from './turn-state.ts';

export const InterruptKind = { SIGHT: 0, NOISE: 1 } as const;

const TEAM_SIDE = [Side.FRIENDLY, Side.ENEMY, Side.NONE, Side.FRIENDLY, Side.ENEMY, Side.FRIENDLY] as const;
const HUMAN_TEAM = [true, false, false, false, false, true] as const;
const LAST_TEAM = Team.CIV;
const MAX_DISTANCE_VISIBLE = 26;
const TIME_BETWEEN_RT_OPPLIST_DECAYS = 20;
const LIFE_GAIN_PER_REGEN_POINT = 10;

function pointsContext(t: TacticalState): PointsContext {
  return { env: t.pathEnv, content: t.content, inCombat: t.inCombat };
}

export function isTeamActive(t: TacticalState, team: number): boolean {
  return teamMembers(t, team).length > 0;
}

export function selectedSoldier(t: TacticalState): Soldier | null {
  return t.soldiers[t.turn.selected] ?? null;
}

export function selectSoldier(t: TacticalState, s: Soldier): void {
  t.turn.selected = s.id;
}

function selectNextAvailSoldier(t: TacticalState, from: Soldier): void {
  const ours = teamMembers(t, Team.OUR);
  const start = ours.indexOf(from);
  for (let k = 1; k <= ours.length; k++) {
    const s = ours[(start + k) % ours.length];
    if (s && s.life >= OKLIFE) {
      selectSoldier(t, s);
      return;
    }
  }
}

function checkForBreathCollapse(s: Soldier): void {
  if (s.breath !== 0 || s.collapsed || s.monsterOrAnimal) return;
  s.breathCollapsed = true;
}

function regenerateAtTurnStart(s: Soldier): void {
  if (s.regenerationCounter <= 0) return;
  s.life = Math.min(s.life + LIFE_GAIN_PER_REGEN_POINT, s.lifeMax);
  if (s.life === s.lifeMax) s.bleeding = 0;
  else if (s.bleeding + s.life > s.lifeMax) s.bleeding = s.lifeMax - s.life;
  s.regenerationCounter--;
}

const CLOSE_CALL_QUOTE = 22;
const CLOSE_CALL_ODDS = 3;

export function sayCloseCallQuotes(t: TacticalState): void {
  for (const s of teamMembers(t, Team.OUR)) {
    if (
      s.placed &&
      s.life >= OKLIFE &&
      s.closeCall &&
      s.numHitsThisTurn === 0 &&
      !s.closeCallQuoteSaid &&
      t.rng.int(CLOSE_CALL_ODDS) === 0
    ) {
      t.narrative.sayQuote(s, CLOSE_CALL_QUOTE);
      s.closeCallQuoteSaid = true;
    }
    s.closeCall = false;
  }
}

export function beginMercTurn(t: TacticalState, s: Soldier): void {
  if (s.ai.underFire !== 0) s.ai.underFire--;
  regenerateAtTurnStart(s);
  if (bleedsAtTurnStart(s)) {
    const blood = checkBleeding(t, s);
    if (blood !== NO_BLOOD && s.placed) dropBlood(t, s, u8(blood));
  }
  if (s.life === 0) return;
  s.shock = Math.trunc(s.shock / 2);
  if (s.ai.noiseGridNo !== NOWHERE && s.ai.noiseVolume !== 0) {
    s.ai.noiseVolume--;
    if (s.ai.noiseVolume === 0) s.ai.noiseGridNo = NOWHERE;
  }
  clearGassedAtTurnStart(t, s);
  if (s.blindedCounter > 0 && --s.blindedCounter === 0) handleSight(t, s, SightFlags.LOOK);
  s.weightCarriedAtTurnStart = carriedWeightPercentOf(t.content, s);
  unusedAPsToBreath(pointsContext(t), s, t.explosives.gassed[s.id] === 1);
  if (s.turnsUntilCanSayHeardNoise > 0) s.turnsUntilCanSayHeardNoise--;
  if (s.placed) checkForBreathCollapse(s);
  calcNewActionPoints(s, boxingHalvesPoints(t));
  s.tilesMoved = 0;
  if (s.placed) {
    beginSoldierGetup(t, s);
    if (t.inCombat) verifyAndDecayOpplist(t, s);
  }
  s.pummeledQuoteSaid = false;
  s.closeCallQuoteSaid = false;
  s.numHitsThisTurn = 0;
  s.suppressionPoints = 0;
  s.apsLostToSuppression = 0;
  s.closeCall = false;
  s.movementNoiseHeard = 0;
  if (s.actionPoints > 0) {
    s.moved = false;
    s.passedLastInterrupt = false;
  }
}

export const RT_TURN_MS = 5000;
export const STRATEGIC_OVERHEAD_MS = 20;

export function handleRealtimeTurns(t: TacticalState, clock: RealtimeClock): void {
  if (!t.inCombat && t.turn.forceRealtimeTurn) {
    t.turn.forceRealtimeTurn = false;
    clock.lastTurnMs = t.clockMs;
    handleTacticalEndTurn(t, clock);
    forceOpplistDecay(t, clock);
    return;
  }
  if (t.clockMs - clock.lastOverheadMs < STRATEGIC_OVERHEAD_MS) return;
  clock.lastOverheadMs = t.clockMs;
  if (t.engagedInConv) return;
  if (t.inCombat) {
    clock.lastTurnMs = t.clockMs;
    return;
  }
  if (t.clockMs - clock.lastTurnMs <= RT_TURN_MS) return;
  clock.lastTurnMs = t.clockMs;
  handleTacticalEndTurn(t, clock);
}

function nonCombatDecayPublicOpplist(t: TacticalState, clock: RealtimeClock, now: number): void {
  if (u32(now - clock.lastOpplistDecaySeconds) < TIME_BETWEEN_RT_OPPLIST_DECAYS) return;
  for (const s of mercs(t)) verifyAndDecayOpplist(t, s);
  for (let team = 0; team < TEAM_COUNT; team++) if (isTeamActive(t, team)) decayPublicOpplist(t, team);
  clock.lastOpplistDecaySeconds = now;
}

function forceOpplistDecay(t: TacticalState, clock: RealtimeClock): void {
  const now = worldSeconds(t);
  clock.lastOpplistDecaySeconds = u32(now - TIME_BETWEEN_RT_OPPLIST_DECAYS);
  nonCombatDecayPublicOpplist(t, clock, now);
}

export function handleTacticalEndTurn(t: TacticalState, clock: RealtimeClock): void {
  const now = worldSeconds(t);
  decaySmokeEffects(t);
  decayLightEffects(t);
  decayBloodAndSmells(t, now);
  t.sectorHooks.addPendingEnemies(t);
  nonCombatDecayPublicOpplist(t, clock, now);
  if (!t.inCombat) {
    for (const s of teamMembers(t, Team.OUR)) {
      if (s.life <= 0) continue;
      beginMercTurn(t, s);
      handlePlayerServices(t, s);
    }
    for (const s of mercs(t)) {
      if (s.team === Team.OUR) continue;
      beginMercTurn(t, s);
      handlePlayerServices(t, s);
    }
  }
  t.sectorHooks.tacticalTurnEnded(t);
}

export function betweenTurnsVisibilityAdjustments(t: TacticalState): void {
  for (const s of t.soldiers) {
    if (!s?.placed || s.life <= 0 || s.team === Team.OUR || s.team === Team.MILITIA) continue;
    if (teamNoLongerSeesMan(t, Team.OUR, s, null, 0)) s.visible = -1;
  }
}

function endTurnEvents(t: TacticalState): void {
  handleTeamServices(t, Team.OUR);
  decaySmells(t.smell);
  decaySmokeEffects(t);
  decayLightEffects(t);
}

export function startPlayerTeamTurn(t: TacticalState, entering: boolean): void {
  t.turn.currentTeam = Team.OUR;
  initPlayerUIBar(t, false);
  if (t.inCombat) {
    const selected = selectedSoldier(t);
    if (selected && selected.life < OKLIFE) selectNextAvailSoldier(t, selected);
  }
  if (!entering) checkForEndOfCombatMode(t, true);
  t.turn.killedEnemyOnAttack = false;
  if (t.inCombat) t.events.push({ type: 'turnStarted', team: Team.OUR, round: t.turn.round });
}

export function beginTeamTurn(t: TacticalState, start: number): void {
  let team = start;
  for (;;) {
    if (team > LAST_TEAM) {
      team = Team.OUR;
      t.turn.currentTeam = Team.OUR;
      t.turn.round++;
      endTurnEvents(t);
    } else if (!isTeamActive(t, team)) {
      team++;
      t.turn.currentTeam++;
      continue;
    }
    decayPublicOpplist(t, team);
    for (const s of teamMembers(t, team)) if (s.life > 0) beginMercTurn(t, s);
    if (boxingRoundDecided(t)) return;
    if (team === Team.OUR) {
      if (t.inCombat) startPlayerTeamTurn(t, false);
      return;
    }
    if (buildAIListForTeam(t, team)) {
      const s = removeFirstAIListEntry(t);
      if (s) {
        t.events.push({ type: 'turnStarted', team, round: t.turn.round });
        addTopMessage(t, TopMessageKind.COMPUTER_TURN);
        t.turnHooks.startNPCAI(t, s);
        return;
      }
    }
    team++;
    t.turn.currentTeam++;
  }
}

export function endTurn(t: TacticalState, nextTeam: number): void {
  if (t.turn.intList.length > 0) {
    endInterrupt(t, false);
    return;
  }
  t.sectorHooks.addPendingEnemies(t);
  const ctx = pointsContext(t);
  for (const s of teamMembers(t, t.turn.currentTeam)) {
    s.moved = true;
    if (enoughPoints(t.inCombat, s, ptsToMoveDirection(ctx, s, s.path[0] ?? 0, s.uiMovementMode))) {
      s.finalDestination = s.gridNo;
      s.noAPToFinishMove = false;
    }
  }
  t.turn.currentTeam = nextTeam;
  beginTeamTurn(t, t.turn.currentTeam);
  betweenTurnsVisibilityAdjustments(t);
}

export function endAITurn(t: TacticalState): void {
  if (t.turn.intList.length > 0) {
    endInterrupt(t, false);
    return;
  }
  for (const s of teamMembers(t, t.turn.currentTeam)) {
    s.moved = true;
    s.oldLife = s.life;
  }
  t.turn.currentTeam++;
  beginTeamTurn(t, t.turn.currentTeam);
}

export function endAllAITurns(t: TacticalState): void {
  if (t.turn.intList.length > 0) endInterrupt(t, false);
  if (t.turn.currentTeam !== Team.OUR) {
    for (const s of teamMembers(t, t.turn.currentTeam)) {
      s.moved = true;
      s.aiTurnControl = false;
      s.oldLife = s.life;
    }
    t.turn.currentTeam = Team.OUR;
  }
}

export function numCapableEnemyInSector(t: TacticalState): number {
  let n = 0;
  for (const s of t.soldiers) {
    if (!s?.placed || s.dead) continue;
    if (s.life < OKLIFE && s.life !== 0) continue;
    if (s.neutral || s.side === Side.FRIENDLY) continue;
    n++;
  }
  return n;
}

export function battleFought(t: TacticalState): boolean {
  const fought = t.turn.numFoughtInBattle;
  return (fought[Team.ENEMY] ?? 0) + (fought[Team.CREATURE] ?? 0) + (fought[Team.CIV] ?? 0) > 0;
}

export function lastMercKillWasMonster(t: TacticalState): boolean {
  const killed = t.turn.lastMercKill;
  return killed !== null && isMonster(killed);
}

const CIV_GROUPS_THAT_FIGHT: ReadonlySet<number> = new Set([CivilianGroup.REBEL, CivilianGroup.KINGPIN, CivilianGroup.HICKS]);

function armedFightingCivilian(t: TacticalState, s: Soldier): boolean {
  return CIV_GROUPS_THAT_FIGHT.has(s.civilianGroup) && findObjClass(t.content.items, s, WEAPON_CLASSES) !== NO_SLOT;
}

export function checkForPotentialAddToBattleIncrement(t: TacticalState, s: Soldier): void {
  if (s.neutral || s.side === Side.FRIENDLY) return;
  if (s.team === Team.CIV && !armedFightingCivilian(t, s)) return;
  t.turn.numFoughtInBattle[s.team] = (t.turn.numFoughtInBattle[s.team] ?? 0) + 1;
}

function commonEnterCombatModeCode(t: TacticalState, startTeam: number): void {
  t.inCombat = true;
  t.turn.numFoughtInBattle.fill(0);
  t.sectorHooks.combatEntered(t);
  for (const s of t.soldiers) {
    if (!s?.placed || s.bodyType === Body.CROW) continue;
    stopMerc(t, s);
    t.turnHooks.cancelAIAction(t, s);
    s.aiTurnControl = false;
    checkForPotentialAddToBattleIncrement(t, s);
    calcNewActionPoints(s, boxingHalvesPoints(t));
  }
  t.turn.round = 1;
  t.events.push({ type: 'combatStarted', team: startTeam });
}

export function enterCombatMode(t: TacticalState, startTeam: number): void {
  if (t.inCombat) return;
  if (numCapableEnemyInSector(t) === 0) return;
  t.turn.enemyInSector = true;
  commonEnterCombatModeCode(t, startTeam);
  if (startTeam === Team.OUR) {
    const selected = selectedSoldier(t);
    if (!selected || selected.ai.oppCount === 0) {
      for (const s of teamMembers(t, Team.OUR)) if (s.life >= OKLIFE && s.ai.oppCount > 0) selectSoldier(t, s);
    }
    startPlayerTeamTurn(t, true);
  } else endTurn(t, startTeam);
}

export function setSoldierAsUnderAiControl(t: TacticalState, s: Soldier): void {
  for (const x of t.soldiers) if (x) x.aiTurnControl = false;
  s.aiTurnControl = true;
}

export function displayHiddenTurnbased(t: TacticalState, actor: Soldier): void {
  if (inMeanwhile(t) || t.inCombat) return;
  t.turn.currentTeam = actor.team;
  commonEnterCombatModeCode(t, actor.team);
  setSoldierAsUnderAiControl(t, actor);
  actor.turnInProgress = true;
  if (t.turn.topMessage?.kind !== TopMessageKind.COMPUTER_TURN) addTopMessage(t, TopMessageKind.COMPUTER_TURN);
}

export function exitCombatMode(t: TacticalState): void {
  t.inCombat = false;
  t.turn.virginSector = true;
  for (const s of t.soldiers) {
    if (!s?.placed) continue;
    if (s.noAPToFinishMove && s.life >= OKLIFE) {
      adjustNoAPToFinishMove(s, false);
      soldierGotoStationaryStance(t, s);
    }
    s.pendingAnimation = NO_PENDING_ANIMATION;
    s.pendingDirection = NO_PENDING_DIRECTION;
    removePendingAction(t, s);
    s.moved = false;
    s.finalDestination = s.gridNo;
    s.aiTurnControl = false;
  }
  betweenTurnsVisibilityAdjustments(t);
  pauseAiTemporarily(t);
  turnOffEveryonesMuzzleFlashes(t);
  t.turn.intList.length = 0;
  t.turn.forceRealtimeTurn = true;
  endTopMessage(t);
}

function soldierHasSeenEnemiesLastFewTurns(t: TacticalState, s: Soldier): boolean {
  for (const other of t.soldiers) {
    if (!other?.placed || TEAM_SIDE[other.team] === s.side) continue;
    if (other.team !== Team.OUR && other.life < OKLIFE) continue;
    if (consideredNeutral(s, other) || other.side === s.side) continue;
    const v = s.oppList[other.id];
    if (v === Opp.SEEN_CURRENTLY || v === Opp.SEEN_THIS_TURN) return true;
  }
  return false;
}

const QUIET_TURNS_TO_END_COMBAT = 2;
const TURNS_NOT_SEEN_WHEN_NOBODY_IS_AWARE = 5;

export function checkForEndOfCombatMode(t: TacticalState, increment: boolean): boolean {
  if (!t.inCombat) return false;
  if (boxingFight(t)) return false;
  if (checkForEndOfBattle(t)) return true;
  const turn = t.turn;
  const weSeeNoOne = !mercs(t).some((s) => s.team === Team.OUR && s.ai.oppCount > 0);
  const nobodyAlerted = !mercs(t).some((s) => s.team !== Team.OUR && !s.neutral && s.life >= OKLIFE && s.ai.alertStatus >= AlertStatus.RED);
  if (weSeeNoOne && nobodyAlerted) turn.consNumTurnsNotSeen = TURNS_NOT_SEEN_WHEN_NOBODY_IS_AWARE;
  else {
    let someone = false;
    let we = false;
    for (const s of mercs(t)) {
      if (s.life < OKLIFE || s.neutral || !soldierHasSeenEnemiesLastFewTurns(t, s)) continue;
      turn.consNumTurnsNotSeen = 0;
      someone = true;
      if (s.team === Team.OUR || (s.team === Team.MILITIA && s.side === Side.FRIENDLY)) {
        we = true;
        break;
      }
    }
    if (someone) {
      turn.consNumTurnsWeHaventSeenButEnemyDoes = we ? 0 : turn.consNumTurnsWeHaventSeenButEnemyDoes + 1;
      return false;
    }
    if (increment) turn.consNumTurnsNotSeen++;
  }
  turn.consNumTurnsWeHaventSeenButEnemyDoes = 0;
  if (turn.consNumTurnsNotSeen >= QUIET_TURNS_TO_END_COMBAT) {
    turn.consNumTurnsNotSeen = 0;
    exitCombatMode(t);
    t.events.push({ type: 'combatEnded', reason: 'lull' });
    return true;
  }
  return false;
}

function militiaStillFighting(t: TacticalState): boolean {
  return teamMembers(t, Team.MILITIA).some((s) => s.side === Side.FRIENDLY && s.life >= OKLIFE);
}

function checkForLosingEndOfBattle(t: TacticalState): boolean {
  const ours = teamMembers(t, Team.OUR).filter((s) => s.bodyType < Body.HUMVEE);
  if (ours.length === 0) return false;
  if (!ours.every((s) => s.life < OKLIFE)) return false;
  if (militiaStillFighting(t) && t.sectorHooks.militiaFinishBattle(t)) return false;
  if (ours.some((s) => s.life !== 0)) {
    t.turn.killingGuysForLosingBattle = true;
    t.sectorHooks.battleLost(t);
    t.turn.killingGuysForLosingBattle = false;
  }
  return true;
}

function killIncapacitatedEnemyInSector(t: TacticalState): boolean {
  let killed = false;
  for (const s of soldiersById(t)) {
    if (s.life >= OKLIFE || s.dead || s.neutral || s.side === Side.FRIENDLY) continue;
    soldierTakeDamage(t, s, s.life, 100, DamageReason.BLOODLOSS, null);
    killed = true;
  }
  return killed;
}

export function endBattleAsLost(t: TacticalState): void {
  endAllAITurns(t);
  t.turn.enemyInSector = false;
  if (t.inCombat) exitCombatMode(t);
  t.events.push({ type: 'combatEnded', reason: 'lost' });
  t.sectorHooks.battleEnded(t, 'lost');
}

export function endBattleAfterSurrender(t: TacticalState): void {
  if (!t.inCombat && !t.turn.enemyInSector) return;
  if (t.turn.attackBusyCount > 0 || t.turn.killingGuysForLosingBattle) return;
  endBattleAsLost(t);
}

function countBattleFought(t: TacticalState): void {
  for (const s of teamMembers(t, Team.OUR)) {
    const p = s.profile === NO_PROFILE ? null : profileProgress(t, s.profile);
    if (p) p.battlesFought++;
  }
}

export function checkForEndOfBattle(t: TacticalState): boolean {
  const turn = t.turn;
  if (boxingFight(t)) return false;
  if (!t.inCombat && !turn.enemyInSector) return false;
  if (turn.attackBusyCount > 0) return false;
  if (turn.killingGuysForLosingBattle) return false;
  const won = numCapableEnemyInSector(t) === 0 && !t.sectorHooks.pendingEnemies(t);
  const lost = checkForLosingEndOfBattle(t);
  if (lost) {
    endBattleAsLost(t);
    return true;
  }
  if (won) {
    const boxing = boxingActive(t);
    if (!boxing && killIncapacitatedEnemyInSector(t)) return false;
    turn.enemyInSector = false;
    endAllAITurns(t);
    if (t.inCombat) exitCombatMode(t);
    if (boxing) {
      t.events.push({ type: 'combatEnded', reason: 'boxing' });
      return true;
    }
    if (battleFought(t)) countBattleFought(t);
    for (const s of teamMembers(t, Team.MILITIA)) {
      s.ai.alertStatus = AlertStatus.GREEN;
      t.turnHooks.checkForChangingOrders(t, s);
      s.ai.noiseGridNo = NOWHERE;
      s.ai.noiseVolume = 0;
      s.ai.newSituation = 0;
      s.ai.orders = Orders.STATIONARY;
      if (s.life >= OKLIFE) s.bleeding = 0;
    }
    t.perception.awareOfOpposition[Team.MILITIA] = false;
    for (const s of teamMembers(t, Team.CIV)) {
      s.ai.alertStatus = AlertStatus.GREEN;
      s.ai.noiseGridNo = NOWHERE;
      s.ai.noiseVolume = 0;
      s.ai.newSituation = 0;
      t.turnHooks.checkForChangingOrders(t, s);
    }
    t.perception.awareOfOpposition[Team.CIV] = false;
    t.events.push({
      type: 'combatEnded',
      reason: 'won',
      ...(battleFought(t) ? { fought: true as const } : {}),
      ...(lastMercKillWasMonster(t) ? { monsterKill: true as const } : {}),
    });
    t.sectorHooks.battleEnded(t, 'won');
    return true;
  }
  return false;
}

function latestInterruptGuy(t: TacticalState): Soldier | undefined {
  const list = t.turn.intList;
  return list[list.length - 1];
}

function deleteFromIntList(t: TacticalState, index: number): void {
  const list = t.turn.intList;
  if (index > list.length) return;
  list.splice(index - 1, 1);
}

export function clearIntList(t: TacticalState): void {
  t.turn.intList.length = 0;
}

export function addToIntList(t: TacticalState, s: Soldier, gainControl: boolean): void {
  const list = t.turn.intList;
  for (let k = 2; k <= list.length; k++) {
    if (list[k - 1] !== s) continue;
    if (!gainControl) {
      t.turn.lastInterruptedGuy = s;
      return;
    }
    deleteFromIntList(t, k);
  }
  list.push(s);
  if (gainControl) s.intStartAPs = s.actionPoints;
  else {
    t.turn.lastInterruptedGuy = s;
    s.aiTurnControl = false;
  }
}

function freezeInterrupted(s: Soldier): void {
  adjustNoAPToFinishMove(s, true);
  s.turningFromPronePosition = TurningFromProne.OFF;
}

function freezeEntry(t: TacticalState, index: number): void {
  const s = t.turn.intList[index - 1];
  if (s) freezeInterrupted(s);
  deleteFromIntList(t, index);
}

function verifyOutOfTurnOrderArray(t: TacticalState): void {
  const list = t.turn.intList;
  const highest = new Array<number>(TEAM_COUNT).fill(0);
  for (let i = 1; i <= list.length; i++) {
    const current = list[i - 1] as Soldier;
    const team = current.team;
    if ((highest[team] ?? 0) > 0) {
      let loop = false;
      for (let other = 0; other < TEAM_COUNT; other++) {
        if (other === team || (highest[other] ?? 0) <= (highest[team] ?? 0)) continue;
        const next = (highest[team] ?? 0) + 1;
        while (list[next - 1] !== current) freezeEntry(t, next);
        loop = true;
        break;
      }
      if (loop) {
        highest.fill(0);
        i = 0;
        continue;
      }
    }
    highest[team] = i;
  }
  if (highest.filter((h) => h > 0).length >= 3) {
    const firstTeam = list[0]?.team;
    for (let i = 2; i <= list.length; ) {
      if (list[i - 1]?.team !== firstTeam) freezeEntry(t, i);
      else i++;
    }
  }
}

function everyoneInInterruptListOnSameTeam(t: TacticalState): boolean {
  const list = t.turn.intList;
  return list.every((s) => s.team === list[0]?.team);
}

export function doneAddingToIntList(t: TacticalState): void {
  verifyOutOfTurnOrderArray(t);
  if (everyoneInInterruptListOnSameTeam(t)) endInterrupt(t, true);
  else startInterrupt(t);
}

function startInterrupt(t: TacticalState): void {
  const turn = t.turn;
  const first = latestInterruptGuy(t);
  if (!first) return;
  const team = first.team;
  turn.interruptOccurred = true;
  for (const s of t.soldiers) {
    if (!s) continue;
    s.movedPriorToInterrupt = s.moved;
    s.moved = true;
  }
  let interrupter: Soldier | undefined = first;
  for (;;) {
    if (!interrupter) break;
    interrupter.moved = false;
    deleteFromIntList(t, turn.intList.length);
    interrupter = latestInterruptGuy(t);
    if (!interrupter || interrupter.team !== team) break;
  }
  if (team === Team.OUR) {
    selectSoldier(t, first);
    turn.currentTeam = Team.OUR;
    const soldiers = teamMembers(t, Team.OUR).filter((s) => !s.moved);
    t.events.push({ type: 'interrupt', team, soldiers: soldiers.map((s) => s.id), selected: first.id });
    initPlayerUIBar(t, true);
    sayCloseCallQuotes(t);
  } else {
    if (!buildAIListForTeam(t, team)) {
      endInterrupt(t, false);
      return;
    }
    const s = removeFirstAIListEntry(t);
    if (!s) {
      endInterrupt(t, false);
      return;
    }
    turn.hiddenInterrupt = true;
    turn.unlockUIAfterHiddenInterrupt = false;
    turn.currentTeam = s.team;
    t.turnHooks.startNPCAI(t, s);
  }
  if (!turn.hiddenInterrupt) {
    const latest = latestInterruptGuy(t);
    if (latest) freezeInterrupted(latest);
  }
}

export function displayHiddenInterrupt(t: TacticalState, actor: Soldier): void {
  const turn = t.turn;
  if (!turn.hiddenInterrupt) return;
  const latest = latestInterruptGuy(t);
  if (latest) freezeInterrupted(latest);
  addTopMessage(t, actor.team === Team.MILITIA ? TopMessageKind.MILITIA_INTERRUPT : TopMessageKind.COMPUTER_INTERRUPT);
  turn.hiddenInterrupt = false;
  t.events.push({ type: 'interrupt', team: turn.currentTeam });
}

export function endInterrupt(t: TacticalState, markOccurred: boolean): void {
  const turn = t.turn;
  turn.interruptOccurred = markOccurred;
  for (const s of teamMembers(t, turn.currentTeam)) {
    if (!s.moved && s.actionPoints === s.intStartAPs) {
      const minAPs = t.turnHooks.minAPsToAttack(t, s, s.lastTarget, false);
      if (minAPs > 0 && minAPs <= s.actionPoints) s.passedLastInterrupt = true;
    }
  }
  if (!everyoneInInterruptListOnSameTeam(t)) {
    turn.hiddenInterrupt = false;
    startInterrupt(t);
    return;
  }
  const interrupted = latestInterruptGuy(t);
  for (const s of t.soldiers) {
    if (!s) continue;
    if (s.actionPoints === 0) s.moved = true;
    else if (s.team !== Team.OUR && s.ai.newSituation === Situation.IS_NEW) s.moved = false;
    else s.moved = s.movedPriorToInterrupt;
  }
  if (!interrupted) {
    clearIntList(t);
    return;
  }
  turn.currentTeam = interrupted.team;
  if (interrupted.team === Team.OUR) {
    clearIntList(t);
    if (interrupted.life < OKLIFE) selectNextAvailSoldier(t, interrupted);
    else selectSoldier(t, interrupted);
    if (turn.hiddenInterrupt) {
      turn.hiddenInterrupt = false;
      const selected = selectedSoldier(t);
      if (selected?.noAPToFinishMove && interrupted.reasonCantFinishMove !== ReasonCantFinishMove.STOPPED_SIGHT) {
        adjustNoAPToFinishMove(selected, false);
        if (selected.gridNo !== selected.finalDestination)
          getNewSoldierPath(t, selected, selected.finalDestination, selected.uiMovementMode, 0, false);
      }
      turn.unlockUIAfterHiddenInterrupt = false;
    } else {
      t.events.push({ type: 'interruptEnded', team: Team.OUR });
      initPlayerUIBar(t, false);
    }
    return;
  }
  turn.hiddenInterrupt = false;
  let found = mercs(t).some((s) => s.team >= Team.ENEMY && s.team <= turn.currentTeam && s.life >= OKLIFE);
  if (found) {
    found = false;
    if (buildAIListForTeam(t, turn.currentTeam)) {
      for (const s of turn.intList) moveToFrontOfAIList(t, s);
      const s = removeFirstAIListEntry(t);
      if (s) {
        found = true;
        t.turnHooks.startNPCAI(t, s);
      }
    }
  }
  addTopMessage(t, TopMessageKind.COMPUTER_TURN);
  clearIntList(t);
  if (!found) endAITurn(t);
}

export function resolveInterruptsVs(t: TacticalState, mover: Soldier, kind: number): void {
  if (!t.inCombat) return;
  const turn = t.turn;
  const winners: { opp: Soldier; diff: number }[] = [];
  for (let team = 0; team < TEAM_COUNT; team++) {
    if (!isTeamActive(t, team) || TEAM_SIDE[team] === mover.side || team === Team.CIV) continue;
    for (const opp of teamMembers(t, team)) {
      if (opp.life < OKLIFE || opp.collapsed) continue;
      if (kind === InterruptKind.NOISE) {
        if (pythSpacesAway(mover.gridNo, opp.gridNo) > MAX_DISTANCE_VISIBLE) {
          opp.interruptDuelPts = NO_INTERRUPT;
          continue;
        }
      } else if (opp.oppList[mover.id] !== Opp.SEEN_CURRENTLY) {
        opp.interruptDuelPts = NO_INTERRUPT;
        continue;
      }
      let occurs: boolean;
      if (opp.interruptDuelPts === NO_INTERRUPT) occurs = false;
      else if (opp.interruptDuelPts === AUTOMATIC_INTERRUPT) {
        mover.interruptDuelPts = 0;
        occurs = true;
      } else {
        mover.interruptDuelPts = calcInterruptDuelPts(t, mover, opp, true);
        occurs = interruptDuel(opp, mover);
      }
      if (occurs) winners.push({ opp, diff: u8(opp.interruptDuelPts - mover.interruptDuelPts) });
      mover.interruptDuelPts = NO_INTERRUPT;
      opp.interruptDuelPts = NO_INTERRUPT;
    }
  }
  if (winners.length === 0) return;
  if (turn.currentTeam !== mover.team && !HUMAN_TEAM[turn.currentTeam]) {
    const controlled = teamMembers(t, turn.currentTeam).find((s) => s.aiTurnControl);
    if (controlled) {
      controlled.aiTurnControl = false;
      addToIntList(t, controlled, false);
    }
  } else addToIntList(t, mover, false);
  for (let n = 0; n < winners.length; n++) {
    let smallest = NO_INTERRUPT;
    let slot = -1;
    winners.forEach((w, k) => {
      if (w.diff < smallest) {
        smallest = w.diff;
        slot = k;
      }
    });
    const winner = winners[slot];
    if (!winner) continue;
    addToIntList(t, winner.opp, true);
    if (turn.intList.length === 1) {
      endInterrupt(t, true);
      return;
    }
    winner.diff = NO_INTERRUPT;
  }
  doneAddingToIntList(t);
}

export const ENEMY_SIGHTING_PAUSE_MS = 3000;

export function handleEnemySightingPause(t: TacticalState): void {
  const pause = t.turn.enemySightingOnTheirTurn;
  if (!pause || t.clockMs - pause.since <= ENEMY_SIGHTING_PAUSE_MS) return;
  if (t.turn.currentTeam !== Team.OUR) adjustNoAPToFinishMove(pause.enemy, false);
  pause.enemy.pauseAllAnimation = false;
  t.turn.enemySightingOnTheirTurn = null;
}
