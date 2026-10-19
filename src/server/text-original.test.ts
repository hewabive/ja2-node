import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeEdtRecord, edtRecordWidth, edtRowCount } from '../content/formats/edt.ts';
import { DialogueTexts, dialogueFileCandidates, type TextKey } from '../content/narrative/dialogue-text.ts';
import { withGraphicFacts } from '../content/rules/graphic-facts.ts';
import { parseJsonc } from '../content/strategic/jsonc.ts';
import { EDT_LAYOUTS_PATH, EdtLayouts } from '../content/text/edt-layouts.ts';
import { vfsFileReader } from '../content/vfs/vfs.ts';
import { type DataVfs, openDataVfs } from '../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import { detectDataVersion } from './data-version.ts';
import { TextService } from './text-service.ts';

const UTF16_BYTES = 2;
const LISTINGS = { aim: 'externalized/mercs-AIM-listings.json', merc: 'externalized/mercs-MERC-listings.json' } as const;

async function projectJson(path: string): Promise<unknown> {
  return parseJsonc(await readFile(join(PROJECT_DATA_DIR, path), 'utf8'));
}

async function bioRows(path: string): Promise<number> {
  const listings = (await projectJson(path)) as { bioIndex?: number }[];
  return Math.max(...listings.map((l) => l.bioIndex ?? 0)) + 1;
}

describe.skipIf(!process.env.JA2_DATA_DIR)('text on the original data', () => {
  let data: DataVfs;
  let layouts: EdtLayouts;
  const read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: process.env.JA2_DATA_DIR });
    layouts = EdtLayouts.parse(await projectJson(EDT_LAYOUTS_PATH));
  });
  afterAll(async () => {
    await data.close();
  });

  it('detects the English data version from the SLFs and honours an override', () => {
    expect(detectDataVersion(data.vfs, true, {}).version).toBe('english');
    expect(detectDataVersion(data.vfs, true, { JA2_DATA_VERSION: 'russianGold' })).toEqual({ version: 'russianGold', source: 'override' });
  });

  it('decodes every fixed EDT file the game reads to whole records of its layout', async () => {
    const fixed = layouts.entries.filter((e) => !e.path.includes('{'));
    let present = 0;
    for (const { path, columns } of fixed) {
      const bytes = await read(path);
      if (!bytes) continue;
      present++;
      const recordBytes = edtRecordWidth(columns) * UTF16_BYTES;
      expect(bytes.length % recordBytes, path).toBe(0);
      const rows = edtRowCount(bytes, edtRecordWidth(columns));
      expect(rows, path).toBeGreaterThan(0);
      for (let row = 0; row < rows; row++) expect(decodeEdtRecord(bytes, row, columns)?.length, `${path} ${row}`).toBe(columns.length);
      expect(decodeEdtRecord(bytes, rows, columns), path).toBeNull();
    }
    expect(present).toBe(fixed.length);
  });

  it('has one biography record per A.I.M. and M.E.R.C. listing', async () => {
    for (const [file, listing] of [
      ['binarydata/aimbios.edt', LISTINGS.aim],
      ['binarydata/mercbios.edt', LISTINGS.merc],
    ] as const) {
      const layout = layouts.layoutOf(file);
      const bytes = await read(file);
      expect(layout && bytes).toBeTruthy();
      if (!layout || !bytes) continue;
      expect(edtRowCount(bytes, edtRecordWidth(layout.columns)), file).toBe(await bioRows(listing));
    }
  });

  it('decodes every dialogue and civilian quote file the content reads to whole rows', async () => {
    let present = 0;
    for (const file of dialogueFileCandidates()) {
      const bytes = await read(file);
      if (!bytes) continue;
      present++;
      const layout = layouts.layoutOf(file);
      expect(layout, file).not.toBeNull();
      if (layout) expect(bytes.length % (edtRecordWidth(layout.columns) * UTF16_BYTES), file).toBe(0);
    }
    expect(present).toBeGreaterThan(0);
  });

  it('serves the same rows through the text service as the simulation reads for quote lengths', async () => {
    const texts = new TextService({ vfs: data.vfs, dataVersion: 'english' });
    const dialogue = await DialogueTexts.load(read, texts.encoding);
    const keys: TextKey[] = [
      { file: 'npcdata/094.edt', row: 1, width: 240 },
      { file: 'mercedt/007.edt', row: 3, width: 240 },
      { file: 'npcdata/civ06.edt', row: 0, width: 160 },
    ];
    for (const key of keys) {
      const served = await texts.text(key);
      expect(served, key.file).not.toBeNull();
      expect(served, key.file).toBe(dialogue.text(key));
      const record = await texts.edtRecord(key.file, key.row);
      expect(record.ok && record.record.columns[0] === served, key.file).toBe(true);
    }
    expect((await texts.edtRecord('binarydata/itemdesc.edt', 1)).ok).toBe(true);
    expect((await texts.edtRecord('npcdata/094.edt', 1_000)).ok).toBe(false);
  });
});
