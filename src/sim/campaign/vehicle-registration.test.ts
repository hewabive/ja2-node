import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type CampaignKit,
  type CampaignOptions,
  createTestCampaign,
  landFirstSquad,
  testCampaignAdapter,
} from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { reloadPoint } from '../../../tests/support/reload.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { TransportMask } from '../../content/strategic/policy.ts';
import { createCampaignSession } from '../../server/campaign-factory.ts';
import { getGroup } from '../strategic/forces/groups.ts';
import { newSoldierCreate, tacticalCreateSoldier } from '../tactical/creation.ts';
import { NEUTRAL_POPULATION, soldierSlotTaken } from '../tactical/init-list.ts';
import { setSoldierPosition } from '../tactical/movement.ts';
import { Body, firstFreeSoldierId, type Soldier, Team } from '../tactical/soldier.ts';
import { registerSoldier, type TacticalState } from '../tactical/state.ts';
import { removeVehicleFromList } from '../vehicles/vehicle-list.ts';
import type { CampaignSim } from './campaign-sim.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const A9 = { x: 9, y: 1, z: 0 };
const NO_GARRISON = { admins: 0, troops: 0, elites: 0 };
const OPTIONS: CampaignOptions = { seed: 15, garrison: NO_GARRISON };
const PARKED_AT = 9000;
const VEHICLE_LIFE = 80;

function tacticalOf(c: CampaignSim): TacticalState {
  const t = c.tactical?.state;
  if (!t) throw new Error('no loaded sector');
  return t;
}

function parkVehicle(t: TacticalState, team: number, body: number, at = PARKED_AT): Soldier {
  const id = firstFreeSoldierId((n) => soldierSlotTaken(t, n), team, body);
  const create = { ...newSoldierCreate(team, body, 0, at), life: VEHICLE_LIFE, lifeMax: VEHICLE_LIFE };
  const s = tacticalCreateSoldier(t, create, id, NEUTRAL_POPULATION);
  if (!s) throw new Error(`no vehicle of body ${body}`);
  registerSoldier(t, s);
  setSoldierPosition(t, s, at);
  s.placed = true;
  return s;
}

function landedCampaign(): CampaignSim {
  const { campaign } = createTestCampaign(kit, OPTIONS);
  landFirstSquad(campaign);
  return campaign;
}

describe('the vehicle list of a campaign, shared by the strategic and tactical layers (Vehicles.cc pVehicleList)', () => {
  it('registers a vehicle of the loaded sector in the strategic list with the movement group of its slot set out for it (Vehicles.cc AddVehicleToList)', () => {
    const campaign = landedCampaign();
    const t = tacticalOf(campaign);
    expect(t.vehicles).toBe(campaign.state.forces.vehicles);
    const truck = parkVehicle(t, Team.CIV, Body.ICECREAMTRUCK);
    reloadPoint(campaign);
    const forces = campaign.state.forces;
    const v = forces.vehicles[truck.vehicleId];
    expect(v).toMatchObject({ valid: true, sector: A9, soldierId: truck.id, movementGroup: forces.vehicleGroupIds[truck.vehicleId] });
    const ctx = campaign.strategic;
    const g = ctx && v ? getGroup(ctx, v.movementGroup) : undefined;
    expect(g).toMatchObject({ transportMask: TransportMask.CAR, sector: A9, next: A9, traverseTime: 0, arrivalTime: 0 });
  });

  it('keeps one list through a snapshot: what one layer changes, the other sees, and the campaign still registers', () => {
    const campaign = landedCampaign();
    const before = parkVehicle(tacticalOf(campaign), Team.CIV, Body.HUMVEE);
    const adapter = testCampaignAdapter(kit, OPTIONS);
    const restored = adapter.restore(adapter.snapshot(campaign), campaign);
    const t = tacticalOf(restored);
    const forces = restored.state.forces;
    expect(t.vehicles).toBe(forces.vehicles);
    const parked = forces.vehicles[before.vehicleId];
    if (parked) removeVehicleFromList(parked);
    expect(t.vehicles[before.vehicleId]?.valid).toBe(false);
    const after = parkVehicle(t, Team.CIV, Body.ICECREAMTRUCK, PARKED_AT + 4);
    expect(after.vehicleId).toBe(before.vehicleId);
    const ctx = restored.strategic;
    const g = ctx ? getGroup(ctx, forces.vehicles[after.vehicleId]?.movementGroup ?? 0) : undefined;
    expect(g?.transportMask).toBe(TransportMask.CAR);
  });

  it('gives a vehicle that joins us through the recruit flow soldier id 18, then 19 (Soldier_Create.cc TacticalCreateSoldier)', async () => {
    const { campaign } = await createCampaignSession(kit.sectors.read, (p) => kit.sectors.worlds.exists(p), OPTIONS.seed);
    const t = tacticalOf(campaign);
    const hummers = [parkVehicle(t, Team.CIV, Body.HUMVEE), parkVehicle(t, Team.CIV, Body.HUMVEE, PARKED_AT + 4)];
    const recruit = campaign.talk?.npcActions.recruitFlow;
    const joined = hummers.map((h) => recruit?.changeTeam(h, Team.OUR) ?? null);
    expect(joined.map((s) => s?.id)).toEqual([18, 19]);
    expect(joined.map((s) => s?.vehicleId)).toEqual(hummers.map((h) => h.vehicleId));
    expect(joined.map((s) => (s ? campaign.state.forces.vehicles[s.vehicleId]?.soldierId : null))).toEqual([18, 19]);
  });

  it('drops the vehicles not on our team from the list when the sector unloads and keeps ours, which come back with their ids (WorldDef.cc TrashWorld)', () => {
    const campaign = landedCampaign();
    const t = tacticalOf(campaign);
    const civilian = parkVehicle(t, Team.CIV, Body.ICECREAMTRUCK);
    const tank = parkVehicle(t, Team.ENEMY, Body.TANK_NW, PARKED_AT + 4);
    const ours = parkVehicle(t, Team.OUR, Body.HUMVEE, PARKED_AT + 8);
    reloadPoint(campaign);
    campaign.sectors?.trashWorld();
    reloadPoint(campaign);
    const vehicles = campaign.state.forces.vehicles;
    expect([civilian, tank, ours].map((s) => vehicles[s.vehicleId]?.valid)).toEqual([false, false, true]);
  });
});
