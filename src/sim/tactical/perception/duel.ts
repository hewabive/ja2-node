// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/TeamTurns.cc StandardInterruptConditionsMet, CalcInterruptDuelPts, InterruptDuel;
// @src OppList.cc FindUnusedWatchedLoc, FindWatchedLocWithLessThanXPointsLeft, FindWatchedLoc, GetWatchedLocPoints,
// @src CommunicateWatchedLoc, IncrementWatchedLoc, SetWatchedLocAsUsed, WatchedLocLocationIsEmpty, DecayWatchedLocs.

import { gridSquare, pythSpacesAway, spacesAway } from '../../../content/world/grid.ts';
import { i8, idiv, u8 } from '../../../core/int.ts';
import { AnimHeight, height, states } from '../animation.ts';
import { lightTrueLevel, NORMAL_LIGHTLEVEL_DAY } from '../lighting/lighting.ts';
import { boxingActive } from '../narrative/boxing-state.ts';
import { interruptBasePoints } from '../narrative/robot.ts';
import { minPtsToMove } from '../points.ts';
import { effectiveExpLevel } from '../skills.ts';
import {
  NO_INTERRUPT,
  NOBODY,
  numSkillTraits,
  OKBREATH,
  OKLIFE,
  SkillTrait,
  type Soldier,
  TEAM_FIRST_ID,
  TEAM_SIZES,
  Team,
  TOTAL_SOLDIERS,
} from '../soldier.ts';
import { type TacticalState, teamMembers, whoIsThere } from '../state.ts';
import { NUM_WATCHED_LOCS } from '../turns/turn-state.ts';
import { atan8Of, Opp, SightFlags } from './opp.ts';

export const AUTOMATIC_INTERRUPT = 100;
export const MIN_APS_TO_INTERRUPT = 4;
const AP_CHANGE_FACING = 1;
const AP_CROUCH = 2;
const MAX_WATCHED_LOC_POINTS = 4;
const WATCHED_LOC_RADIUS = 1;
const MAX_DISTANCE_VISIBLE = 26;
const STRAIGHT = 13;
const BEST_SIGHTING_ALL = 6;
const NOWHERE = -1;
const DARK_LEVELS_ABOVE_DAY = 3;

export function seenOpponent(t: TacticalState, viewer: number, opp: number): number {
  return t.turn.seenOpponents[viewer * TOTAL_SOLDIERS + opp] ?? 0;
}

export function markSeenOpponent(t: TacticalState, viewer: number, opp: number): void {
  const k = viewer * TOTAL_SOLDIERS + opp;
  t.turn.seenOpponents[k] = t.turn.seenOpponents[k] === 0 ? -1 : 1;
}

const wk = (id: number, loc: number) => id * NUM_WATCHED_LOCS + loc;

function findUnusedWatchedLoc(t: TacticalState, id: number): number {
  for (let k = 0; k < NUM_WATCHED_LOCS; k++) if (t.turn.watched.gridNo[wk(id, k)] === NOWHERE) return k;
  return -1;
}

function findWatchedLocWithLessThanXPointsLeft(t: TacticalState, id: number, limit: number): number {
  const w = t.turn.watched;
  for (let k = 0; k < NUM_WATCHED_LOCS; k++) if (w.gridNo[wk(id, k)] !== NOWHERE && (w.points[wk(id, k)] ?? 0) <= limit) return k;
  return -1;
}

function findWatchedLoc(t: TacticalState, id: number, g: number, level: number): number {
  const w = t.turn.watched;
  for (let k = 0; k < NUM_WATCHED_LOCS; k++) {
    const loc = w.gridNo[wk(id, k)] ?? NOWHERE;
    if (loc !== NOWHERE && w.level[wk(id, k)] === level && spacesAway(loc, g) <= WATCHED_LOC_RADIUS) return k;
  }
  return -1;
}

export function watchedLocPoints(t: TacticalState, id: number, g: number, level: number): number {
  const k = findWatchedLoc(t, id, g, level);
  return k === -1 ? 0 : (t.turn.watched.points[wk(id, k)] ?? 0);
}

function setWatchedLoc(t: TacticalState, id: number, k: number, g: number, level: number, points: number): void {
  const w = t.turn.watched;
  w.gridNo[wk(id, k)] = g;
  w.level[wk(id, k)] = level;
  w.points[wk(id, k)] = points;
  w.reset[wk(id, k)] = 0;
  w.incremented[wk(id, k)] = 1;
}

function communicateWatchedLoc(t: TacticalState, watcher: Soldier, g: number, level: number, points: number): void {
  const w = t.turn.watched;
  for (const s of teamMembers(t, watcher.team)) {
    if (s === watcher || s.life < OKLIFE) continue;
    const k = findWatchedLoc(t, s.id, g, level);
    if (k === -1) {
      let free = findUnusedWatchedLoc(t, s.id);
      if (free === -1) free = findWatchedLocWithLessThanXPointsLeft(t, s.id, points);
      if (free !== -1) setWatchedLoc(t, s.id, free, g, level, points);
    } else {
      w.points[wk(s.id, k)] = Math.max(w.points[wk(s.id, k)] ?? 0, points);
      w.reset[wk(s.id, k)] = 0;
      w.incremented[wk(s.id, k)] = 1;
    }
  }
}

export function incrementWatchedLoc(t: TacticalState, watcher: Soldier, g: number, level: number): void {
  const w = t.turn.watched;
  const id = watcher.id;
  const k = findWatchedLoc(t, id, g, level);
  if (k === -1) {
    let free = findUnusedWatchedLoc(t, id);
    if (free === -1) free = findWatchedLocWithLessThanXPointsLeft(t, id, 1);
    if (free !== -1) {
      setWatchedLoc(t, id, free, g, level, 1);
      communicateWatchedLoc(t, watcher, g, level, 1);
    }
    return;
  }
  if (!w.incremented[wk(id, k)] && (w.points[wk(id, k)] ?? 0) < MAX_WATCHED_LOC_POINTS) {
    w.points[wk(id, k)] = (w.points[wk(id, k)] ?? 0) + 1;
    communicateWatchedLoc(t, watcher, g, level, w.points[wk(id, k)] ?? 0);
  }
  w.reset[wk(id, k)] = 0;
  w.incremented[wk(id, k)] = 1;
}

export function setWatchedLocAsUsed(t: TacticalState, id: number, g: number, level: number): void {
  const k = findWatchedLoc(t, id, g, level);
  if (k !== -1) t.turn.watched.reset[wk(id, k)] = 0;
}

export function clearWatchedLocIncrements(t: TacticalState, id: number): void {
  for (let k = 0; k < NUM_WATCHED_LOCS; k++) t.turn.watched.incremented[wk(id, k)] = 0;
}

function watchedLocIsEmpty(t: TacticalState, g: number, level: number, team: number): boolean {
  for (const near of gridSquare(g, WATCHED_LOC_RADIUS)) {
    const other = whoIsThere(t, near, level);
    if (other && other.team !== team) return false;
  }
  return true;
}

function decayWatchedLoc(t: TacticalState, at: number, team: number): void {
  const w = t.turn.watched;
  const loc = w.gridNo[at] ?? NOWHERE;
  if (loc === NOWHERE || !watchedLocIsEmpty(t, loc, w.level[at] ?? 0, team)) return;
  if (!w.reset[at]) {
    w.reset[at] = 1;
    return;
  }
  w.reset[at] = 0;
  w.points[at] = idiv(w.points[at] ?? 0, 2);
  if (w.points[at] === 0) w.gridNo[at] = NOWHERE;
}

export function decayWatchedLocs(t: TacticalState, team: number): void {
  const first = TEAM_FIRST_ID[team] ?? 0;
  const last = first + (TEAM_SIZES[team] ?? 0) - 1;
  for (let id = first; id <= last; id++) for (let k = 0; k < NUM_WATCHED_LOCS; k++) decayWatchedLoc(t, wk(id, k), team);
}

export function calcInterruptDuelPts(t: TacticalState, s: Soldier, opp: Soldier, useWatchSpots: boolean): number {
  if (s.neutral) return NO_INTERRUPT;
  let p = interruptBasePoints(t, s);
  if (useWatchSpots) p += watchedLocPoints(t, s.id, opp.gridNo, opp.level);
  if (s.ai.oppCount > 2) p -= idiv(s.ai.oppCount - 1, 2);
  if (s.oppList[opp.id] === Opp.HEARD_THIS_TURN) p--;
  p -= s.shock;
  const d = u8(pythSpacesAway(s.gridNo, opp.gridNo));
  const st = states(t.content.animations);
  if (t.inCombat && s.team !== t.turn.currentTeam) p -= idiv(d, 10);
  else if (!seenOpponent(t, opp.id, s.id)) {
    if (s.state === st.SWATTING && d > MAX_DISTANCE_VISIBLE / 2) p++;
    else if (s.state === st.CRAWLING && d > MAX_DISTANCE_VISIBLE / 4) p += idiv(d, STRAIGHT);
  }
  if (s.state === st.RUNNING && !seenOpponent(t, s.id, opp.id)) p -= 2;
  if (s.servicePartner !== NOBODY) p -= 2;
  const nightOps = numSkillTraits(s, SkillTrait.NIGHTOPS);
  if (nightOps && lightTrueLevel(t, s.gridNo, s.level) > NORMAL_LIGHTLEVEL_DAY + DARK_LEVELS_ABOVE_DAY) p += nightOps;
  if (s.team === Team.OUR) {
    if (seenOpponent(t, s.id, opp.id) === 1) p++;
  } else if (s.team === Team.ENEMY) {
    if (seenOpponent(t, s.id, opp.id) === 1) p++;
    else if ((t.perception.publicOpp[s.team]?.[opp.id] ?? 0) !== Opp.NOT_HEARD_OR_SEEN) p++;
  }
  if (p >= AUTOMATIC_INTERRUPT) p = AUTOMATIC_INTERRUPT - 1;
  return i8(p);
}

export function standardInterruptConditionsMet(t: TacticalState, s: Soldier, opp: Soldier | null, oldOpp: number): boolean {
  const turn = t.turn;
  if (t.inCombat && !(turn.sightFlags & SightFlags.INTERRUPT)) return false;
  if (turn.attackBusyCount > 0) return false;
  if (!opp && !turn.whoThrewRock) return false;
  if (t.inCombat && t.perception.bestSize !== BEST_SIGHTING_ALL && (s.team === turn.currentTeam || boxingActive(t))) return false;
  if (!s.placed || s.life < OKLIFE || s.breath < OKBREATH || s.collapsed) return false;
  if (s.actionPoints < MIN_APS_TO_INTERRUPT) return false;
  if (t.explosives.gassed[s.id]) return false;
  if (s.ai.underFire !== 0) return false;
  if (s.neutral) return false;
  let need = AP_CHANGE_FACING;
  if (opp) {
    if (s.side === opp.side) {
      if (s.team === Team.OUR || s.team === Team.CIV) return false;
      if (s.team !== opp.team) return false;
    }
    if (opp.team === Team.OUR) {
      const selected = t.soldiers[turn.selected];
      if (!selected || (opp !== selected && s.side !== selected.side)) return false;
    } else if (!opp.aiTurnControl && s.side !== opp.side) return false;
    if (opp.team !== turn.currentTeam && s.team !== turn.currentTeam) return false;
    if (s.oppList[opp.id] === Opp.SEEN_CURRENTLY) {
      if (oldOpp === Opp.SEEN_CURRENTLY || oldOpp === Opp.SEEN_THIS_TURN) return false;
      const dir = atan8Of(s, opp);
      if ((s.desiredDirection + 4) % 8 === dir && pythSpacesAway(s.gridNo, opp.gridNo) > effectiveExpLevel(s)) return false;
      const ctx = { env: t.pathEnv, content: t.content, inCombat: t.inCombat };
      need = height(t.content, s.state) !== AnimHeight.CROUCH ? AP_CROUCH : minPtsToMove(ctx, s, s.uiMovementMode);
    } else if (opp.oppList[s.id] !== Opp.SEEN_CURRENTLY || s.ai.oppCount > 0 || oldOpp === Opp.HEARD_THIS_TURN) return false;
  }
  if (s.actionPoints < need) return false;
  if (s.passedLastInterrupt) return false;
  return true;
}

export function interruptDuel(a: Soldier, b: Soldier): boolean {
  if (a.oppList[b.id] === Opp.SEEN_CURRENTLY && b.oppList[a.id] !== Opp.SEEN_CURRENTLY) {
    if (a.interruptDuelPts < b.interruptDuelPts) a.interruptDuelPts = b.interruptDuelPts;
    return true;
  }
  return a.interruptDuelPts > b.interruptDuelPts;
}
