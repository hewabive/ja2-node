import { describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { parseTilesetDatabase, TILESET_DATABASE_PATH } from '../formats/ja2set.ts';
import { encodeStiIndexed, encodeStiRgb } from '../formats/sti.ts';
import { vfsFileReader } from '../vfs/vfs.ts';
import { parseTileTables, TILE_TABLES_PATH } from '../world/tile-tables.ts';
import { loadTileSurfaceGeometry, loadTileSurfaces, type ReadFile } from '../world/tileset-loader.ts';
import {
  animationFrameCount,
  decodeGraphicFacts,
  encodeGraphicFacts,
  type GraphicFacts,
  graphicFactsOf,
  graphicFactsPath,
  readGraphicFacts,
  stiFrameGeometry,
  withGraphicFacts,
} from './graphic-facts.ts';

const SLOW_MS = 120_000;
const PALETTE = new Uint8Array(768);
const APP_DATA = { wallOrientation: 2, numberOfTiles: 3, tileLocationIndex: 4, currentFrame: 0, numberOfFrames: 9, flags: 1 };

function indexedSti(): Uint8Array {
  return encodeStiIndexed({
    palette: PALETTE,
    subImages: [
      { offsetX: -3, offsetY: 5, width: 2, height: 1, pixels: Uint8Array.of(1, 2) },
      { offsetX: 7, offsetY: -1, width: 1, height: 2, pixels: Uint8Array.of(3, 4) },
    ],
    appData: [APP_DATA, { ...APP_DATA, numberOfFrames: 0 }],
  });
}

function json(read: ReadFile, path: string): Promise<unknown> {
  return read(path).then((bytes) => JSON.parse(new TextDecoder().decode(bytes ?? new Uint8Array())));
}

async function expectSameGeometry(read: ReadFile, roots: readonly string[], tilesets: number): Promise<number> {
  const tables = parseTileTables(await json(read, TILE_TABLES_PATH));
  const facts = withGraphicFacts(read);
  let compared = 0;
  for (const root of roots) {
    const db = parseTilesetDatabase((await read(root + TILESET_DATABASE_PATH)) ?? new Uint8Array());
    for (let id = 0; id < Math.min(tilesets, db.tilesets.length); id++) {
      const pictures = await loadTileSurfaces(read, tables, db, id, root);
      const geometry = await loadTileSurfaceGeometry(facts, tables, db, id, root);
      geometry.forEach((g, i) => {
        const p = pictures[i];
        if (!p) return;
        expect(g).toEqual({ type: p.type, path: p.path, frames: p.frames, auxData: p.auxData, structures: p.structures, picture: null });
        compared++;
      });
    }
  }
  return compared;
}

describe('graphic facts', () => {
  it('keep the frame geometry and app data of an indexed STI', () => {
    const facts = graphicFactsOf('tilesets/0/wall.sti', indexedSti());
    expect(facts).toEqual({
      kind: 'indexed',
      frames: [
        { offsetX: -3, offsetY: 5, width: 2 },
        { offsetX: 7, offsetY: -1, width: 1 },
      ],
      appData: [APP_DATA, { ...APP_DATA, numberOfFrames: 0 }],
    });
    expect(decodeGraphicFacts(encodeGraphicFacts(facts))).toEqual(facts);
    expect(animationFrameCount(facts)).toBe(9);
  });

  it('tell RGB pictures, other bytes and broken files apart like the decoders did', () => {
    const rgb = graphicFactsOf('loadscreens/x.sti', encodeStiRgb(1, 1, Uint16Array.of(5)));
    const other = graphicFactsOf('tilecache/x.sti', Uint8Array.of(1, 2, 3, 4));
    const broken = graphicFactsOf('tilecache/x.sti', indexedSti().subarray(0, 900));
    const sprite = graphicFactsOf('stubs/world/tilesets/0/x.sprite.json', new TextEncoder().encode('{"format":"nope"}'));
    expect(rgb).toEqual({ kind: 'rgb' });
    expect(animationFrameCount(rgb)).toBe(1);
    expect(stiFrameGeometry(rgb)).toBeNull();
    expect(other).toEqual({ kind: 'other' });
    expect(animationFrameCount(other)).toBeNull();
    expect(() => stiFrameGeometry(other)).toThrow('not an STCI file');
    expect(broken.kind).toBe('invalid');
    expect(() => animationFrameCount(broken)).toThrow();
    expect(sprite.kind).toBe('invalid');
    for (const facts of [rgb, other, broken, sprite] as GraphicFacts[])
      expect(decodeGraphicFacts(encodeGraphicFacts(facts))).toEqual(facts);
  });

  it('are served under their own paths by the live reader, other paths pass through', async () => {
    const files = new Map<string, Uint8Array>([
      ['tilecache/blast.sti', indexedSti()],
      ['tables/x.json', Uint8Array.of(1)],
    ]);
    const reads: string[] = [];
    const read = withGraphicFacts(async (path) => {
      reads.push(path);
      return files.get(path) ?? null;
    });
    expect(graphicFactsPath('TILECACHE\\Blast.STI')).toBe('@rules/graphics/tilecache/blast.sti.json');
    expect(animationFrameCount(await readGraphicFacts(read, 'TILECACHE/BLAST.STI'))).toBe(9);
    expect(await readGraphicFacts(read, 'tilecache/missing.sti')).toBeNull();
    expect(await read('tables/x.json')).toEqual(Uint8Array.of(1));
    await readGraphicFacts(read, 'tilecache/blast.sti');
    expect(reads).toEqual(['tilecache/blast.sti', 'tilecache/missing.sti', 'tables/x.json']);
  });

  it(
    'give the stub tilesets the geometry their pictures have',
    async () => {
      const kit = await loadStubSectorKit();
      try {
        expect(await expectSameGeometry(vfsFileReader(kit.vfs), ['stubs/world/'], Number.POSITIVE_INFINITY)).toBeGreaterThan(0);
      } finally {
        await kit.dispose();
      }
    },
    SLOW_MS,
  );
});

describe.skipIf(!ORIGINAL_DATA_DIR)('graphic facts on the original data', () => {
  it(
    'give the original tilesets the geometry their pictures have',
    async () => {
      const data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
      try {
        expect(await expectSameGeometry(vfsFileReader(data.vfs), [''], 3)).toBeGreaterThan(100);
      } finally {
        await data.close();
      }
    },
    SLOW_MS,
  );
});
