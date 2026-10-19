import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readDataJson } from '../../../tests/support/tactical.ts';
import { writeAnimationScripts } from '../formats/ja2bin.ts';
import { writeTilesetDatabase } from '../formats/ja2set.ts';
import { encodeStiIndexed } from '../formats/sti.ts';
import { PROJECT_DATA_LAYER, STUBS_LAYER } from '../vfs/layers.ts';
import { TILE_TABLES_PATH } from '../world/tile-tables.ts';
import { readGraphicFacts } from './graphic-facts.ts';
import {
  allLayersHash,
  buildMemoryRulePack,
  CONTENT_HASH_LENGTH,
  NotARuleFileError,
  parseRulePackManifest,
  type RuleListingEntry,
  type RulePackIdentityInput,
  type RuleSource,
  type Sha256,
  verifyRulePackManifest,
} from './pack.ts';

const sha256: Sha256 = async (bytes) => createHash('sha256').update(bytes).digest('hex');
const text = (s: string) => new TextEncoder().encode(s);
const SURFACE = 'tilesets/0/grass.sti';
const STUB_SURFACE = 'stubs/tilesets/0/grass.sti';
const USER_DATA_LAYER = 'data-dir';
const PROJECT_TABLE_DIRS = ['tables/', 'externalized/'];
const STUBS_ROOT = 'stubs/';
const U0B_IDENTITY_HASH = '5e642fec8ed11243afc84bbb24bde307bd6199d661458879483479e7e3220d8c';

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

type FileChanges = Readonly<Record<string, Uint8Array | null>>;

function withChanges(files: Map<string, Uint8Array>, changes: FileChanges): Map<string, Uint8Array> {
  for (const [path, bytes] of Object.entries(changes)) {
    if (bytes) files.set(path, bytes);
    else files.delete(path);
  }
  return files;
}

function dataSet(changes: FileChanges = {}): Map<string, Uint8Array> {
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
  return withChanges(files, changes);
}

function stubbedDataSet(changes: FileChanges = {}): Map<string, Uint8Array> {
  const files = dataSet();
  for (const [path, bytes] of [
    ['stubs/binarydata/ja2set.dat', tilesetDatabase()],
    ['stubs/binarydata/ja2bin.dat', writeAnimationScripts({ codes: new Uint16Array(32000).fill(2) })],
    ['stubs/maps/a9.dat', text('stub map')],
    ['stubs/npcdata/000.edt', text('stub words')],
    ['stubs/npcdata/000.npc', text('stub records')],
    ['stubs/profiles.json', text('{}')],
    [STUB_SURFACE, grassSti(5)],
  ] as const)
    files.set(path, bytes);
  return withChanges(files, changes);
}

function layerOf(path: string): string {
  if (PROJECT_TABLE_DIRS.some((dir) => path.startsWith(dir))) return PROJECT_DATA_LAYER;
  return path.startsWith(STUBS_ROOT) ? STUBS_LAYER : USER_DATA_LAYER;
}

interface PackOptions {
  readonly layers?: Readonly<Record<string, number>>;
  readonly source?: RuleSource;
}

function packOf(files: Map<string, Uint8Array>, options: PackOptions = {}) {
  const listing: RuleListingEntry[] = [...files].map(([path, bytes]) => ({
    path,
    size: bytes.length,
    layers: options.layers?.[path] ?? 1,
    layer: layerOf(path),
  }));
  return buildMemoryRulePack({
    source: options.source ?? 'stubs',
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
    expect(pack.manifest.graphics).toEqual([{ path: SURFACE, size: grassSti(3).length, hash: expect.any(String), layer: USER_DATA_LAYER }]);
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
    expect((await packOf(dataSet(), { layers: { 'npcdata/000.npc': 2 } })).hash).not.toBe(base);
  });

  it('round-trips its manifest and notices a manifest that does not match its hash', async () => {
    const pack = await packOf(dataSet(), { layers: { 'npcdata/000.npc': 2 } });
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

const rewrittenTable = () => text(JSON.stringify(readDataJson(TILE_TABLES_PATH), null, 1));

const REPOSITORY_CHANGES: readonly FileChanges[] = [
  { [TILE_TABLES_PATH]: rewrittenTable() },
  { 'tables/cursors.json': text('{"cursors":[]}') },
  { 'tables/ui-constants/main-menu.json': text('{}') },
  { 'externalized/new-table.json': text('[]') },
];

const STUB_CHANGES: readonly FileChanges[] = [
  { 'stubs/maps/a9.dat': text('another stub map') },
  { 'stubs/maps/b9.dat': text('a new stub map') },
  { 'stubs/npcdata/000.npc': text('other stub records') },
  { 'stubs/npcdata/000.edt': null },
  { 'stubs/binarydata/ja2bin.dat': writeAnimationScripts({ codes: new Uint16Array(32000).fill(3) }) },
  { 'stubs/profiles.json': text('{"profiles":[]}') },
  { [STUB_SURFACE]: grassSti(6) },
];

const USER_DATA_CHANGES: readonly FileChanges[] = [
  { 'maps/a9.dat': text('other map') },
  { 'maps/b9.dat': text('new map') },
  { 'npcdata/000.npc': text('other records') },
  { 'npcdata/000.edt': null },
  { [SURFACE]: grassSti(4) },
];

async function identityOf(source: RuleSource, changes: FileChanges = {}, layers: Readonly<Record<string, number>> = {}) {
  const pack = await packOf(stubbedDataSet(changes), { source, layers });
  return { hash: pack.hash, allLayers: pack.allLayersHash };
}

describe('the identity of the rule pack', () => {
  it('on the original data covers the user data only, not the project tables or the stub pack', async () => {
    const base = await identityOf('original');
    for (const changes of [...REPOSITORY_CHANGES, ...STUB_CHANGES]) {
      const changed = await identityOf('original', changes);
      expect(changed.hash, Object.keys(changes).join()).toBe(base.hash);
      expect(changed.allLayers, Object.keys(changes).join()).not.toBe(base.allLayers);
    }
    for (const changes of USER_DATA_CHANGES)
      expect((await identityOf('original', changes)).hash, Object.keys(changes).join()).not.toBe(base.hash);
    expect((await identityOf('original', {}, { 'npcdata/000.npc': 2 })).hash).not.toBe(base.hash);
    expect((await identityOf('original', {}, { 'stubs/npcdata/000.npc': 2 })).hash).toBe(base.hash);
  });

  it('on the stubs covers the stub pack but not the project tables', async () => {
    const base = await identityOf('stubs');
    for (const changes of REPOSITORY_CHANGES)
      expect((await identityOf('stubs', changes)).hash, Object.keys(changes).join()).toBe(base.hash);
    for (const changes of STUB_CHANGES) expect((await identityOf('stubs', changes)).hash, Object.keys(changes).join()).not.toBe(base.hash);
  });

  it('keeps the hash over every layer that U0b used as the identity, and verifies both hashes of a cached manifest', async () => {
    const input: RulePackIdentityInput = {
      source: 'original',
      files: [
        { path: 'tables/a.json', size: 2, hash: '0123456789abcdef', layer: PROJECT_DATA_LAYER },
        { path: 'binarydata/prof.dat', size: 3, hash: '00112233aabbccdd', layer: 'maps.slf' },
        { path: 'npcdata/000.edt', size: 5, hash: 'ffeeddccbbaa9988', layer: USER_DATA_LAYER },
      ],
      graphics: [{ path: 'tilesets/0/grass.sti', size: 10, hash: 'fedcba9876543210', layer: 'tilesets.slf' }],
      layers: [['npcdata/000.edt', 2]],
    };
    expect(await allLayersHash(input, sha256)).toBe(U0B_IDENTITY_HASH);
    const pack = await packOf(stubbedDataSet(), { source: 'original' });
    const manifest = parseRulePackManifest(JSON.parse(JSON.stringify(pack.manifest)));
    expect(await verifyRulePackManifest(manifest, sha256)).toBe(true);
    const relabelled = { ...manifest, files: manifest.files.map((f) => (f.path === 'maps/a9.dat' ? { ...f, layer: STUBS_LAYER } : f)) };
    expect(await verifyRulePackManifest(relabelled, sha256)).toBe(false);
    const otherTable = { ...manifest, files: manifest.files.map((f) => (f.path === TILE_TABLES_PATH ? { ...f, size: f.size + 1 } : f)) };
    expect(await verifyRulePackManifest(otherTable, sha256)).toBe(false);
  });
});
