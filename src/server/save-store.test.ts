import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SYNTHETIC_SAVE_BALANCE, SYNTHETIC_SAVE_SECTOR, syntheticSaveHeaderBytes } from '../../tests/support/native-save.ts';
import { AUTO_SAVE_NAMES, isReservedSaveName, isValidSaveName, playerSaveName, SaveStore, slugify } from './save-store.ts';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('save store', () => {
  let dir: string;
  let native: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ja2-store-'));
    native = join(dir, 'SavedGames');
    await mkdir(native);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('accepts plain names and never paths', () => {
    for (const name of ['QuickSave', 'Auto01', 'my-save_2', '2026-10-18t12-00-00z-bridge']) expect(isValidSaveName(name)).toBe(true);
    for (const name of ['', '../escape', 'a/b', 'a\\b', '.hidden', '-dash', 'x.j2s', 'x y', 'é', 'a'.repeat(65), 'C:save'])
      expect(isValidSaveName(name)).toBe(false);
    const store = new SaveStore(dir);
    expect(() => store.filePath('../../etc/passwd')).toThrow(/invalid save name/);
    expect(store.nativePath('../x')).toBeNull();
    expect(isReservedSaveName('quicksave')).toBe(true);
    expect(isReservedSaveName('Error')).toBe(true);
    expect(isReservedSaveName('Bridge')).toBe(false);
  });

  it('names player saves after the UTC time and the slugged description', () => {
    const now = new Date('2026-10-18T07:07:09.500Z');
    expect(playerSaveName('Before the Bridge!', now)).toBe('2026-10-18t07-07-09z-before-the-bridge');
    expect(playerSaveName('', now)).toBe('2026-10-18t07-07-09z');
    expect(slugify('Ça va  très   bien')).toBe('ca-va-tres-bien');
    const long = playerSaveName('x'.repeat(46), now);
    expect(long.length).toBeLessThanOrEqual(64);
    expect(isValidSaveName(long)).toBe(true);
  });

  it('writes the older or missing autosave and keeps two backups of a Dead is Dead save', async () => {
    const fresh = new SaveStore(dir);
    expect(await fresh.nextAutoName()).toBe('Auto01');
    await fresh.write('Auto01', { bytes: bytes('a1'), log: null, backups: false });
    expect(await new SaveStore(dir).nextAutoName()).toBe('Auto02');
    await fresh.write('Auto02', { bytes: bytes('a2'), log: null, backups: false });
    await utimes(fresh.filePath('Auto01'), 1000, 1000);
    expect(await new SaveStore(dir).nextAutoName()).toBe('Auto01');
    await utimes(fresh.filePath('Auto02'), 500, 500);
    expect(await new SaveStore(dir).nextAutoName()).toBe('Auto02');
    fresh.noteAutoWritten(AUTO_SAVE_NAMES[1]);
    expect(await fresh.nextAutoName()).toBe('Auto01');

    for (const n of [1, 2, 3, 4]) await fresh.write('Ironclad', { bytes: bytes(`v${n}`), log: bytes(`log${n}`), backups: true });
    expect(await readFile(fresh.filePath('Ironclad'), 'utf8')).toBe('v4');
    expect(await readFile(fresh.backupPath('Ironclad', 1), 'utf8')).toBe('v3');
    expect(await readFile(fresh.backupPath('Ironclad', 2), 'utf8')).toBe('v2');
    expect(await readFile(fresh.logPath('Ironclad'), 'utf8')).toBe('log4');
    await expect(readFile(join(dir, 'Backup', 'Ironclad.j2s.3'))).rejects.toThrow();

    expect(await fresh.delete('Ironclad')).toBe(true);
    expect(await fresh.read('Ironclad')).toBeNull();
    expect(await fresh.readLog('Ironclad')).toBeNull();
    expect(await fresh.delete('Ironclad')).toBe(false);
  });

  it('lists unreadable saves with their problem and native headers read only', async () => {
    const store = new SaveStore(dir, native);
    await writeFile(join(dir, 'broken.j2s'), 'not gzip');
    await writeFile(join(dir, 'bad name.j2s'), 'ignored');
    await writeFile(join(native, 'SaveGame03.sav'), syntheticSaveHeaderBytes('Before Drassen'));
    await writeFile(join(native, 'garbage.sav'), 'short');
    const own = await store.list();
    expect(own).toEqual([{ name: 'broken', modifiedMs: expect.any(Number), head: null, problem: expect.stringMatching(/gzip/) }]);
    const saves = await store.listNative();
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({
      name: 'SaveGame03',
      header: {
        description: 'Before Drassen',
        day: 2,
        hour: 3,
        minute: 4,
        sector: SYNTHETIC_SAVE_SECTOR,
        currentBalance: SYNTHETIC_SAVE_BALANCE,
      },
    });
  });
});
