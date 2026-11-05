import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { ReloadingSession } from '../../../tests/support/session-reload.ts';
import { OUR_HUMMER_ROUTE, stubCampaignWithOurHummer } from '../../../tests/support/vehicles.ts';
import type { CampaignSession } from '../../server/campaign-session.ts';
import type { SimEvent } from '../events.ts';
import type { RosterMerc } from './roster.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const SEED = 41;
const DESTINATION = 'B11';
const FIRST_STOP = 'B9';
const ROUTE_SECONDS = 3 * 60 * 60;
const ALMOST_EMPTY = 100;

function hummerOf(session: CampaignSession): RosterMerc {
  const hummer = session.campaign.battle?.roster.all().find((m) => m.isVehicle);
  if (!hummer) throw new Error('no vehicle of ours');
  return hummer;
}

function passengerOf(session: CampaignSession): number {
  const passenger = session.view().strategic?.mercs.find((m) => m.vehicle !== undefined && m.kind !== 'vehicle');
  if (!passenger) throw new Error('nobody aboard');
  return passenger.id;
}

function fuelAt(hummer: RosterMerc): readonly [number, number] {
  return [hummer.soldier.breathRed, hummer.soldier.breath];
}

function driveAndWatchTheFuel(session: CampaignSession): (readonly [string, number, number])[] {
  expect(session.dispatch({ type: 'route', soldier: passengerOf(session), to: DESTINATION })).toMatchObject({ ok: true });
  const live = new ReloadingSession('vehicle-travel', session);
  const arrivals: (readonly [string, number, number])[] = [];
  for (let leg = 0; leg < OUR_HUMMER_ROUTE.length; leg++) {
    const report = live.advance({ worldSeconds: ROUTE_SECONDS, events: ['groupArrived'] });
    const arrived = report.events.find((e) => e.type === 'groupArrived');
    if (arrived?.type !== 'groupArrived') break;
    arrivals.push([arrived.sector, ...fuelAt(hummerOf(session))]);
    if (arrived.final) break;
  }
  return arrivals;
}

describe('a ground vehicle of ours on the strategic map (Strategic_Movement.cc GroupArrivedAtSector, SpendVehicleFuel)', () => {
  it('burns six fuel a minute of each leg and shows the fuel left rounded up to a whole percent (quirk), driving on', async () => {
    const session = await stubCampaignWithOurHummer(kit, SEED);
    expect(driveAndWatchTheFuel(session)).toEqual([
      ['B9', 9820, 99],
      ['B10', 9640, 97],
      ['B11', 9460, 95],
    ]);
  });

  it('stops the group where the tank runs dry, says so, and refuses the next move of any passenger for the vehicle (quirk)', async () => {
    const session = await stubCampaignWithOurHummer(kit, SEED);
    Object.assign(hummerOf(session).soldier, { breathRed: ALMOST_EMPTY, breath: 1 });
    const route = session.dispatch({ type: 'route', soldier: passengerOf(session), to: DESTINATION });
    expect(route).toMatchObject({ ok: true });
    const live = new ReloadingSession('out-of-gas', session);
    const report = live.advance({ worldSeconds: ROUTE_SECONDS });
    const events = report.events.filter((e: SimEvent) => e.type === 'vehicleOutOfGas' || e.type === 'groupArrived');
    const hummer = hummerOf(session);
    expect(events).toEqual([
      expect.objectContaining({ type: 'vehicleOutOfGas', vehicle: hummer.vehicleId, sector: FIRST_STOP }),
      expect.objectContaining({ type: 'groupArrived', sector: FIRST_STOP, final: true }),
    ]);
    expect(fuelAt(hummer)).toEqual([0, 0]);
    const view = session.view().strategic;
    expect(view?.vehicles?.find((v) => v.id === hummer.vehicleId)).toMatchObject({ sector: FIRST_STOP, betweenSectors: false, path: [] });
    const refused = { ok: false, data: { refusal: 'vehicleNoGas', soldier: hummer.id } };
    expect(session.dispatch({ type: 'route', soldier: passengerOf(session), to: DESTINATION })).toMatchObject(refused);
    expect(session.dispatch({ type: 'route', soldier: hummer.id, to: DESTINATION })).toMatchObject(refused);
  });
});
