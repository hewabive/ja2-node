// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc MakeCivHostile, SetSoldierNonNeutral, CivilianGroupMembersChangeSidesWithinProximity,
// @src CivilianGroupMemberChangesSides, CivilianGroupChangesSides, HickCowAttacked, MilitiaChangesSides,
// @src ProcessImplicationsOfPCAttack (civilian, militia, boxing and quest branches); OppList.cc AddToShouldBecomeHostileOrSayQuoteList,
// @src SelectSpeakerFromHostileOrSayQuoteList, CheckHostileOrSayQuoteList (dialogue gating, hostile quote flag, the AI pause and the
// @src speaker reveal); Handle_Doors.cc ProcessImplicationsOfPCMessingWithDoor; Overhead.cc HandleBrothelWallDestroyed.

import { ItemClass, NOTHING } from '../../../content/items/items.ts';
import { Direction, directionIncrement, pythSpacesAway } from '../../../content/world/grid.ts';
import { has, StructureFlags, type StructureInstance } from '../../../content/world/structures.ts';
import { civGroupHostility, setCivGroupHostility } from '../../strategic/narrative/civ-groups.ts';
import { Fact, Quest } from '../../strategic/narrative/fact-ids.ts';
import { QuestStatus } from '../../strategic/narrative/facts.ts';
import { pauseAiTemporarily, pauseAiUntilManuallyUnpaused, unPauseAi } from '../ai/pause.ts';
import { soldierToSoldierLos } from '../combat/positions.ts';
import { Opp } from '../perception/opp.ts';
import { handleSight, recalculateOppCntsDueToNoLongerNeutral } from '../perception/sight.ts';
import { AlertStatus, Body, CivilianGroup, NO_PROFILE, OKLIFE, Orders, Side, type Soldier, Team } from '../soldier.ts';
import { sectorMapOf, type TacticalState, teamMembers } from '../state.ts';
import { checkForPotentialAddToBattleIncrement, enterCombatMode } from '../turns/turns.ts';
import { boxingPlayerDisqualified, setBoxingState } from './boxing.ts';
import { BoxingState, boxingActive, boxingFight, Disqualification } from './boxing-state.ts';
import {
  BOXING_SECTOR,
  BROTHEL_SECTOR,
  BrothelRooms,
  CivGroupHostility,
  HICKS_FARM_SECTOR,
  KINGPIN_DOOR_GRIDNOS,
  Profile,
  REBEL_SYMPATHIZERS,
  TIXA_SECTOR,
  WARDEN_ALERT_RADIUS,
} from './constants.ts';

const MAX_DISTANCE_VISIBLE = 26;
const NO_ROOM = 0;
const isVehicle = (s: Soldier) => s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP;
const ProfileMiscFlag3 = { TOWN_DOESNT_CARE_ABOUT_DEATH: 0x40 } as const;
const ProfileMiscFlag2 = { NEEDS_TO_SAY_HOSTILE_QUOTE: 0x10 } as const;
const AGGRESSIVE_ATTITUDE = 5;
const VISIBLE = 1;
const SIGHT_LOOK_AND_RADIO = 3;

const inSector = (t: TacticalState, sector: { readonly x: number; readonly y: number }) =>
  t.sector !== null && t.sector.x === sector.x && t.sector.y === sector.y && t.sector.z === 0;

function findByProfile(t: TacticalState, profile: number): Soldier | null {
  return t.soldiers.find((s) => s?.placed && s.profile === profile) ?? null;
}

function mariaQuestActive(t: TacticalState): boolean {
  const status = t.narrative.questStatus(Quest.RESCUE_MARIA);
  return status === QuestStatus.IN_PROGRESS || status === QuestStatus.DONE;
}

function hostileSideFor(t: TacticalState, s: Soldier): number {
  if (REBEL_SYMPATHIZERS.has(s.profile)) return Side.HOSTILE;
  if (s.profile === Profile.MARIA || s.profile === Profile.ANGEL) return mariaQuestActive(t) ? Side.HOSTILE : Side.ENEMY;
  return s.civilianGroup === CivilianGroup.REBEL ? Side.HOSTILE : Side.ENEMY;
}

export function setSoldierNonNeutral(s: Soldier): void {
  s.neutral = false;
}

export function makeCivHostile(t: TacticalState, s: Soldier): void {
  if (s.bodyType === Body.COW) return;
  const side = hostileSideFor(t, s);
  if (!s.neutral && side === s.side) return;
  let hostile = s;
  if (s.profile === Profile.CONRAD || s.profile === Profile.GENERAL) {
    setSoldierNonNeutral(s);
    s.side = side;
    hostile = t.narrative.changeSoldierTeam(s, Team.ENEMY) ?? s;
  } else {
    if (
      s.civilianGroup === CivilianGroup.KINGPIN &&
      t.narrative.questStatus(Quest.RESCUE_MARIA) === QuestStatus.IN_PROGRESS &&
      !boxingActive(t) &&
      findByProfile(t, Profile.MARIA) !== null
    )
      t.narrative.setFactTrue(Fact.MARIA_ESCAPE_NOTICED);
    if (s.profile === Profile.BILLY) s.ai.orders = Orders.FARPATROL;
    if (s.neutral) {
      setSoldierNonNeutral(s);
      recalculateOppCntsDueToNoLongerNeutral(t, s);
    }
  }
  if (t.inCombat) checkForPotentialAddToBattleIncrement(t, hostile);
}

export function addToShouldBecomeHostileOrSayQuoteList(t: TacticalState, s: Soldier): void {
  if (s.life < OKLIFE) return;
  if (!t.hostileQuoteList.includes(s)) t.hostileQuoteList.push(s);
}

function markNeedsToSayHostileQuote(t: TacticalState, profile: number, on: boolean): void {
  const p = t.profiles.get(profile);
  if (!p) return;
  if (on) p.miscFlags2 |= ProfileMiscFlag2.NEEDS_TO_SAY_HOSTILE_QUOTE;
  else p.miscFlags2 &= ~ProfileMiscFlag2.NEEDS_TO_SAY_HOSTILE_QUOTE;
}

function selectSpeaker(t: TacticalState): Soldier | null {
  const speakers: Soldier[] = [];
  for (const s of t.hostileQuoteList) {
    if (s.profile === NO_PROFILE) continue;
    markNeedsToSayHostileQuote(t, s.profile, true);
    if (t.narrative.hasUnusedHostileRecord(s.profile)) speakers.push(s);
    else markNeedsToSayHostileQuote(t, s.profile, false);
  }
  return speakers.length === 0 ? null : (speakers[t.rng.int(speakers.length)] ?? null);
}

function revealSpeaker(t: TacticalState, speaker: Soldier): void {
  if (speaker.visible === VISIBLE) return;
  const publicOpp = t.perception.publicOpp[Team.OUR];
  if (publicOpp) publicOpp[speaker.id] = Opp.HEARD_THIS_TURN;
  handleSight(t, speaker, SIGHT_LOOK_AND_RADIO);
}

export function checkHostileOrSayQuoteList(t: TacticalState): void {
  if (t.hostileQuoteList.length === 0 || t.narrative.dialogueBusy()) return;
  const speaker = selectSpeaker(t);
  if (speaker) {
    pauseAiUntilManuallyUnpaused(t);
    revealSpeaker(t, speaker);
    t.narrative.sayHostileQuote(speaker);
    return;
  }
  for (const s of t.hostileQuoteList) {
    if (!s.neutral) continue;
    makeCivHostile(t, s);
    const group = s.civilianGroup;
    if (
      s.team === Team.CIV &&
      group !== CivilianGroup.NONE &&
      civGroupHostility(t.civGroups, group) === CivGroupHostility.WILL_BECOME_HOSTILE
    )
      setCivGroupHostility(t.civGroups, group, CivGroupHostility.HOSTILE);
  }
  unPauseAi(t);
  t.hostileQuoteList.length = 0;
  if (!t.inCombat) enterCombatMode(t, Team.CIV);
}

function seesOrNear(s: Soldier, attacked: Soldier): boolean {
  const attacker = attacked.attacker;
  return (
    (attacker !== null && s.oppList[attacker.id] === Opp.SEEN_CURRENTLY) ||
    pythSpacesAway(s.gridNo, attacked.gridNo) < MAX_DISTANCE_VISIBLE ||
    (attacker !== null && pythSpacesAway(s.gridNo, attacker.gridNo) < MAX_DISTANCE_VISIBLE)
  );
}

export function civilianGroupMembersChangeSidesWithinProximity(t: TacticalState, attacked: Soldier): number {
  if (attacked.civilianGroup === CivilianGroup.NONE) return attacked.profile;
  let first: number = NO_PROFILE;
  for (const s of teamMembers(t, Team.CIV)) {
    if (s.life === 0 || !s.neutral || s.civilianGroup !== attacked.civilianGroup || s.bodyType === Body.COW) continue;
    if (!seesOrNear(s, attacked)) continue;
    makeCivHostile(t, s);
    if (s.ai.oppCount > 0) addToShouldBecomeHostileOrSayQuoteList(t, s);
    if (s.profile !== NO_PROFILE && s.ai.oppCount > 0 && (first === NO_PROFILE || t.rng.int(2))) first = s.profile;
  }
  return first;
}

export function civilianGroupMemberChangesSides(t: TacticalState, attacked: Soldier): Soldier {
  if (attacked.civilianGroup === CivilianGroup.NONE) return attacked;
  let first: number = NO_PROFILE;
  let newAttacked = attacked;
  for (const s of teamMembers(t, Team.OUR)) {
    if (s.life === 0 || s.civilianGroup !== attacked.civilianGroup) continue;
    if (s.profile !== NO_PROFILE && (first === NO_PROFILE || t.rng.int(2))) first = s.profile;
    const fresh = t.narrative.changeSoldierTeam(s, Team.CIV);
    if (fresh && s === attacked) newAttacked = fresh;
  }
  civilianGroupMembersChangeSidesWithinProximity(t, newAttacked);
  const group = newAttacked.civilianGroup;
  if (civGroupHostility(t.civGroups, group) === CivGroupHostility.NEUTRAL) {
    if (group === CivilianGroup.REBEL) t.narrative.rebelsBetrayed();
    t.narrative.civGroupWillBecomeHostile(group);
    setCivGroupHostility(t.civGroups, group, CivGroupHostility.WILL_EVENTUALLY_BECOME_HOSTILE);
  }
  return newAttacked;
}

export function civilianGroupChangesSides(t: TacticalState, group: number): void {
  setCivGroupHostility(t.civGroups, group, CivGroupHostility.HOSTILE);
  for (const s of teamMembers(t, Team.CIV)) {
    if (s.life === 0 || !s.neutral || s.civilianGroup !== group || s.bodyType === Body.COW) continue;
    makeCivHostile(t, s);
    if (s.ai.oppCount > 0) addToShouldBecomeHostileOrSayQuoteList(t, s);
  }
}

function hickCowAttacked(t: TacticalState, nasty: Soldier): void {
  for (const s of teamMembers(t, Team.CIV)) {
    if (s.life === 0 || !s.neutral || s.civilianGroup !== CivilianGroup.HICKS) continue;
    if (soldierToSoldierLos(t, s, nasty, MAX_DISTANCE_VISIBLE, true) !== 0) {
      civilianGroupMemberChangesSides(t, s);
      return;
    }
  }
}

export function militiaChangesSides(t: TacticalState): void {
  for (const m of teamMembers(t, Team.MILITIA)) {
    if (m.life === 0) continue;
    makeCivHostile(t, m);
    recalculateOppCntsDueToNoLongerNeutral(t, m);
  }
}

function townCaresAboutDeath(t: TacticalState, s: Soldier): boolean {
  if (s.profile === NO_PROFILE) return true;
  const flags = t.profiles.get(s.profile)?.miscFlags3 ?? 0;
  return (flags & ProfileMiscFlag3.TOWN_DOESNT_CARE_ABOUT_DEATH) === 0;
}

function neutralCivilianAttacked(t: TacticalState, attacker: Soldier, target: Soldier): void {
  if (target.bodyType === Body.COW && inSector(t, HICKS_FARM_SECTOR)) {
    hickCowAttacked(t, attacker);
    return;
  }
  if (
    target.profile === Profile.PABLO &&
    target.life >= OKLIFE &&
    t.narrative.fact(Fact.PABLO_PUNISHED_BY_PLAYER) &&
    !t.narrative.fact(Fact.FACT_38)
  ) {
    t.narrative.triggerNpcRecord(Profile.PABLO, 3);
    return;
  }
  addToShouldBecomeHostileOrSayQuoteList(t, target);
  if (townCaresAboutDeath(t, target)) militiaChangesSides(t);
}

function fairBlow(t: TacticalState, attacker: Soldier): boolean {
  const weapon = attacker.attackingWeapon;
  const brassKnuckles = t.content.items.byName.get('BRASS_KNUCKLES')?.index;
  return attacker.boxer && (weapon === NOTHING || weapon === brassKnuckles);
}

function cheatingInTheRing(t: TacticalState, attacker: Soldier, target: Soldier): void {
  if (fairBlow(t, attacker)) return;
  const itemClass = t.content.items.byIndex.get(attacker.attackingWeapon)?.itemClass ?? ItemClass.NONE;
  if (itemClass & (ItemClass.BLADE | ItemClass.PUNCH) && target.boxer) {
    boxingPlayerDisqualified(t, attacker, Disqualification.BAD_ATTACK);
    return;
  }
  setBoxingState(t, BoxingState.NOT_BOXING);
  if (target.team === Team.CIV && target.boxer) t.narrative.setSoldierNeutral(target);
}

export function processImplicationsOfPCAttack(t: TacticalState, attacker: Soldier, target: Soldier): boolean {
  target.ai.asleep = false;
  if (target.profile === Profile.PABLO && t.narrative.fact(Fact.PLAYER_FOUND_ITEMS_MISSING))
    t.narrative.setFactTrue(Fact.PABLO_PUNISHED_BY_PLAYER);
  if (boxingFight(t)) cheatingInTheRing(t, attacker, target);
  if (target.team === Team.MILITIA && target.side === Side.FRIENDLY) militiaChangesSides(t);
  else if (
    target.team === Team.CIV &&
    target.neutral &&
    target.profile === Profile.SLAY &&
    target.life >= OKLIFE &&
    !t.narrative.fact(Fact.FACT_155)
  )
    t.narrative.triggerNpcRecord(Profile.SLAY, 1);
  else if (target.team === Team.CIV && target.civilianGroup === CivilianGroup.NONE && target.neutral && !isVehicle(target))
    neutralCivilianAttacked(t, attacker, target);
  else {
    if (target.profile === Profile.CARMEN && attacker.profile !== Profile.SLAY) target.ai.attitude = AGGRESSIVE_ATTITUDE;
    if (target.civilianGroup !== CivilianGroup.NONE && (target.team === Team.OUR || target.neutral)) {
      civilianGroupMemberChangesSides(t, target);
      if (target.profile !== NO_PROFILE && target.life >= OKLIFE && target.visible === VISIBLE) {
        pauseAiTemporarily(t);
        addToShouldBecomeHostileOrSayQuoteList(t, target);
      }
    } else if (target.civilianGroup !== CivilianGroup.NONE && !target.boxer) civilianGroupMembersChangeSidesWithinProximity(t, target);
    else if (target.team === Team.OUR && !t.inCombat) return false;
  }
  return true;
}

function inBrothel(t: TacticalState, room: number): boolean {
  return inSector(t, BROTHEL_SECTOR) && room >= BrothelRooms.FIRST && room <= BrothelRooms.LAST;
}

export function inBrothelGuardRoom(t: TacticalState, gridNo: number): boolean {
  return inSector(t, BROTHEL_SECTOR) && sectorMapOf(t).rooms[gridNo] === BrothelRooms.GUARD_ROOM;
}

function roomBesideWall(t: TacticalState, gridNo: number): number {
  const rooms = sectorMapOf(t).rooms;
  for (const g of [gridNo, gridNo + directionIncrement(Direction.SOUTH), gridNo + directionIncrement(Direction.EAST)]) {
    const room = rooms[g] ?? NO_ROOM;
    if (room !== NO_ROOM) return room;
  }
  return NO_ROOM;
}

export function handleBrothelWallDestroyed(t: TacticalState, gridNo: number, s: StructureInstance, destroyed: boolean): void {
  if (!inSector(t, BROTHEL_SECTOR) || !has(s.flags, StructureFlags.WALLSTUFF) || !destroyed) return;
  const room = roomBesideWall(t, gridNo);
  if (room !== NO_ROOM && inBrothel(t, room)) civilianGroupChangesSides(t, CivilianGroup.KINGPIN);
}

export function processImplicationsOfPCMessingWithDoor(t: TacticalState, s: Soldier): void {
  const room = sectorMapOf(t).rooms[s.gridNo] ?? 0;
  if (inBrothel(t, room) || (inSector(t, BOXING_SECTOR) && KINGPIN_DOOR_GRIDNOS.has(s.gridNo))) {
    for (const goon of teamMembers(t, Team.CIV)) {
      if (goon.civilianGroup !== CivilianGroup.KINGPIN || goon.life < OKLIFE || goon.oppList[s.id] !== Opp.SEEN_CURRENTLY) continue;
      makeCivHostile(t, goon);
      if (!t.inCombat) enterCombatMode(t, goon.team);
    }
  }
  if (inSector(t, TIXA_SECTOR)) {
    const warden = findByProfile(t, Profile.WARDEN);
    if (warden && warden.ai.alertStatus < AlertStatus.RED && pythSpacesAway(s.gridNo, warden.gridNo) <= WARDEN_ALERT_RADIUS) {
      warden.ai.alertStatus = AlertStatus.RED;
      t.turnHooks.checkForChangingOrders(t, warden);
      t.turnHooks.cancelAIAction(t, warden);
    }
  }
}
