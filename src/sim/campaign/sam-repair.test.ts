import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { reloadPoint } from '../../../tests/support/reload.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { type Sector, sectorFromId, sectorId, strategicIndex } from '../../content/strategic/sector-ids.ts';
import { tileIndex } from '../../content/world/tile-tables.ts';
import { evaluateGroupSituation } from '../strategic/ai/orders.ts';
import { EnemyIntention, MoveType, SectorFlag } from '../strategic/forces/constants.ts';
import { createNewEnemyGroupDepartingFromSector } from '../strategic/forces/groups.ts';
import { getSectorFlagStatus, sectorInfo } from '../strategic/map/sectors.ts';
import { addStructTileToTail, MapChangeKind, structLayerAt } from '../tactical/map-changes.ts';
import { tileChangeViews } from '../tactical/world-view.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { sectorKey } from './sector-diff.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const NO_GARRISON = { admins: 0, troops: 0, elites: 0 };
const NO_GARRISON_COUNTS = { numAdmins: 0, numTroops: 0, numElites: 0 };
const REINFORCEMENTS = 6;
const D2_TERMINAL = { gridNo: 10196, working: 'EIGHTISTRUCT4', damaged: 'EIGHTISTRUCT2' };
const D15_TERMINAL = { gridNo: 11295, working: 'EIGHTISTRUCT3', damaged: 'EIGHTISTRUCT1' };

function samSector(campaign: CampaignSim, index: number): Sector {
  const site = campaign.strategic?.content.samSites[index];
  if (!site) throw new Error('no SAM site');
  return sectorFromId(site.sector);
}

function reinforceGarrison(campaign: CampaignSim, sector: Sector): void {
  const q = campaign.queen;
  if (!q) throw new Error('no strategic AI');
  q.state.queen.awake = true;
  const garrison = q.state.queen.garrisons.find((g) => g.sector === sectorId(sector));
  if (!garrison) throw new Error('no garrison');
  const g = createNewEnemyGroupDepartingFromSector(q, sectorId(sector), 0, REINFORCEMENTS, 0);
  if (!g.enemy) throw new Error('not an enemy group');
  g.size = REINFORCEMENTS;
  g.moveType = MoveType.ONE_WAY;
  g.enemy.intention = EnemyIntention.REINFORCEMENTS;
  garrison.pendingGroup = g.id;
  expect(evaluateGroupSituation(q, g)).toBe(true);
}

function loadSector(campaign: CampaignSim, sector: Sector): void {
  const flow = campaign.sectors;
  if (!flow) throw new Error('no sector flow');
  Object.assign(sectorInfo(campaign.state.map, sector), NO_GARRISON_COUNTS);
  for (const m of flow.setup.roster.all()) m.sector = { ...sector };
  for (const g of campaign.state.forces.groups) if (g.player) g.sector = { ...sector };
  expect(flow.setCurrentWorldSector(sector)).toBe(true);
}

function tile(campaign: CampaignSim, name: string): number {
  const tables = campaign.sectors?.setup.content.tileTables;
  if (!tables) throw new Error('no tile tables');
  return tileIndex(tables, name);
}

describe("the Queen's reinforcements repairing a SAM site (UpdateSAMDoneRepair)", () => {
  it("writes the terminal's swap into the stored changes of an unloaded SAM sector, by the site's orientation and also for a site never damaged, and the next load shows the working terminal", () => {
    const { campaign } = createTestCampaign(kit, { seed: 4, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    const d2 = samSector(campaign, 0);
    const d15 = samSector(campaign, 1);
    reinforceGarrison(campaign, d2);
    reinforceGarrison(campaign, d15);
    reloadPoint(campaign);
    const stored = (s: Sector) => campaign.state.sectorDiffs.get(sectorKey(s))?.mapChanges?.map((c) => [c.kind, c.gridNo, c.tile]);
    expect(stored(d2)).toEqual([
      [MapChangeKind.REMOVE_STRUCT_TILE, D2_TERMINAL.gridNo, tile(campaign, D2_TERMINAL.damaged)],
      [MapChangeKind.APPEND_STRUCT_TILE, D2_TERMINAL.gridNo, tile(campaign, D2_TERMINAL.working)],
    ]);
    expect(stored(d15)).toEqual([
      [MapChangeKind.REMOVE_STRUCT_TILE, D15_TERMINAL.gridNo, tile(campaign, D15_TERMINAL.damaged)],
      [MapChangeKind.APPEND_STRUCT_TILE, D15_TERMINAL.gridNo, tile(campaign, D15_TERMINAL.working)],
    ]);
    expect(getSectorFlagStatus(campaign.state.map, d2, SectorFlag.MAP_MODIFICATIONS_TEMP_FILE_EXISTS)).toBe(true);
    loadSector(campaign, d2);
    const t = campaign.tactical?.state;
    if (!t) throw new Error('no sector');
    expect(structLayerAt(t, D2_TERMINAL.gridNo)).toContain(tile(campaign, D2_TERMINAL.working));
    expect(structLayerAt(t, D2_TERMINAL.gridNo)).not.toContain(tile(campaign, D2_TERMINAL.damaged));
  });

  it('swaps the damaged terminal for the working one in the loaded map when the SAM sector is the world sector', () => {
    const { campaign } = createTestCampaign(kit, { seed: 4, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    const d2 = samSector(campaign, 0);
    loadSector(campaign, d2);
    const left = campaign.tactical?.state;
    if (!left) throw new Error('no sector');
    addStructTileToTail(left, D2_TERMINAL.gridNo, tile(campaign, D2_TERMINAL.damaged));
    const element = campaign.state.map.elements[strategicIndex(d2)];
    if (!element) throw new Error('no map element');
    element.samCondition = 0;
    reinforceGarrison(campaign, d2);
    reloadPoint(campaign);
    const t = campaign.tactical?.state;
    if (!t) throw new Error('no sector');
    expect(campaign.state.map.elements[strategicIndex(d2)]?.samCondition).toBe(100);
    expect(structLayerAt(t, D2_TERMINAL.gridNo)).toContain(tile(campaign, D2_TERMINAL.working));
    expect(structLayerAt(t, D2_TERMINAL.gridNo)).not.toContain(tile(campaign, D2_TERMINAL.damaged));
    expect(
      tileChangeViews(t)
        .filter((c) => c.gridNo === D2_TERMINAL.gridNo)
        .map((c) => [c.kind, c.tile]),
    ).toEqual([
      ['append', tile(campaign, D2_TERMINAL.damaged)],
      ['remove', tile(campaign, D2_TERMINAL.damaged)],
      ['append', tile(campaign, D2_TERMINAL.working)],
    ]);
    expect(campaign.state.sectorDiffs.get(sectorKey(d2))?.mapChanges ?? null).toBeNull();
  });
});
