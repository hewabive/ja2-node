// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/OppList.cc ManSeesMan (new sighting of an OUR merc: civilian groups, Carmen, Eldin, the
// @src assassins, Angel, Joe and Elliot, Iggy, Kingpin goons, the hicks). See docs/25 §11.1.

import { civGroupHostility } from '../../strategic/narrative/civ-groups.ts';
import { Fact } from '../../strategic/narrative/fact-ids.ts';
import { worldSeconds } from '../explosions/state.ts';
import { stopMerc } from '../movement.ts';
import { Opp } from '../perception/opp.ts';
import { Attitude, CivilianGroup, NO_PROFILE, NOWHERE, Orders, type Soldier, Team } from '../soldier.ts';
import { sectorMapOf, type TacticalState } from '../state.ts';
import { enterCombatMode } from '../turns/turns.ts';
import { addToShouldBecomeHostileOrSayQuoteList, makeCivHostile } from './civ-hostility.ts';
import { ASSASSINS, BrothelRooms, CivGroupHostility, HicksCurfew, MuseumRooms, NpcRecord, Profile } from './constants.ts';

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_DAY = 1440;

const roomOf = (t: TacticalState, g: number) => sectorMapOf(t).rooms[g] ?? 0;

function groupWillTurn(t: TacticalState, s: Soldier): boolean {
  return s.civilianGroup !== CivilianGroup.NONE && civGroupHostility(t.civGroups, s.civilianGroup) >= CivGroupHostility.WILL_BECOME_HOSTILE;
}

function carriesItem(t: TacticalState, s: Soldier, name: string): boolean {
  const item = t.content.items.byName.get(name)?.index;
  return item !== undefined && s.inv.some((o) => o.item === item);
}

function eldinSees(t: TacticalState, s: Soldier, opp: Soldier): void {
  if (!s.neutral) return;
  const room = roomOf(t, opp.gridNo);
  const behindRopes = !t.narrative.fact(Fact.MUSEUM_OPEN) && room >= MuseumRooms.FIRST && room <= MuseumRooms.LAST;
  if (
    behindRopes ||
    t.narrative.fact(Fact.MUSEUM_ALARM_WENT_OFF) ||
    room === MuseumRooms.DISPLAY_A ||
    room === MuseumRooms.DISPLAY_B ||
    carriesItem(t, opp, 'CHALICE')
  ) {
    t.narrative.setFactTrue(Fact.MUSEUM_ALARM_WENT_OFF);
    addToShouldBecomeHostileOrSayQuoteList(t, s);
  }
}

function assassinSees(t: TacticalState, s: Soldier): void {
  if (s.ai.orders === Orders.SEEKENEMY) return;
  s.ai.orders = Orders.SEEKENEMY;
  if (s.ai.oppCount !== 0) return;
  t.turnHooks.cancelAIAction(t, s);
  t.turnHooks.setNewSituation(t, s);
}

function angelSees(t: TacticalState, s: Soldier, opp: Soldier): void {
  if (opp.profile === Profile.MARIA) {
    if (t.narrative.fact(Fact.MARIA_ESCORTED_AT_LEATHER_SHOP, Profile.MARIA))
      t.narrative.triggerNpcRecord(Profile.ANGEL, NpcRecord.ANGEL_RESCUED);
    return;
  }
  if (!t.narrative.fact(Fact.ANGEL_LEFT_DEED, Profile.ANGEL) || t.narrative.fact(Fact.ANGEL_MENTIONED_DEED, Profile.ANGEL)) return;
  t.turnHooks.cancelAIAction(t, s);
  s.absoluteFinalDestination = NOWHERE;
  stopMerc(t, s);
  t.narrative.triggerNpcRecord(Profile.ANGEL, NpcRecord.ANGEL_DEED);
}

function profiledCivilianSees(t: TacticalState, s: Soldier, opp: Soldier): void {
  if (s.neutral) {
    if (groupWillTurn(t, s)) {
      addToShouldBecomeHostileOrSayQuoteList(t, s);
      return;
    }
  } else if (t.narrative.hasUnusedHostileRecord(s.profile)) {
    addToShouldBecomeHostileOrSayQuoteList(t, s);
    return;
  }
  if (s.profile === Profile.CARMEN) {
    if (opp.profile === Profile.SLAY && s.neutral) {
      s.ai.attitude = Attitude.ATTACKSLAYONLY;
      t.narrative.triggerNpcRecord(Profile.CARMEN, NpcRecord.CARMEN_WAR);
    }
  } else if (s.profile === Profile.ELDIN) eldinSees(t, s, opp);
  else if (ASSASSINS.has(s.profile)) assassinSees(t, s);
  else if (s.profile === Profile.ANGEL) angelSees(t, s, opp);
  else if ((s.profile === Profile.JOE || s.profile === Profile.ELLIOT) && !t.narrative.inMeanwhile())
    t.narrative.firstSightingRecord(s.profile, NpcRecord.FIRST_SEEN);
}

function goHostileAndFight(t: TacticalState, s: Soldier): void {
  makeCivHostile(t, s);
  if (!t.inCombat) enterCombatMode(t, s.team);
}

function minuteOfDay(t: TacticalState): number {
  return Math.trunc(worldSeconds(t) / SECONDS_PER_MINUTE) % MINUTES_PER_DAY;
}

function unprofiledCivilianSees(t: TacticalState, s: Soldier, opp: Soldier): void {
  if (groupWillTurn(t, s) && s.neutral) addToShouldBecomeHostileOrSayQuoteList(t, s);
  else if (s.civilianGroup === CivilianGroup.KINGPIN) {
    if (opp.profile === Profile.MARIA) {
      goHostileAndFight(t, s);
      t.narrative.setFactTrue(Fact.MARIA_ESCAPE_NOTICED);
    } else if (roomOf(t, opp.gridNo) === BrothelRooms.GUARD_ROOM) goHostileAndFight(t, s);
  } else if (s.civilianGroup === CivilianGroup.HICKS && !t.narrative.fact(Fact.HICKS_MARRIED_PLAYER_MERC)) {
    const minute = minuteOfDay(t);
    if (minute < HicksCurfew.MORNING_MINUTE || minute > HicksCurfew.EVENING_MINUTE) goHostileAndFight(t, s);
  }
}

export function newSightingRules(t: TacticalState, s: Soldier, opp: Soldier): void {
  if (opp.team !== Team.OUR) return;
  if (s.profile !== NO_PROFILE) {
    if (s.team === Team.CIV) profiledCivilianSees(t, s, opp);
    else if (s.profile === Profile.IGGY && t.narrative.firstSightingRecord(Profile.IGGY, NpcRecord.IGGY_SEEN)) {
      const publicOpp = t.perception.publicOpp[Team.OUR];
      if (publicOpp) publicOpp[s.id] = Opp.HEARD_THIS_TURN;
    }
  } else if (s.team === Team.CIV) unprofiledCivilianSees(t, s, opp);
}
