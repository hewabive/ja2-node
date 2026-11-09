import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { objectOf } from '../../../../tests/support/explosives.ts';
import { ORIGINAL_DATA_DIR } from '../../../../tests/support/original-data.ts';
import { withGraphicFacts } from '../../../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../../../content/vfs/vfs.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { type DataVfs, openDataVfs } from '../../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../../node/repo.ts';
import { animName } from '../anim-states.ts';
import type { TacticalContent } from '../content.ts';
import { loadTacticalContent } from '../load-content.ts';
import { Team } from '../soldier.ts';
import { addItemToPool, Visibility, WorldItemFlags } from '../world-items.ts';
import { Detonator, ItemAction, setActionValue, setDetonator } from './bomb-object.ts';
import { handleExplosionQueue, setOffBombsInGridNo } from './bomb-queue.ts';

const PIT = gridNo(80, 80);
const MAX_TICKS = 2_000;
const SUNK_HEIGHT = -20;

describe.skipIf(!ORIGINAL_DATA_DIR)('the fall into a pit with the original script (Soldier_Ani.cc code 754)', () => {
  let data: DataVfs;
  let content: TacticalContent;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
    content = await loadTacticalContent(withGraphicFacts((path) => vfsFileReader(data.vfs)(path)));
  });
  afterAll(async () => {
    await data.close();
  });

  it('sinks the merc ten steps of two through FALL_INTO_PIT and takes him off the map at its last code, back at ground height', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, PIT, Direction.SOUTH);
    const pit = objectOf(t, 'ACTION_ITEM');
    setDetonator(pit, Detonator.PRESSURE);
    setActionValue(pit, ItemAction.SMALL_PIT);
    addItemToPool(t, PIT, pit, Visibility.BURIED, 0, WorldItemFlags.ARMED_BOMB);
    setOffBombsInGridNo(t, merc, PIT, false, 0);
    handleExplosionQueue(t);
    expect(animName(content, merc.state)).toBe('FALL_INTO_PIT');
    let lowest = 0;
    for (let tick = 0; tick < MAX_TICKS && merc.placed; tick++) {
      sim.step();
      if (merc.placed) lowest = Math.min(lowest, merc.heightAdjustment);
    }
    expect([merc.placed, lowest, merc.heightAdjustment, merc.insertionData]).toEqual([false, SUNK_HEIGHT, 0, PIT]);
  });
});
