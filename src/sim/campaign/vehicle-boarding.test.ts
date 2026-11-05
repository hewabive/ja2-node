import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { ReloadingSession } from '../../../tests/support/session-reload.ts';
import {
  addStubVehicle,
  driveOurHummerInto,
  HUMMER_GRIDNO,
  PROF_HUMMER,
  stubCampaignAtTheHummer,
  stubCampaignWithOurHummer,
} from '../../../tests/support/vehicles.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import type { CampaignSession } from '../../server/campaign-session.ts';
import type { SimEvent } from '../events.ts';
import { ProfileFlag } from '../narrative/narrative-ids.ts';
import { Assignment, VehicleSeat } from '../strategic/forces/constants.ts';
import { FACT_OK_USE_HUMMER } from '../strategic/forces/helicopter.ts';
import { setFact } from '../strategic/narrative/facts.ts';
import { setSoldierDirection } from '../tactical/animation.ts';
import { setSoldierPosition } from '../tactical/movement.ts';
import { Body, type Soldier, SoldierStatusFlags, Team } from '../tactical/soldier.ts';
import { type TacticalState, whoIsThere } from '../tactical/state.ts';
import { MercKind, type RosterMerc } from './roster.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const SEED = 31;
const NORTH_OF_THE_HUMMER = gridNo(66 + 17, 66 + 7);
const SOUTH_OF_THE_HUMMER = gridNo(66 + 17, 66 + 11);
const FIRST_VEHICLE_SLOT = 18;
const SECOND_VEHICLE_SLOT = 19;
const JEEP_AT = gridNo(66 + 8, 66 + 15);
const ELDORADO_AT = gridNo(66 + 16, 66 + 15);
const FIRST_SQUAD = 0;
const SECOND_SQUAD = 1;
const WALK_BUDGET = 20_000;
const AT_THE_EAST_EDGE = gridNo(150, 77);
const PATH_TO_THE_EAST_EDGE = [Direction.NORTHEAST, Direction.NORTHEAST, Direction.NORTH];
const TWO_STEPS_NORTHEAST = gridNo(152, 75);
const INSIDE_THE_MAP = gridNo(140, 77);
const DRIVE_SECONDS = 5;

function tactical(session: CampaignSession): TacticalState {
  const t = session.campaign.tactical?.state;
  if (!t) throw new Error('no loaded sector');
  return t;
}

function civilianHummer(session: CampaignSession): Soldier {
  const s = tactical(session).soldiers.find((x) => x?.placed && x.profile === PROF_HUMMER && x.team !== Team.OUR);
  if (!s) throw new Error('no civilian Hummer in the sector');
  return s;
}

function roster(session: CampaignSession): readonly RosterMerc[] {
  return session.campaign.battle?.roster.all() ?? [];
}

function mercs(session: CampaignSession): RosterMerc[] {
  return roster(session).filter((m) => !m.isVehicle);
}

function merc(session: CampaignSession, id: number): RosterMerc {
  const m = roster(session).find((x) => x.id === id);
  if (!m) throw new Error(`no merc ${id}`);
  return m;
}

function ourVehicles(session: CampaignSession): RosterMerc[] {
  return roster(session).filter((m) => m.isVehicle);
}

function firstTwo(session: CampaignSession): readonly [number, number] {
  const [first, second] = mercs(session);
  if (!first || !second) throw new Error('two mercs needed');
  return [first.id, second.id];
}

async function atTheHummer(mercCount = 2): Promise<CampaignSession> {
  const session = await stubCampaignAtTheHummer(kit, SEED, undefined, mercCount);
  setFact(session.campaign.state.narrative, FACT_OK_USE_HUMMER, true);
  return session;
}

function walkUntilIdle(session: CampaignSession): SimEvent[] {
  return [...new ReloadingSession('walk', session).advance({ idle: true }, WALK_BUDGET).events];
}

function refusalOf(session: CampaignSession, cmd: Record<string, unknown> & { readonly type: string }): unknown {
  const result = session.dispatch(cmd);
  return result.ok ? 'ok' : result.data.refusal;
}

function vehicleEvents(events: readonly SimEvent[]): SimEvent[] {
  return events.filter((e) => e.type === 'vehicleBoarded' || e.type === 'vehicleLeft');
}

function currentSquad(session: CampaignSession): number {
  return session.campaign.state.forces.currentSquad;
}

function selected(session: CampaignSession): number {
  return tactical(session).turn.selected;
}

async function bothAboard(): Promise<{ readonly session: CampaignSession; readonly vid: number }> {
  const session = await atTheHummer();
  const [first, second] = firstTwo(session);
  const vid = civilianHummer(session).vehicleId;
  expect(refusalOf(session, { type: 'enterVehicle', soldier: first, vehicle: civilianHummer(session).id })).toBe('ok');
  walkUntilIdle(session);
  expect(refusalOf(session, { type: 'enterVehicle', soldier: second, vehicle: FIRST_VEHICLE_SLOT })).toBe('ok');
  walkUntilIdle(session);
  return { session, vid };
}

function addCivilianCars(session: CampaignSession): readonly [Soldier, Soldier] {
  const t = tactical(session);
  const jeep = addStubVehicle(t, { body: Body.JEEP, team: Team.CIV, gridNo: JEEP_AT, direction: Direction.WEST });
  const eldorado = addStubVehicle(t, { body: Body.ELDORADO, team: Team.CIV, gridNo: ELDORADO_AT, direction: Direction.WEST });
  session.campaign.tactical?.lookAround();
  return [jeep, eldorado];
}

describe('boarding a vehicle on the tactical screen (Turn_Based_Input.cc CheckForAndHandleHandleVehicleInteractiveClick, Vehicles.cc AddSoldierToVehicle)', () => {
  it('walks up to the civilian Hummer, takes it over as soldier 18 and seats the merc as its driver, the vehicle selected and its squad current', async () => {
    const session = await atTheHummer();
    const [first] = firstTwo(session);
    const civilian = civilianHummer(session);
    const { id: civilianId, vehicleId: vid } = civilian;
    expect(session.dispatch({ type: 'enterVehicle', soldier: first, vehicle: civilianId })).toEqual({
      ok: true,
      data: { actionGridNo: NORTH_OF_THE_HUMMER, boarded: false },
    });
    const events = walkUntilIdle(session);
    const t = tactical(session);
    const [hummer] = ourVehicles(session);
    if (!hummer) throw new Error('the Hummer is not ours');
    expect([hummer.id, hummer.vehicleId, hummer.kind, hummer.statusFlags, hummer.soldier.team, hummer.soldier.gridNo]).toEqual([
      FIRST_VEHICLE_SLOT,
      vid,
      MercKind.VEHICLE,
      SoldierStatusFlags.VEHICLE,
      Team.OUR,
      HUMMER_GRIDNO,
    ]);
    expect(t.soldiers[civilianId]?.placed ?? false).toBe(false);
    expect(hummer.groupId).toBe(t.vehicles[vid]?.movementGroup);
    expect(hummer.assignment).toBeLessThan(Assignment.ON_DUTY);
    const driver = merc(session, first);
    expect([driver.vehicleSeat, driver.assignment, driver.vehicleId, driver.soldier.gridNo]).toEqual([
      VehicleSeat.DRIVER,
      Assignment.VEHICLE,
      vid,
      HUMMER_GRIDNO,
    ]);
    expect([selected(session), currentSquad(session)]).toEqual([FIRST_VEHICLE_SLOT, hummer.assignment]);
    expect((session.campaign.state.profiles.get(PROF_HUMMER)?.miscFlags ?? 0) & ProfileFlag.RECRUITED).toBe(ProfileFlag.RECRUITED);
    expect(vehicleEvents(events)).toEqual([
      { type: 'vehicleBoarded', soldier: first, vehicle: vid, gridNo: HUMMER_GRIDNO, tick: expect.any(Number) },
    ]);
  });

  it('refuses the Hummer as notAllowed while FACT_OK_USE_HUMMER is false', async () => {
    const session = await stubCampaignAtTheHummer(kit, SEED);
    const [first] = firstTwo(session);
    expect(refusalOf(session, { type: 'enterVehicle', soldier: first, vehicle: civilianHummer(session).id })).toBe('notAllowed');
  });

  it('refuses under the move cursor a vehicle with somebody aboard, which the hand cursor boards as a passenger: the mercs aboard on no squad, the vehicle alone on its own', async () => {
    const session = await atTheHummer();
    const [first, second] = firstTwo(session);
    expect(refusalOf(session, { type: 'enterVehicle', soldier: first, vehicle: civilianHummer(session).id })).toBe('ok');
    walkUntilIdle(session);
    expect(refusalOf(session, { type: 'enterVehicle', soldier: second, vehicle: FIRST_VEHICLE_SLOT, cursor: 'move' })).toBe(
      'vehicleOccupied',
    );
    expect(refusalOf(session, { type: 'enterVehicle', soldier: second, vehicle: FIRST_VEHICLE_SLOT, cursor: 'hand' })).toBe('ok');
    walkUntilIdle(session);
    expect(merc(session, second).vehicleSeat).toBe(VehicleSeat.PASSENGER);
    expect(tactical(session).vehicles[merc(session, FIRST_VEHICLE_SLOT).vehicleId]?.passengers.slice(0, 2)).toEqual([first, second]);
    const squads = session.campaign.state.forces.squads;
    expect(squads[merc(session, FIRST_VEHICLE_SLOT).assignment]).toEqual([FIRST_VEHICLE_SLOT]);
    expect(squads.filter((members) => members.includes(first) || members.includes(second))).toEqual([]);
  });
});

describe('leaving a vehicle on the tactical screen (Interface_Panels.cc the Exit Vehicle button, Vehicles.cc ExitVehicle)', () => {
  it('puts each merc on the free tile closest to the vehicle in a squad of his own, made current with him selected; the vehicle left empty drops its squad for its group', async () => {
    const { session, vid } = await bothAboard();
    const [first, second] = firstTwo(session);
    session.drainEvents();
    expect(session.dispatch({ type: 'exitVehicle', soldier: first })).toEqual({ ok: true, data: { gridNo: NORTH_OF_THE_HUMMER } });
    const out = merc(session, first);
    expect([out.vehicleSeat, out.assignment, out.vehicleId, selected(session), currentSquad(session)]).toEqual([
      VehicleSeat.NONE,
      FIRST_SQUAD,
      -1,
      first,
      FIRST_SQUAD,
    ]);
    expect(whoIsThere(tactical(session), NORTH_OF_THE_HUMMER, 0)).toBe(out.soldier);
    expect(merc(session, FIRST_VEHICLE_SLOT).assignment).toBeLessThan(Assignment.ON_DUTY);
    expect(session.dispatch({ type: 'exitVehicle', soldier: second })).toEqual({ ok: true, data: { gridNo: SOUTH_OF_THE_HUMMER } });
    expect([merc(session, second).assignment, selected(session), currentSquad(session)]).toEqual([SECOND_SQUAD, second, SECOND_SQUAD]);
    const hummer = merc(session, FIRST_VEHICLE_SLOT);
    expect([hummer.assignment, hummer.groupId]).toEqual([Assignment.ASSIGNMENT_EMPTY, tactical(session).vehicles[vid]?.movementGroup]);
    expect(refusalOf(session, { type: 'select', soldier: FIRST_VEHICLE_SLOT })).toBe('noDriver');
    expect(vehicleEvents(session.drainEvents())).toEqual([
      { type: 'vehicleLeft', soldier: first, vehicle: vid, gridNo: HUMMER_GRIDNO, tick: expect.any(Number) },
      { type: 'vehicleLeft', soldier: second, vehicle: vid, gridNo: HUMMER_GRIDNO, tick: expect.any(Number) },
    ]);
  });

  it('refuses a merc on foot as notInVehicle', async () => {
    const session = await atTheHummer();
    const [first] = firstTwo(session);
    expect(refusalOf(session, { type: 'exitVehicle', soldier: first })).toBe('notInVehicle');
  });
});

describe('boarding and leaving on the map screen in the loaded sector (Assignments.cc VehicleMenuBtnCallback, SquadMenuBtnCallback)', () => {
  it('takes the civilian Hummer over as soldier 18 with no selection, and leaving puts the merc where ExitVehicle does', async () => {
    const session = await atTheHummer();
    const [first] = firstTwo(session);
    const vid = civilianHummer(session).vehicleId;
    expect(refusalOf(session, { type: 'mapScreen' })).toBe('ok');
    const before = selected(session);
    expect(session.dispatch({ type: 'boardVehicle', soldier: first, vehicle: vid })).toEqual({ ok: true, data: { vehicle: vid, seat: 0 } });
    const [hummer] = ourVehicles(session);
    expect([hummer?.id, hummer?.kind, merc(session, first).vehicleSeat, selected(session)]).toEqual([
      FIRST_VEHICLE_SLOT,
      MercKind.VEHICLE,
      VehicleSeat.DRIVER,
      before,
    ]);
    expect(refusalOf(session, { type: 'leaveVehicle', soldier: first })).toBe('ok');
    expect(merc(session, first).soldier.gridNo).toBe(NORTH_OF_THE_HUMMER);
    expect(whoIsThere(tactical(session), NORTH_OF_THE_HUMMER, 0)).toBe(merc(session, first).soldier);
    expect(vehicleEvents(session.drainEvents())).toEqual([
      { type: 'vehicleBoarded', soldier: first, vehicle: vid, gridNo: HUMMER_GRIDNO, tick: expect.any(Number) },
      { type: 'vehicleLeft', soldier: first, vehicle: vid, gridNo: HUMMER_GRIDNO, tick: expect.any(Number) },
    ]);
  });

  it('takes a second vehicle over as soldier 19 and refuses a third as noVehicleSlot, which stays a civilian car on the map (quirk)', async () => {
    const session = await atTheHummer(3);
    const [jeep, eldorado] = addCivilianCars(session);
    const { vehicleId: jeepId } = jeep;
    const { id: eldoradoSoldier, vehicleId: eldoradoId } = eldorado;
    const [first, second, third] = mercs(session).map((m) => m.id);
    expect(refusalOf(session, { type: 'mapScreen' })).toBe('ok');
    const hummerId = civilianHummer(session).vehicleId;
    expect(refusalOf(session, { type: 'boardVehicle', soldier: first, vehicle: hummerId })).toBe('ok');
    expect(refusalOf(session, { type: 'boardVehicle', soldier: second, vehicle: jeepId })).toBe('ok');
    expect(ourVehicles(session).map((v) => [v.id, v.vehicleId])).toEqual([
      [FIRST_VEHICLE_SLOT, hummerId],
      [SECOND_VEHICLE_SLOT, jeepId],
    ]);
    expect(refusalOf(session, { type: 'boardVehicle', soldier: third, vehicle: eldoradoId })).toBe('noVehicleSlot');
    const car = tactical(session).soldiers[eldoradoSoldier];
    expect([car?.team, car?.placed, car?.vehicleId]).toEqual([Team.CIV, true, eldoradoId]);
    expect(merc(session, third ?? -1).assignment).toBeLessThan(Assignment.ON_DUTY);
  });

  it('moves a merc from one vehicle into another: out of the first, which empties, and into the second', async () => {
    const session = await atTheHummer();
    const [jeep] = addCivilianCars(session);
    const jeepId = jeep.vehicleId;
    const [first] = firstTwo(session);
    expect(refusalOf(session, { type: 'mapScreen' })).toBe('ok');
    expect(refusalOf(session, { type: 'boardVehicle', soldier: first, vehicle: civilianHummer(session).vehicleId })).toBe('ok');
    expect(refusalOf(session, { type: 'boardVehicle', soldier: first, vehicle: jeepId })).toBe('ok');
    const moved = merc(session, first);
    const [hummer, ours] = ourVehicles(session);
    expect([moved.vehicleId, moved.vehicleSeat, moved.assignment, moved.soldier.gridNo]).toEqual([
      jeepId,
      VehicleSeat.DRIVER,
      Assignment.VEHICLE,
      ours?.soldier.gridNo,
    ]);
    expect(hummer?.assignment).toBe(Assignment.ASSIGNMENT_EMPTY);
    expect(ours?.assignment).toBeLessThan(Assignment.ON_DUTY);
  });
});

describe('a vehicle squad at the edge of the map (StrategicMap.cc OKForSectorExit, JumpIntoAdjacentSector)', () => {
  async function hummerAtTheEastEdge(facing: number): Promise<{ readonly session: CampaignSession; readonly hummer: RosterMerc }> {
    const session = await stubCampaignWithOurHummer(kit, SEED);
    await driveOurHummerInto(session, 'B9');
    const [hummer] = ourVehicles(session);
    if (!hummer) throw new Error('no vehicle of ours');
    setSoldierPosition(tactical(session), hummer.soldier, AT_THE_EAST_EDGE);
    setSoldierDirection(tactical(session), hummer.soldier, facing);
    return { session, hummer };
  }

  function leaveEast(session: CampaignSession, hummer: RosterMerc): Soldier {
    expect(refusalOf(session, { type: 'exitSector', soldier: hummer.id, direction: 'east', who: 'merc', load: false })).toBe('ok');
    expect(hummer.soldier.path.slice(0, hummer.soldier.pathSize)).toEqual(PATH_TO_THE_EAST_EDGE);
    new ReloadingSession('drive', session).advance({ worldSeconds: DRIVE_SECONDS });
    const vehicle = merc(session, hummer.id);
    expect([vehicle.soldier.placed, session.view().strategic?.mercs.find((m) => m.id === hummer.id)?.betweenSectors]).toEqual([
      false,
      true,
    ]);
    return vehicle.soldier;
  }

  it('counts the vehicle alone at the exit, never the squad, and the vehicle drives toward the edge as far as it goes straight, its passengers riding its steps: the one move a vehicle makes on the tactical map (quirk)', async () => {
    const { session, hummer } = await hummerAtTheEastEdge(Direction.NORTHEAST);
    expect(refusalOf(session, { type: 'move', soldier: hummer.id, to: INSIDE_THE_MAP })).toBe('vehicleCantMove');
    expect(refusalOf(session, { type: 'exitSector', soldier: hummer.id, direction: 'east', who: 'squad' })).toBe('squadNotAllowed');
    const vehicle = leaveEast(session, hummer);
    expect([vehicle.gridNo, vehicle.direction, vehicle.pauseAnimMove]).toEqual([TWO_STEPS_NORTHEAST, Direction.NORTHEAST, true]);
    expect(mercs(session).map((m) => m.soldier.gridNo)).toEqual([vehicle.gridNo, vehicle.gridNo]);
  });

  it('never moves a vehicle facing away from its first step, which cannot turn, and the walk-off timer takes it out of the sector (Soldier_Control.cc:3914, :4220; Overhead.cc:1083)', async () => {
    const { session, hummer } = await hummerAtTheEastEdge(Direction.SOUTHEAST);
    const vehicle = leaveEast(session, hummer);
    expect([vehicle.gridNo, vehicle.direction, vehicle.pauseAnimMove]).toEqual([AT_THE_EAST_EDGE, Direction.SOUTHEAST, true]);
  });
});
