import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { readDataJson } from '../../../tests/support/tactical.ts';
import { parseMap } from '../../content/formats/map.ts';
import { itemIndex, loadItemTable, NOTHING } from '../../content/items/items.ts';
import { vfsFileReader } from '../../content/vfs/vfs.ts';
import { MINOR_MAP_VERSION, updateOldVersionMap } from '../../content/world/map-version.ts';
import { loadTacticalWorldInputs } from '../../content/world/tactical-world.ts';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { ObjectFlags } from '../items/object.ts';
import { buildSoldierInitList } from './init-list.ts';
import { InvSlot } from './inventory.ts';

const OLDEST_SHIPPED_VERSION = 24;
const RELIT_CAVE_MAP = 'maps/p1_b2.dat';
const CAVES_LIGHT_LEVEL_OF_VERSION_25 = 13;

interface StoredItem {
  readonly map: string;
  readonly placement: number;
  readonly slot: number;
  readonly item: string;
}

const ITEMS_STORED_WITHOUT_THE_FLAG: readonly StoredItem[] = [
  { map: 'maps/n3.dat', placement: 19, slot: InvSlot.BIGPOCK3, item: 'GL_SMOKE_GRENADE' },
  { map: 'maps/e11_a.dat', placement: 41, slot: InvSlot.BIGPOCK2, item: 'HAND_GRENADE' },
];
const I13_ELITE = 36;
const DROPPABLE_EMPTY_I13_ELITE_SLOTS = [InvSlot.HEAD1, InvSlot.HEAD2, InvSlot.SMALLPOCK1, InvSlot.SMALLPOCK8];

describe.skipIf(!ORIGINAL_DATA_DIR)('the version updates of the original maps on load', () => {
  let data: DataVfs;
  const read = (path: string) => vfsFileReader(data.vfs)(path);
  const mapAt = async (path: string) => parseMap(await data.vfs.read(path));
  const locked = (flags: number | undefined) => ((flags ?? 0) & ObjectFlags.NO_OVERWRITE) !== 0;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
  });
  afterAll(async () => {
    await data.close();
  });

  it('find every shipped map at minor version 24 or 25, so that of the old-version fixes only the version 25 one applies: it relights P1_B2, the one cave map at 24', async () => {
    const paths = data.vfs
      .list()
      .map((f) => f.path)
      .filter((p) => p.startsWith('maps/') && p.endsWith('.dat'));
    const versions = new Set<number>();
    const relit: string[] = [];
    for (const path of paths) {
      const map = await mapAt(path);
      versions.add(map.info.mapVersion);
      if (updateOldVersionMap(map).ambient?.lightLevel !== map.ambient?.lightLevel) relit.push(path);
    }
    expect([...versions].sort()).toEqual([OLDEST_SHIPPED_VERSION, MINOR_MAP_VERSION]);
    expect(relit).toEqual([RELIT_CAVE_MAP]);
    expect((await loadTacticalWorldInputs(read, RELIT_CAVE_MAP)).map.ambient?.lightLevel).toBe(CAVES_LIGHT_LEVEL_OF_VERSION_25);
  });

  it("lock the grenades that N3's and E11's enemy placements store without the no-overwrite flag, which the soldiers then carry", async () => {
    const items = await loadItemTable(async (path) => readDataJson(path));
    for (const stored of ITEMS_STORED_WITHOUT_THE_FLAG) {
      const map = await mapAt(stored.map);
      const raw = map.placements[stored.placement]?.detailedRaw;
      expect(raw).toBeTruthy();
      const record = buildSoldierInitList(map)[stored.placement]?.detail?.inventory[stored.slot];
      expect([record?.item, locked(record?.flags)]).toEqual([itemIndex(items, stored.item), true]);
    }
  });

  it("lock the droppable empty slots of I13's elite, which random equipment then leaves empty", async () => {
    const node = buildSoldierInitList(await mapAt('maps/i13.dat'))[I13_ELITE];
    const slots = DROPPABLE_EMPTY_I13_ELITE_SLOTS.map((slot) => node?.detail?.inventory[slot]);
    expect(slots.map((o) => [o?.item, locked(o?.flags)])).toEqual(slots.map(() => [NOTHING, true]));
  });
});
