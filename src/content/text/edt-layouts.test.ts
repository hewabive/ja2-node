import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { CIV_QUOTE_TEXT_SIZE, DIALOGUE_SIZE } from '../formats/edt.ts';
import { dialogueFileCandidates } from '../narrative/dialogue-text.ts';
import { EDT_LAYOUTS_PATH, EdtLayouts } from './edt-layouts.ts';

async function layouts(): Promise<EdtLayouts> {
  return EdtLayouts.parse(JSON.parse(await readFile(join(PROJECT_DATA_DIR, EDT_LAYOUTS_PATH), 'utf8')));
}

describe('EDT layouts', () => {
  it('give the record layout of the fixed laptop and item files', async () => {
    const table = await layouts();
    expect(table.layoutOf('BinaryData/ItemDesc.edt')).toEqual({ path: 'binarydata/itemdesc.edt', columns: [80, 80, 240] });
    expect(table.layoutOf('binarydata/help.edt')?.columns).toEqual([640]);
    expect(table.layoutOf('binarydata/aimbios.edt')?.columns).toEqual([400, 160]);
    expect(table.layoutOf('binarydata/email.edt')?.columns).toEqual([320]);
  });

  it('cover every dialogue and civilian quote file the content reads, with its width', async () => {
    const table = await layouts();
    for (const file of dialogueFileCandidates()) {
      const width = /\/civ\d\d\.edt$|\/[a-p]\d{1,2}\.edt$/i.test(file) ? CIV_QUOTE_TEXT_SIZE : DIALOGUE_SIZE;
      expect(table.layoutOf(file)?.columns, file).toEqual([width]);
    }
  });

  it('refuse files without a layout and paths that leave the VFS', async () => {
    const table = await layouts();
    expect(table.layoutOf('binarydata/prof.dat')).toBeNull();
    expect(table.layoutOf('npcdata/1234.edt')).toBeNull();
    expect(table.layoutOf('npcdata/q1.edt')).toBeNull();
    expect(table.layoutOf('npcdata/a17.edt')).toBeNull();
    expect(table.layoutOf('../binarydata/help.edt')).toBeNull();
  });
});
