import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { withSpeechLengths } from '../../src/content/audio/speech-lengths.ts';
import type { LayerCount } from '../../src/content/narrative/npc-records.ts';
import { withGraphicFacts } from '../../src/content/rules/graphic-facts.ts';
import {
  buildTacticalWorldFromInputs,
  loadTacticalWorldInputs,
  type TacticalWorld,
  type TacticalWorldInputs,
} from '../../src/content/world/tactical-world.ts';
import { parseTileTables, TILE_TABLES_PATH, type TileTables } from '../../src/content/world/tile-tables.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import { openDataVfs } from '../../src/node/data-vfs.ts';
import { DEFAULT_STUBS_DIR, PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import type { TacticalContent } from '../../src/sim/tactical/content.ts';
import { loadTacticalContent } from '../../src/sim/tactical/load-content.ts';
import { type Arena, arenaMapBytes } from './arena.ts';

export type DataSource = 'stubs' | 'original';

export interface BenchData {
  readonly source: DataSource;
  readonly dataDir: string | null;
  readonly savesDir: string | null;
  readonly read: ReadFile;
  readonly layers: LayerCount;
  exists(path: string): boolean;
  content(): Promise<TacticalContent>;
  world(path: string): Promise<TacticalWorld>;
  addArena(arena: Arena): Promise<string>;
  close(): Promise<void>;
}

export interface BenchDataOptions {
  readonly dataDir?: string | undefined;
  readonly stubsDir?: string | undefined;
}

function savesDirFor(dataDir: string | null): string | null {
  const explicit = process.env.JA2_SAVES_DIR;
  if (explicit) return explicit;
  return dataDir ? join(dirname(dataDir), 'SavedGames') : null;
}

export async function openBenchData(options: BenchDataOptions): Promise<BenchData> {
  const stubsDir = options.stubsDir ?? DEFAULT_STUBS_DIR;
  if (!existsSync(stubsDir)) throw new Error(`no stub pack at ${stubsDir}: run pnpm stubs`);
  const data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: options.dataDir || undefined, stubsDir });
  const overlay = new Map<string, Uint8Array>();
  const read: ReadFile = withSpeechLengths(
    withGraphicFacts(async (path) => overlay.get(path) ?? (data.vfs.stat(path) ? data.vfs.read(path) : null)),
    data.vfs,
  );
  let content: Promise<TacticalContent> | null = null;
  let tables: TileTables | null = null;
  const worlds = new Map<string, Promise<TacticalWorldInputs>>();
  const tileTables = async (): Promise<TileTables> => {
    if (tables) return tables;
    const bytes = await read(TILE_TABLES_PATH);
    if (!bytes) throw new Error(`missing ${TILE_TABLES_PATH}`);
    tables = parseTileTables(JSON.parse(new TextDecoder().decode(bytes)));
    return tables;
  };
  return {
    source: data.dataDir ? 'original' : 'stubs',
    dataDir: data.dataDir,
    savesDir: savesDirFor(data.dataDir),
    read,
    layers: (path) => data.vfs.layerCount(path),
    exists: (path) => overlay.has(path) || data.vfs.stat(path) !== undefined,
    content: () => {
      content ??= loadTacticalContent(read);
      return content;
    },
    world: async (path) => {
      const inputs = worlds.get(path) ?? loadTacticalWorldInputs(read, path);
      worlds.set(path, inputs);
      return buildTacticalWorldFromInputs(await inputs);
    },
    addArena: async (arena) => {
      if (!overlay.has(arena.path)) overlay.set(arena.path, arenaMapBytes(arena, await tileTables()));
      return arena.path;
    },
    close: () => data.close(),
  };
}
