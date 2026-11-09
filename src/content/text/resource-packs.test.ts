import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { type DataDirFile, matchResourcePacks, parseResourcePack, RESOURCE_PACKS_DIR, type ResourcePack } from './resource-packs.ts';

interface Listed {
  readonly path: string;
  readonly size: number;
  readonly md5: string;
}

function pack(version: string, resources: readonly Listed[], properties: object = {}): ResourcePack {
  return parseResourcePack({
    name: version,
    properties: { vanilla_version: version, with_file_size: true, with_hash_md5: true, ...properties },
    resources: resources.map((r) => ({ path: r.path, properties: { file_size: r.size, hash_md5: r.md5 } })),
  });
}

const file = (path: string, size: number, md5 = `${path.toLowerCase()}#${size}`): Listed => ({ path, size, md5 });
const dataDir = (...files: readonly Listed[]): DataDirFile[] => files.map(({ path, size }) => ({ path, size }));

function hasher(files: readonly Listed[]) {
  const hashed: string[] = [];
  const hash = async (f: DataDirFile, algorithm: string) => {
    hashed.push(`${algorithm} ${f.path}`);
    return files.find((l) => l.path === f.path)?.md5 ?? '';
  };
  return { hashed, hash };
}

describe('the resource packs of the data version guess (guess.rs guess_by_resource_matching)', () => {
  it('reads the packs Stracciatella ships, each a release with file sizes and MD5 hashes', async () => {
    const dir = join(PROJECT_DATA_DIR, RESOURCE_PACKS_DIR);
    const packs = await Promise.all(
      (await readdir(dir)).sort().map(async (f) => parseResourcePack(JSON.parse(await readFile(join(dir, f), 'utf8')))),
    );
    expect(packs.map((p) => [p.version, p.withFileSize, p.hashes])).toEqual([
      ['english', true, ['md5']],
      ['german', true, ['md5']],
      ['french', true, ['md5']],
      ['polish', true, ['md5']],
      ['russian', true, ['md5']],
    ]);
    for (const p of packs) expect(p.resources.every((r) => r.fileSize !== null && r.hashes.get('md5')?.length === 32)).toBe(true);
  });

  it('refuses a pack with an unknown version, a hash other than MD5 or SLF contents, which none of the shipped packs has', () => {
    expect(() => pack('KLINGON', [])).toThrow('KLINGON');
    expect(() => pack('ENGLISH', [], { with_hash_sha1: true })).toThrow('sha1');
    expect(() => pack('ENGLISH', [], { with_archive_slf: true })).toThrow('archives');
    expect(pack('RUSSIAN_GOLD', []).version).toBe('russianGold');
    expect(pack('SIMPLIFIED_CHINESE', [], { with_hash_md5: false }).hashes).toEqual([]);
  });

  it('picks the pack whose files differ least from the data directory, by path ignoring case, then size, then hash', async () => {
    const data = [file('Data.slf', 10), file('Maps.slf', 20), file('NpcData/000.npc', 5)];
    const { hash } = hasher(data);
    const french = pack('FRENCH', [file('DATA.SLF', 10), file('maps.slf', 20), file('npcdata/000.NPC', 5)]);
    const german = pack('GERMAN', [file('Data.slf', 11), file('Maps.slf', 20, 'other'), file('NpcData/000.npc', 5)]);
    expect(await matchResourcePacks([german, french], dataDir(...data), hash)).toBe('french');
  });

  it("counts the pack's own files twice and those only in the data directory not at all (Percentages::from)", async () => {
    const data = [file('a.slf', 1), file('b.slf', 2)];
    const { hash } = hasher(data);
    const onePackOnlyFile = pack('ENGLISH', [file('a.slf', 1), file('b.slf', 2), file('c.slf', 3)]);
    const oneSizeMismatch = pack('POLISH', [file('a.slf', 1), file('b.slf', 9)]);
    expect(await matchResourcePacks([onePackOnlyFile, oneSizeMismatch], dataDir(...data), hash)).toBe('polish');
    const extra = [file('a.slf', 1), file('w.slf', 4)];
    const sizeMismatch = pack('ENGLISH', [file('a.slf', 7)]);
    const bothSidesExtra = pack('POLISH', [file('a.slf', 1), file('v.slf', 5)]);
    expect(await matchResourcePacks([sizeMismatch, bothSidesExtra], dataDir(...extra), hasher(extra).hash)).toBe('english');
  });

  it('leaves the game temp folder of the data directory out, and gives a tie to the first pack', async () => {
    const data = [file('a.slf', 1), file('Temp/x.tmp', 2)];
    const { hash } = hasher(data);
    const withTemp = pack('ENGLISH', data);
    const first = pack('FRENCH', [file('a.slf', 1)]);
    const second = pack('POLISH', [file('a.slf', 1)]);
    expect(await matchResourcePacks([withTemp, first], dataDir(...data), hash)).toBe('french');
    expect(await matchResourcePacks([first, second], dataDir(...data), hash)).toBe('french');
    expect(await matchResourcePacks([second, first], dataDir(...data), hash)).toBe('polish');
    expect(await matchResourcePacks([], dataDir(...data), hash)).toBeNull();
  });

  it('hashes only the files whose hashes can still change which pack wins, the smallest first', async () => {
    const data = [file('big.slf', 900), file('small.slf', 10), file('tiny.slf', 1)];
    const english = pack('ENGLISH', data);
    const decidedBySize = hasher(data);
    const german = pack('GERMAN', [file('big.slf', 901), file('small.slf', 11), file('tiny.slf', 2), file('extra.slf', 3)]);
    expect(await matchResourcePacks([german, english], dataDir(...data), decidedBySize.hash)).toBe('english');
    expect(decidedBySize.hashed).toEqual([]);
    const decidedByHashes = hasher(data);
    const polish = pack('POLISH', [file('big.slf', 901), file('small.slf', 11), file('tiny.slf', 1)]);
    expect(await matchResourcePacks([polish, english], dataDir(...data), decidedByHashes.hash)).toBe('english');
    expect(decidedByHashes.hashed).toEqual(['md5 tiny.slf', 'md5 small.slf']);
  });
});
