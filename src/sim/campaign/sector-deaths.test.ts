import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad, ourSoldiers } from '../../../tests/support/campaign.ts';
import { spawnSoldier } from '../../../tests/support/combat.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { StrategicMove } from '../../content/strategic/map-tables.ts';
import { strategicIndex } from '../../content/strategic/sector-ids.ts';
import { Town } from '../strategic/economy/constants.ts';
import { setTownLoyalty } from '../strategic/economy/loyalty.ts';
import { sectorInfo, Traversability } from '../strategic/map/sectors.ts';
import { NarrativeHistory } from '../strategic/narrative/history-codes.ts';
import { worldDay } from '../strategic/time/world-clock.ts';
import { handleSoldierDeath } from '../tactical/combat/death.ts';
import { soldierTakeDamage } from '../tactical/combat/hit.ts';
import { DamageReason } from '../tactical/combat/types.ts';
import { Body, type Soldier, TEAM_FIRST_ID, TEAM_SIZES, Team } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
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
const A10 = { x: 10, y: 1, z: 0 };
const NORTH = 0;
const NO_GARRISON = { admins: 0, troops: 0, elites: 0 };
const OMERTA_RATING = 50;
const CARLOS = 58;
const KILLED_CIVILIAN_REPUTATION_LOSS = 5;

function never(): never {
  throw new Error('missing');
}

function loadedA9(seed: number, troops = 0): { campaign: CampaignSim; t: TacticalState; merc: Soldier } {
  const { campaign } = createTestCampaign(kit, { seed, garrison: { ...NO_GARRISON, troops } });
  landFirstSquad(campaign);
  const t = campaign.tactical?.state ?? never();
  return { campaign, t, merc: ourSoldiers(campaign)[0] ?? never() };
}

function freeId(t: TacticalState, team: number): number {
  const first = TEAM_FIRST_ID[team] ?? never();
  for (let id = first; id < first + (TEAM_SIZES[team] ?? 0); id++) if (!t.soldiers[id]?.placed) return id;
  return never();
}

function newcomer(campaign: CampaignSim, team: number, near: Soldier, profile?: number): Soldier {
  const sim = campaign.tactical ?? never();
  return spawnSoldier(sim, freeId(sim.state, team), team, near.gridNo + 2, NORTH, profile === undefined ? {} : { profile });
}

function kill(t: TacticalState, victim: Soldier, killer: Soldier | null): void {
  Object.assign(victim, { life: 0, attacker: killer, intendedTarget: killer !== null });
  handleSoldierDeath(t, victim);
}

function omerta(campaign: CampaignSim) {
  return campaign.state.economy.towns[Town.OMERTA] ?? never();
}

function startOmerta(campaign: CampaignSim): void {
  setTownLoyalty(campaign.economy ?? never(), Town.OMERTA, OMERTA_RATING);
}

describe('civilian and militia deaths in a loaded town sector', () => {
  it('turns our murder of a civilian into the KILLED_CIVILIAN morale event (its reputation loss) and the distance-spread loyalty loss', () => {
    const { campaign, t, merc } = loadedA9(41);
    startOmerta(campaign);
    const reputation = campaign.state.status.badReputation;
    kill(t, newcomer(campaign, Team.CIV, merc), merc);
    expect(campaign.state.status.badReputation).toBe(reputation + KILLED_CIVILIAN_REPUTATION_LOSS);
    expect(omerta(campaign)).toMatchObject({ rating: OMERTA_RATING - 2, change: -110 });
  });

  it('treats a militia death as no murder: only the strategic militia count and NATIVE_KILLED change', () => {
    const { campaign, merc } = loadedA9(43);
    Object.assign(sectorInfo(campaign.state.map, A10), { numAdmins: 0, numTroops: 0, numElites: 0, militia: [2, 0, 0] });
    expect(campaign.sectors?.setCurrentWorldSector(A10)).toBe(true);
    const t = campaign.tactical?.state ?? never();
    startOmerta(campaign);
    const reputation = campaign.state.status.badReputation;
    const militia = t.soldiers.find((s) => s?.placed && s.team === Team.MILITIA) ?? never();
    kill(t, militia, merc);
    expect(sectorInfo(campaign.state.map, A10).militia).toEqual([1, 0, 0]);
    expect(campaign.state.status.badReputation).toBe(reputation);
    expect(omerta(campaign)).toMatchObject({ rating: OMERTA_RATING, change: -19 });
  });

  it('logs a profiled death as killed by our merc or as an NPC death, and nothing for a vehicle', () => {
    const { campaign, t, merc } = loadedA9(47);
    const history = campaign.state.laptop.history;
    kill(t, newcomer(campaign, Team.CIV, merc, CARLOS), merc);
    expect(history.at(-1)).toMatchObject({ code: NarrativeHistory.MERC_KILLED_CHARACTER, secondCode: CARLOS, x: A9.x, y: A9.y, z: 0 });
    const other = newcomer(campaign, Team.CIV, merc, CARLOS + 1);
    kill(t, other, null);
    expect(history.at(-1)).toMatchObject({ code: NarrativeHistory.NPC_KILLED, secondCode: CARLOS + 1 });
    const count = history.length;
    const truck = newcomer(campaign, Team.CIV, merc, CARLOS + 2);
    truck.bodyType = Body.ICECREAMTRUCK;
    kill(t, truck, merc);
    expect(history).toHaveLength(count);
  });
});

describe('player activity from damage', () => {
  function hurt(t: TacticalState, s: Soldier, by: Soldier): void {
    soldierTakeDamage(t, s, 1, 0, DamageReason.GUNFIRE, by);
  }

  it('counts a hit on an enemy in an enemy-held or non-town sector and a hit on any creature, as the current day', () => {
    const { campaign, t, merc } = loadedA9(53, 1);
    const map = campaign.state.map;
    const today = worldDay(campaign.state.clock);
    const element = map.elements[strategicIndex(A9)] ?? never();
    const through = sectorInfo(map, A9).traversability;
    const enemy = t.soldiers.find((s) => s?.placed && s.team === Team.ENEMY) ?? never();
    const reset = () => {
      map.activity.lastDayOfPlayerActivity = today - 1;
      map.activity.daysOfInactivity = 2;
    };
    element.enemyControlled = false;
    through[StrategicMove.THROUGH] = Traversability.TOWN;
    reset();
    hurt(t, enemy, merc);
    hurt(t, newcomer(campaign, Team.CIV, merc), merc);
    expect(map.activity).toMatchObject({ lastDayOfPlayerActivity: today - 1, daysOfInactivity: 2 });
    hurt(t, newcomer(campaign, Team.CREATURE, merc), merc);
    expect(map.activity).toMatchObject({ lastDayOfPlayerActivity: today, daysOfInactivity: 0 });
    reset();
    element.enemyControlled = true;
    hurt(t, enemy, merc);
    expect(map.activity).toMatchObject({ lastDayOfPlayerActivity: today, daysOfInactivity: 0 });
    reset();
    element.enemyControlled = false;
    through[StrategicMove.THROUGH] = Traversability.PLAINS;
    hurt(t, enemy, merc);
    expect(map.activity).toMatchObject({ lastDayOfPlayerActivity: today, daysOfInactivity: 0 });
  });
});
