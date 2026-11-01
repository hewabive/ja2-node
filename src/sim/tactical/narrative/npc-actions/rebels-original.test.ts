import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fakeActionEnv } from '../../../../../tests/support/npc-actions.ts';
import { ORIGINAL_DATA_DIR } from '../../../../../tests/support/original-data.ts';
import { withGraphicFacts } from '../../../../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../../../../content/vfs/vfs.ts';
import { has, StructureFlags } from '../../../../content/world/structures.ts';
import { loadTacticalWorld } from '../../../../content/world/tactical-world.ts';
import { tileIndex } from '../../../../content/world/tile-tables.ts';
import { type DataVfs, openDataVfs } from '../../../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../../../node/repo.ts';
import { Npc } from '../../../strategic/narrative/npc-ids.ts';
import { loadTacticalContent } from '../../load-content.ts';
import { applyMapChanges, type MapChange, MapChangeKind, type StructTileChangeKind, structTileChange } from '../../map-changes.ts';
import type { TacticalState } from '../../state.ts';
import { TacticalSim } from '../../tactical-sim.ts';
import { tileChangeViews } from '../../world-view.ts';
import { handleNpcDoAction } from './catalog.ts';
import { NpcActionCode } from './codes.ts';
import { NO_HIDEOUT_ACTIONS } from './env.ts';

const TRAPDOOR = 7887;
const MOVED_CRATE = 8207;

describe.skipIf(!ORIGINAL_DATA_DIR)('the rebel hideout on the original A10', () => {
  let data: DataVfs;
  const read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
  });
  afterAll(async () => {
    await data.close();
  });

  it('takes the crate standing on the trapdoor off it, puts it two rows south and shows the open trapdoor once A10 loads again', async () => {
    const [content, world] = await Promise.all([loadTacticalContent(read), loadTacticalWorld(read, 'maps/a10.dat')]);
    const changes: MapChange[] = [];
    const record = (kind: StructTileChangeKind) => (gridNo: number, tile: string) =>
      changes.push(structTileChange(kind, gridNo, tileIndex(world.tables, tile)));
    const hideout = {
      ...NO_HIDEOUT_ACTIONS,
      addStructToUnloadedMap: record(MapChangeKind.APPEND_STRUCT_TILE),
      removeStructFromUnloadedMap: record(MapChangeKind.REMOVE_STRUCT_TILE),
    };
    handleNpcDoAction({ ...fakeActionEnv(), hideout }, Npc.FATIMA, NpcActionCode.GOTO_HIDEOUT, 0);
    const crate = tileIndex(world.tables, 'SECONDOSTRUCT1');
    const crateDef = world.tiles[crate]?.structure;
    const cratesAt = (t: TacticalState, g: number) =>
      t.world.structures.at(g).filter((s) => has(s.flags, StructureFlags.BASE_TILE) && s.def === crateDef).length;
    const t = new TacticalSim(world, content, 1).state;
    expect([cratesAt(t, TRAPDOOR), cratesAt(t, MOVED_CRATE)]).toEqual([1, 0]);
    applyMapChanges(t, changes);
    expect([cratesAt(t, TRAPDOOR), cratesAt(t, MOVED_CRATE)]).toEqual([0, 1]);
    expect(tileChangeViews(t)).toEqual([
      { kind: 'remove', gridNo: TRAPDOOR, level: 0, tile: crate },
      { kind: 'append', gridNo: MOVED_CRATE, level: 0, tile: crate },
      { kind: 'append', gridNo: TRAPDOOR, level: 0, tile: tileIndex(world.tables, 'DEBRIS2MISC1') },
    ]);
  });
});
