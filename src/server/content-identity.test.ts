import { describe, expect, it } from 'vitest';
import { DIALOGUE_SIZE } from '../content/formats/edt.ts';
import { DialogueTexts } from '../content/narrative/dialogue-text.ts';
import { ContentLedger, engineIdentity, NO_TEXT_IDENTITY, quoteLengthIdentity, textIdentityOf } from './content-identity.ts';

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
});
