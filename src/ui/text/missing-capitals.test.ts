import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { fontFiles } from '../../../tests/support/ui-fonts.ts';
import type { StiIndexed } from '../../content/formats/sti.ts';
import { glyphTablePath } from '../../content/text/data-version.ts';
import { type GlyphTable, glyphCount, glyphIndexOf, parseGlyphTable } from '../../content/text/glyph-table.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { type BitmapFont, bitmapFontFromSti, drawableGlyph, fontIdOfPath } from './bitmap-font.ts';
import { FontName, FontSet } from './fonts.ts';
import { stringPixLength } from './measure.ts';
import { glyphRun } from './print.ts';

const GLYPH_HEIGHT = 8;

function syntheticFont(id: string, glyphs: number, table: GlyphTable): BitmapFont {
  const subImages = Array.from({ length: glyphs }, (_, index) => ({
    offsetX: 0,
    offsetY: 0,
    width: index + 1,
    height: GLYPH_HEIGHT,
    pixels: new Uint8Array(0),
  }));
  const sti: StiIndexed = {
    kind: 'indexed',
    width: 0,
    height: 0,
    flags: 0,
    palette: new Uint8Array(0),
    subImages,
    appData: null,
    anomalies: 0,
  };
  return bitmapFontFromSti(id, sti, table);
}

function glyph(font: BitmapFont, character: string): number {
  return drawableGlyph(font, character.codePointAt(0) as number);
}

describe('fonts missing a Cyrillic capital', () => {
  let english: GlyphTable;
  let full: number;
  const tableGlyph = (character: string): number => glyphIndexOf(english, character.codePointAt(0) as number);

  beforeAll(async () => {
    english = parseGlyphTable(JSON.parse(await readFile(join(PROJECT_DATA_DIR, glyphTablePath('english')), 'utf8')));
    full = glyphCount(english);
  });

  it('draw Ч with the glyph of 4 in the block fonts and the capitals after it with their own glyphs', () => {
    for (const id of ['blockfont', 'blockfont2', 'blockfontnarrow']) {
      const font = syntheticFont(id, full - 1, english);
      expect(glyph(font, 'Ч'), id).toBe(tableGlyph('4'));
      expect(glyph(font, 'ч'), id).toBe(tableGlyph('4'));
      expect(glyph(font, 'Ц'), id).toBe(tableGlyph('Ц'));
      expect(glyph(font, 'Ш'), id).toBe(tableGlyph('Ш') - 1);
      expect(glyph(font, 'Ъ'), id).toBe(tableGlyph('Ь') - 1);
      expect(glyph(font, 'Я'), id).toBe(tableGlyph('Я') - 1);
      expect(glyph(font, 'я'), id).toBe(tableGlyph('Я') - 1);
    }
  });

  it('draw П with the glyph of ? in FONT14HUMANIST and the capitals after it with their own glyphs', () => {
    const font = syntheticFont('font14humanist', full - 1, english);
    expect(glyph(font, 'П')).toBe(tableGlyph('?'));
    expect(glyph(font, 'О')).toBe(tableGlyph('О'));
    expect(glyph(font, 'Р')).toBe(tableGlyph('Р') - 1);
    expect(glyph(font, 'Ч')).toBe(tableGlyph('Ч') - 1);
    expect(glyph(font, 'Я')).toBe(tableGlyph('Я') - 1);
  });

  it("keep the table's glyphs for the accented Latin letters after the Cyrillic ones", () => {
    const font = syntheticFont('blockfont2', full - 1, english);
    for (const character of ['Ä', 'ß', 'À', 'é', 'Ą', 'ż']) expect(glyph(font, character), character).toBe(tableGlyph(character));
    expect(glyph(font, 'ź')).toBe(tableGlyph('?'));
  });

  it('measure with the glyphs they draw', () => {
    const font = syntheticFont('blockfont2', full - 1, english);
    expect(glyphRun(font, 'ЧЯ', 0, 0).glyphs.map((g) => g.index)).toEqual([tableGlyph('4'), tableGlyph('Я') - 1]);
    expect(stringPixLength('ЧЯ', font)).toBe(tableGlyph('4') + 1 + tableGlyph('Я'));
    expect(stringPixLength('ЧЯ', font)).toBe(glyphRun(font, 'ЧЯ', 0, 0).width);
  });

  it('leave fonts with the whole table and other fonts one glyph short untouched', () => {
    for (const font of [syntheticFont('blockfont2', full, english), syntheticFont('font14humanist', full, english)]) {
      expect(glyph(font, 'П'), font.id).toBe(tableGlyph('П'));
      expect(glyph(font, 'Ч'), font.id).toBe(tableGlyph('Ч'));
      expect(glyph(font, 'Я'), font.id).toBe(tableGlyph('Я'));
      expect(font.table, font.id).toBe(english);
    }
    expect(syntheticFont('font12arial', full - 1, english).table).toBe(english);
  });

  it('correct every font macro that loads an affected file', async () => {
    const files = await fontFiles();
    const fonts = new Map(Object.values(files).map((path) => [fontIdOfPath(path), syntheticFont(fontIdOfPath(path), full - 1, english)]));
    const set = new FontSet(files, fonts);
    for (const name of [FontName.BLOCKFONT, FontName.BLOCKFONT2, FontName.BLOCKFONTNARROW, 'MILITARYFONT1'])
      expect(glyph(set.get(name), 'Ч'), name).toBe(tableGlyph('4'));
    expect(glyph(set.get(FontName.FONT14HUMANIST), 'П')).toBe(tableGlyph('?'));
    expect(glyph(set.get(FontName.TINYFONT1), 'Я')).toBe(tableGlyph('Я'));
  });
});
