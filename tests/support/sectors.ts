import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AnimationTimelines, requireAnimationTimelines } from '../../src/content/anim/timelines.ts';
import { withGraphicFacts } from '../../src/content/rules/graphic-facts.ts';
import { buildMemoryRulePack, type RulePack } from '../../src/content/rules/pack.ts';
import { withSectorExitGrids } from '../../src/content/strategic/sector-maps.ts';
import { parseVfsAliases, VFS_ALIASES_FILE } from '../../src/content/vfs/aliases.ts';
import { type Vfs, vfsFileReader } from '../../src/content/vfs/vfs.ts';
import {
  buildTacticalWorldFromInputs,
  loadTacticalWorldInputs,
  type TacticalWorld,
  type TacticalWorldInputs,
} from '../../src/content/world/tactical-world.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import { openDataVfs, STUBS_PREFIX } from '../../src/node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import { nodeSha256, vfsRuleListing } from '../../src/server/rule-pack.ts';
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
  'stubs/world/maps/d5.dat',
  'stubs/world/maps/town.dat',
  'stubs/world/maps/mine.dat',
  'stubs/world/maps/camp.dat',
  'stubs/world/maps/airfield.dat',
  'stubs/world/maps/cave.dat',
] as const;

export interface StubSectorKit {
  readonly vfs: Vfs;
  rulePack(): Promise<RulePack>;
  readonly timelines: AnimationTimelines;
  readonly stubsDir: string;
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
  const read: ReadFile = withGraphicFacts(vfsFileReader(data.vfs));
  const content = await loadTacticalContent(read);
  const inputs = new Map<string, TacticalWorldInputs>();
  for (const path of STUB_MAPS) inputs.set(path, await loadTacticalWorldInputs(read, path));
  const aliases = parseVfsAliases(JSON.parse(await readFile(join(dir, VFS_ALIASES_FILE), 'utf8')));
  const aliased = (path: string): TacticalWorldInputs | null => {
    const target = aliases.get(path.slice(STUBS_PREFIX.length + 1));
    const i = target === undefined ? undefined : inputs.get(`${STUBS_PREFIX}/${target}`);
    return i ? { ...i, mapPath: path, map: withSectorExitGrids(i.map, path) } : null;
  };
  const build = (path: string): TacticalWorld | null => {
    const i = inputs.get(path) ?? aliased(path);
    return i ? buildTacticalWorldFromInputs(i) : null;
  };
  const timelines = await requireAnimationTimelines(read);
  let pack: Promise<RulePack> | null = null;
  return {
    vfs: data.vfs,
    rulePack: () => {
      pack ??= buildMemoryRulePack({
        source: 'stubs',
        listing: vfsRuleListing(data.vfs),
        read: (p) => data.vfs.read(p),
        sha256: nodeSha256,
      });
      return pack;
    },
    timelines,
    stubsDir: dir,
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
