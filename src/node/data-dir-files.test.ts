import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dataDirFiles, dataDirHasher } from './data-dir-files.ts';

describe('the files of a data directory for the resource pack guess', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'ja2-data-dir-files-'));
    await mkdir(join(root, 'NpcData'));
    await writeFile(join(root, 'Data.slf'), 'abc');
    await writeFile(join(root, 'NpcData', '000.npc'), 'records');
    await symlink(join(root, 'Data.slf'), join(root, 'Linked.slf'));
    await symlink(join(root, 'missing'), join(root, 'Broken.slf'));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lists every file below the directory by its relative path and size, following links and skipping broken ones', async () => {
    expect(await dataDirFiles(root)).toEqual([
      { path: 'Data.slf', size: 3 },
      { path: 'Linked.slf', size: 3 },
      { path: 'NpcData/000.npc', size: 7 },
    ]);
  });

  it('hashes a file with MD5 on demand, reading it once', async () => {
    const hash = dataDirHasher(root);
    const file = { path: 'NpcData/000.npc', size: 7 };
    const first = hash(file, 'md5');
    expect(hash(file, 'md5')).toBe(first);
    expect(await first).toBe(createHash('md5').update('records').digest('hex'));
  });
});
