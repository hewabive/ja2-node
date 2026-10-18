import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { glyphCount, glyphIndexOf, parseGlyphTable } from './glyph-table.ts';

const TABLES = ['eng', 'fr', 'rus', 'rus-gold', 'chs'];

async function table(suffix: string): Promise<unknown> {
  return JSON.parse(await readFile(join(PROJECT_DATA_DIR, 'externalized/translation_tables', `translation-table-${suffix}.json`), 'utf8'));
}

describe('glyph tables', () => {
  it('parses every table of the externalized data', async () => {
    for (const suffix of TABLES) expect(parseGlyphTable(await table(suffix)).size, suffix).toBeGreaterThan(90);
  });

  it('maps the English characters to the glyphs of the original fonts and falls back to the question mark', async () => {
    const eng = parseGlyphTable(await table('eng'));
    expect(glyphIndexOf(eng, 'A'.codePointAt(0) as number)).toBe(0);
    expect(glyphIndexOf(eng, 'а'.codePointAt(0) as number)).toBe(glyphIndexOf(eng, 'А'.codePointAt(0) as number));
    expect(glyphIndexOf(eng, '€'.codePointAt(0) as number)).toBe(glyphIndexOf(eng, '?'.codePointAt(0) as number));
    expect(glyphCount(eng)).toBe(188);
  });

  it('refuses malformed entries', () => {
    expect(() => parseGlyphTable([])).toThrow(/not an object/);
    expect(() => parseGlyphTable({ ab: 1, '?': 2 })).toThrow(/single character/);
    expect(() => parseGlyphTable({ a: -1, '?': 2 })).toThrow(/bad glyph index/);
    expect(() => parseGlyphTable({ a: 1 })).toThrow(/"\?"/);
  });
});
