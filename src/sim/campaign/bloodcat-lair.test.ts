import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { parseSectorString, strategicIndex } from '../../content/strategic/sector-ids.ts';
import { Rng } from '../../core/rng.ts';
import { addPlayerToGroup, createNewPlayerGroupDepartingFromSector } from '../strategic/forces/groups.ts';
import { groupArrivedAtSector, rebuildWayPointsForGroupPath } from '../strategic/forces/movement.ts';
import { removeCharacterFromSquads } from '../strategic/forces/squads.ts';
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

const BESIDE_THE_LAIR = parseSectorString('I15');
const LAIR = parseSectorString('I16');

function walkIntoTheLair(c: CampaignSim, id: number): void {
  const ctx = c.strategic;
  const merc = c.battle?.roster.get(id);
  if (!ctx || !merc) throw new Error('no strategic layer');
  removeCharacterFromSquads(ctx, id);
  merc.sector = { ...BESIDE_THE_LAIR };
  const g = createNewPlayerGroupDepartingFromSector(ctx, BESIDE_THE_LAIR);
  addPlayerToGroup(ctx, g, id);
  rebuildWayPointsForGroupPath(ctx, [strategicIndex(BESIDE_THE_LAIR), strategicIndex(LAIR)], g);
  groupArrivedAtSector(ctx, g, false, false);
}

describe('a group reaching an unvisited bloodcat lair', () => {
  it('lays the three corpses once, facing a draw of the strategic movement cosmetic stream', () => {
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 12, mercs: 2 });
    const [first, second] = roster.all().map((m) => m.id);
    if (first === undefined || second === undefined) throw new Error('two mercs');
    const facing = Rng.fromState(c.state.cosmetic.movement.state()).int(8);
    walkIntoTheLair(c, first);
    const corpses = c.state.sectorDiffs.get(sectorKey(LAIR))?.corpses ?? [];
    expect(corpses.map((k) => [k.gridNo, k.direction])).toEqual([
      [14319, facing],
      [9835, facing],
      [11262, facing],
    ]);
    walkIntoTheLair(c, second);
    expect(c.state.sectorDiffs.get(sectorKey(LAIR))?.corpses).toHaveLength(3);
  });
});
