import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../../tests/support/original-data.ts';
import { withGraphicFacts } from '../../../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../../../content/vfs/vfs.ts';
import { spacesAway } from '../../../content/world/grid.ts';
import { loadTacticalWorld } from '../../../content/world/tactical-world.ts';
import { type DataVfs, openDataVfs } from '../../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../../node/repo.ts';
import { addSoldierInitListTeamToWorld, buildSoldierInitList, NEUTRAL_POPULATION } from '../init-list.ts';
import { loadTacticalContent } from '../load-content.ts';
import { Orders, Team } from '../soldier.ts';
import { TacticalSim } from '../tactical-sim.ts';

const PABLO = 98;
const SAL = 99;
const WALDO = 138;
const RNDPTPATROL_RANGE = 10;
const GREEN_TICKS = 24_000;

describe.skipIf(!ORIGINAL_DATA_DIR)('the named random point patrollers of the original B13', () => {
  let data: DataVfs;
  const read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
  });
  afterAll(async () => {
    await data.close();
  });

  it('keep their orders and patrol points after a fresh load, and stay within the roaming range of those points', async () => {
    const [content, world] = await Promise.all([loadTacticalContent(read), loadTacticalWorld(read, 'maps/b13.dat')]);
    const sim = new TacticalSim(world, content, 1);
    const t = sim.state;
    t.initList = buildSoldierInitList(sim.world.map);
    addSoldierInitListTeamToWorld(t, Team.CIV, { ...NEUTRAL_POPULATION, profileHere: () => true });
    const named = [PABLO, SAL, WALDO].map((profile) => {
      const s = t.soldiers.find((x) => x?.profile === profile);
      const node = t.initList.find((n) => n.detail?.profile === profile);
      if (!s || !node) throw new Error(`profile ${profile} is not in B13`);
      const points = node.basic.patrolGrid.slice(1, node.basic.patrolCount + 1);
      return { s, points, start: node.basic.startingGridNo, farthest: 0 };
    });
    for (const n of named) expect(n.s.ai.patrolGrid).toEqual([n.start, ...n.points]);
    for (let k = 0; k < GREEN_TICKS; k++) {
      sim.step();
      for (const n of named) n.farthest = Math.max(n.farthest, Math.min(...n.points.map((p) => spacesAway(n.s.gridNo, p))));
    }
    expect(named.map((n) => [n.s.profile, n.s.ai.orders])).toEqual([
      [PABLO, Orders.RNDPTPATROL],
      [SAL, Orders.RNDPTPATROL],
      [WALDO, Orders.RNDPTPATROL],
    ]);
    for (const n of named) expect(n.farthest).toBeLessThanOrEqual(RNDPTPATROL_RANGE);
  });
});
