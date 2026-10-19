import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readDataJson } from '../../../tests/support/tactical.ts';
import { writeAnimationScripts } from '../formats/ja2bin.ts';
import { writeTilesetDatabase } from '../formats/ja2set.ts';
import { encodeStiIndexed } from '../formats/sti.ts';
import { TILE_TABLES_PATH } from '../world/tile-tables.ts';
import { readGraphicFacts } from './graphic-facts.ts';
import {
  buildMemoryRulePack,
  CONTENT_HASH_LENGTH,
  NotARuleFileError,
  parseRulePackManifest,
  type RuleListingEntry,
  type Sha256,
  verifyRulePackManifest,
} from './pack.ts';

const sha256: Sha256 = async (bytes) => createHash('sha256').update(bytes).digest('hex');
const text = (s: string) => new TextEncoder().encode(s);
const SURFACE = 'tilesets/0/grass.sti';

function grassSti(width: number): Uint8Array {
  return encodeStiIndexed({
    palette: new Uint8Array(768),
    subImages: [{ offsetX: 1, offsetY: 2, width, height: 1, pixels: new Uint8Array(width).fill(1) }],
  });
}

function tilesetDatabase(): Uint8Array {
  const tables = readDataJson(TILE_TABLES_PATH) as { types: readonly { name: string }[] };
  const surfaceFiles = tables.types.map((_, i) => (i === 0 ? 'grass.sti' : ''));
  return writeTilesetDatabase({ tilesets: [{ id: 0, name: 'GENERIC 1', ambientId: 0, surfaceFiles }], tileTypeCount: surfaceFiles.length });
}

function dataSet(changes: Readonly<Record<string, Uint8Array | null>> = {}): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>([
    [TILE_TABLES_PATH, text(JSON.stringify(readDataJson(TILE_TABLES_PATH)))],
    ['binarydata/ja2set.dat', tilesetDatabase()],
    ['binarydata/ja2bin.dat', writeAnimationScripts({ codes: new Uint16Array(32000).fill(1) })],
    ['maps/a9.dat', text('map')],
    ['npcdata/000.edt', text('words')],
    ['npcdata/000.npc', text('records')],
    [SURFACE, grassSti(3)],
    ['sounds/shot.wav', text('noise')],
  ]);
  for (const [path, bytes] of Object.entries(changes)) {
    if (bytes) files.set(path, bytes);
    else files.delete(path);
  }
  return files;
}

function packOf(files: Map<string, Uint8Array>, layers: Readonly<Record<string, number>> = {}) {
  const listing: RuleListingEntry[] = [...files].map(([path, bytes]) => ({ path, size: bytes.length, layers: layers[path] ?? 1 }));
  return buildMemoryRulePack({
    source: 'stubs',
    listing,
    read: async (path) => {
      const bytes = files.get(path);
      if (!bytes) throw new Error(`no ${path}`);
      return bytes;
    },
    sha256,
  });
}

describe('the rule pack', () => {
  it('holds the rule files and the graphic facts, and nothing else', async () => {
    const pack = await packOf(dataSet());
    expect(pack.manifest.files.map((f) => f.path)).toEqual([
      '@rules/graphics/tilesets/0/grass.sti.json',
      'binarydata/ja2bin.dat',
      'binarydata/ja2set.dat',
      'maps/a9.dat',
      'npcdata/000.edt',
      'npcdata/000.npc',
      TILE_TABLES_PATH,
    ]);
    expect(pack.manifest.graphics).toEqual([{ path: SURFACE, size: grassSti(3).length, hash: expect.any(String) }]);
    expect(pack.scriptsHash).toHaveLength(CONTENT_HASH_LENGTH);
    expect(await pack.read('MAPS\\A9.DAT')).toEqual(text('map'));
    expect(await pack.read('maps/b9.dat')).toBeNull();
    expect(pack.exists('maps/a9.dat')).toBe(true);
    expect(pack.exists('npcdata/001.npc')).toBe(false);
    expect((await readGraphicFacts(pack.read, SURFACE))?.kind).toBe('indexed');
    expect(await readGraphicFacts(pack.read, 'tilesets/0/missing.sti')).toBeNull();
    await expect(pack.read(SURFACE)).rejects.toBeInstanceOf(NotARuleFileError);
    await expect(pack.read('sounds/shot.wav')).rejects.toBeInstanceOf(NotARuleFileError);
    expect(() => pack.exists('sounds/shot.wav')).toThrow(NotARuleFileError);
    expect(pack.layers('maps/a9.dat')).toBe(1);
    expect(pack.layers('maps/b9.dat')).toBe(0);
  });

  it('has one hash over its inputs: rule files by content, text files by presence, graphics by content', async () => {
    const base = (await packOf(dataSet())).hash;
    expect((await packOf(dataSet())).hash).toBe(base);
    expect((await packOf(dataSet({ 'sounds/shot.wav': text('other noise') }))).hash).toBe(base);
    expect((await packOf(dataSet({ 'npcdata/000.edt': text('other words') }))).hash).toBe(base);
    expect((await packOf(dataSet({ 'npcdata/000.edt': null }))).hash).not.toBe(base);
    expect((await packOf(dataSet({ 'maps/a9.dat': text('other map') }))).hash).not.toBe(base);
    expect((await packOf(dataSet({ 'maps/b9.dat': text('new map') }))).hash).not.toBe(base);
    expect((await packOf(dataSet({ [SURFACE]: grassSti(4) }))).hash).not.toBe(base);
    expect((await packOf(dataSet(), { 'npcdata/000.npc': 2 })).hash).not.toBe(base);
  });

  it('round-trips its manifest and notices a manifest that does not match its hash', async () => {
    const pack = await packOf(dataSet(), { 'npcdata/000.npc': 2 });
    const manifest = parseRulePackManifest(JSON.parse(JSON.stringify(pack.manifest)));
    expect(manifest).toEqual(pack.manifest);
    expect(await verifyRulePackManifest(manifest, sha256)).toBe(true);
    expect(pack.layers('npcdata/000.npc')).toBe(2);
    const tampered = { ...manifest, files: manifest.files.filter((f) => f.path !== 'maps/a9.dat') };
    expect(await verifyRulePackManifest(tampered, sha256)).toBe(false);
    expect(() => parseRulePackManifest({ ...manifest, format: 'other' })).toThrow();
    expect(() => parseRulePackManifest({ ...manifest, files: [{ path: 'x' }] })).toThrow();
  });
});
