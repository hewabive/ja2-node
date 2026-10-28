// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc HandleAtNewGridNo (escorts arriving: Skyrider at his chopper, John and Mary at the Drassen
// @src airport, Maria at the leather shop, Joey near Martha), HandleMaryArrival, HandleJohnArrival; TacticalAI/AIUtils.cc
// @src ClosestPC (with the distance); Strategic/Quests.cc NPCInRoom.

import { pythSpacesAway } from '../../../content/world/grid.ts';
import { Fact, Quest } from '../../strategic/narrative/fact-ids.ts';
import { QuestStatus } from '../../strategic/narrative/facts.ts';
import { roomAt } from '../ai/destinations.ts';
import { stopMerc } from '../movement.ts';
import { Opp } from '../perception/opp.ts';
import { NOWHERE, OKLIFE, type Soldier, Team } from '../soldier.ts';
import { type SectorRef, type TacticalState, teamMembers } from '../state.ts';
import { Profile } from './constants.ts';

export const DRASSEN_AIRPORT: SectorRef = { x: 13, y: 2, z: 0 };
const SAN_MONA_LEATHER_SHOP_SECTOR: SectorRef = { x: 6, y: 3, z: 0 };
const CAMBRIA: SectorRef = { x: 8, y: 7, z: 0 };
export const CHOPPER_GRIDNO = 8842;
export const TOURISTS_PLANE_GRIDNO = 8228;
const CHOPPER_RADIUS = 11;
const PLANE_RADIUS = 40;
const NPC_TALK_RADIUS = 4;
const CLOSEST_PC_LIMIT = NPC_TALK_RADIUS * 2;
const TOURIST_PAIR_LIMIT = 8;
const LEATHER_SHOP_ROOM = 2;
const UNSEEN_PC_PENALTY = 10;
const WORLD_MAX_DISTANCE = 25600;
const Record = { SKYRIDER_AT_CHOPPER: 15, JOHN_ALONE: 12, TOURISTS_AT_PLANE: 13, ANGEL_SEES_MARIA: 12, JOEY_AT_MARTHA: 10 } as const;
const NO_FACT_PROFILE = 0;

function inSector(t: TacticalState, sector: SectorRef): boolean {
  const s = t.sector;
  return s !== null && s.x === sector.x && s.y === sector.y && s.z === sector.z;
}

function onPlayerTeam(t: TacticalState, profile: number): Soldier | null {
  return teamMembers(t, Team.OUR).find((s) => s.profile === profile) ?? null;
}

function byProfile(t: TacticalState, profile: number): Soldier | null {
  return t.soldiers.find((s): s is Soldier => s?.placed === true && s.profile === profile) ?? null;
}

function closestPcDistance(t: TacticalState, s: Soldier): number | null {
  let best = WORLD_MAX_DISTANCE;
  let found = false;
  for (const m of teamMembers(t, Team.OUR)) {
    if (m.life < OKLIFE || t.narrative.isEpc(m)) continue;
    let d = pythSpacesAway(s.gridNo, m.gridNo);
    if (m.team !== s.team && s.oppList[m.id] !== Opp.SEEN_CURRENTLY) d += UNSEEN_PC_PENALTY;
    if (d < best) {
      best = d;
      found = true;
    }
  }
  return found ? best : null;
}

function nearThePlane(t: TacticalState, s: Soldier): boolean {
  if (pythSpacesAway(s.gridNo, TOURISTS_PLANE_GRIDNO) >= PLANE_RADIUS) return false;
  const d = closestPcDistance(t, s);
  return d === null || d <= CLOSEST_PC_LIMIT;
}

function handleMaryArrival(t: TacticalState, given: Soldier | null): void {
  const mary = given ?? onPlayerTeam(t, Profile.MARY);
  if (!mary || t.narrative.fact(Fact.JOHN_ALIVE, NO_FACT_PROFILE) || !nearThePlane(t, mary)) return;
  t.narrative.setFactTrue(Fact.MARY_OR_JOHN_ARRIVED);
  stopMerc(t, mary);
  t.narrative.triggerNpcRecord(Profile.MARY, Record.TOURISTS_AT_PLANE);
}

function handleJohnArrival(t: TacticalState, given: Soldier | null): void {
  const john = given ?? onPlayerTeam(t, Profile.JOHN);
  if (!john || !nearThePlane(t, john)) return;
  const mary = t.narrative.fact(Fact.MARY_ALIVE, NO_FACT_PROFILE) ? byProfile(t, Profile.MARY) : null;
  if (mary && pythSpacesAway(john.gridNo, mary.gridNo) > TOURIST_PAIR_LIMIT) return;
  t.narrative.setFactTrue(Fact.MARY_OR_JOHN_ARRIVED);
  stopMerc(t, john);
  if (mary) {
    stopMerc(t, mary);
    t.narrative.triggerNpcRecord(Profile.JOHN, Record.TOURISTS_AT_PLANE);
  } else t.narrative.triggerNpcRecord(Profile.JOHN, Record.JOHN_ALONE);
}

function handleSkyriderArrival(t: TacticalState, s: Soldier): void {
  if (pythSpacesAway(s.gridNo, CHOPPER_GRIDNO) >= CHOPPER_RADIUS) return;
  stopMerc(t, s);
  t.narrative.setFactTrue(Fact.SKYRIDER_CLOSE_TO_CHOPPER);
  t.narrative.triggerNpcRecord(Profile.SKYRIDER, Record.SKYRIDER_AT_CHOPPER);
  t.narrative.setUpHelicopterForPlayer(DRASSEN_AIRPORT);
}

function npcInRoom(t: TacticalState, profile: number, room: number): boolean {
  const s = byProfile(t, profile);
  return s !== null && s.gridNo !== NOWHERE && roomAt(t, s.gridNo) === room;
}

function handleEscortedArrival(t: TacticalState, s: Soldier): void {
  if (inSector(t, DRASSEN_AIRPORT)) {
    if (s.profile === Profile.SKYRIDER) handleSkyriderArrival(t, s);
    else if (s.profile === Profile.MARY) handleMaryArrival(t, s);
    else if (s.profile === Profile.JOHN) handleJohnArrival(t, s);
  } else if (
    s.profile === Profile.MARIA &&
    inSector(t, SAN_MONA_LEATHER_SHOP_SECTOR) &&
    t.narrative.fact(Fact.MARIA_ESCORTED_AT_LEATHER_SHOP, Profile.MARIA)
  ) {
    if (npcInRoom(t, Profile.ANGEL, LEATHER_SHOP_ROOM)) t.narrative.triggerNpcRecord(Profile.ANGEL, Record.ANGEL_SEES_MARIA);
  } else if (s.profile === Profile.JOEY && inSector(t, CAMBRIA) && t.narrative.fact(Fact.JOEY_NEAR_MARTHA, NO_FACT_PROFILE)) {
    stopMerc(t, s);
    t.narrative.triggerNpcRecord(Profile.JOEY, Record.JOEY_AT_MARTHA);
  }
}

export function handleEscortArrival(t: TacticalState, s: Soldier): void {
  if (s.team !== Team.OUR) return;
  if (t.narrative.isEpc(s)) {
    handleEscortedArrival(t, s);
    return;
  }
  if (t.narrative.questStatus(Quest.ESCORT_TOURISTS) !== QuestStatus.IN_PROGRESS || !inSector(t, DRASSEN_AIRPORT)) return;
  if (t.narrative.fact(Fact.JOHN_ALIVE, NO_FACT_PROFILE)) handleJohnArrival(t, null);
  else handleMaryArrival(t, null);
}
