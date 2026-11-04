import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../../tests/support/original-data.ts';
import { withGraphicFacts } from '../../../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../../../content/vfs/vfs.ts';
import { loadTacticalWorld } from '../../../content/world/tactical-world.ts';
import type { ReadFile } from '../../../content/world/tileset-loader.ts';
import { type DataVfs, openDataVfs } from '../../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../../node/repo.ts';
import type { TacticalContent } from '../content.ts';
import { loadTacticalContent } from '../load-content.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { loadWorldItemsFromMap } from '../world-items.ts';
import { initPanicSystem, PanicFlags, type PanicState } from './panic-triggers.ts';

const BOTH = PanicFlags.BOMBS_HERE | PanicFlags.TRIGGERS_HERE;
const NONE = { gridNo: -1, isAlarm: false, tolerance: 0 };

describe.skipIf(!ORIGINAL_DATA_DIR)('the panic triggers of the original maps (World_Items.cc FindPanicBombsAndTriggers)', () => {
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

  async function panicOf(path: string): Promise<Pick<PanicState, 'flags' | 'triggers'>> {
    const world = await loadTacticalWorld(read, path);
    const sim = new TacticalSim(world, content, 1);
    loadWorldItemsFromMap(
      sim.state,
      world.map.items.map((record) => ({ ...record, nonExistChance: 0 })),
    );
    initPanicSystem(sim.state);
    return { flags: sim.state.panic.flags, triggers: sim.state.panic.triggers };
  }

  it('puts each trigger beside its switch, south of the left-facing one in I13 and east of the others, with its tolerance and alarm flag', async () => {
    expect(await panicOf('maps/i13.dat')).toEqual({
      flags: BOTH,
      triggers: [{ gridNo: 12067, isAlarm: false, tolerance: 35 }, NONE, NONE],
    });
    expect(await panicOf('maps/h13.dat')).toEqual({
      flags: BOTH,
      triggers: [{ gridNo: 11119, isAlarm: false, tolerance: 50 }, NONE, NONE],
    });
    expect(await panicOf('maps/p1_b1.dat')).toEqual({
      flags: BOTH,
      triggers: [{ gridNo: 12755, isAlarm: true, tolerance: 15 }, NONE, NONE],
    });
    expect(await panicOf('maps/i8.dat')).toEqual({ flags: BOTH, triggers: [NONE, { gridNo: 14801, isAlarm: false, tolerance: 80 }, NONE] });
  });

  it('gives Tixa two triggers, and the palace basement in P3 panic bombs without a trigger, for its remote bomb triggers', async () => {
    const tixa = await panicOf('maps/j9.dat');
    expect(tixa.triggers.map((trigger) => trigger.gridNo)).toEqual([9376, 9216, -1]);
    expect((await panicOf('maps/p3_b1.dat')).flags).toBe(PanicFlags.BOMBS_HERE);
  });
});
