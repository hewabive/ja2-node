import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../../tests/support/campaign.ts';
import { spawnCreature } from '../../../tests/support/creatures.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { MAX_SAVE_VERSION } from '../../content/formats/savegame.ts';
import type { SavedPreBattleInfo } from '../../content/formats/savegame-tactical.ts';
import { strategicIndex } from '../../content/strategic/sector-ids.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { createCampaignSession } from '../../server/campaign-factory.ts';
import { EncounterCode } from '../strategic/forces/constants.ts';
import { getGroup } from '../strategic/forces/groups.ts';
import { importPreBattleState } from '../strategic/map/save-import.ts';
import { Fact } from '../strategic/narrative/fact-ids.ts';
import { setFact } from '../strategic/narrative/facts.ts';
import { Situation } from '../tactical/ai/actions.ts';
import { Body, NOWHERE, TEAM_FIRST_ID, Team } from '../tactical/soldier.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { runNativeLoadHooks } from './native-load-hooks.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const A9 = { x: 9, y: 1, z: 0 };
const B9 = { x: 9, y: 2, z: 0 };
const DRASSEN_REFUEL_SECTOR = { x: 13, y: 2, z: 0 };
const NO_GARRISON = { admins: 0, troops: 0, elites: 0 };
const CAT_TILE = gridNo(80, 80);
const MAX_MISC_NOISE_DURATION = 12;
const SQUAD = 3;
const MISSING_GROUP = 250;
const PERSISTENT_GROUP_SECTOR = { x: 1, y: 1, z: 0 };

function landed(): CampaignSim {
  const { campaign } = createTestCampaign(kit, { seed: 5, mercs: 2, garrison: NO_GARRISON });
  landFirstSquad(campaign);
  return campaign;
}

function savedPreBattle(encounterCode: number): SavedPreBattleInfo {
  return {
    persistent: true,
    encounterCode,
    explicitEncounterCode: EncounterCode.NO_ENCOUNTER,
    battleSectorLocator: true,
    sector: A9,
    cantRetreat: false,
  };
}

function bloodcatIn(campaign: CampaignSim) {
  const tactical = campaign.tactical;
  if (!tactical) throw new Error('no loaded sector');
  return spawnCreature(tactical, TEAM_FIRST_ID[Team.CREATURE], Body.BLOODCAT, CAT_TILE, Direction.NORTH);
}

function mapCenter(campaign: CampaignSim): number {
  const center = campaign.tactical?.state.world.map?.info.centerGridNo ?? -1;
  if (center === -1) throw new Error('the loaded map has no centre');
  return center;
}

function creatureNoise(campaign: CampaignSim): [number | undefined, number | undefined] {
  const p = campaign.tactical?.state.perception;
  return [p?.publicNoiseGridNo[Team.CREATURE], p?.publicNoiseVolume[Team.CREATURE]];
}

describe('the hooks a native load runs at its end (SaveLoadGame.cc LoadSavedGame)', () => {
  it('keeps the squad of a save made in a bloodcat ambush in its sector while a bloodcat lives, and calls the cats to the map centre (Map_Screen_Interface.cc:3822, SaveLoadGame.cc:1193)', () => {
    const campaign = landed();
    const cat = bloodcatIn(campaign);
    importPreBattleState(campaign.state, savedPreBattle(EncounterCode.BLOODCAT_AMBUSH));
    runNativeLoadHooks(campaign, MAX_SAVE_VERSION);
    expect(creatureNoise(campaign)).toEqual([mapCenter(campaign), MAX_MISC_NOISE_DURATION]);
    expect(cat.ai.newSituation).toBe(Situation.IS_NEW);
    expect(campaign.dispatch({ type: 'route', soldier: 0, to: 'B9' })).toEqual({
      ok: false,
      reason: 'the squad cannot move: inCombat',
      data: { refusal: 'inCombat', soldier: 0 },
    });
  });

  it('calls the enemies on the saved ambush code alone, which outlives its battle until a squad next arrives: the locator off and the ambush fought elsewhere (Knowledge.cc:49, Strategic_Movement.cc:728)', () => {
    const campaign = landed();
    const cat = bloodcatIn(campaign);
    importPreBattleState(campaign.state, { ...savedPreBattle(EncounterCode.ENEMY_AMBUSH), battleSectorLocator: false, sector: B9 });
    runNativeLoadHooks(campaign, MAX_SAVE_VERSION);
    expect(creatureNoise(campaign)).toEqual([mapCenter(campaign), MAX_MISC_NOISE_DURATION]);
    expect(cat.ai.newSituation).toBe(Situation.IS_NEW);
  });

  it('calls nobody while the saved encounter is no ambush (Knowledge.cc:49)', () => {
    const campaign = landed();
    const cat = bloodcatIn(campaign);
    importPreBattleState(campaign.state, savedPreBattle(EncounterCode.ENTERING_BLOODCAT_LAIR));
    runNativeLoadHooks(campaign, MAX_SAVE_VERSION);
    expect(creatureNoise(campaign)[0]).toBe(NOWHERE);
    expect(cat.ai.newSituation).not.toBe(Situation.IS_NEW);
  });

  it('gives a squad whose movement group is gone a new persistent group departing from A1 (Squads.cc:907 CheckSquadMovementGroups)', () => {
    const campaign = landed();
    const ids = campaign.state.forces.squadGroupIds;
    const kept = ids.filter((_, q) => q !== SQUAD);
    ids[SQUAD] = MISSING_GROUP;
    runNativeLoadHooks(campaign, MAX_SAVE_VERSION);
    const strategic = campaign.strategic;
    if (!strategic) throw new Error('no strategic layer');
    const recreated = getGroup(strategic, ids[SQUAD] ?? MISSING_GROUP);
    expect(recreated).toMatchObject({ player: true, persistent: true, sector: PERSISTENT_GROUP_SECTOR, members: [] });
    expect(ids.filter((_, q) => q !== SQUAD)).toEqual(kept);
  });
});

async function newGame(): Promise<CampaignSim> {
  const session = await createCampaignSession(kit.sectors.read, (p) => kit.sectors.worlds.exists(p), 7, { hire: [] });
  return session.campaign;
}

const LAST_VERSION_WITH_STALE_REFUEL_SITES = 89;
const LAST_VERSION_WITHOUT_SPECK_PAYMENTS = 90;
const SPECK_PAID_AS_SAVED = 1000;

function freeDrassenSkies(campaign: CampaignSim): void {
  const drassen = campaign.state.map.elements[strategicIndex(DRASSEN_REFUEL_SECTOR)];
  if (!drassen) throw new Error('no Drassen refuel sector');
  drassen.enemyControlled = false;
  drassen.enemyAirControlled = false;
}

function mercListingProfiles(campaign: CampaignSim): { listed: readonly number[]; larry: number; drunkLarry: number } {
  const content = campaign.laptop?.content;
  if (!content) throw new Error('no laptop');
  const larry = content.namedProfiles.LARRY_NORMAL ?? -1;
  return { listed: content.mercListings.map((l) => l.profile), larry, drunkLarry: content.namedProfiles.LARRY_DRUNK ?? -1 };
}

describe('the fix-ups a native load runs for older save versions (SaveLoadGame.cc:1150-1160)', () => {
  it("brings the refuel sites of a save of version 89 or lower up to the airspace and the Estoni fact, and keeps a later save's as saved (Map_Screen_Helicopter.cc:613 UpdateRefuelSiteAvailability)", async () => {
    const sitesAfterLoad = async (version: number) => {
      const campaign = await newGame();
      freeDrassenSkies(campaign);
      const sites = campaign.state.forces.helicopter.refuelSiteAvailable;
      sites.splice(0, sites.length, false, true);
      runNativeLoadHooks(campaign, version);
      return [...campaign.state.forces.helicopter.refuelSiteAvailable];
    };
    expect(await sitesAfterLoad(LAST_VERSION_WITH_STALE_REFUEL_SITES)).toEqual([true, false]);
    expect(await sitesAfterLoad(LAST_VERSION_WITH_STALE_REFUEL_SITES + 1)).toEqual([false, true]);
  });

  it("adds every M.E.R.C. listing merc's cost to date to Speck's total below version 91, the drunk Larry's for Larry's listing once he has relapsed (Mercs.cc:1692 CalcAproximateAmountPaidToSpeck)", async () => {
    const paidAfterLoad = async (version: number) => {
      const campaign = await newGame();
      const { listed, larry, drunkLarry } = mercListingProfiles(campaign);
      const costs = campaign.state.finances.profileCostToDate;
      const [first, second] = listed.filter((p) => p !== larry);
      costs.set(first ?? -1, 300);
      costs.set(second ?? -1, 20);
      costs.set(larry, 4000);
      costs.set(drunkLarry, 50_000);
      setFact(campaign.state.narrative, Fact.LARRY_CHANGED, true);
      const merc = campaign.state.laptop.merc;
      merc.totalMoneyPaidToSpeck = SPECK_PAID_AS_SAVED;
      runNativeLoadHooks(campaign, version);
      return merc.totalMoneyPaidToSpeck;
    };
    expect(await paidAfterLoad(LAST_VERSION_WITHOUT_SPECK_PAYMENTS)).toBe(SPECK_PAID_AS_SAVED + 300 + 20 + 50_000);
    expect(await paidAfterLoad(LAST_VERSION_WITHOUT_SPECK_PAYMENTS + 1)).toBe(SPECK_PAID_AS_SAVED);
  });
});
