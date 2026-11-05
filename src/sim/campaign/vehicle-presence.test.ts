import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { addStubTank, driveOurHummerInto, stubCampaignAtTheHummer, stubCampaignWithOurHummer } from '../../../tests/support/vehicles.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import type { SoldierView } from '../../protocol/view.ts';
import type { CampaignSession } from '../../server/campaign-session.ts';
import { onTheMap } from '../../ui/screens/tactical/soldiers.ts';
import { FACT_OK_USE_HUMMER } from '../strategic/forces/helicopter.ts';
import { setFact } from '../strategic/narrative/facts.ts';
import { Body, Team } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
import type { RosterMerc } from './roster.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const SEED = 29;
const ENTERED = 'B9';
const VEHICLE_APS = 37;
const TANK_SPOT = gridNo(70, 140);

function tactical(session: CampaignSession): TacticalState {
  const t = session.campaign.tactical?.state;
  if (!t) throw new Error('no loaded sector');
  return t;
}

function hummerOf(session: CampaignSession): RosterMerc {
  const hummer = session.campaign.battle?.roster.all().find((m) => m.isVehicle);
  if (!hummer) throw new Error('no vehicle of ours');
  return hummer;
}

function aboard(session: CampaignSession): RosterMerc[] {
  return (session.campaign.battle?.roster.all() ?? []).filter((m) => m.isPassengerOrDriver);
}

function listed(session: CampaignSession, id: number): SoldierView | undefined {
  return session.view().soldiers.find((v) => v.id === id);
}

async function inTheLoadedSector(): Promise<CampaignSession> {
  const session = await stubCampaignWithOurHummer(kit, SEED);
  await driveOurHummerInto(session, ENTERED);
  return session;
}

describe('the mercs aboard a vehicle of ours in the view (D16; Interface_Panels.cc GetUIApsToDisplay)', () => {
  it('lists them as our soldiers with their seat and the vehicle, at its tile, and leaves them off the map the client draws', async () => {
    const session = await inTheLoadedSector();
    const hummer = hummerOf(session);
    const [driver, passenger] = aboard(session);
    if (!driver || !passenger) throw new Error('two aboard needed');
    hummer.soldier.actionPoints = VEHICLE_APS;
    expect(listed(session, driver.id)).toMatchObject({ vehicle: { id: hummer.vehicleId, driver: true }, ap: VEHICLE_APS, squad: null });
    expect(listed(session, passenger.id)).toMatchObject({ vehicle: { id: hummer.vehicleId, driver: false }, squad: null });
    expect(listed(session, hummer.id)).toMatchObject({ vehicle: null, passengers: [driver.id, passenger.id] });
    const drawn = session
      .view()
      .soldiers.filter(onTheMap)
      .map((v) => v.id);
    expect(drawn).toContain(hummer.id);
    expect(drawn).not.toContain(driver.id);
    expect(drawn).not.toContain(passenger.id);
  });

  it("refuses their orders as inVehicle, the money panel's included, while their vehicle is the soldier selected", async () => {
    const session = await inTheLoadedSector();
    const [driver] = aboard(session);
    if (!driver) throw new Error('nobody aboard');
    const refusal = (cmd: Record<string, unknown> & { readonly type: string }) => {
      const result = session.dispatch(cmd);
      return result.ok ? 'ok' : result.data.refusal;
    };
    expect(refusal({ type: 'move', soldier: driver.id, to: gridNo(70, 70) })).toBe('inVehicle');
    expect(refusal({ type: 'withdrawCash', soldier: driver.id, amount: 100 })).toBe('inVehicle');
    expect(refusal({ type: 'select', soldier: driver.id })).toBe('inVehicle');
    expect(session.view().selected).toBe(hummerOf(session).id);
  });
});

describe('a vehicle of ours left empty (Soldier_Find.cc IsOwnedMerc)', () => {
  it('is no longer ours to select once everybody got off, and the view shows it empty (quirk)', async () => {
    const session = await inTheLoadedSector();
    expect(session.dispatch({ type: 'mapScreen' })).toMatchObject({ ok: true });
    for (const m of aboard(session)) expect(session.dispatch({ type: 'leaveVehicle', soldier: m.id })).toMatchObject({ ok: true });
    expect(session.dispatch({ type: 'tacticalScreen' })).toMatchObject({ ok: true });
    const hummer = hummerOf(session);
    expect(listed(session, hummer.id)).toMatchObject({ passengers: [] });
    expect(session.dispatch({ type: 'select', soldier: hummer.id })).toMatchObject({ ok: false, data: { refusal: 'noDriver' } });
  });
});

describe('the vehicles the strategic view names (D16; Vehicles.cc IsThisVehicleAccessibleToSoldier)', () => {
  function namedVehicles(session: CampaignSession): number[] {
    return (session.view().strategic?.vehicles ?? []).map((v) => v.id);
  }

  function civilianHummer(session: CampaignSession): number {
    const t = tactical(session);
    const hummer = t.soldiers.find((s) => s?.placed && s.bodyType === Body.HUMVEE && s.team !== Team.OUR);
    if (!hummer) throw new Error('no civilian Hummer in the sector');
    return hummer.vehicleId;
  }

  it('names a civilian vehicle only while a merc of ours could board it, which the Hummer needs the fact for', async () => {
    const session = await stubCampaignAtTheHummer(kit, SEED);
    const vid = civilianHummer(session);
    expect(namedVehicles(session)).not.toContain(vid);
    setFact(session.campaign.state.narrative, FACT_OK_USE_HUMMER, true);
    expect(namedVehicles(session)).toContain(vid);
  });

  it("never names an enemy's tank in the loaded sector, which the vehicle list holds", async () => {
    const session = await stubCampaignAtTheHummer(kit, SEED);
    const tank = addStubTank(tactical(session), { body: Body.TANK_NW, team: Team.ENEMY, gridNo: TANK_SPOT, direction: Direction.SOUTH });
    expect(tactical(session).vehicles[tank.vehicleId]?.valid).toBe(true);
    expect(namedVehicles(session)).not.toContain(tank.vehicleId);
  });
});
