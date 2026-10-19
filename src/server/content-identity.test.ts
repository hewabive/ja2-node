import { describe, expect, it } from 'vitest';
import { DIALOGUE_SIZE } from '../content/formats/edt.ts';
import { DialogueTexts } from '../content/narrative/dialogue-text.ts';
import { PROJECT_DATA_LAYER, STUBS_LAYER } from '../content/vfs/layers.ts';
import { MemoryLayer, Vfs, vfsFileReader } from '../content/vfs/vfs.ts';
import {
  type ContentFileEntry,
  ContentLedger,
  type ContentSource,
  engineIdentity,
  NO_TEXT_IDENTITY,
  quoteLengthIdentity,
  type SavedRepositoryFile,
  textIdentityOf,
} from './content-identity.ts';

const SAVE_COMMIT = '0123abc';
const USER_DATA_LAYER = 'maps.slf';
const encode = (s: string) => new TextEncoder().encode(s);

interface LayeredData {
  readonly tables: Readonly<Record<string, string>>;
  readonly user: Readonly<Record<string, string>>;
  readonly stubs: Readonly<Record<string, string>>;
}

const SAVED_DATA: LayeredData = {
  tables: { 'tables/a.json': '{"a":1}' },
  user: { 'binarydata/prof.dat': 'profiles', 'maps/a9.dat': 'map' },
  stubs: { 'stubs/anims/structdata/cr_crouch.jsd': 'stub jsd', 'stubs/npcdata/000.npc': 'stub records' },
};

const RECORDED: readonly ContentFileEntry[] = [
  ['binarydata/prof.dat', 'f'],
  ['maps/a9.dat', 'p'],
  ['maps/b9.dat', 'm'],
  ['stubs/anims/structdata/cr_crouch.jsd', 'p'],
  ['stubs/npcdata/000.npc', 'f'],
  ['tables/a.json', 'f'],
  ['tables/b.json', 'm'],
];

function layeredVfs(data: LayeredData): Vfs {
  const layer = (name: string, files: Readonly<Record<string, string>>) =>
    new MemoryLayer(
      name,
      Object.entries(files).map(([path, text]) => [path, encode(text)] as const),
    );
  return new Vfs([layer(PROJECT_DATA_LAYER, data.tables), layer(USER_DATA_LAYER, data.user), layer(STUBS_LAYER, data.stubs)]);
}

const savedTables: SavedRepositoryFile = async (commit, layer, path) => {
  const text = commit === SAVE_COMMIT && layer === PROJECT_DATA_LAYER ? SAVED_DATA.tables[path] : undefined;
  return text === undefined ? null : encode(text);
};

function scopedLedger(source: ContentSource, data: LayeredData, history: SavedRepositoryFile = savedTables): ContentLedger {
  const vfs = layeredVfs(data);
  return new ContentLedger(source, vfsFileReader(vfs), (path) => vfs.stat(path) !== undefined, {
    layerOf: (path) => vfs.stat(path)?.layer ?? null,
    savedRepositoryFile: history,
  });
}

async function matchesAfter(source: ContentSource, change: (data: LayeredData) => LayeredData, history?: SavedRepositoryFile) {
  const logic = await scopedLedger(source, SAVED_DATA).logicHash(RECORDED);
  return scopedLedger(source, change(SAVED_DATA), history).matchesSaved(RECORDED, { logic, commit: SAVE_COMMIT });
}

function files(entries: Record<string, string>): Map<string, Uint8Array> {
  return new Map(Object.entries(entries).map(([path, text]) => [path, new TextEncoder().encode(text)]));
}

function ledgerOver(data: Map<string, Uint8Array>): ContentLedger {
  return new ContentLedger(
    'stubs',
    async (path) => data.get(path) ?? null,
    (path) => data.has(path),
  );
}

function edtRows(rows: readonly string[]): Uint8Array {
  const bytes = new Uint8Array(rows.length * DIALOGUE_SIZE * 2);
  const view = new DataView(bytes.buffer);
  rows.forEach((row, r) => {
    for (let i = 0; i < row.length; i++) view.setUint16((r * DIALOGUE_SIZE + i) * 2, row.charCodeAt(i) + 1, true);
  });
  return bytes;
}

describe('content identity', () => {
  it('hashes the files the simulation read, the missing ones and the probes, and sees a changed file', async () => {
    const data = files({ 'binarydata/prof.dat': 'profiles', 'tables/a.json': '{}', 'npcdata/000.edt': 'text' });
    const ledger = ledgerOver(data);
    await ledger.read('binarydata/prof.dat');
    await ledger.read('anims/missing.jsd');
    await ledger.read('npcdata/000.edt');
    ledger.exists('tables/a.json');
    ledger.exists('mercedt/000.edt');
    expect(ledger.files()).toEqual([
      ['anims/missing.jsd', 'm'],
      ['binarydata/prof.dat', 'f'],
      ['mercedt/000.edt', 'm'],
      ['npcdata/000.edt', 'p'],
      ['tables/a.json', 'p'],
    ]);
    const saved = ledger.currentLogicHash();
    expect(await ledger.logicHash(ledger.files())).toBe(saved);
    expect(await ledgerOver(new Map(data)).logicHash(ledger.files())).toBe(saved);
    const textChanged = new Map(data).set('npcdata/000.edt', new TextEncoder().encode('other text'));
    expect(await ledgerOver(textChanged).logicHash(ledger.files())).toBe(saved);
    const changed = new Map(data).set('binarydata/prof.dat', new TextEncoder().encode('profilez'));
    expect(await ledgerOver(changed).logicHash(ledger.files())).not.toBe(saved);
    const removed = new Map(data);
    removed.delete('tables/a.json');
    expect(await ledgerOver(removed).logicHash(ledger.files())).not.toBe(saved);
    const original = new ContentLedger('original', ledgerOver(data).read, (p) => data.has(p));
    expect(await original.logicHash(ledger.files())).not.toBe(saved);
  });

  it('hashes the quote lengths, not the words', () => {
    const texts = (rows: readonly string[]) => new DialogueTexts(new Map([['npcdata/000.edt', edtRows(rows)]]));
    const base = quoteLengthIdentity(texts(['Hello', 'Bye']));
    expect(quoteLengthIdentity(texts(['Jello', 'Eye']))).toBe(base);
    expect(quoteLengthIdentity(texts(['Hello there', 'Bye']))).not.toBe(base);
    expect(textIdentityOf(null)).toBe(NO_TEXT_IDENTITY);
  });

  it('names the engine version and commit', () => {
    expect(engineIdentity({ JA2_COMMIT: 'abc123' })).toEqual({ version: expect.any(String), commit: 'abc123' });
  });

  it('checks a 0.7.0 file list on the original data against the user data only', async () => {
    const same = (d: LayeredData) => d;
    expect(await matchesAfter('original', same)).toBe(true);
    expect(await matchesAfter('original', (d) => ({ ...d, tables: { 'tables/a.json': '{"a":2}', 'tables/b.json': '{}' } }))).toBe(true);
    expect(await matchesAfter('original', (d) => ({ ...d, stubs: { ...d.stubs, 'stubs/anims/structdata/cr_crouch.jsd': 'new' } }))).toBe(
      true,
    );
    expect(await matchesAfter('original', (d) => ({ ...d, user: { ...d.user, 'binarydata/prof.dat': 'profilez' } }))).toBe(false);
    expect(await matchesAfter('original', (d) => ({ ...d, user: { ...d.user, 'maps/b9.dat': 'new map' } }))).toBe(false);
    expect(
      await matchesAfter(
        'original',
        (d) => ({ ...d, tables: { 'tables/a.json': '{"a":2}' } }),
        async () => null,
      ),
    ).toBe(false);
  });

  it('checks a 0.7.0 file list on the stubs against the stub pack, not the project tables', async () => {
    expect(await matchesAfter('stubs', (d) => ({ ...d, tables: { 'tables/a.json': '{"a":2}', 'tables/b.json': '{}' } }))).toBe(true);
    expect(await matchesAfter('stubs', (d) => ({ ...d, stubs: { ...d.stubs, 'stubs/npcdata/000.npc': 'other records' } }))).toBe(false);
  });
});
