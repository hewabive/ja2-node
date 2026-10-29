// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/OppList.cc DistanceVisible, ManLooksForMan, ManSeesMan, MakeBloodcatsHostile, RecalculateOppCntsDueToNoLongerNeutral,
// @src RecalculateOppCntsDueToBecomingNeutral,
// @src HandleManNoLongerSeen, TeamNoLongerSeesMan,
// @src UpdatePersonal, UpdatePublic, RadioSightings, OurTeamRadiosRandomlyAbout, HandleSight, ManLooksForOtherTeams,
// @src OtherTeamsLookForMan, AllTeamsLookForAll, ReevaluateBestSightingPosition, HandleBestSightingPositionInRealtime,
// @src DecayOppListValue, VerifyAndDecayOpplist, DecayPublicOpplist, EndMuzzleFlash, TurnOffEveryonesMuzzleFlashes,
// @src TurnOffTeamsMuzzleFlashes, DecideTrueVisibility (ManSeesMan's first-battle fact through the narrative
// @src port, no best sighting while boxing, ReevaluateEnemyStance at its end); Soldier_Macros.h AM_A_ROBOT.

import { pythSpacesAway } from '../../../content/world/grid.ts';
import { Fact } from '../../strategic/narrative/fact-ids.ts';
import { endHeight, setSoldierAniSpeed, states } from '../animation.ts';
import { StatCause, statChange } from '../combat/experience.ts';
import { withinOneOctant } from '../directions.ts';
import { wearsHeadGear } from '../inventory.ts';
import { adjustMaxSightRangeForEnvEffects, lightTrueLevel, NORMAL_LIGHTLEVEL_DAY, NORMAL_LIGHTLEVEL_NIGHT } from '../lighting/lighting.ts';
import { boxingActive } from '../narrative/boxing-state.ts';
import { newSightingRules } from '../narrative/sight-rules.ts';
import { StatKind } from '../profiles.ts';
import {
  AlertStatus,
  Body,
  consideredNeutral,
  isMonster,
  NO_INTERRUPT,
  NO_PROFILE,
  NOBODY,
  NOWHERE,
  numSkillTraits,
  OKLIFE,
  SkillTrait,
  type Soldier,
  SoldierClass,
  Team,
  TOTAL_SOLDIERS,
} from '../soldier.ts';
import { mercs, type TacticalState, teamMembers, whoIsThere } from '../state.ts';
import {
  addToIntList,
  checkForPotentialAddToBattleIncrement,
  doneAddingToIntList,
  InterruptKind,
  isTeamActive,
  resolveInterruptsVs,
} from '../turns/turns.ts';
import {
  calcInterruptDuelPts,
  clearWatchedLocIncrements,
  decayWatchedLocs,
  incrementWatchedLoc,
  markSeenOpponent,
  setWatchedLocAsUsed,
  standardInterruptConditionsMet,
} from './duel.ts';
import { reevaluateEnemyStance } from './enemy-stance.ts';
import { revealRoofsAndItems } from './fov.ts';
import { type HeightClass, type LosSubject, soldierToSoldierLineOfSight } from './los.ts';
import { atan8, Caller, Opp, SightFlags } from './opp.ts';

export { atan8, atan8Of, Caller, Opp, SightFlags } from './opp.ts';

const IRRELEVANT = -1;
export const MAX_DISTANCE_VISIBLE = 26;
const STRAIGHT = 13;
const ANGLE = 11;
const LOOK_BY_OCTANT_DIFFERENCE = [STRAIGHT, ANGLE, 7, 0, 0];
const SUNGOGGLES_BONUS_PER_LEVEL = 1;
const NIGHTSIGHTGOGGLES_BONUS = 2;
const UVGOGGLES_BONUS = 4;
const GOGGLES_FADE_LEVELS = 3;
const DARK_LEVELS_ABOVE_DAY = 5;
const NO_ITEM = -2;
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
const TEAM_COUNT = 6;
const DIFFICULTY_MEDIUM = 2;
const NORMAL_HUMAN_SMELL_STRENGTH = 10;
const UNSEEN_SPOTTING_EXPERIENCE_CHANCES = 10;

export interface Perception {
  readonly publicOpp: Int8Array[];
  readonly publicLastKnown: Int16Array[];
  readonly publicNoiseGridNo: number[];
  readonly publicNoiseVolume: number[];
  readonly publicNoiseLevel: number[];
  readonly lastMercToRadio: (Soldier | null)[];
  readonly awareOfOpposition: boolean[];
  bestSize: number;
  best: (Soldier | null)[];
  combatTeam: number;
  disallowSight: boolean;
}

export function createPerception(maxSoldiers: number): Perception {
  return {
    publicOpp: Array.from({ length: TEAM_COUNT }, () => new Int8Array(maxSoldiers)),
    publicLastKnown: Array.from({ length: TEAM_COUNT }, () => new Int16Array(maxSoldiers).fill(-1)),
    publicNoiseGridNo: new Array<number>(TEAM_COUNT).fill(-1),
    publicNoiseVolume: new Array<number>(TEAM_COUNT).fill(0),
    publicNoiseLevel: new Array<number>(TEAM_COUNT).fill(0),
    lastMercToRadio: new Array<Soldier | null>(TEAM_COUNT).fill(null),
    awareOfOpposition: new Array<boolean>(TEAM_COUNT).fill(false),
    bestSize: BEST_SIGHTING_NONCOMBAT,
    best: new Array<Soldier | null>(BEST_SIGHTING_ALL).fill(null),
    combatTeam: -1,
    disallowSight: false,
  };
}

export function validForSightings(s: Soldier | undefined): s is Soldier {
  return s?.placed === true && s.life > 0;
}

export function hostile(a: Soldier, b: Soldier): boolean {
  return !consideredNeutral(a, b) && !consideredNeutral(b, a) && a.side !== b.side;
}

function losSubject(t: TacticalState, s: Soldier): LosSubject {
  return { gridNo: s.gridNo, level: s.level, heightClass: endHeight(t.content, s.state) as (typeof HeightClass)[keyof typeof HeightClass] };
}

function distanceSmellable(subject: Soldier): number {
  const d = MAX_DISTANCE_VISIBLE;
  if (isMonster(subject)) return d;
  return Math.max(Math.trunc((d * (subject.normalSmell - subject.monsterSmell)) / NORMAL_HUMAN_SMELL_STRENGTH), 0);
}

export function distanceVisible(
  t: TacticalState,
  viewer: Soldier,
  facing: number,
  subjectDir: number,
  g: number,
  level: number,
  muzzleFlashInView = true,
): number {
  const subject = whoIsThere(t, g, level);
  if (isMonster(viewer)) return subject ? distanceSmellable(subject) : 0;
  if (viewer.blindedCounter > 0) return 0;
  const flash = muzzleFlashInView && subject?.muzzleFlash === true;
  let d: number;
  if (facing === IRRELEVANT || flash || viewer.gridNo === g) d = MAX_DISTANCE_VISIBLE;
  else {
    const diff = Math.abs(facing - subjectDir);
    const look = LOOK_BY_OCTANT_DIFFERENCE[diff > 4 ? 8 - diff : diff] ?? 0;
    d = look === ANGLE && (viewer.team === Team.OUR || viewer.ai.alertStatus >= AlertStatus.RED) ? STRAIGHT : look;
    d *= 2;
    if (viewer.state === states(t.content.animations).RUNNING && look !== STRAIGHT) d = Math.trunc((d * 8) / 10);
  }
  if (viewer.level !== level) d += 2;
  const light = flash ? Math.min(lightTrueLevel(t, g, level), NORMAL_LIGHTLEVEL_DAY) : lightTrueLevel(t, g, level);
  return adjustMaxSightRangeForEnvEffects(light, d) + lightGearBonus(t, viewer, light);
}

export function seesMuzzleFlashWithoutTurning(viewer: Soldier, towards: number): boolean {
  return withinOneOctant(viewer.direction, towards);
}

function amARobot(t: TacticalState, s: Soldier): boolean {
  return s.profile !== NO_PROFILE && t.content.profiles[s.profile]?.bodyType === Body.ROBOTNOWEAPON;
}

function nightSightBonus(t: TacticalState, viewer: Soldier, light: number, wears: (name: string) => boolean): number {
  const intensifier = wears('NIGHTGOGGLES') || amARobot(t, viewer);
  if (!intensifier && !wears('UVGOGGLES') && viewer.bodyType !== Body.BLOODCAT) return 0;
  if (intensifier) {
    if (light <= NORMAL_LIGHTLEVEL_NIGHT) return NIGHTSIGHTGOGGLES_BONUS;
    return light < NORMAL_LIGHTLEVEL_NIGHT + GOGGLES_FADE_LEVELS ? NIGHTSIGHTGOGGLES_BONUS / 2 : 0;
  }
  return t.lighting.underground ? 0 : UVGOGGLES_BONUS;
}

function lightGearBonus(t: TacticalState, viewer: Soldier, light: number): number {
  const wears = (name: string) => wearsHeadGear(viewer.inv, t.content.items.byName.get(name)?.index ?? NO_ITEM);
  if (light < NORMAL_LIGHTLEVEL_DAY) {
    if (!wears('SUNGOGGLES')) return 0;
    return SUNGOGGLES_BONUS_PER_LEVEL * (light < NORMAL_LIGHTLEVEL_DAY - 1 ? 2 : 1);
  }
  if (light <= NORMAL_LIGHTLEVEL_DAY + DARK_LEVELS_ABOVE_DAY) return 0;
  return nightSightBonus(t, viewer, light, wears) + numSkillTraits(viewer, SkillTrait.NIGHTOPS);
}

export function knowledge(oldValue: number, newValue: number): number {
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
      if (mate.team !== team || mate.life < OKLIFE || t.explosives.gassed[mate.id] || (mate.oppList[opp.id] ?? 0) !== 0) continue;
      manLooksForMan(t, mate, opp, Caller.UPDATEPUBLIC);
      mate.newOppCnt = 0;
    }
  }
}

function addOneOpponent(s: Soldier, checkOrders: (s: Soldier) => void): void {
  s.ai.oppCount++;
  if (s.ai.oppCount !== 1 || s.bodyType === Body.LARVAE_MONSTER) return;
  if (s.ai.alertStatus < AlertStatus.RED) checkOrders(s);
  s.ai.alertStatus = AlertStatus.BLACK;
  if (isMonster(s)) {
    s.ai.caller = NOBODY;
    s.ai.callPriority = 0;
  }
}

export function recalculateOppCntsDueToNoLongerNeutral(t: TacticalState, s: Soldier): void {
  s.ai.oppCount = 0;
  if (s.neutral) return;
  for (const opp of mercs(t)) {
    if (opp.life === 0 || opp.neutral || opp.team === s.team || !hostile(s, opp)) continue;
    if (s.oppList[opp.id] === Opp.SEEN_CURRENTLY) addOneOpponent(s, t.perceptionHooks.checkForChangingOrders);
    if (opp.oppList[s.id] === Opp.SEEN_CURRENTLY) addOneOpponent(opp, t.perceptionHooks.checkForChangingOrders);
  }
}

export function recalculateOppCntsDueToBecomingNeutral(t: TacticalState, s: Soldier): void {
  if (!s.neutral) return;
  s.ai.oppCount = 0;
  for (const opp of mercs(t)) {
    if (opp.life === 0 || opp.neutral || opp.team === s.team || consideredNeutral(s, opp) || s.side === opp.side) continue;
    if (opp.oppList[s.id] === Opp.SEEN_CURRENTLY) removeOneOpponent(opp);
  }
}

function makeBloodcatsHostile(t: TacticalState): void {
  for (const cat of teamMembers(t, Team.CREATURE)) {
    if (cat.bodyType !== Body.BLOODCAT || !validForSightings(cat)) continue;
    cat.neutral = false;
    recalculateOppCntsDueToNoLongerNeutral(t, cat);
    if (t.inCombat) checkForPotentialAddToBattleIncrement(t, cat);
  }
}

function drawBloodcatRoarChance(t: TacticalState): void {
  t.rng.int(2);
}

function bloodcatSightingTurnsHostile(t: TacticalState, s: Soldier, opp: Soldier): void {
  if (s.bodyType === Body.BLOODCAT) {
    if (s.neutral) makeBloodcatsHostile(t);
    else if (s.ai.oppCount === 0) drawBloodcatRoarChance(t);
  } else if (opp.bodyType === Body.BLOODCAT && opp.neutral) makeBloodcatsHostile(t);
}

function removeOneOpponent(s: Soldier): void {
  s.ai.oppCount = Math.max(0, s.ai.oppCount - 1);
  if (s.ai.oppCount === 0) s.ai.alertStatus = AlertStatus.RED;
}

export function teamNoLongerSeesMan(t: TacticalState, team: number, opp: Soldier, exclude: Soldier | null, iteration: number): boolean {
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
    if (onOurOrMilitiaTeam(me) && !onOurOrMilitiaTeam(opp)) opp.visible = 0;
  }
}

function onOurOrMilitiaTeam(s: Soldier): boolean {
  return s.team === Team.OUR || s.team === Team.MILITIA;
}

function decideTrueVisibility(s: Soldier): void {
  if (s.visible === 0) s.visible = -1;
}

export function endMuzzleFlash(t: TacticalState, s: Soldier): void {
  s.muzzleFlash = false;
  if (!onOurOrMilitiaTeam(s)) s.visible = 0;
  for (const other of mercs(t)) {
    if (other.oppList[s.id] !== Opp.SEEN_CURRENTLY || other.gridNo === NOWHERE) continue;
    if (pythSpacesAway(other.gridNo, s.gridNo) > distanceVisible(t, other, IRRELEVANT, IRRELEVANT, s.gridNo, s.level)) {
      handleManNoLongerSeen(t, other, s);
    } else if (onOurOrMilitiaTeam(other)) s.visible = 1;
  }
  decideTrueVisibility(s);
}

export function turnOffTeamsMuzzleFlashes(t: TacticalState, team: number): void {
  for (const s of teamMembers(t, team)) if (s.muzzleFlash) endMuzzleFlash(t, s);
}

export function turnOffEveryonesMuzzleFlashes(t: TacticalState): void {
  for (const s of mercs(t)) if (s.muzzleFlash) endMuzzleFlash(t, s);
}

const SEEK_ACTIONS = new Set([1, 3, 2, 6, 7, 8]);

function initSightArrays(t: TacticalState): void {
  t.perception.best.fill(null);
}

function reevaluateBestSighting(t: TacticalState, s: Soldier, points: number): void {
  if (points === NO_INTERRUPT) return;
  const p = t.perception;
  const best = p.best;
  const size = p.bestSize;
  if (s.interruptDuelPts !== NO_INTERRUPT && points < s.interruptDuelPts) {
    const index = best.slice(0, size - 1).indexOf(s);
    if (index >= 0) {
      s.interruptDuelPts = points;
      for (let k = index + 1; k < size; k++) {
        const here = best[k];
        const above = best[k - 1];
        if (here && above && above.interruptDuelPts < here.interruptDuelPts) {
          best[k - 1] = here;
          best[k] = above;
        } else break;
      }
    } else if (best[size - 1] === s) s.interruptDuelPts = points;
    return;
  }
  if (best.slice(0, size).includes(s)) return;
  for (let k = 0; k < size; k++) {
    const entry = best[k];
    if (entry && points <= entry.interruptDuelPts) continue;
    const last = best[size - 1];
    if (last) last.interruptDuelPts = NO_INTERRUPT;
    s.interruptDuelPts = points;
    for (let m = size - 1; m > k; m--) best[m] = best[m - 1] ?? null;
    best[k] = s;
    return;
  }
}

export function manSeesMan(t: TacticalState, s: Soldier, opp: Soldier, caller: number): void {
  if (!validForSightings(s) || s.life < OKLIFE || !validForSightings(opp) || s.team === opp.team) return;
  const old = s.oppList[opp.id] ?? 0;
  let newOpp = false;
  if (old !== Opp.SEEN_CURRENTLY) {
    newSightingRules(t, s, opp);
    bloodcatSightingTurnsHostile(t, s, opp);
  }
  if (old !== Opp.SEEN_CURRENTLY && hostile(s, opp)) {
    addOneOpponent(s, t.perceptionHooks.checkForChangingOrders);
    if (old !== Opp.SEEN_THIS_TURN) {
      newOpp = true;
      s.newOppCnt++;
      incrementWatchedLoc(t, s, opp.gridNo, opp.level);
      if (s.team === Team.OUR && opp.team === Team.ENEMY && !t.narrative.fact(Fact.FIRST_BATTLE_FOUGHT))
        t.narrative.setFactTrue(Fact.FIRST_BATTLE_BEING_FOUGHT);
    } else setWatchedLocAsUsed(t, s.id, opp.gridNo, opp.level);
    if (old !== Opp.SEEN_THIS_TURN || s.lastKnownOpp[opp.id] !== opp.gridNo) t.perceptionHooks.setNewSituation(s);
    else if (SEEK_ACTIONS.has(s.ai.action)) t.perceptionHooks.setNewSituation(s);
  }
  updatePersonal(s, opp, Opp.SEEN_CURRENTLY, opp.gridNo);
  const sightingCaller = caller === Caller.MANLOOKSFOROTHERTEAMS || caller === Caller.OTHERTEAMSLOOKFORMAN || caller === Caller.UNKNOWN;
  if (sightingCaller && t.perception.bestSize !== 0 && !boxingActive(t) && newOpp) {
    if (t.inCombat) {
      if (standardInterruptConditionsMet(t, s, opp, old)) reevaluateBestSighting(t, s, calcInterruptDuelPts(t, s, opp, true));
    } else if (s.team !== Team.OUR || opp.life >= OKLIFE) reevaluateBestSighting(t, s, calcInterruptDuelPts(t, s, opp, true));
  }
  markSeenOpponent(t, s.id, opp.id);
  if ((s.team === Team.OUR || s.team === Team.MILITIA) && opp.visible <= 0) {
    const locate = opp.visible === -1;
    opp.visible = 1;
    if (locate) setSoldierAniSpeed(t, opp);
  } else if (s.team !== Team.OUR) reevaluateEnemyStance(t, s, s.state);
}

export function manLooksForMan(t: TacticalState, me: Soldier, opp: Soldier, caller: number): boolean {
  if (me === opp || !validForSightings(me) || me.life < OKLIFE || !validForSightings(opp) || me.team === opp.team) return false;
  if (me.bodyType === Body.LARVAE_MONSTER) return false;
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
    soldierToSoldierLineOfSight(
      losWorld,
      losSubject(t, me),
      losSubject(t, opp),
      d & 0xff,
      aware,
      t.perception.disallowSight,
      isMonster(me),
    ) !== 0
  ) {
    manSeesMan(t, me, opp, caller);
    seen = true;
  }
  if (!seen && me.oppList[opp.id] === Opp.SEEN_CURRENTLY) handleManNoLongerSeen(t, me, opp);
  return seen;
}

function putMilitiaOnRedAlert(t: TacticalState): void {
  if (isTeamActive(t, Team.MILITIA)) t.perception.awareOfOpposition[Team.MILITIA] = true;
}

export function radioSightings(t: TacticalState, s: Soldier, about: Soldier | null, toTeam: number): void {
  const p = t.perception;
  p.lastMercToRadio[s.team] = s;
  const table = p.publicOpp[toTeam];
  if (!table) return;
  let revealed = 0;
  let unknown = 0;
  const contacts: number[] = [];
  const targets = about ? [about] : t.soldiers.filter((x) => x !== undefined);
  for (const opp of targets) {
    if (!validForSightings(opp)) continue;
    if (s.side === opp.side && opp.team === Team.OUR) continue;
    const pers = s.oppList[opp.id] ?? 0;
    const publ = table[opp.id] ?? 0;
    if (pers === Opp.NOT_HEARD_OR_SEEN) continue;
    if (!knowledge(publ, pers) && publ !== pers) continue;
    const ourMercSeesHostile = s.team === Team.OUR && pers === Opp.SEEN_CURRENTLY && opp.side !== s.side && !opp.neutral;
    if (ourMercSeesHostile && toTeam === Team.MILITIA) putMilitiaOnRedAlert(t);
    else if (ourMercSeesHostile && opp.life >= OKLIFE) {
      let contact = false;
      if (publ === Opp.NOT_HEARD_OR_SEEN) {
        unknown++;
        contact = true;
        if (opp.oppList[s.id] !== Opp.SEEN_CURRENTLY)
          statChange(t, s, StatKind.EXPERIENCE, UNSEEN_SPOTTING_EXPERIENCE_CHANCES, StatCause.SUCCESS);
      } else if (publ !== Opp.SEEN_CURRENTLY && publ !== Opp.SEEN_THIS_TURN) {
        revealed++;
        contact = true;
      }
      if (contact) contacts.push(opp.id);
      if (contact && t.turn.currentTeam !== Team.OUR) {
        const pause = t.turn.enemySightingOnTheirTurn;
        if (pause) pause.enemy.pauseAllAnimation = false;
        t.turn.enemySightingOnTheirTurn = { enemy: opp, since: t.clockMs };
        opp.pauseAllAnimation = true;
      }
    }
    updatePublic(t, toTeam, opp, pers, s.lastKnownOpp[opp.id] ?? -1);
  }
  if (s.ai.noiseVolume > (p.publicNoiseVolume[toTeam] ?? 0)) {
    p.publicNoiseGridNo[toTeam] = s.ai.noiseGridNo;
    p.publicNoiseLevel[toTeam] = s.ai.noiseLevel;
    p.publicNoiseVolume[toTeam] = s.ai.noiseVolume;
  }
  if (s.team === Team.OUR && (revealed || unknown)) t.perceptionHooks.ourTeamSeesSomeone(s, revealed, unknown, contacts);
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
    if (looker.team === opp.team || looker.life < OKLIFE || looker.bodyType === Body.LARVAE_MONSTER) continue;
    const oldOpp = looker.oppList[opp.id] ?? 0;
    if (!manLooksForMan(t, looker, opp, Caller.OTHERTEAMSLOOKFORMAN)) continue;
    if (t.perception.bestSize === 0 && t.inCombat && looker.newOppCnt) {
      looker.interruptDuelPts =
        t.turn.sightFlags & SightFlags.INTERRUPT && standardInterruptConditionsMet(t, looker, opp, oldOpp)
          ? calcInterruptDuelPts(t, looker, opp, true)
          : NO_INTERRUPT;
    }
  }
  if (opp.team !== Team.OUR && opp.visible === 0) opp.visible = -1;
}

function handleBestSightingInRealtime(t: TacticalState): void {
  const p = t.perception;
  if (t.turn.delayResolvingBestSightingDueToDoor) return;
  const [first, second, third] = p.best;
  if (!first) return;
  if (!second || first.team === second.team || !third || first.team === third.team) t.perceptionHooks.enterCombatMode(first.team, first);
  else {
    t.perceptionHooks.enterCombatMode(second.team, second);
    addToIntList(t, second, false);
    addToIntList(t, first, true);
    doneAddingToIntList(t);
  }
  for (const s of p.best) if (s) s.interruptDuelPts = NO_INTERRUPT;
}

export function resolveBestSightingAfterNoise(t: TacticalState): void {
  handleBestSightingInRealtime(t);
}

function handleBestSightingInTurnbased(t: TacticalState): void {
  const p = t.perception;
  const best = p.best;
  const first = best[0];
  if (!first) return;
  if (first.team !== t.turn.currentTeam) {
    let found = -1;
    for (let k = 0; k < p.bestSize; k++) {
      const entry = best[k];
      if (!entry) {
        if (!t.turn.interruptProvoker) return;
        best[k] = t.turn.interruptProvoker;
        found = k;
        break;
      }
      if (entry.team === t.turn.currentTeam) {
        found = k;
        break;
      }
    }
    if (found >= 0) {
      addToIntList(t, best[found] as Soldier, false);
      for (let k = 0; k < found; k++) addToIntList(t, best[k] as Soldier, true);
      doneAddingToIntList(t);
    }
  }
  for (const s of best) if (s) s.interruptDuelPts = NO_INTERRUPT;
}

export function initOpplistForDoorOpening(t: TacticalState): void {
  t.perception.bestSize = BEST_SIGHTING_ALL;
  t.turn.delayResolvingBestSightingDueToDoor = true;
  initSightArrays(t);
}

export function addDoorNoiseSighting(t: TacticalState, s: Soldier, points: number): void {
  reevaluateBestSighting(t, s, points);
}

export function handleSight(t: TacticalState, s: Soldier, flags: number): void {
  if (!validForSightings(s)) return;
  const p = t.perception;
  t.turn.sightFlags = flags;
  if (p.bestSize !== BEST_SIGHTING_ALL) {
    p.bestSize = t.inCombat ? 0 : BEST_SIGHTING_NONCOMBAT;
    initSightArrays(t);
  }
  clearWatchedLocIncrements(t, s.id);
  const saved = s.ai.newSituation;
  s.ai.newSituation = 0;
  if (flags & SightFlags.LOOK) {
    if (s.life >= OKLIFE) manLooksForOtherTeams(t, s);
    otherTeamsLookForMan(t, s);
  }
  if (t.inCombat && flags & SightFlags.INTERRUPT) resolveInterruptsVs(t, s, InterruptKind.SIGHT);
  if (p.bestSize === BEST_SIGHTING_NONCOMBAT) handleBestSightingInRealtime(t);
  if (s.ai.newSituation && s.team !== Team.OUR) t.perceptionHooks.haltFromSighting(s);
  s.ai.newSituation = Math.max(s.ai.newSituation, saved);
  if (flags & SightFlags.RADIO) {
    const enemyRadio = (x: Soldier) =>
      t.options.difficulty >= DIFFICULTY_MEDIUM &&
      x.team === Team.ENEMY &&
      p.awareOfOpposition[Team.ENEMY] === true &&
      x.soldierClass !== SoldierClass.ADMINISTRATOR;
    if (s.team === Team.OUR) {
      radioSightings(t, s, null, s.team);
      radioSightings(t, s, null, Team.MILITIA);
      revealRoofsAndItems(t, s, true);
    } else if (enemyRadio(s)) radioSightings(t, s, null, Team.ENEMY);
    s.newOppCnt = 0;
    if (s.team !== Team.OUR) ourTeamRadiosRandomlyAbout(t, s);
    for (const them of mercs(t)) {
      if (them.life < OKLIFE || them.team === s.team) continue;
      if (them.team !== Team.OUR && enemyRadio(them)) radioSightings(t, them, null, Team.ENEMY);
      them.newOppCnt = 0;
    }
  }
  t.turn.sightFlags |= SightFlags.INTERRUPT;
}

export function allTeamsLookForAll(t: TacticalState, allowInterrupts = false): void {
  const p = t.perception;
  if (allowInterrupts || !t.inCombat) {
    p.bestSize = BEST_SIGHTING_ALL;
    if (t.turn.delayResolvingBestSightingDueToDoor) t.turn.delayResolvingBestSightingDueToDoor = false;
    else initSightArrays(t);
  }
  for (const s of mercs(t)) if (s.life >= OKLIFE) handleSight(t, s, SightFlags.LOOK);
  for (const s of teamMembers(t, Team.OUR)) handleSight(t, s, SightFlags.RADIO);
  if (!t.inCombat) {
    handleBestSightingInRealtime(t);
    p.bestSize = t.inCombat ? 0 : BEST_SIGHTING_NONCOMBAT;
  } else if (allowInterrupts) {
    handleBestSightingInTurnbased(t);
    p.bestSize = 0;
  }
  t.turn.interruptProvoker = null;
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

function radioNewOpponents(t: TacticalState, s: Soldier): void {
  if (!s.newOppCnt) return;
  if (s.team === Team.OUR) radioSightings(t, s, null, s.team);
  s.newOppCnt = 0;
}

export function verifyAndDecayOpplist(t: TacticalState, s: Soldier): void {
  if (s.life < OKLIFE) {
    s.oppList.fill(Opp.NOT_HEARD_OR_SEEN);
    s.ai.oppCount = 0;
    return;
  }
  radioNewOpponents(t, s);
  for (const opp of mercs(t)) {
    if (!validForSightings(opp) || opp.team === s.team) continue;
    if ((s.oppList[opp.id] ?? 0) === Opp.NOT_HEARD_OR_SEEN) continue;
    manLooksForMan(t, s, opp, Caller.VERIFYANDDECAYOPPLIST);
    s.oppList[opp.id] = decayOppListValue(s.oppList[opp.id] ?? 0);
  }
  radioNewOpponents(t, s);
}

function decayPublicNoise(t: TacticalState, team: number): void {
  const p = t.perception;
  const volume = p.publicNoiseVolume[team] ?? 0;
  if (!volume) return;
  const next = t.inCombat ? Math.trunc((volume * 7) / 10) : Math.trunc(volume / 2);
  p.publicNoiseVolume[team] = next;
  if (next <= 0) p.publicNoiseGridNo[team] = NOWHERE;
}

function decayPublicOpponents(t: TacticalState, team: number): boolean {
  const table = t.perception.publicOpp[team];
  if (!table) return false;
  let anyPubliclyKnown = false;
  for (const opp of mercs(t)) {
    if (!opp.life || opp.team === team) continue;
    const value = table[opp.id] ?? Opp.NOT_HEARD_OR_SEEN;
    if (value === Opp.NOT_HEARD_OR_SEEN) continue;
    anyPubliclyKnown = true;
    const decayed = decayOppListValue(value);
    table[opp.id] = decayed;
    if (decayed === Opp.NOT_HEARD_OR_SEEN) updatePublic(t, team, opp, Opp.NOT_HEARD_OR_SEEN, NOWHERE);
  }
  return anyPubliclyKnown;
}

export function decayPublicOpplist(t: TacticalState, team: number): void {
  decayPublicNoise(t, team);
  if (!decayPublicOpponents(t, team)) t.perception.lastMercToRadio[team] = null;
  decayWatchedLocs(t, team);
}

export function publicOpp(t: TacticalState, team: number, opp: Soldier): number {
  return t.perception.publicOpp[team]?.[opp.id] ?? 0;
}

export function decayIndividualOpplist(t: TacticalState, s: Soldier): void {
  if (s.life < OKLIFE) {
    for (const opp of t.soldiers) if (opp && s.oppList[opp.id] === Opp.SEEN_CURRENTLY) handleManNoLongerSeen(t, s, opp);
    s.oppList.fill(Opp.NOT_HEARD_OR_SEEN);
    s.ai.oppCount = 0;
    return;
  }
  for (const opp of mercs(t)) {
    if (!validForSightings(opp) || s.team === opp.team) continue;
    if (s.oppList[opp.id] !== Opp.SEEN_CURRENTLY) continue;
    s.oppList[opp.id] = (s.oppList[opp.id] ?? 0) + 1;
    if (hostile(s, opp)) removeOneOpponent(s);
  }
}

export function verifyPublicOpplistDueToDeath(t: TacticalState, s: Soldier): void {
  if (s.ai.oppCount === 0) return;
  for (const opp of mercs(t)) {
    if (!validForSightings(opp) || s.team === opp.team) continue;
    let stillSeen = false;
    if (s.oppList[opp.id] === Opp.SEEN_CURRENTLY) {
      stillSeen = mercs(t).some((mate) => validForSightings(mate) && mate.team === s.team && mate.oppList[opp.id] === Opp.SEEN_CURRENTLY);
    }
    if (!stillSeen) {
      const table = t.perception.publicOpp[s.team];
      if (table) table[opp.id] = decayOppListValue(table[opp.id] ?? 0);
    }
  }
}

export function removeManAsTarget(t: TacticalState, s: Soldier): void {
  if (t.perception.lastMercToRadio[s.team] === s) t.perception.lastMercToRadio[s.team] = null;
  for (let team = 0; team < t.perception.publicOpp.length; team++) updatePublic(t, team, s, Opp.NOT_HEARD_OR_SEEN, -1);
  for (const opp of mercs(t)) {
    if (opp.oppList[s.id] === Opp.SEEN_CURRENTLY && !opp.neutral && hostile(opp, s)) removeOneOpponent(opp);
    updatePersonal(opp, s, Opp.NOT_HEARD_OR_SEEN, -1);
    t.turn.seenOpponents[opp.id * TOTAL_SOLDIERS + s.id] = 0;
  }
  for (const other of mercs(t)) {
    s.lastKnownOpp[other.id] = -1;
    const lastKnown = t.perception.publicLastKnown[s.team];
    if (lastKnown) lastKnown[other.id] = -1;
  }
}
