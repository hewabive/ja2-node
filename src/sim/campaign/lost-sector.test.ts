import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { parseSectorString, sectorId, strategicIndex } from '../../content/strategic/sector-ids.ts';
import { evaluateGroupSituation } from '../strategic/ai/orders.ts';
import { EnemyIntention, MoveType } from '../strategic/forces/constants.ts';
import { createNewEnemyGroupDepartingFromSector } from '../strategic/forces/groups.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const DRASSEN_SECTOR = parseSectorString('C13');
const REINFORCEMENTS = 10;

describe('a sector lost without a battle', () => {
  it('announces the important sector that enemy reinforcements walk into', () => {
    const { campaign: c } = createTestCampaign(kit, { seed: 3, mercs: 1 });
    const q = c.queen;
    if (!q) throw new Error('no strategic AI');
    q.state.queen.awake = true;
    const element = c.state.map.elements[strategicIndex(DRASSEN_SECTOR)];
    if (!element) throw new Error('no map element');
    element.enemyControlled = false;
    const garrison = q.state.queen.garrisons.find((gg) => gg.sector === sectorId(DRASSEN_SECTOR));
    if (!garrison) throw new Error('no Drassen garrison');
    const g = createNewEnemyGroupDepartingFromSector(q, sectorId(DRASSEN_SECTOR), 0, REINFORCEMENTS, 0);
    if (!g.enemy) throw new Error('not an enemy group');
    g.size = REINFORCEMENTS;
    g.moveType = MoveType.ONE_WAY;
    g.enemy.intention = EnemyIntention.REINFORCEMENTS;
    garrison.pendingGroup = g.id;
    c.drainEvents();
    expect(evaluateGroupSituation(q, g)).toBe(true);
    expect(element.enemyControlled).toBe(true);
    const notices = c.drainEvents().filter((e) => e.type === 'sectorLost' || e.type === 'sectorControlChanged');
    expect(notices).toMatchObject([{ type: 'sectorLost', sector: 'C13', kind: 'town' }]);
  });
});
