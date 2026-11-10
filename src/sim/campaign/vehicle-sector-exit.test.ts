import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { ReloadingSession } from '../../../tests/support/session-reload.ts';
import { driveOurHummerInto, stubCampaignWithOurHummer } from '../../../tests/support/vehicles.ts';
import { parseSectorString, sameSector } from '../../content/strategic/sector-ids.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import type { CampaignSession } from '../../server/campaign-session.ts';
import type { CommandResult } from '../command.ts';
import { InsertionCode, VehicleSeat } from '../strategic/forces/constants.ts';
import { sectorInfo } from '../strategic/map/sectors.ts';
import { setSoldierDirection } from '../tactical/animation.ts';
import { addExitGridToWorld } from '../tactical/map-changes.ts';
import { setSoldierPosition } from '../tactical/movement.ts';
import { OKLIFE } from '../tactical/soldier.ts';
import { type TacticalState, whoIsThere } from '../tactical/state.ts';
import type { RosterMerc } from './roster.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const SEED = 43;
const STUB_MAP_ORIGIN = 66;
const ON_THE_ROAD = 'B9';
const DOWN_THE_ROAD = 'B10';
const IN_TOWN = 'A10';
const NEXT_IN_TOWN = 'A9';
const AT_THE_EAST_EDGE = gridNo(150, 77);
const AT_THE_WEST_EDGE = gridNo(77, 150);
const CAR_MINUTES_ON_THE_ROAD = 30;
const CAR_MINUTES_THROUGH_TOWN = 5;
const FUEL_PER_MINUTE = 6;
const WALK_OFF_SECONDS = 5;
const UNLOCK_SECONDS = 1;
const TRAVEL_SECONDS = 3600;
const A9_EAST_ENTRY = gridNo(STUB_MAP_ORIGIN + 28, STUB_MAP_ORIGIN + 9);
const BESIDE_THE_EXIT_GRID = gridNo(120, 77);
const EXIT_GRID = gridNo(117, 77);
const EXIT_GRID_LANDING = gridNo(90, 80);

function tactical(session: CampaignSession): TacticalState {
  const t = session.campaign.tactical?.state;
  if (!t) throw new Error('no loaded sector');
  return t;
}

function roster(session: CampaignSession): readonly RosterMerc[] {
  return session.campaign.battle?.roster.all() ?? [];
}

function hummerOf(session: CampaignSession): RosterMerc {
  const hummer = roster(session).find((m) => m.isVehicle);
  if (!hummer) throw new Error('no vehicle of ours');
  return hummer;
}

function aboard(session: CampaignSession): RosterMerc[] {
  return roster(session).filter((m) => m.isPassengerOrDriver);
}

function vehicleView(session: CampaignSession) {
  const id = hummerOf(session).vehicleId;
  return session.view().strategic?.vehicles?.find((v) => v.id === id);
}

function vehicleGroupView(session: CampaignSession) {
  const id = hummerOf(session).id;
  return session.view().strategic?.groups.find((g) => g.members.includes(id));
}

function everyoneIn(session: CampaignSession, sector: string): boolean {
  return roster(session).every((m) => sameSector(m.sector, parseSectorString(sector)) && !m.betweenSectors);
}

function quietSector(session: CampaignSession, sector: string): void {
  Object.assign(sectorInfo(session.campaign.state.map, parseSectorString(sector)), { numAdmins: 0, numTroops: 0, numElites: 0 });
}

async function hummerIn(sector: string): Promise<CampaignSession> {
  const session = await stubCampaignWithOurHummer(kit, SEED);
  quietSector(session, sector);
  await driveOurHummerInto(session, sector);
  return session;
}

function standHummer(session: CampaignSession, at: number, facing: number): void {
  const t = tactical(session);
  const hummer = hummerOf(session).soldier;
  setSoldierPosition(t, hummer, at);
  setSoldierDirection(t, hummer, facing);
}

async function exitSector(session: CampaignSession, cmd: Record<string, unknown>): Promise<CommandResult> {
  const order = { type: 'exitSector', soldier: hummerOf(session).id, who: 'merc', ...cmd };
  await session.prepare(order);
  return session.dispatch(order);
}

function advance(session: CampaignSession, worldSeconds: number): void {
  new ReloadingSession('vehicle-exit', session).advance({ worldSeconds });
}

function seatedAtTheHummer(session: CampaignSession): unknown[] {
  const at = hummerOf(session).soldier.gridNo;
  return aboard(session).map((m) => [m.soldier.placed, m.soldier.gridNo === at, m.soldier.structure, m.vehicleSeat]);
}

const SEATED = [
  [true, true, null, VehicleSeat.DRIVER],
  [true, true, null, VehicleSeat.PASSENGER],
];

describe('a vehicle of ours leaving the loaded sector with everybody aboard (deviation "Vehicle sector exit"; StrategicMap.cc JumpIntoAdjacentSector)', () => {
  async function offTheRoadsEastEdge(): Promise<{ readonly session: CampaignSession; readonly riders: readonly number[] }> {
    const session = await hummerIn(ON_THE_ROAD);
    const riders = aboard(session).map((m) => m.id);
    standHummer(session, AT_THE_EAST_EDGE, Direction.NORTHEAST);
    expect(await exitSector(session, { direction: 'east', load: false })).toMatchObject({
      ok: true,
      data: { minutes: CAR_MINUTES_ON_THE_ROAD, who: 'merc', load: false, target: DOWN_THE_ROAD },
    });
    advance(session, WALK_OFF_SECONDS);
    return { session, riders };
  }

  it('drives off the edge as its own group with everybody aboard, at the car speed the exit showed, and nobody stays on the old map', async () => {
    const { session, riders } = await offTheRoadsEastEdge();
    const hummer = hummerOf(session);
    expect(vehicleGroupView(session)).toMatchObject({
      members: [hummer.id, ...riders],
      betweenSectors: true,
      next: DOWN_THE_ROAD,
      traverseMinutes: CAR_MINUTES_ON_THE_ROAD,
    });
    expect(vehicleView(session)).toMatchObject({
      sector: ON_THE_ROAD,
      betweenSectors: true,
      passengers: riders,
      path: [ON_THE_ROAD, DOWN_THE_ROAD],
    });
    expect(roster(session).map((m) => [m.id, m.soldier.placed, m.betweenSectors])).toEqual(
      [...riders, hummer.id].map((id) => [id, false, true]),
    );
  });

  it('burns the fuel of the trip at the arrival, where its record and everybody aboard stand, still seated, and a merc gets off there', async () => {
    const { session, riders } = await offTheRoadsEastEdge();
    const fuelAtDeparture = hummerOf(session).soldier.breathRed;
    advance(session, TRAVEL_SECONDS);
    expect(hummerOf(session).soldier.breathRed).toBe(fuelAtDeparture - CAR_MINUTES_ON_THE_ROAD * FUEL_PER_MINUTE);
    expect(vehicleView(session)).toMatchObject({ sector: DOWN_THE_ROAD, betweenSectors: false, passengers: riders, path: [] });
    expect(everyoneIn(session, DOWN_THE_ROAD)).toBe(true);
    expect(aboard(session).map((m) => m.vehicleSeat)).toEqual([VehicleSeat.DRIVER, VehicleSeat.PASSENGER]);
    const [, passenger] = riders;
    expect(session.dispatch({ type: 'leaveVehicle', soldier: passenger })).toMatchObject({ ok: true });
    const off = roster(session).find((m) => m.id === passenger);
    expect([off?.vehicleSeat, off?.betweenSectors, off && sameSector(off.sector, parseSectorString(DOWN_THE_ROAD))]).toEqual([
      VehicleSeat.NONE,
      false,
      true,
    ]);
    expect(vehicleView(session)?.passengers).toEqual(riders.filter((id) => id !== passenger));
  });

  it('loads the next sector through a town with the vehicle at the entry point of its side, not across from where it left, as its riders take the travel insertion code (quirk), driving in from nowhere with its passengers seated at its tile', async () => {
    const session = await hummerIn(IN_TOWN);
    standHummer(session, AT_THE_WEST_EDGE, Direction.SOUTHWEST);
    expect(await exitSector(session, { direction: 'west', load: true })).toMatchObject({
      ok: true,
      data: { minutes: CAR_MINUTES_THROUGH_TOWN, who: 'merc', load: true, target: NEXT_IN_TOWN },
    });
    advance(session, WALK_OFF_SECONDS);
    const t = tactical(session);
    const hummer = hummerOf(session);
    expect(session.campaign.state.worldSector).toEqual(parseSectorString(NEXT_IN_TOWN));
    const walkingIn = t.mercsWaiting?.remaining ?? 0;
    expect([hummer.soldier.gridNo, hummer.insertionCode, hummer.soldier.insertionData, hummer.soldier.pathSize, walkingIn]).toEqual([
      A9_EAST_ENTRY,
      InsertionCode.GRIDNO,
      A9_EAST_ENTRY,
      0,
      0,
    ]);
    expect(whoIsThere(t, hummer.soldier.gridNo, 0)).toBe(hummer.soldier);
    expect(seatedAtTheHummer(session)).toEqual(SEATED);
    expect(vehicleView(session)).toMatchObject({ sector: NEXT_IN_TOWN, betweenSectors: false, path: [] });
    advance(session, UNLOCK_SECONDS);
    const [, passenger] = aboard(session);
    expect(session.dispatch({ type: 'exitVehicle', soldier: passenger?.id })).toMatchObject({ ok: true });
  });

  async function atAnExitGridToTheNextTownSector(): Promise<CampaignSession> {
    const session = await hummerIn(IN_TOWN);
    standHummer(session, BESIDE_THE_EXIT_GRID, Direction.WEST);
    addExitGridToWorld(tactical(session), { mapIndex: EXIT_GRID, gridNo: EXIT_GRID_LANDING, sector: parseSectorString(NEXT_IN_TOWN) });
    return session;
  }

  it('drives through an exit grid as its own group, set in the target at once with its record and everybody aboard', async () => {
    const session = await atAnExitGridToTheNextTownSector();
    const riders = aboard(session).map((m) => m.id);
    expect(await exitSector(session, { exitGrid: EXIT_GRID, load: false })).toMatchObject({
      ok: true,
      data: { minutes: 0, who: 'merc', load: false, target: NEXT_IN_TOWN },
    });
    advance(session, WALK_OFF_SECONDS);
    const hummer = hummerOf(session);
    expect(vehicleGroupView(session)).toMatchObject({ members: [hummer.id, ...riders], sector: NEXT_IN_TOWN, betweenSectors: false });
    expect(vehicleView(session)).toMatchObject({ sector: NEXT_IN_TOWN, betweenSectors: false, passengers: riders });
    expect(everyoneIn(session, NEXT_IN_TOWN)).toBe(true);
    expect(roster(session).some((m) => m.soldier.placed)).toBe(false);
  });

  it("loads the target of an exit grid with the vehicle by the exit's landing tile and its passengers seated at it, an unconscious one too", async () => {
    const session = await atAnExitGridToTheNextTownSector();
    const [, passenger] = aboard(session);
    if (!passenger) throw new Error('no passenger');
    passenger.soldier.life = OKLIFE - 1;
    expect(await exitSector(session, { exitGrid: EXIT_GRID, load: true })).toMatchObject({ ok: true, data: { load: true } });
    advance(session, WALK_OFF_SECONDS);
    expect(session.campaign.state.worldSector).toEqual(parseSectorString(NEXT_IN_TOWN));
    expect(hummerOf(session).soldier.gridNo).toBe(EXIT_GRID_LANDING);
    expect(seatedAtTheHummer(session)).toEqual(SEATED);
    expect(vehicleView(session)).toMatchObject({ sector: NEXT_IN_TOWN, betweenSectors: false });
  });
});

describe('a merc boarding a vehicle that has no soldier on the loaded map (Vehicles.cc:266 EVENT_StopMerc)', () => {
  const MERC_TALK = 11;
  const WAITING_FOR_A_TILE = 1;

  it("loses a native save's pending action unless he waits for a tile, and waits no more", async () => {
    const session = await stubCampaignWithOurHummer(kit, SEED);
    const [stopped, waiting] = aboard(session);
    const hummer = hummerOf(session);
    const roster = session.campaign.battle?.roster;
    if (!stopped || !waiting || !roster) throw new Error('nobody aboard');
    const talk = { action: MERC_TALK, giveTarget: 0, data3: Direction.EAST, animCount: 0 };
    stopped.soldier.savedPendingAction = { ...talk };
    waiting.soldier.savedPendingAction = { ...talk };
    waiting.soldier.delayedMovement = WAITING_FOR_A_TILE;
    roster.seatAtVehicle(stopped.id, hummer.id);
    roster.seatAtVehicle(waiting.id, hummer.id);
    expect([stopped.soldier.savedPendingAction, waiting.soldier.savedPendingAction, waiting.soldier.delayedMovement]).toEqual([
      null,
      talk,
      0,
    ]);
  });
});
