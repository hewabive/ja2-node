import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { ReloadingSession } from '../../../tests/support/session-reload.ts';
import { driveOurHummerInto, stubCampaignWithOurHummer } from '../../../tests/support/vehicles.ts';
import type { CampaignSession } from '../../server/campaign-session.ts';
import { Assignment, VehicleSeat } from '../strategic/forces/constants.ts';
import { soldierTakeDamage } from '../tactical/combat/hit.ts';
import { DamageReason } from '../tactical/combat/types.ts';
import { type TacticalState, whoIsThere } from '../tactical/state.ts';
import type { RosterMerc } from './roster.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const SEED = 23;
const ENTERED = 'B9';
const OUR_VEHICLE_SLOT = 18;
const WRECKING_GUNFIRE = 3 * 100;
const DEATH_SECONDS = 30;

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

async function inTheLoadedSector(): Promise<CampaignSession> {
  const session = await stubCampaignWithOurHummer(kit, SEED);
  await driveOurHummerInto(session, ENTERED);
  return session;
}

describe('the mercs aboard a ground vehicle in the loaded sector (Soldier_Add.cc InternalAddSoldierToSector, Vehicles.cc UpdateAllVehiclePassengersGridNo)', () => {
  it('come in with it: registered in their merc slots before the vehicle in slot 18, then given its tile, with no occupant or structure', async () => {
    const session = await inTheLoadedSector();
    const t = tactical(session);
    const hummer = hummerOf(session).soldier;
    const seated = aboard(session);
    expect(hummer.id).toBe(OUR_VEHICLE_SLOT);
    expect(seated.map((m) => m.vehicleSeat)).toEqual([VehicleSeat.DRIVER, VehicleSeat.PASSENGER]);
    expect(seated.every((m) => m.id < hummer.id && t.mercSlots.includes(m.soldier))).toBe(true);
    expect(seated.map((m) => [m.soldier.placed, m.soldier.gridNo, m.soldier.structure])).toEqual([
      [true, hummer.gridNo, null],
      [true, hummer.gridNo, null],
    ]);
    expect(hummer.structure).not.toBeNull();
    expect(whoIsThere(t, hummer.gridNo, 0)).toBe(hummer);
    const listed = session.view().soldiers;
    expect(listed.find((v) => v.id === hummer.id)?.passengers).toEqual(seated.map((m) => m.id));
    expect(seated.map((m) => listed.find((v) => v.id === m.id)?.vehicle)).toEqual([
      { id: hummer.vehicleId, driver: true },
      { id: hummer.vehicleId, driver: false },
    ]);
  });

  it('get off on the map screen onto the grid, and on boarding again sit at the vehicle, leaving the tile they stood on free', async () => {
    const session = await inTheLoadedSector();
    expect(session.dispatch({ type: 'mapScreen' })).toMatchObject({ ok: true });
    const [, passenger] = aboard(session);
    if (!passenger) throw new Error('no passenger');
    expect(session.dispatch({ type: 'leaveVehicle', soldier: passenger.id })).toMatchObject({ ok: true });
    const off = roster(session).find((m) => m.id === passenger.id)?.soldier;
    const stoodAt = off?.gridNo ?? -1;
    expect([off?.vehicleSeat, off?.placed, off?.structure === null]).toEqual([VehicleSeat.NONE, true, false]);
    expect(whoIsThere(tactical(session), stoodAt, 0)).toBe(off);
    const hummer = hummerOf(session);
    expect(session.dispatch({ type: 'boardVehicle', soldier: passenger.id, vehicle: hummer.vehicleId })).toMatchObject({ ok: true });
    const on = roster(session).find((m) => m.id === passenger.id)?.soldier;
    const t = tactical(session);
    expect([on?.vehicleSeat, on?.placed, on?.gridNo, on?.structure]).toEqual([
      VehicleSeat.PASSENGER,
      true,
      hummerOf(session).soldier.gridNo,
      null,
    ]);
    expect(whoIsThere(t, stoodAt, 0)).toBeNull();
    expect(whoIsThere(t, hummerOf(session).soldier.gridNo, 0)).toBe(hummerOf(session).soldier);
  });
});

describe('the mercs aboard a ground vehicle destroyed in the loaded sector (Vehicles.cc KillAllInVehicle, KillPersonInVehicle)', () => {
  function wreck(session: CampaignSession): void {
    const t = tactical(session);
    soldierTakeDamage(t, hummerOf(session).soldier, WRECKING_GUNFIRE, 0, DamageReason.GUNFIRE, null);
  }

  it('each take 100 life and 100 breath of bleeding as tactical damage and die on its tile at once, sitting with no fall to play', async () => {
    const session = await inTheLoadedSector();
    const at = hummerOf(session).soldier.gridNo;
    wreck(session);
    const killed = aboard(session).map((m) => m.soldier);
    expect(killed.map((s) => [s.life, s.lastDamageReason, s.doingExternalDeath, s.placed, s.gridNo])).toEqual([
      [0, DamageReason.BLOODLOSS, true, false, at],
      [0, DamageReason.BLOODLOSS, true, false, at],
    ]);
    new ReloadingSession('wreck', session).advance({ worldSeconds: DEATH_SECONDS });
    const dead = roster(session).filter((m) => !m.isVehicle);
    expect(dead.map((m) => [m.assignment, m.vehicleSeat])).toEqual([
      [Assignment.ASSIGNMENT_DEAD, VehicleSeat.NONE],
      [Assignment.ASSIGNMENT_DEAD, VehicleSeat.NONE],
    ]);
  });

  it('are spared behind a merc already dead in an earlier seat: the killing stops at him (quirk)', async () => {
    const session = await inTheLoadedSector();
    const [driver, passenger] = aboard(session);
    if (!driver || !passenger) throw new Error('two aboard needed');
    driver.soldier.life = 0;
    wreck(session);
    expect([driver.soldier.life, passenger.soldier.life]).toEqual([0, passenger.soldier.lifeMax]);
    expect(passenger.soldier.doingExternalDeath).toBe(false);
  });
});
