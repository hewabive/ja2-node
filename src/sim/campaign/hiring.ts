// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Merc_Hiring.cc HireMerc, MercArrivesCallback; Strategic/Map_Screen_Interface.cc
// @src HandleTimeCompressWithTeamJackedInAndGearedToGo; GameScreen.cc InitHelicopterEntranceByMercs. See docs/15 §4.5.

import type { MercProfile } from '../../content/formats/prof.ts';
import { type Sector, sectorFromId } from '../../content/strategic/sector-ids.ts';
import { createItem } from '../items/object.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import { InsertionCode } from '../strategic/forces/constants.ts';
import { addCharacterToAnySquad } from '../strategic/forces/squads.ts';
import { CompressMode, EventKind, FIRST_ARRIVAL_DELAY, NUM_SEC_IN_MIN, STARTING_TIME, Warp } from '../strategic/time/constants.ts';
import { addStrategicEvent } from '../strategic/time/event-queue.ts';
import { setGameTimeCompressionLevel, stopTimeCompression, warpGameTime } from '../strategic/time/world-clock.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { createMercFromProfile } from '../tactical/creation.ts';
import { autoPlaceObject } from '../tactical/inventory.ts';
import { firstFreeSoldierId, type Soldier, Team } from '../tactical/soldier.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { MercKind, type Roster, RosterMerc } from './roster.ts';

const MAX_MERCS_ON_TEAM = 18;
const FIRST_ARRIVAL_MINUTE = (STARTING_TIME + FIRST_ARRIVAL_DELAY) / NUM_SEC_IN_MIN;
const NO_PREVIOUS_SECTOR = 255;
const NO_VEHICLE = -1;
const DEFAULT_DIRECTION = 4;
const LETTER = 'LETTER';
const LETTER_STATUS = 100;

export interface HireOptions {
  readonly content: TacticalContent;
  readonly gunNut: boolean;
}

export interface Recruit {
  readonly soldier: Soldier;
  readonly profile: MercProfile | null;
}

export function profileRecruit(profile: MercProfile, options: HireOptions): (id: number) => Recruit {
  return (id) => ({
    soldier: createMercFromProfile(
      { content: options.content, options: { gunNut: options.gunNut, bloodAndGore: true } },
      id,
      profile,
      DEFAULT_DIRECTION,
    ),
    profile,
  });
}

export function hireMerc(
  campaign: CampaignSim,
  roster: Roster,
  recruit: (id: number) => Recruit,
  content: TacticalContent,
): RosterMerc | string {
  if (roster.all().length >= MAX_MERCS_ON_TEAM) return 'the team is full';
  const strategic = campaign.strategic;
  if (!strategic) return 'the campaign has no strategic layer';
  const id = firstFreeSoldierId((n) => roster.get(n) !== undefined, Team.OUR);
  if (id < 0) return 'no free soldier slot';
  const { soldier, profile } = recruit(id);
  const s = campaign.state;
  const arrival = s.didGameJustStart ? FIRST_ARRIVAL_MINUTE : 0;
  const merc = new RosterMerc({
    soldier,
    profile,
    kind: MercKind.AIM_MERC,
    statusFlags: 0,
    sector: sectorFromId(strategic.content.policy.startSector),
    betweenSectors: false,
    groupId: 0,
    prevSectorId: NO_PREVIOUS_SECTOR,
    insertionCode: s.didGameJustStart ? InsertionCode.CHOPPER : InsertionCode.NORTH,
    insertionDirection: 0,
    path: [],
    assignment: Assignment.IN_TRANSIT,
    vehicleId: NO_VEHICLE,
    asleep: false,
  });
  if (s.didGameJustStart && id === 0) giveLetter(content, merc);
  roster.add(merc);
  s.atLeastOneMercHired = true;
  if (arrival) addStrategicEvent(s.queue, EventKind.DELAYED_HIRING_OF_MERC, arrival, id);
  return merc;
}

function giveLetter(content: TacticalContent, merc: RosterMerc): void {
  const letter = content.items.byName.get(LETTER);
  if (!letter) return;
  const ctx = { items: content.items, inCombat: false, actionPoints: () => 0, spendActionPoints: () => {}, dropAtFeet: () => {} };
  autoPlaceObject(ctx, merc.soldier, createItem(content.items, letter.index, LETTER_STATUS));
}

export function mercArrives(campaign: CampaignSim, id: number): void {
  const strategic = campaign.strategic;
  const merc = strategic?.mercs.get(id);
  if (!merc || !strategic) return;
  stopTimeCompression(campaign.clockContext);
  addCharacterToAnySquad(strategic, id);
  const world = campaign.state.worldSector;
  if (world && sameSector(world, merc.sector)) strategic.mercs.updateMercInSector(id, merc.sector);
  else merc.insertionCode = InsertionCode.NORTH;
}

function sameSector(a: Sector, b: Sector): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export function teamJackedInAndGearedToGo(campaign: CampaignSim, loadStartSector: () => void): void {
  const s = campaign.state;
  if (!s.didGameJustStart || (campaign.strategic?.mercs.all().length ?? 0) === 0) return;
  loadStartSector();
  warpGameTime(campaign.clockContext, FIRST_ARRIVAL_DELAY, Warp.NORMAL);
  s.didGameJustStart = false;
  if (s.flow === 'tactical') setGameTimeCompressionLevel(campaign.clockContext, CompressMode.X1);
}
