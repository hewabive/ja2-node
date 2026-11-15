import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../../tests/support/campaign.ts';
import { spawnCreature } from '../../../tests/support/creatures.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import type { SavedPreBattleInfo } from '../../content/formats/savegame-tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { EncounterCode } from '../strategic/forces/constants.ts';
import { getGroup } from '../strategic/forces/groups.ts';
import { importPreBattleState } from '../strategic/map/save-import.ts';
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
  it('keeps the squad of a save made in a bloodcat ambush in its sector while a bloodcat lives, and calls the cats to the map centre (Map_Screen_Interface.cc:3798, SaveLoadGame.cc:1195)', () => {
    const campaign = landed();
    const cat = bloodcatIn(campaign);
    importPreBattleState(campaign.state, savedPreBattle(EncounterCode.BLOODCAT_AMBUSH));
    runNativeLoadHooks(campaign);
    expect(creatureNoise(campaign)).toEqual([mapCenter(campaign), MAX_MISC_NOISE_DURATION]);
    expect(cat.ai.newSituation).toBe(Situation.IS_NEW);
    expect(campaign.dispatch({ type: 'route', soldier: 0, to: 'B9' })).toEqual({
      ok: false,
      reason: 'the squad cannot move: inCombat',
      data: { refusal: 'inCombat', soldier: 0 },
    });
  });

  it('calls the enemies on the saved ambush code alone, which outlives its battle until a squad next arrives: the locator off and the ambush fought elsewhere (Knowledge.cc:49, Strategic_Movement.cc:731)', () => {
    const campaign = landed();
    const cat = bloodcatIn(campaign);
    importPreBattleState(campaign.state, { ...savedPreBattle(EncounterCode.ENEMY_AMBUSH), battleSectorLocator: false, sector: B9 });
    runNativeLoadHooks(campaign);
    expect(creatureNoise(campaign)).toEqual([mapCenter(campaign), MAX_MISC_NOISE_DURATION]);
    expect(cat.ai.newSituation).toBe(Situation.IS_NEW);
  });

  it('calls nobody while the saved encounter is no ambush (Knowledge.cc:49)', () => {
    const campaign = landed();
    const cat = bloodcatIn(campaign);
    importPreBattleState(campaign.state, savedPreBattle(EncounterCode.ENTERING_BLOODCAT_LAIR));
    runNativeLoadHooks(campaign);
    expect(creatureNoise(campaign)[0]).toBe(NOWHERE);
    expect(cat.ai.newSituation).not.toBe(Situation.IS_NEW);
  });

  it('gives a squad whose movement group is gone a new persistent group departing from A1 (Squads.cc:904 CheckSquadMovementGroups)', () => {
    const campaign = landed();
    const ids = campaign.state.forces.squadGroupIds;
    const kept = ids.filter((_, q) => q !== SQUAD);
    ids[SQUAD] = MISSING_GROUP;
    runNativeLoadHooks(campaign);
    const strategic = campaign.strategic;
    if (!strategic) throw new Error('no strategic layer');
    const recreated = getGroup(strategic, ids[SQUAD] ?? MISSING_GROUP);
    expect(recreated).toMatchObject({ player: true, persistent: true, sector: PERSISTENT_GROUP_SECTOR, members: [] });
    expect(ids.filter((_, q) => q !== SQUAD)).toEqual(kept);
  });
});
