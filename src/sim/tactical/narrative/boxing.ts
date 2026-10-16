// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Boxing.cc ExitBoxing, EndBoxingMatch, BoxingPlayerDisqualified, TriggerEndOfBoxingRecord,
// @src CountPeopleInBoxingRing, CountPeopleInBoxingRingAndDoActions, CheckOnBoxers, BoxerExists, PickABoxer, BoxerAvailable,
// @src BoxersAvailable, AnotherFightPossible, BoxingMovementCheck, SetBoxingState, ClearAllBoxerFlags; Tactical/Interface_Dialogue.cc
// @src NPC_ACTION_START_BOXING_MATCH (the state part); TacticalAI/FindLocations.cc FindClosestBoxingRingSpot. See docs/25 §7.

import { WEAPON_CLASSES } from '../../../content/items/items.ts';
import { WORLD_COLS, WORLD_ROWS } from '../../../content/world/grid.ts';
import { u8 } from '../../../core/int.ts';
import { type BoxingRecord, NUM_BOXERS } from '../../strategic/narrative/facts.ts';
import { NarrativeHistory } from '../../strategic/narrative/history-codes.ts';
import { Npc } from '../../strategic/narrative/npc-ids.ts';
import { legalNPCDestination, PathMode, roomAt } from '../ai/destinations.ts';
import { beginSoldierGetup } from '../combat/death.ts';
import { findObjClass } from '../combat/reload.ts';
import { NO_SLOT } from '../inventory.ts';
import { stopMerc } from '../movement.ts';
import { recalculateOppCntsDueToBecomingNeutral, recalculateOppCntsDueToNoLongerNeutral } from '../perception/sight.ts';
import { deductPoints } from '../points.ts';
import { AlertStatus, Body, NOBODY, NOWHERE, OKBREATH, OKLIFE, SkillTrait, type Soldier, Team } from '../soldier.ts';
import { mercs, soldiersById, type TacticalState, teamMembers, whoIsThere } from '../state.ts';
import { checkForEndOfCombatMode, endAllAITurns, enterCombatMode } from '../turns/turns.ts';
import {
  BOXER_GRIDNOS,
  BOXING_RING,
  BoxingState,
  boxingStateName,
  boxingTracksMovement,
  DISQUALIFICATION_NAMES,
  Disqualification,
} from './boxing-state.ts';
import { setSoldierNonNeutral } from './civ-hostility.ts';

const DarrenRecord = { DISQUALIFIED: 21, ROUND_OVER: 22, PLAYER_WON: 23, PLAYER_LOST: 24 } as const;
const RING_SPOT_SEARCH_RANGE = 7;
const FAR_AWAY = 9999;
const RING_PAIR = 2;
const NO_ROOM = 0;
const STAT_BONUS_PER_REST = 5;
const MAX_STAT = 100;
const FULL_BREATH = 100;
const BREATH_REFILL_SCALE = 100;
const LIFE_MARGIN_FOR_ANOTHER_FIGHT = 5;
const MARTIAL_ARTIST_SLOT = NUM_BOXERS - 1;
const DISPUTED_PLAYERS_IN_RING = 1;

function soldierAt(t: TacticalState | null, id: number): Soldier | null {
  if (!t || id === NOBODY) return null;
  return t.soldiers[id] ?? null;
}

export function inBoxingRing(t: TacticalState, gridNo: number): boolean {
  return roomAt(t, gridNo) === BOXING_RING;
}

export function setBoxingState(t: TacticalState, next: number): void {
  const b = t.boxing;
  const previous = b.state;
  if (previous === BoxingState.NOT_BOXING) {
    if (next !== BoxingState.NOT_BOXING) t.narrative.pauseGame();
  } else if (next === BoxingState.NOT_BOXING) {
    t.narrative.unPauseGame();
    if (boxersAvailable(b) === NUM_BOXERS) b.fought[0] = true;
  }
  b.state = next;
  if (next !== previous) t.events.push({ type: 'boxingState', state: boxingStateName(next), previous: boxingStateName(previous) });
}

function calmBoxerDown(t: TacticalState, s: Soldier): void {
  t.turnHooks.cancelAIAction(t, s);
  s.ai.alertStatus = AlertStatus.GREEN;
  s.ai.underFire = 0;
  if (s.life > 0 && (s.life < OKLIFE || s.breath < OKBREATH)) {
    s.life = Math.max(OKLIFE * 2, s.life);
    if (s.breath < FULL_BREATH) deductPoints(t.inCombat, s, 0, -BREATH_REFILL_SCALE * (FULL_BREATH - s.breath));
    beginSoldierGetup(t, s);
  }
}

export function exitBoxing(t: TacticalState): void {
  for (const playersPass of [false, true]) {
    for (const s of soldiersById(t)) {
      if (!s.boxer || !inBoxingRing(t, s.gridNo)) continue;
      if (s.team === Team.OUR) {
        if (!playersPass) continue;
        s.underAiControl = true;
      } else {
        if (playersPass) continue;
        t.narrative.setSoldierNeutral(s);
        recalculateOppCntsDueToBecomingNeutral(t, s);
      }
      calmBoxerDown(t, s);
    }
  }
  t.narrative.deleteTalkingMenu();
  endAllAITurns(t);
  if (checkForEndOfCombatMode(t, false)) t.boxing.uiLocked = true;
  unlockWhenNobodyLeavesTheRing(t);
}

export function unlockWhenNobodyLeavesTheRing(t: TacticalState): void {
  if (t.boxing.uiLocked && !soldiersById(t).some((s) => s.boxer && s.life > 0)) t.boxing.uiLocked = false;
}

export function endBoxingMatch(t: TacticalState, loser: Soldier): void {
  const b = t.boxing;
  const playerLost = loser.team === Team.OUR;
  if (playerLost) setBoxingState(t, BoxingState.LOST_ROUND);
  else {
    setBoxingState(t, BoxingState.WON_ROUND);
    b.lastMatchWonByPlayer = true;
    b.matchesWon = u8(b.matchesWon + 1);
  }
  t.events.push({ type: 'boxingRoundOver', loser: loser.id, result: playerLost ? 'lost' : 'won' });
  t.narrative.triggerNpcRecord(Npc.DARREN, DarrenRecord.ROUND_OVER);
}

export function boxingPlayerDisqualified(t: TacticalState, offender: Soldier | null, reason: number): void {
  const stops = reason === Disqualification.BOXER_OUT_OF_RING || reason === Disqualification.NON_BOXER_IN_RING;
  if (stops && offender) stopMerc(t, offender);
  setBoxingState(t, BoxingState.DISQUALIFIED);
  t.events.push({ type: 'boxerDisqualified', soldier: offender?.id ?? null, reason: DISQUALIFICATION_NAMES[reason] ?? 'badAttack' });
  t.narrative.triggerNpcRecord(Npc.DARREN, DarrenRecord.DISQUALIFIED);
}

function endOfBoxingResult(t: TacticalState, s: Soldier): 'won' | 'lost' | 'disqualified' | null {
  switch (t.boxing.state) {
    case BoxingState.WON_ROUND:
      t.narrative.addHistory(NarrativeHistory.WON_BOXING, s.profile);
      t.narrative.triggerNpcRecord(Npc.DARREN, DarrenRecord.PLAYER_WON);
      return 'won';
    case BoxingState.LOST_ROUND:
      t.narrative.addHistory(NarrativeHistory.LOST_BOXING, s.profile);
      t.narrative.triggerNpcRecord(Npc.DARREN, DarrenRecord.PLAYER_LOST);
      return 'lost';
    case BoxingState.DISQUALIFIED:
      t.narrative.addHistory(NarrativeHistory.DISQUALIFIED_BOXING, s.profile);
      return 'disqualified';
    default:
      return null;
  }
}

export function triggerEndOfBoxingRecord(t: TacticalState, s: Soldier | null): void {
  t.boxing.uiLocked = false;
  const result = s ? endOfBoxingResult(t, s) : null;
  t.events.push({ type: 'boxingEnded', soldier: s?.id ?? null, result });
  setBoxingState(t, BoxingState.NOT_BOXING);
}

export function countPeopleInBoxingRing(t: TacticalState): number {
  return mercs(t).filter((s) => inBoxingRing(t, s.gridNo)).length;
}

function startFight(t: TacticalState, inRing: readonly Soldier[]): void {
  for (const s of inRing) s.boxer = true;
  setBoxingState(t, BoxingState.BOXING);
  t.boxing.lastMatchWonByPlayer = false;
  const first = inRing[t.rng.int(RING_PAIR)] as Soldier;
  enterCombatMode(t, first.team);
}

function countPeopleInBoxingRingAndDoActions(t: TacticalState): void {
  let total = 0;
  let players = 0;
  const inRing: Soldier[] = [];
  let nonBoxingPlayer: Soldier | null = null;
  for (const s of mercs(t)) {
    if (!inBoxingRing(t, s.gridNo)) continue;
    if (total < RING_PAIR) inRing.push(s);
    total++;
    if (s.team !== Team.OUR) continue;
    players++;
    if (!nonBoxingPlayer && !s.boxer) nonBoxingPlayer = s;
  }
  const state = t.boxing.state;
  if (players > DISPUTED_PLAYERS_IN_RING) {
    boxingPlayerDisqualified(t, nonBoxingPlayer, Disqualification.NON_BOXER_IN_RING);
    if (state <= BoxingState.PRE_BOXING) setBoxingState(t, BoxingState.NOT_BOXING);
    return;
  }
  if (state === BoxingState.WAITING_FOR_PLAYER) {
    if (total === 1 && players === 1) {
      setBoxingState(t, BoxingState.PRE_BOXING);
      pickABoxer(t);
    }
  } else if (state === BoxingState.PRE_BOXING && total === RING_PAIR && players === 1) startFight(t, inRing);
}

export function checkOnBoxers(b: BoxingRecord, t: TacticalState | null): boolean {
  if (b.boxers[0] === NOBODY && t) {
    BOXER_GRIDNOS.forEach((gridNo, i) => {
      const s = whoIsThere(t, gridNo, 0);
      if (!s || findObjClass(t.content.items, s, WEAPON_CLASSES) !== NO_SLOT) return;
      b.boxers[i] = s.id;
    });
  }
  return b.boxers.some((id) => id !== NOBODY);
}

export function boxerExists(t: TacticalState | null): boolean {
  return t !== null && BOXER_GRIDNOS.some((gridNo) => whoIsThere(t, gridNo, 0) !== null);
}

function improveBoxer(b: BoxingRecord, boxer: Soldier, slot: number): void {
  const bonus = b.rests * STAT_BONUS_PER_REST;
  const stats = boxer.stats;
  stats.strength = Math.min(MAX_STAT, stats.strength + bonus);
  stats.dexterity = Math.min(MAX_STAT, stats.dexterity + bonus);
  stats.agility = Math.min(MAX_STAT, stats.agility + bonus);
  boxer.lifeMax = Math.min(MAX_STAT, boxer.lifeMax + bonus);
  if (slot === MARTIAL_ARTIST_SLOT && boxer.bodyType === Body.REGMALE) boxer.skillTrait1 = SkillTrait.MARTIALARTS;
}

export function pickABoxer(t: TacticalState): void {
  const b = t.boxing;
  for (let i = 0; i < NUM_BOXERS; i++) {
    const id = b.boxers[i] ?? NOBODY;
    if (id === NOBODY) continue;
    const boxer = soldierAt(t, id);
    if (b.fought[i]) {
      if (boxer) boxer.boxer = false;
    } else if (boxer?.placed && boxer.life >= OKLIFE) {
      boxer.boxer = true;
      setSoldierNonNeutral(boxer);
      recalculateOppCntsDueToNoLongerNeutral(t, boxer);
      t.turnHooks.cancelAIAction(t, boxer);
      boxer.ai.counter = t.clockMs;
      b.fought[i] = true;
      improveBoxer(b, boxer, i);
      t.events.push({ type: 'boxerPicked', soldier: boxer.id, slot: i });
      return;
    }
  }
}

export function boxerAvailable(b: BoxingRecord, t: TacticalState | null): boolean {
  if (!checkOnBoxers(b, t)) return false;
  return b.boxers.some((id, i) => id !== NOBODY && !b.fought[i]);
}

export function boxersAvailable(b: BoxingRecord): number {
  return b.boxers.filter((id, i) => id !== NOBODY && !b.fought[i]).length;
}

export function anotherFightPossible(b: BoxingRecord, t: TacticalState | null): boolean {
  const available = boxersAvailable(b);
  if (available === NUM_BOXERS || available === 0 || !t) return false;
  return teamMembers(t, Team.OUR).some((s) => s.life > OKLIFE + LIFE_MARGIN_FOR_ANOTHER_FIGHT && !s.collapsed);
}

export function boxingMovementCheck(t: TacticalState, s: Soldier): void {
  if (inBoxingRing(t, s.gridNo)) {
    countPeopleInBoxingRingAndDoActions(t);
    return;
  }
  if (t.boxing.state !== BoxingState.BOXING || !s.boxer) return;
  boxingPlayerDisqualified(t, s, Disqualification.BOXER_OUT_OF_RING);
  t.narrative.addHistory(NarrativeHistory.DISQUALIFIED_BOXING, s.profile);
  s.boxer = false;
  s.underAiControl = false;
}

export function boxingMovementCheckWhileTracked(t: TacticalState, s: Soldier): void {
  if (boxingTracksMovement(t)) boxingMovementCheck(t, s);
}

export function clearAllBoxerFlags(t: TacticalState): void {
  for (const s of mercs(t)) s.boxer = false;
}

export function startBoxingMatch(t: TacticalState): void {
  clearAllBoxerFlags(t);
  setBoxingState(t, BoxingState.WAITING_FOR_PLAYER);
}

export function clearBoxers(b: BoxingRecord): void {
  b.boxers.fill(NOBODY);
}

export function findClosestBoxingRingSpot(t: TacticalState, s: Soldier, inRing: boolean): number {
  const column = s.gridNo % WORLD_COLS;
  const row = Math.trunc(s.gridNo / WORLD_ROWS);
  const maxLeft = s.team === Team.OUR && !inRing ? 0 : Math.min(RING_SPOT_SEARCH_RANGE, column);
  const maxRight = Math.min(RING_SPOT_SEARCH_RANGE, WORLD_COLS - (column + 1));
  const maxUp = Math.min(RING_SPOT_SEARCH_RANGE, row);
  const maxDown = Math.min(RING_SPOT_SEARCH_RANGE, WORLD_ROWS - (row + 1));
  let closest = NOWHERE;
  let closestDistance = FAR_AWAY;
  for (let dy = -maxUp; dy <= maxDown; dy++) {
    for (let dx = -maxLeft; dx <= maxRight; dx++) {
      const gridNo = s.gridNo + dx + WORLD_COLS * dy;
      const room = roomAt(t, gridNo);
      if (room === NO_ROOM) continue;
      const fits = inRing
        ? room === BOXING_RING
        : room !== BOXING_RING && legalNPCDestination(t, s, gridNo, PathMode.IGNORE_PATH, false, 0);
      if (!fits) continue;
      const distance = Math.abs(dx) + Math.abs(dy);
      if (distance < closestDistance && whoIsThere(t, gridNo, 0) === null) {
        closest = gridNo;
        closestDistance = distance;
      }
    }
  }
  return closest;
}
