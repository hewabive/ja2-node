import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../../tests/support/original-data.ts';
import { withGraphicFacts } from '../../../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../../../content/vfs/vfs.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { loadTacticalWorld } from '../../../content/world/tactical-world.ts';
import { tileIndex } from '../../../content/world/tile-tables.ts';
import type { ReadFile } from '../../../content/world/tileset-loader.ts';
import { type DataVfs, openDataVfs } from '../../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../../node/repo.ts';
import type { TacticalContent } from '../content.ts';
import { loadTacticalContent } from '../load-content.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { loadWorldItemsFromMap, Visibility, WorldItemFlags } from '../world-items.ts';
import { Detonator, detonatorOf } from './bomb-object.ts';
import { MineFlag } from './mine-flags.ts';
import { worldBombItems } from './world-bombs.ts';

const F9_MINE = 10498;
const SWITCH_MAPS = ['maps/d5.dat', 'maps/h14.dat', 'maps/k4_b1.dat', 'maps/l12.dat', 'maps/j9.dat'];

describe.skipIf(!ORIGINAL_DATA_DIR)('bombs and switches of the original maps', () => {
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

  async function loaded(path: string): Promise<TacticalSim> {
    const world = await loadTacticalWorld(read, path);
    const sim = new TacticalSim(world, content, 1);
    const sureToExist = world.map.items.map((record) => ({ ...record, nonExistChance: 0 }));
    loadWorldItemsFromMap(sim.state, sureToExist);
    return sim;
  }

  it("loads F9's mine armed and buried as its record stores it, its tile unmarked for the enemy", async () => {
    const t = (await loaded('maps/f9.dat')).state;
    const mine = worldBombItems(t).find((wi) => wi.gridNo === F9_MINE);
    expect(mine && [mine.visible, detonatorOf(mine.object), mine.flags & WorldItemFlags.ARMED_BOMB]).toEqual([
      Visibility.BURIED,
      Detonator.PRESSURE,
      WorldItemFlags.ARMED_BOMB,
    ]);
    expect(t.mineFlags.some((flags) => flags & MineFlag.ENEMY)).toBe(false);
  });

  it('loads every switch over a switch structure as a hand-worked switch and every other loose one as a pressure plate', async () => {
    const switchItem = content.items.byName.get('SWITCH')?.index;
    let checked = 0;
    for (const path of SWITCH_MAPS) {
      const t = (await loaded(path)).state;
      for (const wi of t.worldItems) {
        if (wi.object.item !== switchItem || wi.flags & WorldItemFlags.DONTRENDER) continue;
        const overSwitch = t.world.structures.find(wi.gridNo, StructureFlags.SWITCH) !== null;
        expect([path, wi.gridNo, detonatorOf(wi.object)]).toEqual([path, wi.gridNo, overSwitch ? Detonator.SWITCH : Detonator.PRESSURE]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('builds the blue flag as a generic, transparent structure without cells', async () => {
    const world = await loadTacticalWorld(read, 'maps/a9.dat');
    const flag = world.tiles[tileIndex(world.tables, 'FIRSTSWITCHES21')]?.structure;
    expect(flag?.flags).toBe(StructureFlags.GENERIC | StructureFlags.TRANSPARENT);
    expect(flag?.tiles.every((tile) => tile.flags === 0 && tile.shape.every((cells) => cells === 0))).toBe(true);
  });
});
