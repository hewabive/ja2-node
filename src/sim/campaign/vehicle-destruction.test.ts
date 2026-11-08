import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, type CampaignOptions, createTestCampaign, landFirstSquad } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { reloadPoint } from '../../../tests/support/reload.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import { soldierTakeDamage } from '../tactical/combat/hit.ts';
import { DamageReason } from '../tactical/combat/types.ts';
import { newSoldierCreate, tacticalCreateSoldier } from '../tactical/creation.ts';
import { NEUTRAL_POPULATION, soldierSlotTaken } from '../tactical/init-list.ts';
import { setSoldierPosition } from '../tactical/movement.ts';
import { Body, firstFreeSoldierId, type Soldier, Team } from '../tactical/soldier.ts';
import { registerSoldier, type TacticalState } from '../tactical/state.ts';
import type { CampaignSim } from './campaign-sim.ts';
import type { RosterMerc } from './roster.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const NO_GARRISON = { admins: 0, troops: 0, elites: 0 };
const OPTIONS: CampaignOptions = { seed: 15, garrison: NO_GARRISON };
const PARKED_AT = 9000;
const VEHICLE_LIFE = 80;
const WRECKING_GUNFIRE = 3 * VEHICLE_LIFE;
const SKULL_TICKS = 2_000;

function tacticalOf(c: CampaignSim): TacticalState {
  const t = c.tactical?.state;
  if (!t) throw new Error('no loaded sector');
  return t;
}

function rosterOf(c: CampaignSim): RosterMerc[] {
  const roster = c.battle?.roster;
  if (!roster) throw new Error('no roster');
  return roster.all().filter((m) => m.inSector);
}

function parkOurHummer(t: TacticalState): Soldier {
  const id = firstFreeSoldierId((n) => soldierSlotTaken(t, n), Team.OUR, Body.HUMVEE);
  const create = { ...newSoldierCreate(Team.OUR, Body.HUMVEE, 0, PARKED_AT), life: VEHICLE_LIFE, lifeMax: VEHICLE_LIFE };
  const s = tacticalCreateSoldier(t, create, id, NEUTRAL_POPULATION);
  if (!s) throw new Error('no Hummer');
  registerSoldier(t, s);
  setSoldierPosition(t, s, PARKED_AT);
  s.placed = true;
  return s;
}

function wreckWithTwoAboard(firstAlreadyDead: boolean): { readonly first: RosterMerc; readonly second: RosterMerc } {
  const { campaign } = createTestCampaign(kit, OPTIONS);
  landFirstSquad(campaign);
  const hummer = parkOurHummer(tacticalOf(campaign));
  const [first, second] = rosterOf(campaign);
  if (!first || !second) throw new Error('two mercs needed');
  const v = campaign.state.forces.vehicles[hummer.vehicleId];
  if (!v) throw new Error('the Hummer has no vehicle');
  for (const [seat, m] of [first, second].entries()) {
    v.passengers[seat] = m.id;
    campaign.battle?.roster.removeFromGridNo(m.id);
  }
  if (firstAlreadyDead) first.soldier.life = 0;
  reloadPoint(campaign);
  const t = tacticalOf(campaign);
  const wreck = t.soldiers[hummer.id];
  if (!wreck) throw new Error('the Hummer is gone');
  soldierTakeDamage(t, wreck, WRECKING_GUNFIRE, 0, DamageReason.GUNFIRE, null);
  for (let tick = 0; tick < SKULL_TICKS && tacticalOf(campaign).pendingSkullReleases.length > 0; tick++) campaign.step();
  reloadPoint(campaign);
  const roster = campaign.battle?.roster;
  const reread = (m: RosterMerc) => {
    const now = roster?.get(m.id);
    if (!now) throw new Error(`merc ${m.id} is gone`);
    return now;
  };
  return { first: reread(first), second: reread(second) };
}

describe('the mercs aboard a destroyed vehicle (Vehicles.cc KillAllInVehicle)', () => {
  it('die in seat order when their vehicle is destroyed in the loaded sector, in the sector until their skulls are done (HandleTakeDamageDeath, Soldier_Control.cc:5366)', () => {
    const { first, second } = wreckWithTwoAboard(false);
    expect([first.life, second.life]).toEqual([0, 0]);
    expect([first.assignment, second.assignment]).toEqual([Assignment.ASSIGNMENT_DEAD, Assignment.ASSIGNMENT_DEAD]);
  });

  it('are spared behind a merc already dead in an earlier seat: the killing stops at him (quirk)', () => {
    const { first, second } = wreckWithTwoAboard(true);
    expect(first.life).toBe(0);
    expect(second.life).toBeGreaterThan(0);
    expect(second.assignment).not.toBe(Assignment.ASSIGNMENT_DEAD);
  });
});
