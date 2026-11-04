import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { withGraphicFacts } from '../../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../../content/vfs/vfs.ts';
import { DIRECTION_INCREMENT, Direction, gridNo } from '../../content/world/grid.ts';
import { loadTacticalWorld } from '../../content/world/tactical-world.ts';
import type { ReadFile } from '../../content/world/tileset-loader.ts';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import type { SimEvent } from '../events.ts';
import { addCorpseStructure } from './combat/death.ts';
import type { TacticalContent } from './content.ts';
import { InvSlot } from './inventory.ts';
import { loadTacticalContent } from './load-content.ts';
import { NO_PROFILE, Team } from './soldier.ts';
import { TacticalSim } from './tactical-sim.ts';
import { isCuttableWireFenceAtGridNo } from './tile-tools.ts';

const B13_FENCE = gridNo(98, 20);
const WEST_OF_B13_FENCE = gridNo(95, 20);
const ORIGIN = gridNo(80, 80);
const EAST = DIRECTION_INCREMENT[Direction.EAST] ?? 0;

describe.skipIf(!ORIGINAL_DATA_DIR)('tools on tiles with the original scripts (Soldier_Ani.cc codes 481 and 760)', () => {
  let data: DataVfs;
  let read: ReadFile;
  let content: TacticalContent;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
    read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));
    content = await loadTacticalContent(read);
  });
  afterAll(async () => {
    await data.close();
  });

  it("cuts B13's wire fence at the cut code of CUTTING_FENCE", async () => {
    const sim = new TacticalSim(await loadTacticalWorld(read, 'maps/b13.dat'), content, 1);
    spawnSoldier(sim, 0, Team.OUR, WEST_OF_B13_FENCE, Direction.EAST, { gun: 'WIRECUTTERS' });
    expect(isCuttableWireFenceAtGridNo(sim.state, B13_FENCE)).toBe(true);
    expect(sim.dispatch({ type: 'cutFence', soldier: 0, gridNo: B13_FENCE })).toEqual({ ok: true });
    const events: SimEvent[] = runUntilIdle(sim);
    expect(isCuttableWireFenceAtGridNo(sim.state, B13_FENCE)).toBe(false);
    expect(events.filter((e) => e.type === 'fenceCut')).toHaveLength(1);
  });

  it('fills the jar at the blood code of TAKE_BLOOD_FROM_CORPSE', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const type = content.corpses.table.types.indexOf('ADULTMONSTER_DEAD');
    const at = ORIGIN + EAST;
    const corpse = { gridNo: at, level: 0, heightAdjustment: 0, bodyType: 0, direction: Direction.NORTH, state: 0, profile: NO_PROFILE };
    t.corpses.push({ ...corpse, type, timeOfDeath: 0, headTaken: false, servicingCrows: 0 });
    addCorpseStructure(t, at, 0, type, Direction.NORTH);
    const merc = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST, { gun: 'JAR' });
    expect(sim.dispatch({ type: 'fillJar', soldier: 0, gridNo: at })).toEqual({ ok: true });
    runUntilIdle(sim);
    expect(content.items.byIndex.get(merc.inv[InvSlot.HAND]?.item ?? 0)?.name).toBe('JAR_CREATURE_BLOOD');
  });
});
