import type { BasicPlacement } from '../../src/content/formats/map.ts';
import { parseSectorString, type Sector } from '../../src/content/strategic/sector-ids.ts';
import { Direction, gridNo } from '../../src/content/world/grid.ts';
import { createCampaignSession } from '../../src/server/campaign-factory.ts';
import { CampaignSession } from '../../src/server/campaign-session.ts';
import type { Session } from '../../src/server/session.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import { createMercRecord } from '../../src/sim/campaign/merc-record.ts';
import { MercKind, RosterMerc } from '../../src/sim/campaign/roster.ts';
import { Assignment, NO_VEHICLE } from '../../src/sim/strategic/forces/constants.ts';
import { addPlayerToGroup, getGroup, removeGroup, setGroupSectorValue } from '../../src/sim/strategic/forces/groups.ts';
import { FACT_OK_USE_HUMMER } from '../../src/sim/strategic/forces/helicopter.ts';
import { addVehicleToList } from '../../src/sim/strategic/forces/vehicles.ts';
import { sectorInfo } from '../../src/sim/strategic/map/sectors.ts';
import { setFact } from '../../src/sim/strategic/narrative/facts.ts';
import { createFromPlacementParts, newSoldierCreate, tacticalCreateSoldier } from '../../src/sim/tactical/creation.ts';
import { NEUTRAL_POPULATION, soldierSlotTaken } from '../../src/sim/tactical/init-list.ts';
import { addSoldierToSector, Insertion } from '../../src/sim/tactical/insertion.ts';
import { setSoldierPosition } from '../../src/sim/tactical/movement.ts';
import {
  Attitude,
  Body,
  createSoldier,
  firstFreeSoldierId,
  NOWHERE,
  Orders,
  type Soldier,
  SoldierClass,
  SoldierStatusFlags,
  Team,
} from '../../src/sim/tactical/soldier.ts';
import { registerSoldier, type TacticalState } from '../../src/sim/tactical/state.ts';
import { seatAtVehicle } from '../../src/sim/tactical/vehicle-passengers.ts';
import { registerVehicleSoldier } from '../../src/sim/tactical/vehicle-soldiers.ts';
import { NO_PASSENGER, vehicleTypeOfBody } from '../../src/sim/vehicles/vehicle-list.ts';
import type { RunMode } from './reload.ts';
import type { StubSectorKit } from './sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from './session-reload.ts';

const STUB_MAP_ORIGIN = 66;
const VEHICLE_LIFE = 100;
const NO_PREVIOUS_SECTOR = 255;
const VEHICLE_STATS = {
  agility: 0,
  dexterity: 0,
  strength: 0,
  wisdom: 0,
  leadership: 0,
  marksmanship: 0,
  mechanical: 0,
  explosives: 0,
  medical: 0,
  experience: 0,
};
const VEHICLE_PALETTES = { hair: '', skin: '', vest: '', pants: '' };

export const HUMMER_SECTOR = 'L10';
export const PROF_HUMMER = 160;
export const HUMMER_GRIDNO = gridNo(STUB_MAP_ORIGIN + 17, STUB_MAP_ORIGIN + 9);
export const HUMMER_DIRECTION = Direction.WEST;
export const HUMMER_ARRIVAL_GRIDNO = gridNo(STUB_MAP_ORIGIN + 8, STUB_MAP_ORIGIN + 9);

const APPROACH = 'L9';
const START = 'A9';
const QUIET = [START, APPROACH, HUMMER_SECTOR];
export const OUR_HUMMER_ROUTE = ['B9', 'B10', 'B11'];
const LANDING_COMPRESSION = 2;
const ROUTE_BUDGET = 10;
const ROUTE_SLICE_SECONDS = 6 * 3600;
const AVERAGE_LEVEL = 2;

function quietSector(campaign: CampaignSim, name: string): void {
  Object.assign(sectorInfo(campaign.state.map, parseSectorString(name)), { numAdmins: 0, numTroops: 0, numElites: 0 });
}

function removeEnemyGroups(campaign: CampaignSim): void {
  const ctx = campaign.strategic;
  if (!ctx) throw new Error('no strategic layer');
  for (const g of ctx.state.forces.groups.filter((group) => !group.player)) removeGroup(ctx, g, true);
}

function teleportSquad(session: CampaignSession, sector: Sector): void {
  const campaign = session.campaign;
  const ctx = campaign.strategic;
  if (!ctx || !campaign.battle) throw new Error('no strategic layer');
  for (const m of campaign.battle.roster.all()) {
    const group = getGroup(ctx, m.groupId);
    if (group) setGroupSectorValue(ctx, sector, group);
    m.sector = { ...sector };
  }
}

async function dispatchPrepared(session: CampaignSession, cmd: { readonly type: string; readonly [key: string]: unknown }): Promise<void> {
  await session.prepare(cmd);
  const result = session.dispatch(cmd);
  if (!result.ok) throw new Error(`${cmd.type} refused: ${result.reason}`);
}

interface CampaignDriver {
  readonly sim: CampaignSession;
  order(cmd: { readonly type: string; readonly [key: string]: unknown }): Promise<void>;
  advance(worldSeconds: number): void;
}

async function arriveAtTheHummer(d: CampaignDriver): Promise<void> {
  for (const name of QUIET) quietSector(d.sim.campaign, name);
  removeEnemyGroups(d.sim.campaign);
  await d.order({ type: 'compressTime', mode: LANDING_COMPRESSION });
  await d.order({ type: 'mapScreen' });
  teleportSquad(d.sim, parseSectorString(APPROACH));
  const first = d.sim.view().strategic?.mercs[0];
  if (!first) throw new Error('no merc');
  await d.order({ type: 'route', soldier: first.id, to: HUMMER_SECTOR });
  const arrived = () => d.sim.view().strategic?.mercs.every((m) => m.sector === HUMMER_SECTOR && !m.betweenSectors) === true;
  for (let k = 0; k < ROUTE_BUDGET && !arrived(); k++) d.advance(ROUTE_SLICE_SECONDS);
  if (!arrived()) throw new Error(`the squad did not reach ${HUMMER_SECTOR}`);
  await d.order({ type: 'enterSector', sector: HUMMER_SECTOR });
}

export async function stubCampaignAtTheHummer(kit: StubSectorKit, seed: number, mode?: RunMode, mercs = 2): Promise<CampaignSession> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs, land: false });
  const session = drivenSession(created, stubSessionSources(kit), mode);
  let live: ReloadingSession | null = null;
  await arriveAtTheHummer({
    sim: session,
    order: (cmd) => dispatchPrepared(session, cmd),
    advance: (worldSeconds) => {
      live ??= new ReloadingSession('hummer', session);
      live.advance({ worldSeconds });
    },
  });
  return session;
}

export async function bringSessionToTheHummer(session: Session): Promise<void> {
  const sim = session.sim;
  if (!(sim instanceof CampaignSession)) throw new Error('not a campaign');
  await arriveAtTheHummer({
    sim,
    order: async (cmd) => {
      const result = await session.prepareAndDispatch(cmd);
      if (!result.ok) throw new Error(`${cmd.type} refused: ${result.reason}`);
    },
    advance: (worldSeconds) => void session.advance({ worldSeconds }),
  });
}

export interface StubVehicleOrder {
  readonly body: number;
  readonly team: number;
  readonly gridNo: number;
  readonly direction: number;
  readonly soldierClass?: number;
}

export interface StubTankOrder extends StubVehicleOrder {
  readonly body: typeof Body.TANK_NW | typeof Body.TANK_NE;
}

function vehiclePlacement(order: StubVehicleOrder): BasicPlacement {
  return {
    detailed: false,
    startingGridNo: order.gridNo,
    team: order.team,
    relativeAttributeLevel: AVERAGE_LEVEL,
    relativeEquipmentLevel: AVERAGE_LEVEL,
    direction: order.direction,
    orders: Orders.STATIONARY,
    attitude: Attitude.DEFENSIVE,
    bodyType: order.body,
    patrolGrid: [order.gridNo],
    patrolCount: 0,
    onRoof: false,
    soldierClass: order.soldierClass ?? SoldierClass.ARMY,
    civilianGroup: 0,
    priorityExistence: true,
    hasKeys: 0,
  };
}

export function addStubVehicle(t: TacticalState, order: StubVehicleOrder): Soldier {
  const id = firstFreeSoldierId((n) => soldierSlotTaken(t, n), order.team, order.body);
  const vehicle = id < 0 ? null : createFromPlacementParts(t, id, vehiclePlacement(order), null, NEUTRAL_POPULATION);
  if (!vehicle) throw new Error(`no soldier slot for a vehicle on team ${order.team}`);
  vehicle.insertionGridNo = order.gridNo;
  const at = { code: Insertion.GRIDNO, data: order.gridNo, direction: order.direction };
  if (!addSoldierToSector(t, vehicle, at, {}, false)) throw new Error(`the vehicle found no place near ${order.gridNo}`);
  return vehicle;
}

export function addStubTank(t: TacticalState, order: StubTankOrder): Soldier {
  return addStubVehicle(t, order);
}

export function addVehicleOfOurs(campaign: CampaignSim, sector: Sector, body: number = Body.HUMVEE): RosterMerc {
  const ctx = campaign.strategic;
  const battle = campaign.battle;
  if (!ctx || !battle) throw new Error('no strategic layer');
  const roster = battle.roster;
  const id = firstFreeSoldierId((n) => roster.get(n) !== undefined, Team.OUR, body);
  if (id < 0) throw new Error('no soldier slot for a vehicle of ours');
  const soldier = createSoldier({
    id,
    team: Team.OUR,
    name: `vehicle ${id}`,
    bodyType: body,
    palettes: VEHICLE_PALETTES,
    stats: VEHICLE_STATS,
    life: VEHICLE_LIFE,
    gridNo: NOWHERE,
    direction: Direction.NORTH,
    state: 0,
  });
  const vid = addVehicleToList(ctx, sector, vehicleTypeOfBody(body));
  registerVehicleSoldier({ content: battle.content, vehicles: ctx.state.forces.vehicles }, soldier, vid);
  const merc = new RosterMerc(
    createMercRecord({
      soldier,
      profile: null,
      kind: MercKind.VEHICLE,
      statusFlags: SoldierStatusFlags.VEHICLE,
      sector: { ...sector },
      betweenSectors: false,
      groupId: 0,
      prevSectorId: NO_PREVIOUS_SECTOR,
      insertionCode: 0,
      insertionDirection: 0,
      path: [],
      assignment: Assignment.ASSIGNMENT_EMPTY,
      vehicleId: NO_VEHICLE,
      asleep: false,
    }),
  );
  roster.add(merc);
  const group = getGroup(ctx, ctx.state.forces.vehicles[vid]?.movementGroup ?? 0);
  if (group) addPlayerToGroup(ctx, group, id);
  return merc;
}

export const OUR_HUMMER_SECTOR = START;

export async function stubCampaignWithOurHummer(kit: StubSectorKit, seed: number, mode?: RunMode, mercs = 2): Promise<CampaignSession> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs, land: false });
  const session = drivenSession(created, stubSessionSources(kit), mode);
  for (const name of [START, ...OUR_HUMMER_ROUTE]) quietSector(session.campaign, name);
  removeEnemyGroups(session.campaign);
  await dispatchPrepared(session, { type: 'compressTime', mode: LANDING_COMPRESSION });
  await dispatchPrepared(session, { type: 'mapScreen' });
  setFact(session.campaign.state.narrative, FACT_OK_USE_HUMMER, true);
  const hummer = addVehicleOfOurs(session.campaign, parseSectorString(START));
  for (const m of session.view().strategic?.mercs ?? [])
    if (m.id !== hummer.id) await dispatchPrepared(session, { type: 'boardVehicle', soldier: m.id, vehicle: hummer.vehicleId });
  return session;
}

export async function driveOurHummerInto(session: CampaignSession, sector: string): Promise<void> {
  const passenger = session.view().strategic?.mercs.find((m) => m.vehicle !== undefined && m.kind !== 'vehicle');
  if (!passenger) throw new Error('nobody aboard');
  await dispatchPrepared(session, { type: 'route', soldier: passenger.id, to: sector });
  const live = new ReloadingSession('our-hummer', session);
  const arrived = () => session.view().strategic?.mercs.every((m) => m.sector === sector && !m.betweenSectors) === true;
  for (let k = 0; k < ROUTE_BUDGET && !arrived(); k++) live.advance({ worldSeconds: ROUTE_SLICE_SECONDS });
  if (!arrived()) throw new Error(`our Hummer did not reach ${sector}`);
  await dispatchPrepared(session, { type: 'enterSector', sector });
}

const OUR_VEHICLE_SLOT = 18;

export function ourHummerOnTheMap(t: TacticalState, at: number, direction: number = Direction.WEST): Soldier {
  const create = { ...newSoldierCreate(Team.OUR, Body.HUMVEE, direction, at), life: VEHICLE_LIFE, lifeMax: VEHICLE_LIFE };
  const s = tacticalCreateSoldier(t, create, OUR_VEHICLE_SLOT, NEUTRAL_POPULATION);
  if (!s) throw new Error('no Hummer');
  registerSoldier(t, s);
  setSoldierPosition(t, s, at);
  return s;
}

export function seatInVehicle(t: TacticalState, merc: Soldier, vehicle: Soldier, seat: number): void {
  const v = t.vehicles[vehicle.vehicleId];
  if (!v) throw new Error('the vehicle soldier has no vehicle');
  v.passengers[v.passengers.indexOf(NO_PASSENGER)] = merc.id;
  merc.vehicleSeat = seat;
  seatAtVehicle(t, merc, vehicle);
}
