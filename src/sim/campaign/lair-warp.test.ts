import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad, ourSoldiers } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { reloadPoint } from '../../../tests/support/reload.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { Direction } from '../../content/world/grid.ts';
import { LAIR_DESTROYED } from '../strategic/creatures/creatures.ts';
import { InsertionCode } from '../strategic/forces/constants.ts';
import { Quest } from '../strategic/narrative/fact-ids.ts';
import { QuestStatus } from '../strategic/narrative/facts.ts';
import type { CampaignSim } from './campaign-sim.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const DRASSEN_LAIR = 1;
const LAIR_ENTRANCE = { x: 13, y: 7, z: 2 };
const DRASSEN_MINE_EXIT = { x: 13, y: 4, z: 1 };
const DRASSEN_MINE = { x: 13, y: 4, z: 0 };
const WARP_GRID_NO = 20700;
const CAVE_LADDER = 64 * 160 + 74;
const NO_GARRISON = { admins: 0, troops: 0, elites: 0 };

function inLairLevel(seed: number, sector: typeof LAIR_ENTRANCE, questDone: boolean): CampaignSim {
  const { campaign, roster } = createTestCampaign(kit, { seed, garrison: NO_GARRISON });
  landFirstSquad(campaign);
  const creatures = campaign.state.creatures;
  creatures.lairId = LAIR_DESTROYED;
  creatures.destroyedLairId = DRASSEN_LAIR;
  if (questDone) campaign.state.narrative.quests[Quest.CREATURES] = QuestStatus.DONE;
  for (const m of roster.all()) {
    m.sector = { ...sector };
    m.insertionCode = InsertionCode.CENTER;
  }
  for (const g of campaign.state.forces.groups) if (g.player) g.sector = { ...sector };
  expect(campaign.sectors?.setCurrentWorldSector(sector)).toBe(true);
  reloadPoint(campaign);
  return campaign;
}

describe('the warp out of a creature lair', () => {
  it('takes every conscious merc of the lair level to the mine exit on the surface, facing north-west', () => {
    const c = inLairLevel(31, LAIR_ENTRANCE, true);
    const [first] = ourSoldiers(c);
    if (!first) throw new Error('no merc');
    const warped = c.dispatch({ type: 'exitSector', soldier: first.id, exitGrid: CAVE_LADDER, warp: true });
    expect(warped).toEqual({ ok: true, data: { warp: true, target: 'D13', level: 0 } });
    expect(c.state.worldSector).toEqual(DRASSEN_MINE);
    const placed = ourSoldiers(c);
    expect(placed).toHaveLength(4);
    expect(placed.some((s) => s.gridNo === WARP_GRID_NO)).toBe(true);
    expect(placed.every((s) => s.direction === Direction.NORTHWEST)).toBe(true);
    expect(c.state.movement.tacticalTraversal.active).toBe(false);
  });

  it('is refused before the creature quest is done and on the mine levels above the lair', () => {
    const early = inLairLevel(32, LAIR_ENTRANCE, false);
    const soldier = ourSoldiers(early)[0]?.id;
    const refused = { ok: false, reason: expect.stringContaining('creature quest is done') };
    expect(early.dispatch({ type: 'exitSector', soldier, exitGrid: CAVE_LADDER, warp: true })).toMatchObject(refused);
    expect(early.state.worldSector).toEqual(LAIR_ENTRANCE);
    const mineExit = inLairLevel(33, DRASSEN_MINE_EXIT, true);
    const miner = ourSoldiers(mineExit)[0]?.id;
    expect(mineExit.dispatch({ type: 'exitSector', soldier: miner, exitGrid: CAVE_LADDER, warp: true })).toMatchObject(refused);
    expect(mineExit.dispatch({ type: 'exitSector', soldier: miner, exitGrid: CAVE_LADDER, who: 'squad' })).toMatchObject({ ok: true });
  });
});
