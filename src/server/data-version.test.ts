import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RESOURCE_PACKS_DIR } from '../content/text/resource-packs.ts';
import { PROJECT_DATA_LAYER, STUBS_LAYER } from '../content/vfs/layers.ts';
import { MemoryLayer, Vfs } from '../content/vfs/vfs.ts';
import { chooseDataVersion, chooseDisplayLanguage, detectDataVersion, originalDataPaths } from './data-version.ts';

const nothing = () => [];
const DATA_FILES: Readonly<Record<string, string>> = { 'Data.slf': 'own stub data', 'Maps/a9.dat': 'own stub map' };
const md5 = (text: string) => createHash('md5').update(text).digest('hex');

function packLayer(packs: Readonly<Record<string, object>>): MemoryLayer {
  const bytes = (o: object) => new TextEncoder().encode(JSON.stringify(o));
  return new MemoryLayer(
    PROJECT_DATA_LAYER,
    Object.entries(packs).map(([name, pack]) => [`${RESOURCE_PACKS_DIR}/${name}.json`, bytes(pack)] as const),
  );
}

function syntheticPack(version: string, hashOf: (text: string) => string, properties: object = {}): object {
  return {
    name: `synthetic ${version}`,
    properties: { vanilla_version: version, with_file_size: true, with_hash_md5: true, ...properties },
    resources: Object.entries(DATA_FILES).map(([path, text]) => ({
      path: path.toUpperCase(),
      properties: { file_size: text.length, hash_md5: hashOf(text) },
    })),
  };
}

describe('data version at server start', () => {
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'ja2-data-version-'));
    await mkdir(join(dataDir, 'Maps'));
    for (const [path, text] of Object.entries(DATA_FILES)) await writeFile(join(dataDir, path), text);
  });
  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('is stubs without original data, whatever the override says', async () => {
    expect(await chooseDataVersion({ originalData: false, paths: nothing })).toEqual({ version: 'stubs', source: 'stubs' });
    expect(await chooseDataVersion({ originalData: false, paths: nothing, override: 'german' })).toMatchObject({
      version: 'stubs',
      warning: expect.stringContaining('JA2_DATA_VERSION'),
    });
  });

  it('takes a named override, Russian Gold included, and refuses unknown names', async () => {
    expect(await chooseDataVersion({ originalData: true, paths: nothing, override: 'russianGold' })).toEqual({
      version: 'russianGold',
      source: 'override',
    });
    await expect(chooseDataVersion({ originalData: true, paths: nothing, override: 'elvish' })).rejects.toThrow('JA2_DATA_VERSION');
  });

  it('guesses from language folders in the original layers only, before any resource pack, English otherwise', async () => {
    const vfs = new Vfs([
      new MemoryLayer(PROJECT_DATA_LAYER, [['german/readme.txt', new Uint8Array(1)]]),
      new MemoryLayer(STUBS_LAYER, [['stubs/polish/x.sti', new Uint8Array(1)]]),
      new MemoryLayer('interface.slf', [['russian/interface/panel_russian.sti', new Uint8Array(1)]]),
    ]);
    expect(originalDataPaths(vfs)).toEqual(['russian/interface/panel_russian.sti']);
    const french = async () => 'french' as const;
    expect(await chooseDataVersion({ originalData: true, paths: () => originalDataPaths(vfs), resources: french })).toEqual({
      version: 'russian',
      source: 'detected',
    });
    expect(await chooseDataVersion({ originalData: true, paths: nothing })).toEqual({ version: 'english', source: 'default' });
  });

  it('matches the files of the data directory against the resource packs when no language folder decides', async () => {
    const packs = packLayer({ a: syntheticPack('ENGLISH', (text) => md5(`${text}!`)), b: syntheticPack('FRENCH', md5) });
    expect(await detectDataVersion({ vfs: new Vfs([packs]), dataDir }, {})).toEqual({ version: 'french', source: 'detected' });
    expect(await detectDataVersion({ vfs: new Vfs([packs]), dataDir: null }, {})).toEqual({ version: 'stubs', source: 'stubs' });
    expect(await detectDataVersion({ vfs: new Vfs([]), dataDir }, {})).toEqual({ version: 'english', source: 'default' });
  });

  it('takes English with a warning when a resource pack cannot be used, as Stracciatella gives up its guess', async () => {
    const packs = packLayer({ a: syntheticPack('FRENCH', md5, { with_hash_sha1: true }) });
    expect(await detectDataVersion({ vfs: new Vfs([packs]), dataDir }, {})).toEqual({
      version: 'english',
      source: 'default',
      warning: expect.stringContaining('sha1'),
    });
  });

  it('picks the display language from JA2_LANG or the data version', () => {
    expect(chooseDisplayLanguage(undefined, 'russianGold')).toBe('rus');
    expect(chooseDisplayLanguage(undefined, 'stubs')).toBe('eng');
    expect(chooseDisplayLanguage('RUS', 'english')).toBe('rus');
    expect(() => chooseDisplayLanguage('russian', 'english')).toThrow('JA2_LANG');
  });
});
