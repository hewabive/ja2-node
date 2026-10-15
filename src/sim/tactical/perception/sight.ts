// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/OppList.cc DistanceVisible, ManLooksForMan, ManSeesMan, HandleManNoLongerSeen, TeamNoLongerSeesMan,
// @src UpdatePersonal, UpdatePublic, RadioSightings, OurTeamRadiosRandomlyAbout, HandleSight, ManLooksForOtherTeams,
// @src OtherTeamsLookForMan, AllTeamsLookForAll, ReevaluateBestSightingPosition, HandleBestSightingPositionInRealtime,
// @src DecayOppListValue, VerifyAndDecayOpplist, DecayPublicOpplist. See docs/08 §2.

import { pythSpacesAway } from '../../../content/world/grid.ts';
import { endHeight, states } from '../animation.ts';
import { AlertStatus, OKLIFE, type Soldier, SoldierClass, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { revealRoofsAndItems } from './fov.ts';
import { type HeightClass, type LosSubject, soldierToSoldierLineOfSight } from './los.ts';

export const Opp = {
  NOT_HEARD_OR_SEEN: 0,
  SEEN_CURRENTLY: 1,
  SEEN_THIS_TURN: 2,
  SEEN_LAST_TURN: 3,
  SEEN_2_TURNS_AGO: 4,
  SEEN_3_TURNS_AGO: 5,
  HEARD_THIS_TURN: -1,
  HEARD_LAST_TURN: -2,
  HEARD_2_TURNS_AGO: -3,
  HEARD_3_TURNS_AGO: -4,
} as const;

export const SightFlags = { LOOK: 0x01, RADIO: 0x02, INTERRUPT: 0x04 } as const;
export const Caller = { MANLOOKSFOROTHERTEAMS: 0, OTHERTEAMSLOOKFORMAN: 1, VERIFYANDDECAYOPPLIST: 2, UPDATEPUBLIC: 4, UNKNOWN: 5 } as const;

const IRRELEVANT = -1;
const MAX_DISTANCE_VISIBLE = 26;
const STRAIGHT = 13;
const ANGLE = 11;
const LOOK_BY_OCTANT_DIFFERENCE = [STRAIGHT, ANGLE, 7, 0, 0];
const LIGHT_PCT = [80, 86, 93, 100, 94, 88, 82, 76, 70, 64, 58, 51, 43, 30, 17, 9];
const KNOWLEDGE_VALUE: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 0, 5, 4, 3, 2, 1],
  [0, 0, 1, 2, 0, 4, 3, 2, 1, 0],
  [0, 0, 0, 1, 0, 3, 2, 1, 0, 0],
  [0, 0, 0, 0, 0, 2, 1, 0, 0, 0],
  [0, 1, 2, 3, 0, 5, 4, 3, 2, 1],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
  [0, 0, 0, 1, 0, 2, 1, 0, 0, 0],
  [0, 0, 1, 2, 0, 3, 2, 1, 0, 0],
  [0, 1, 2, 3, 0, 4, 3, 2, 1, 0],
];
const OLDEST_HEARD_VALUE = -4;
const BEST_SIGHTING_ALL = 6;
const BEST_SIGHTING_NONCOMBAT = 3;
const NO_INTERRUPT = 127;
const SIGHTING_POINTS = 1;
const TEAM_COUNT = 6;
const DIFFICULTY_MEDIUM = 2;

export interface Perception {
  readonly publicOpp: Int8Array[];
  readonly publicLastKnown: Int16Array[];
  readonly publicNoiseGridNo: number[];
  readonly publicNoiseVolume: number[];
  readonly awareOfOpposition: boolean[];
  ambientLight: number;
  difficulty: number;
  bestSize: number;
  best: Soldier[];
  combatTeam: number;
  disallowSight: boolean;
}

export function createPerception(maxSoldiers: number): Perception {
  return {
    publicOpp: Array.from({ length: TEAM_COUNT }, () => new Int8Array(maxSoldiers)),
    publicLastKnown: Array.from({ length: TEAM_COUNT }, () => new Int16Array(maxSoldiers).fill(-1)),
    publicNoiseGridNo: new Array<number>(TEAM_COUNT).fill(-1),
    publicNoiseVolume: new Array<number>(TEAM_COUNT).fill(0),
    awareOfOpposition: new Array<boolean>(TEAM_COUNT).fill(false),
    ambientLight: 3,
    difficulty: DIFFICULTY_MEDIUM,
    bestSize: BEST_SIGHTING_NONCOMBAT,
    best: [],
    combatTeam: -1,
    disallowSight: false,
  };
}

export function validForSightings(s: Soldier | undefined): s is Soldier {
  return s !== undefined && s.placed && s.life > 0;
}

export function hostile(a: Soldier, b: Soldier): boolean {
  return !a.neutral && !b.neutral && a.side !== b.side;
}

function mercs(t: TacticalState): Soldier[] {
  return t.soldiers.filter((s) => s?.placed);
}

function losSubject(t: TacticalState, s: Soldier): LosSubject {
  return { gridNo: s.gridNo, level: s.level, heightClass: endHeight(t.content, s.state) as (typeof HeightClass)[keyof typeof HeightClass] };
}

export function atan8(x1: number, y1: number, x2: number, y2: number): number {
  const x = x2 - x1;
  const y = -(y2 - y1);
  if (x === 0 && y === 0) return 2;
  let theta = Math.atan2(y, x);
  if (theta < 0) theta += 2 * Math.PI;
  const index = Math.trunc((8 * theta + Math.PI) / (2 * Math.PI)) % 8;
  return [2, 1, 0, 7, 6, 5, 4, 3][index] ?? 2;
}

export function distanceVisible(t: TacticalState, viewer: Soldier, facing: number, subjectDir: number, g: number, level: number): number {
  let d: number;
  if (facing === IRRELEVANT || viewer.gridNo === g) d = MAX_DISTANCE_VISIBLE;
  else {
    const diff = Math.abs(facing - subjectDir);
    const look = LOOK_BY_OCTANT_DIFFERENCE[diff > 4 ? 8 - diff : diff] ?? 0;
    d = look === ANGLE && (viewer.team === Team.OUR || viewer.ai.alertStatus >= AlertStatus.RED) ? STRAIGHT : look;
    d *= 2;
    if (viewer.state === states(t.content.animations).RUNNING && look !== STRAIGHT) d = Math.trunc((d * 8) / 10);
  }
  if (viewer.level !== level) d += 2;
  const light = Math.min(15, Math.max(1, t.perception.ambientLight));
  return Math.trunc((d * (LIGHT_PCT[light] ?? 100)) / 100);
}

function knowledge(oldValue: number, newValue: number): number {
  return KNOWLEDGE_VALUE[oldValue - OLDEST_HEARD_VALUE]?.[newValue - OLDEST_HEARD_VALUE] ?? 0;
}

export function updatePersonal(s: Soldier, opp: Soldier, value: number, g: number): void {
  if (knowledge(s.oppList[opp.id] ?? 0, value) > 0 || value === 0) s.oppList[opp.id] = value;
  s.lastKnownOpp[opp.id] = g;
}

export function updatePublic(t: TacticalState, team: number, opp: Soldier, value: number, g: number): void {
  const p = t.perception;
  const table = p.publicOpp[team];
  if (!table) return;
  const old = table[opp.id] ?? 0;
  if (knowledge(old, value) > 0 || value === 0) table[opp.id] = value;
  const lastKnown = p.publicLastKnown[team];
  if (lastKnown) lastKnown[opp.id] = g;
  if (old === 0 && value !== 0) {
    for (const mate of mercs(t)) {
      if (mate.team !== team || mate.life < OKLIFE || (mate.oppList[opp.id] ?? 0) !== 0) continue;
      manLooksForMan(t, mate, opp, Caller.UPDATEPUBLIC);
      mate.newOppCnt = 0;
    }
  }
}

function addOneOpponent(s: Soldier, checkOrders: (s: Soldier) => void): void {
  s.ai.oppCount++;
  if (s.ai.oppCount === 1) {
    if (s.ai.alertStatus < AlertStatus.RED) checkOrders(s);
    s.ai.alertStatus = AlertStatus.BLACK;
  }
}

function removeOneOpponent(s: Soldier): void {
  s.ai.oppCount = Math.max(0, s.ai.oppCount - 1);
  if (s.ai.oppCount === 0) s.ai.alertStatus = AlertStatus.RED;
}

function teamNoLongerSeesMan(t: TacticalState, team: number, opp: Soldier, exclude: Soldier, iteration: number): boolean {
  for (const mate of mercs(t)) {
    if (mate.team !== team || mate === exclude || mate.life < OKLIFE) continue;
    if (mate.oppList[opp.id] === Opp.SEEN_CURRENTLY) return false;
  }
  if (iteration === 0) {
    if (team === Team.OUR && mercs(t).some((m) => m.team === Team.MILITIA)) return teamNoLongerSeesMan(t, Team.MILITIA, opp, exclude, 1);
    if (team === Team.MILITIA && mercs(t).some((m) => m.team === Team.OUR)) return teamNoLongerSeesMan(t, Team.OUR, opp, exclude, 1);
  }
  return true;
}

function handleManNoLongerSeen(t: TacticalState, me: Soldier, opp: Soldier): void {
  if (hostile(me, opp)) removeOneOpponent(me);
  me.oppList[opp.id] = Opp.SEEN_THIS_TURN;
  const table = t.perception.publicOpp[me.team];
  if (table && table[opp.id] === Opp.SEEN_CURRENTLY && teamNoLongerSeesMan(t, me.team, opp, me, 0)) {
    table[opp.id] = Opp.SEEN_THIS_TURN;
    if ((me.team === Team.OUR || me.team === Team.MILITIA) && opp.team !== Team.OUR && opp.team !== Team.MILITIA) opp.visible = 0;
  }
}

const SEEK_ACTIONS = new Set([1, 3, 2, 6, 7, 8]);

function reevaluateBestSighting(t: TacticalState, s: Soldier, points: number): void {
  if (points === NO_INTERRUPT) return;
  const p = t.perception;
  if (p.best.includes(s)) return;
  const index = p.best.length;
  if (index < p.bestSize) {
    s.interruptDuelPts = points;
    p.best.push(s);
  }
}

export function manSeesMan(t: TacticalState, s: Soldier, opp: Soldier, caller: number): void {
  if (!validForSightings(s) || s.life < OKLIFE || !validForSightings(opp)) return;
  const old = s.oppList[opp.id] ?? 0;
  let newOpp = false;
  if (old !== Opp.SEEN_CURRENTLY && hostile(s, opp)) {
    addOneOpponent(s, t.perceptionHooks.checkForChangingOrders);
    if (old !== Opp.SEEN_THIS_TURN) {
      newOpp = true;
      s.newOppCnt++;
    }
    if (old !== Opp.SEEN_THIS_TURN || s.lastKnownOpp[opp.id] !== opp.gridNo) t.perceptionHooks.setNewSituation(s);
    else if (SEEK_ACTIONS.has(s.ai.action)) t.perceptionHooks.setNewSituation(s);
  }
  updatePersonal(s, opp, Opp.SEEN_CURRENTLY, opp.gridNo);
  const sightingCaller = caller === Caller.MANLOOKSFOROTHERTEAMS || caller === Caller.OTHERTEAMSLOOKFORMAN || caller === Caller.UNKNOWN;
  if (sightingCaller && t.perception.bestSize !== 0 && newOpp && !t.inCombat && (s.team !== Team.OUR || opp.life >= OKLIFE)) {
    reevaluateBestSighting(t, s, hostile(s, opp) ? SIGHTING_POINTS : NO_INTERRUPT);
  }
  if ((s.team === Team.OUR || s.team === Team.MILITIA) && opp.visible <= 0) opp.visible = 1;
}

export function manLooksForMan(t: TacticalState, me: Soldier, opp: Soldier, caller: number): boolean {
  if (me === opp || !validForSightings(me) || me.life < OKLIFE || !validForSightings(opp) || me.team === opp.team) return false;
  const pers = me.oppList[opp.id] ?? 0;
  const publ = t.perception.publicOpp[me.team]?.[opp.id] ?? 0;
  const aware = pers !== 0 || publ !== 0;
  const d = aware
    ? distanceVisible(t, me, IRRELEVANT, 0, opp.gridNo, opp.level)
    : distanceVisible(
        t,
        me,
        me.desiredDirection,
        atan8(Math.trunc(me.x), Math.trunc(me.y), Math.trunc(opp.x), Math.trunc(opp.y)),
        opp.gridNo,
        opp.level,
      );
  let seen = false;
  const losWorld = { structures: t.world.structures, heights: t.world.level.heights };
  if (
    pythSpacesAway(me.gridNo, opp.gridNo) <= d &&
    soldierToSoldierLineOfSight(losWorld, losSubject(t, me), losSubject(t, opp), d & 0xff, aware, t.perception.disallowSight) !== 0
  ) {
    manSeesMan(t, me, opp, caller);
    seen = true;
  }
  if (!seen && me.oppList[opp.id] === Opp.SEEN_CURRENTLY) handleManNoLongerSeen(t, me, opp);
  return seen;
}

function radioSightings(t: TacticalState, s: Soldier, about: Soldier | null, toTeam: number): void {
  const p = t.perception;
  const table = p.publicOpp[toTeam];
  if (!table) return;
  let revealed = 0;
  let unknown = 0;
  const targets = about ? [about] : t.soldiers.filter((x) => x !== undefined);
  for (const opp of targets) {
    if (!validForSightings(opp)) continue;
    if (s.side === opp.side && opp.team === Team.OUR) continue;
    const pers = s.oppList[opp.id] ?? 0;
    const publ = table[opp.id] ?? 0;
    if (pers === Opp.NOT_HEARD_OR_SEEN) continue;
    if (!knowledge(publ, pers) && publ !== pers) continue;
    if (
      s.team === Team.OUR &&
      pers === Opp.SEEN_CURRENTLY &&
      opp.side !== s.side &&
      !opp.neutral &&
      toTeam !== Team.MILITIA &&
      opp.life >= OKLIFE
    ) {
      if (publ === Opp.NOT_HEARD_OR_SEEN) unknown++;
      else if (publ !== Opp.SEEN_CURRENTLY && publ !== Opp.SEEN_THIS_TURN) revealed++;
    }
    updatePublic(t, toTeam, opp, pers, s.lastKnownOpp[opp.id] ?? -1);
  }
  if (s.ai.noiseVolume > (p.publicNoiseVolume[toTeam] ?? 0)) {
    p.publicNoiseGridNo[toTeam] = s.ai.noiseGridNo;
    p.publicNoiseVolume[toTeam] = s.ai.noiseVolume;
  }
  if (s.team === Team.OUR && (revealed || unknown)) t.perceptionHooks.ourTeamSeesSomeone(s, revealed, unknown);
}

export function ourTeamRadiosRandomlyAbout(t: TacticalState, about: Soldier): void {
  const radioMen = t.soldiers.filter((s) => s?.team === Team.OUR && validForSightings(s) && s.life >= OKLIFE);
  for (let count = radioMen.length; count > 0; count--) {
    const index = t.rng.int(count);
    const chosen = radioMen[index] as Soldier;
    radioSightings(t, chosen, about, chosen.team);
    chosen.newOppCnt = 0;
    radioMen[index] = radioMen[count - 1] as Soldier;
  }
}

function manLooksForOtherTeams(t: TacticalState, s: Soldier): void {
  for (const opp of mercs(t)) {
    if (opp.team === s.team) continue;
    manLooksForMan(t, s, opp, Caller.MANLOOKSFOROTHERTEAMS);
    if (!t.inCombat && opp.visible === 0) opp.visible = -1;
  }
}

function otherTeamsLookForMan(t: TacticalState, opp: Soldier): void {
  if (opp.team !== Team.OUR && opp.team !== Team.MILITIA && opp.visible >= 0 && opp.visible < 2 && opp.life > 0) opp.visible = 0;
  for (const looker of mercs(t)) {
    if (looker.team === opp.team || looker.life < OKLIFE) continue;
    manLooksForMan(t, looker, opp, Caller.OTHERTEAMSLOOKFORMAN);
  }
  if (opp.team !== Team.OUR && opp.visible === 0) opp.visible = -1;
}

function handleBestSightingInRealtime(t: TacticalState): void {
  const p = t.perception;
  const [first, second, third] = p.best;
  if (first) {
    if (!second || first.team === second.team || !third || first.team === third.team) t.perceptionHooks.enterCombatMode(first.team, first);
    else t.perceptionHooks.enterCombatMode(second.team, second);
  }
  for (const s of p.best) s.interruptDuelPts = NO_INTERRUPT;
  p.best = [];
}

export function handleSight(t: TacticalState, s: Soldier, flags: number): void {
  if (!validForSightings(s)) return;
  const p = t.perception;
  if (p.bestSize !== BEST_SIGHTING_ALL) {
    p.bestSize = t.inCombat ? 0 : BEST_SIGHTING_NONCOMBAT;
    p.best = [];
  }
  const saved = s.ai.newSituation;
  s.ai.newSituation = 0;
  if (flags & SightFlags.LOOK) {
    if (s.life >= OKLIFE) manLooksForOtherTeams(t, s);
    otherTeamsLookForMan(t, s);
  }
  if (p.bestSize === BEST_SIGHTING_NONCOMBAT) handleBestSightingInRealtime(t);
  if (s.ai.newSituation && s.team !== Team.OUR) t.perceptionHooks.haltFromSighting(s);
  s.ai.newSituation = Math.max(s.ai.newSituation, saved);
  if (flags & SightFlags.RADIO) {
    const enemyRadio = (x: Soldier) =>
      p.difficulty >= DIFFICULTY_MEDIUM &&
      x.team === Team.ENEMY &&
      p.awareOfOpposition[Team.ENEMY] === true &&
      x.soldierClass !== SoldierClass.ADMINISTRATOR;
    if (s.team === Team.OUR) {
      radioSightings(t, s, null, s.team);
      radioSightings(t, s, null, Team.MILITIA);
      revealRoofsAndItems(t, s);
    } else if (enemyRadio(s)) radioSightings(t, s, null, Team.ENEMY);
    s.newOppCnt = 0;
    if (s.team !== Team.OUR) ourTeamRadiosRandomlyAbout(t, s);
    for (const them of mercs(t)) {
      if (them.life < OKLIFE || them.team === s.team) continue;
      if (them.team !== Team.OUR && enemyRadio(them)) radioSightings(t, them, null, Team.ENEMY);
      them.newOppCnt = 0;
    }
  }
}

export function allTeamsLookForAll(t: TacticalState): void {
  const p = t.perception;
  p.bestSize = BEST_SIGHTING_ALL;
  p.best = [];
  for (const s of mercs(t)) if (s.life >= OKLIFE) handleSight(t, s, SightFlags.LOOK);
  for (const s of mercs(t)) if (s.team === Team.OUR) handleSight(t, s, SightFlags.RADIO);
  if (!t.inCombat) handleBestSightingInRealtime(t);
  p.bestSize = t.inCombat ? 0 : BEST_SIGHTING_NONCOMBAT;
}

export function decayOppListValue(value: number): number {
  if (value >= Opp.SEEN_THIS_TURN) {
    const next = value + 1;
    return next > Opp.SEEN_3_TURNS_AGO ? Opp.NOT_HEARD_OR_SEEN : next;
  }
  if (value <= Opp.HEARD_THIS_TURN) {
    const next = value - 1;
    return next < Opp.HEARD_3_TURNS_AGO ? Opp.NOT_HEARD_OR_SEEN : next;
  }
  return value;
}

export function verifyAndDecayOpplist(t: TacticalState, s: Soldier): void {
  if (!validForSightings(s)) return;
  if (s.life < OKLIFE) {
    s.oppList.fill(0);
    return;
  }
  if (s.newOppCnt && s.team === Team.OUR) {
    radioSightings(t, s, null, s.team);
    s.newOppCnt = 0;
  }
  for (const opp of t.soldiers) {
    if (!opp || opp === s) continue;
    const value = s.oppList[opp.id] ?? 0;
    if (value === 0) continue;
    if (validForSightings(opp)) manLooksForMan(t, s, opp, Caller.VERIFYANDDECAYOPPLIST);
    s.oppList[opp.id] = decayOppListValue(s.oppList[opp.id] ?? 0);
  }
}

export function decayPublicOpplist(t: TacticalState, team: number): void {
  const p = t.perception;
  const volume = p.publicNoiseVolume[team] ?? 0;
  if (volume) {
    const next = t.inCombat ? Math.trunc((volume * 7) / 10) : Math.trunc(volume / 2);
    p.publicNoiseVolume[team] = next;
    if (next <= 0) p.publicNoiseGridNo[team] = -1;
  }
  const table = p.publicOpp[team];
  if (!table) return;
  for (let id = 0; id < table.length; id++) {
    const value = table[id] ?? 0;
    if (value === 0) continue;
    const decayed = decayOppListValue(value);
    if (decayed === 0) {
      const opp = t.soldiers[id];
      if (opp) updatePublic(t, team, opp, 0, -1);
      else table[id] = 0;
    } else table[id] = decayed;
  }
}

export function publicOpp(t: TacticalState, team: number, opp: Soldier): number {
  return t.perception.publicOpp[team]?.[opp.id] ?? 0;
}
