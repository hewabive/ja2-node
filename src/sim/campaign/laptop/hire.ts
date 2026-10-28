// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Merc_Hiring.cc HireMerc, CreateSpecialItem, MercArrivesCallback, CheckForValidArrivalSector,
// @src StrategicPythSpacesAway, UpdateAnyInTransitMercsWithGlobalArrivalSector; Tactical/Overhead.cc NumberOfMercsOnPlayerTeam;
// @src Strategic/MapScreen.cc (moving the bullseye); Strategic/StrategicMap.cc HandleAirspaceControlUpdated.

import type { MercProfile } from '../../../content/formats/prof.ts';
import { MAP_SIDE, type Sector, sectorFromId, sectorId, sectorShortString, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { createItem } from '../../items/object.ts';
import { Assignment } from '../../strategic/economy/constants.ts';
import { InsertionCode } from '../../strategic/forces/constants.ts';
import { Traversability } from '../../strategic/map/sectors.ts';
import { EventKind } from '../../strategic/time/constants.ts';
import { addStrategicEvent } from '../../strategic/time/event-queue.ts';
import { createHiredMerc } from '../../tactical/creation.ts';
import { autoPlaceObject, InvSlot } from '../../tactical/inventory.ts';
import { MercStatus } from '../../tactical/profiles.ts';
import { firstFreeSoldierId, NO_PROFILE, type Soldier, SoldierStatusFlags, Team } from '../../tactical/soldier.ts';
import { createMercRecord } from '../merc-record.ts';
import { MercKind, RosterMerc } from '../roster.ts';
import type { LaptopContext } from './context.ts';
import { removeNewlyHiredMercFromPersonnelDepartedList } from './records.ts';

export const MAX_MERCS_ON_TEAM = 18;
const NO_PREVIOUS_SECTOR = 255;
const NO_VEHICLE = -1;
const DEFAULT_DIRECTION = 4;
const LETTER = 'LETTER';
const SPECIAL_ITEM_STATUS = 100;
const HIRE_STATUSES: ReadonlySet<number> = new Set([
  MercStatus.OK,
  MercStatus.ANNOYED_BUT_CAN_STILL_CONTACT,
  MercStatus.HIRED_BUT_NOT_ARRIVED_YET,
]);
const ARRIVAL_SEARCH_RADIUS = 4;
const STRATEGIC_INDEX_LIMIT = (MAP_SIDE + 2 - 1) * (MAP_SIDE + 2 - 1);
const STRATEGIC_ROW = MAP_SIDE + 2;
const NO_RANGE = 999999;
const THROUGH_STRATEGIC_MOVE = 4;

export interface Recruit {
  readonly soldier: Soldier;
  readonly profile: MercProfile | null;
}

export interface HireStruct {
  readonly profile: number;
  readonly kind: number;
  readonly length: number;
  readonly copyItems: boolean;
  readonly insertion: number;
  readonly useLandingZone: boolean;
  readonly recruit?: (id: number) => Recruit;
}

export type HireOutcome = { readonly merc: RosterMerc; readonly arrival: number } | 'failed' | 'teamFull';

export interface HireHooks {
  hireContract(merc: RosterMerc, length: number): number;
}

export function numberOfMercsOnPlayerTeam(ctx: Pick<LaptopContext, 'roster'>): number {
  return ctx.roster.all().filter((m) => !(m.statusFlags & SoldierStatusFlags.VEHICLE)).length;
}

function landingZone(ctx: LaptopContext): Sector {
  return sectorFromId(ctx.laptop.mercArriveSector);
}

function createSoldier(ctx: LaptopContext, h: HireStruct, id: number): Recruit | null {
  if (h.recruit) return h.recruit(id);
  const record = ctx.profileRecord(h.profile);
  const progress = ctx.profile(h.profile);
  if (!record || !progress) return null;
  const soldier = createHiredMerc({ content: ctx.tactical, rng: ctx.rng.main }, id, record, progress, h.copyItems, DEFAULT_DIRECTION);
  if (h.copyItems) progress.optionalGearCost = 0;
  return { soldier, profile: record };
}

function createSpecialItem(ctx: LaptopContext, s: Soldier, name: string): void {
  const def = ctx.tactical.items.byName.get(name);
  if (!def) return;
  const o = createItem(ctx.tactical.items, def.index, SPECIAL_ITEM_STATUS);
  const inv = { items: ctx.tactical.items, inCombat: false, actionPoints: () => 0, spendActionPoints: () => {}, dropAtFeet: () => {} };
  if (!autoPlaceObject(inv, s, o)) s.inv[InvSlot.SMALLPOCK8] = o;
}

export function hireMercCore(ctx: LaptopContext, h: HireStruct, hooks: HireHooks): HireOutcome {
  const p = h.profile === NO_PROFILE ? null : ctx.profile(h.profile);
  if (p && !HIRE_STATUSES.has(p.mercStatus)) return 'failed';
  if (numberOfMercsOnPlayerTeam(ctx) >= MAX_MERCS_ON_TEAM) return 'teamFull';
  const id = firstFreeSoldierId((n) => ctx.roster.get(n) !== undefined, Team.OUR);
  if (id < 0) return 'teamFull';
  const recruit = createSoldier(ctx, h, id);
  if (!recruit) return 'failed';
  const s = ctx.state;
  let insertion = h.insertion;
  if (s.didGameJustStart) {
    if (id === 0) createSpecialItem(ctx, recruit.soldier, LETTER);
    insertion = InsertionCode.CHOPPER;
  }
  const merc = new RosterMerc(
    createMercRecord({
      soldier: recruit.soldier,
      profile: recruit.profile,
      kind: h.kind,
      statusFlags: 0,
      sector: landingZone(ctx),
      betweenSectors: false,
      groupId: 0,
      prevSectorId: NO_PREVIOUS_SECTOR,
      insertionCode: insertion,
      insertionDirection: 0,
      path: [],
      assignment: Assignment.IN_TRANSIT,
      vehicleId: NO_VEHICLE,
      asleep: false,
      contract: { useLandingZone: h.useLandingZone },
    }),
  );
  merc.lastAssignmentChangeMin = ctx.now();
  ctx.roster.add(merc);
  const arrival = hooks.hireContract(merc, h.length);
  ctx.laptop.lastHiredMerc.profile = h.profile;
  ctx.laptop.lastHiredMerc.arrival = arrival;
  if (arrival !== 0) addStrategicEvent(s.queue, EventKind.DELAYED_HIRING_OF_MERC, arrival, id);
  if (h.profile !== NO_PROFILE) removeNewlyHiredMercFromPersonnelDepartedList(ctx.laptop, h.profile);
  s.atLeastOneMercHired = true;
  return { merc, arrival };
}

export function updateAnyInTransitMercsWithGlobalArrivalSector(ctx: LaptopContext): void {
  const zone = landingZone(ctx);
  for (const m of ctx.team()) if (m.assignment === Assignment.IN_TRANSIT && m.contract.useLandingZone) m.sector = zone;
}

function enemyControlled(ctx: LaptopContext, index: number): boolean {
  return ctx.state.map.elements[index]?.enemyControlled === true;
}

function enemyAirControlled(ctx: LaptopContext, index: number): boolean {
  return ctx.state.map.elements[index]?.enemyAirControlled === true;
}

export function checkForValidArrivalSector(ctx: LaptopContext): void {
  const zone = landingZone(ctx);
  const origin = strategicIndex(zone);
  if (!enemyControlled(ctx, origin)) return;
  let best: { readonly dx: number; readonly dy: number } | null = null;
  let lowest = NO_RANGE;
  for (let dy = -ARRIVAL_SEARCH_RADIUS; dy <= ARRIVAL_SEARCH_RADIUS; dy++) {
    const leftmost = Math.trunc((origin + STRATEGIC_ROW * dy) / STRATEGIC_ROW) * STRATEGIC_ROW;
    for (let dx = -ARRIVAL_SEARCH_RADIUS; dx <= ARRIVAL_SEARCH_RADIUS; dx++) {
      const index = origin + STRATEGIC_ROW * dy + dx;
      if (index < 1 || index >= STRATEGIC_INDEX_LIMIT || index < leftmost || index >= leftmost + STRATEGIC_ROW) continue;
      if (enemyControlled(ctx, index) || enemyAirControlled(ctx, index)) continue;
      const range = Math.trunc(Math.hypot(dx, dy));
      if (range < lowest) {
        best = { dx, dy };
        lowest = range;
      }
    }
  }
  if (!best) return;
  const to = { x: zone.x + best.dx, y: zone.y + best.dy };
  ctx.laptop.mercArriveSector = sectorId(to);
  updateAnyInTransitMercsWithGlobalArrivalSector(ctx);
  ctx.emit({ type: 'arrivalRerouted', from: sectorShortString(zone), to: sectorShortString(to) });
}

export type LandingZoneRefusal = 'beforeFirstLanding' | 'badSector' | 'groundBarrier' | 'enemyAirspace';

export function landingZoneRefusal(ctx: LaptopContext, sector: Sector): LandingZoneRefusal | null {
  if (ctx.state.didGameJustStart) return 'beforeFirstLanding';
  if (sector.z !== 0 || sector.x < 1 || sector.x > MAP_SIDE || sector.y < 1 || sector.y > MAP_SIDE) return 'badSector';
  const info = ctx.state.map.sectors[sectorId(sector)];
  if (info?.traversability[THROUGH_STRATEGIC_MOVE] === Traversability.GROUNDBARRIER) return 'groundBarrier';
  if (enemyAirControlled(ctx, strategicIndex(sector))) return 'enemyAirspace';
  return null;
}

export function setLandingZone(ctx: LaptopContext, sector: Sector): LandingZoneRefusal | null {
  const refusal = landingZoneRefusal(ctx, sector);
  if (refusal) return refusal;
  ctx.laptop.mercArriveSector = sectorId(sector);
  updateAnyInTransitMercsWithGlobalArrivalSector(ctx);
  return null;
}

export function handleAirspaceControlUpdated(ctx: LaptopContext): void {
  const zone = landingZone(ctx);
  if (!enemyAirControlled(ctx, strategicIndex(zone))) return;
  const start = ctx.startSector();
  ctx.laptop.mercArriveSector = start;
  ctx.emit({ type: 'landingZoneReset', from: sectorShortString(zone), to: sectorShortString(sectorFromId(start)) });
}

export function isAimHire(kind: number): boolean {
  return kind === MercKind.AIM_MERC;
}
