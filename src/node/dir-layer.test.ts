import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { encodeVfsAliases, VFS_ALIASES_FILE } from '../content/vfs/aliases.ts';
import { Vfs, VfsChangedError } from '../content/vfs/vfs.ts';
import { DirLayer } from './dir-layer.ts';

const dec = (u: Uint8Array) => new TextDecoder().decode(u);
const temp: string[] = [];
afterAll(async () => {
  await Promise.all(temp.map((d) => rm(d, { recursive: true, force: true })));
});

async function folder(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ja2-dir-layer-'));
  temp.push(root);
  for (const [name, text] of Object.entries(files)) {
    await mkdir(join(root, name, '..'), { recursive: true });
    await writeFile(join(root, name), text);
  }
  return root;
}

describe('a folder layer whose files change after it was listed', () => {
  it('refuses to read a file that grew at its listed size, and lists it again at its new size', async () => {
    const root = await folder({ 'tables/layout.json': '{"a":1}' });
    const layer = await DirLayer.open('dir', root);
    const vfs = new Vfs([layer]);
    const listed = layer.stamp('tables/layout.json');
    await writeFile(join(root, 'tables/layout.json'), '{"a":1,"b":2}');
    await expect(vfs.read('tables/layout.json')).rejects.toBeInstanceOf(VfsChangedError);
    expect(layer.stamp('tables/layout.json')).not.toBe(listed);
    expect(vfs.stat('tables/layout.json')?.size).toBe(13);
    expect(dec(await vfs.read('tables/layout.json'))).toBe('{"a":1,"b":2}');
  });

  it('refuses to read a file that shrank, instead of failing at its end', async () => {
    const root = await folder({ 'layout.json': '{"a":1,"b":2}' });
    const vfs = new Vfs([await DirLayer.open('dir', root)]);
    await writeFile(join(root, 'layout.json'), '{}');
    await expect(vfs.read('layout.json', 0, 4)).rejects.toBeInstanceOf(VfsChangedError);
    expect(vfs.stat('layout.json')?.size).toBe(2);
    expect(dec(await vfs.read('layout.json'))).toBe('{}');
  });

  it('tells the VFS about the change under every name of the file', async () => {
    const root = await folder({ 'a.json': '[1]', [VFS_ALIASES_FILE]: encodeVfsAliases(new Map([['b.json', 'a.json']])) });
    const vfs = new Vfs([await DirLayer.open('stubs', root, { prefix: 'stubs', aliasFile: VFS_ALIASES_FILE })]);
    await writeFile(join(root, 'a.json'), '[1,2]');
    await expect(vfs.read('stubs/b.json')).rejects.toBeInstanceOf(VfsChangedError);
    expect([vfs.stat('stubs/a.json')?.size, vfs.stat('stubs/b.json')?.size]).toEqual([5, 5]);
  });

  it('lists a change again without a read when it is refreshed', async () => {
    const root = await folder({ 'tables/layout.json': '{"a":1}', 'tables/other.json': '[]' });
    const layer = await DirLayer.open('data', root);
    const vfs = new Vfs([layer]);
    const other = layer.stamp('tables/other.json');
    await writeFile(join(root, 'tables/layout.json'), '{"a":1,"b":2}');
    await layer.refresh();
    expect([vfs.stat('tables/layout.json')?.size, vfs.revision, layer.stamp('tables/other.json')]).toEqual([13, 1, other]);
    expect(dec(await vfs.read('tables/layout.json'))).toBe('{"a":1,"b":2}');
  });

  it('follows a folder renamed over its own, as a stub pack build replaces the pack', async () => {
    const root = await folder({ 'maps/a.map': 'old' });
    const layer = await DirLayer.open('stubs', root);
    const vfs = new Vfs([layer]);
    await rename(root, `${root}.previous`);
    temp.push(`${root}.previous`);
    await mkdir(join(root, 'maps'), { recursive: true });
    await writeFile(join(root, 'maps/a.map'), 'rebuilt');
    await layer.refresh();
    expect(dec(await vfs.read('maps/a.map'))).toBe('rebuilt');
  });
});
