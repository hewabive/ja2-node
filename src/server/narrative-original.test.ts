import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IRRELEVANT } from '../content/formats/npc.ts';
import { parseSaveGame } from '../content/formats/savegame.ts';
import { parseSaveEncryptionTable, SAVE_ENCRYPTION_PATH } from '../content/formats/savegame-header.ts';
import { readSavedNpcRecords } from '../content/formats/savegame-npc.ts';
import { civQuoteTextKey, DialogueTexts, npcDialogueFile } from '../content/narrative/dialogue-text.ts';
import { CIV_QUOTE_SECTORS, CivQuote, civQuoteEntries, MINERS_CIV_QUOTE_INDEX } from '../content/narrative/npc-constants.ts';
import { loadNpcRecordContent } from '../content/narrative/npc-records.ts';
import { MercType } from '../content/strategic/economy-content.ts';
import { type DataVfs, openDataVfs } from '../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import { loadTacticalContent } from '../sim/tactical/load-content.ts';
import { createSaveSession } from './save-session.ts';

const dataDir = process.env.JA2_DATA_DIR ?? '';
const gameRoot = basename(dataDir).toLowerCase() === 'data' ? dirname(dataDir) : dataDir;
const savesDir = join(gameRoot, 'SavedGames');
const saveFiles = dataDir && existsSync(savesDir) ? readdirSync(savesDir).filter((f) => f.toLowerCase().endsWith('.sav')) : [];
const RECRUITED = 0x01;
const MEANWHILE_FILES = 34;
const CIVILIAN_FILES = 17;
const SURFACE = { x: 13, y: 3, z: 0 };
const CHOSEN_CIV_QUOTES = [
  0, 1, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 39,
];

describe.skipIf(!process.env.JA2_DATA_DIR)('NPC records and dialogue on the original data', () => {
  let data: DataVfs;
  const read = async (p: string) => (data.vfs.stat(p) ? data.vfs.read(p) : null);

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir });
  });
  afterAll(async () => {
    await data.close();
  });

  it('loads every record file and finds the lines of most records', async () => {
    const content = await loadTacticalContent(read);
    const records = await loadNpcRecordContent({ read, items: content.items, layerCount: (p) => data.vfs.layerCount(p) });
    expect(records.recruited).not.toBeNull();
    expect(records.meanwhiles.size).toBe(MEANWHILE_FILES);
    expect(records.civilian.filter(Boolean)).toHaveLength(CIVILIAN_FILES);
    const npcs = [...records.profileTypes].filter(([, t]) => t === MercType.NPC || t === MercType.RPC).map(([id]) => id);
    expect(npcs.filter((id) => records.scripts[id]).length).toBeGreaterThan(npcs.length / 2);
    const texts = await DialogueTexts.load(read);
    let lines = 0;
    let found = 0;
    for (const id of npcs) {
      for (const q of records.scripts[id] ?? []) {
        if (q.quoteNum === IRRELEVANT || q.numQuotes === IRRELEVANT) continue;
        for (let k = 0; k < q.numQuotes; k++) {
          lines++;
          if (texts.chars({ file: npcDialogueFile(id), row: q.quoteNum + k, width: 240 }) > 0) found++;
        }
      }
    }
    expect(found / lines).toBeGreaterThan(0.8);
  });

  it('finds the rows of every civilian quote type that can be chosen and the hint lines of every hint sector', async () => {
    const content = await loadTacticalContent(read);
    const records = await loadNpcRecordContent({ read, items: content.items, layerCount: (p) => data.vfs.layerCount(p) });
    const texts = await DialogueTexts.load(read);
    for (const quote of CHOSEN_CIV_QUOTES)
      for (let entry = 0; entry < civQuoteEntries(quote) - 1; entry++)
        expect(texts.chars(civQuoteTextKey(quote, entry, SURFACE)), `civ${quote} row ${entry}`).toBeGreaterThan(0);
    CIV_QUOTE_SECTORS.forEach(([x, y], index) => {
      const sector = { x, y, z: 0 };
      if (index === MINERS_CIV_QUOTE_INDEX) return;
      for (const q of records.civilian[index] ?? [])
        if (q.quoteNum !== IRRELEVANT && q.approachRequired === 0)
          expect(texts.chars(civQuoteTextKey(CivQuote.HINT, q.quoteNum, sector)), `${x},${y} row ${q.quoteNum}`).toBeGreaterThan(0);
    });
  });

  for (const file of saveFiles) {
    it(`imports the record sections of ${file}: backups only for recruited RPCs`, async () => {
      const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
      const table = parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode((await read(SAVE_ENCRYPTION_PATH)) ?? new Uint8Array())));
      const save = parseSaveGame(bytes, table);
      const saved = readSavedNpcRecords(bytes, save.sections, save.header.version);
      expect(saved.arrays.some(Boolean)).toBe(true);
      const { session } = await createSaveSession(read, bytes, undefined, (p) => data.vfs.stat(p) !== undefined);
      const state = session.campaign.state;
      const types = session.campaign.talk?.host.content.profileTypes;
      state.npcRecords.backups.forEach((b, id) => {
        if (!b) return;
        expect(types?.get(id)).toBe(MercType.RPC);
        expect((state.profiles.get(id)?.miscFlags ?? 0) & RECRUITED).toBe(RECRUITED);
      });
      saved.arrays.forEach((a, id) => {
        expect(state.npcRecords.arrays[id] !== null).toBe(a !== null || state.npcRecords.backups[id] !== null);
      });
    });
  }
});
