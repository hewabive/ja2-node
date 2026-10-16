import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildTacticalWorldFromInputs,
  loadTacticalWorldInputs,
  type TacticalWorld,
  type TacticalWorldInputs,
} from '../../src/content/world/tactical-world.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import { openDataVfs } from '../../src/node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import type { SectorWorlds } from '../../src/sim/campaign/sector-flow.ts';
import type { TacticalContent } from '../../src/sim/tactical/content.ts';
import { loadTacticalContent } from '../../src/sim/tactical/load-content.ts';
import { buildStubs } from '../../stubs/build.ts';

export const STUB_MAPS = [
  'stubs/world/maps/a9.dat',
  'stubs/world/maps/a10.dat',
  'stubs/world/maps/a10_b1.dat',
  'stubs/world/maps/wilderness.dat',
  'stubs/world/maps/village.dat',
  'stubs/world/maps/n7.dat',
  'stubs/world/maps/p3.dat',
  'stubs/world/maps/p3_b1.dat',
] as const;

export interface StubSectorKit {
  readonly content: TacticalContent;
  readonly worlds: SectorWorlds;
  readonly read: ReadFile;
  world(path: string): TacticalWorld;
  dispose(): Promise<void>;
}

export async function loadStubSectorKit(): Promise<StubSectorKit> {
  const dir = await mkdtemp(join(tmpdir(), 'ja2-sector-stubs-'));
  await buildStubs(dir);
  const data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, stubsDir: dir });
  const read: ReadFile = async (path) => (data.vfs.stat(path) ? data.vfs.read(path) : null);
  const content = await loadTacticalContent(read);
  const inputs = new Map<string, TacticalWorldInputs>();
  for (const path of STUB_MAPS) inputs.set(path, await loadTacticalWorldInputs(read, path));
  const build = (path: string): TacticalWorld | null => {
    const i = inputs.get(path);
    return i ? buildTacticalWorldFromInputs(i) : null;
  };
  return {
    content,
    read,
    worlds: { exists: (path) => data.vfs.stat(path) !== undefined, world: build },
    world: (path) => {
      const w = build(path);
      if (!w) throw new Error(`no stub map ${path}`);
      return w;
    },
    dispose: async () => {
      await data.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
