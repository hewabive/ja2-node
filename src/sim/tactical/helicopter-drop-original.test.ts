import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { combatStats } from '../../../tests/support/combat.ts';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { withGraphicFacts } from '../../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../../content/vfs/vfs.ts';
import { Direction } from '../../content/world/grid.ts';
import { loadTacticalWorld, type TacticalWorld } from '../../content/world/tactical-world.ts';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { anim } from './anim-states.ts';
import { states } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { addMercToHeli, startHelicopterRun } from './helicopter-drop.ts';
import { loadTacticalContent } from './load-content.ts';
import { createSoldier, NOWHERE, type Soldier, Team } from './soldier.ts';
import { sectorMapOf } from './state.ts';
import { TacticalSim } from './tactical-sim.ts';

const A9 = 'maps/a9.dat';
const BUDGET = 20_000;

describe.skipIf(!ORIGINAL_DATA_DIR)('the helicopter drop with the original HELIDROP script on A9', () => {
  let data: DataVfs;
  let content: TacticalContent;
  let world: () => Promise<TacticalWorld>;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
    const read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));
    content = await loadTacticalContent(read);
    world = () => loadTacticalWorld(read, A9);
  });

  afterAll(async () => {
    await data.close();
  });

  async function dropOnA9(count: number): Promise<{ sim: TacticalSim; seats: Soldier[] }> {
    const sim = new TacticalSim(await world(), content, 7);
    const t = sim.state;
    const seats = Array.from({ length: count }, (_, id) => {
      const s = createSoldier({
        id,
        team: Team.OUR,
        name: `M${id}`,
        bodyType: 0,
        palettes: { hair: 'BLACKHEAD', skin: 'PINKSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' },
        stats: combatStats(70),
        life: 80,
        gridNo: NOWHERE,
        direction: Direction.NORTH,
        state: states(content.animations).STANDING,
      });
      t.soldiers[id] = s;
      addMercToHeli(t.helicopterDrop, id);
      return s;
    });
    startHelicopterRun(t, sectorMapOf(t).info.northGridNo);
    return { sim, seats };
  }

  function stepUntil(sim: TacticalSim, done: () => boolean): void {
    for (let tick = 0; tick < BUDGET; tick++) {
      sim.step();
      if (done()) return;
    }
    throw new Error('the drop did not get there');
  }

  it('plays HELIDROP to code 467, which frees the drop and stands the merc up into KNEEL_UP facing east with his walk pending', async () => {
    const { sim, seats } = await dropOnA9(1);
    const t = sim.state;
    const [merc] = seats as [Soldier];
    stepUntil(sim, () => merc.placed);
    expect(merc.state).toBe(anim(content, 'HELIDROP'));
    stepUntil(sim, () => !t.helicopterDrop.engagedInDrop);
    const named = states(content.animations);
    expect([merc.state, merc.pendingAnimation, merc.direction, merc.pathSize]).toEqual([named.KNEEL_UP, named.WALKING, Direction.EAST, 1]);
  });

  it('lands three seats where the native drop does, the north entry, the sweet spot beside and the entry again, and walks them to the native tiles (oracle helidrop block 1)', async () => {
    const { sim, seats } = await dropOnA9(3);
    const landed: number[] = [];
    for (const s of seats) {
      stepUntil(sim, () => s.placed);
      landed.push(s.gridNo);
    }
    stepUntil(sim, () => !sim.state.helicopterDrop.running);
    expect(landed).toEqual([4870, 4710, 4870]);
    expect(seats.map((s) => s.gridNo)).toEqual([4871, 4711, 5030]);
  });
});
