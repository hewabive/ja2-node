import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeSti } from '../../src/content/formats/sti.ts';
import { type GlyphTable, parseGlyphTable } from '../../src/content/text/glyph-table.ts';
import { openDataVfs } from '../../src/node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import { type BitmapFont, bitmapFontFromSti, fontIdOfPath } from '../../src/ui/text/bitmap-font.ts';
import { FONTS_TABLE_PATH, type FontFiles, FontSet, parseFontFiles } from '../../src/ui/text/fonts.ts';
import { encodeStubFont, loadGlyphSource, STUB_FONT_FACES, stubGlyphTable } from '../../stubs/fonts.ts';

const ENGLISH_GLYPH_TABLE = 'externalized/translation_tables/translation-table-eng.json';

export async function fontFiles(): Promise<FontFiles> {
  return parseFontFiles(JSON.parse(await readFile(join(PROJECT_DATA_DIR, FONTS_TABLE_PATH), 'utf8')));
}

export async function stubFontSet(): Promise<FontSet> {
  const files = await fontFiles();
  const table = await stubGlyphTable();
  const fonts = new Map<string, BitmapFont>();
  for (const face of STUB_FONT_FACES) {
    const sti = decodeSti(encodeStubFont(await loadGlyphSource(face.source), table));
    for (const name of face.names) fonts.set(name, bitmapFontFromSti(name, sti, table));
  }
  return new FontSet(files, fonts);
}

export async function originalFontSet(dataDir: string): Promise<FontSet> {
  const files = await fontFiles();
  const data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir });
  try {
    const table: GlyphTable = parseGlyphTable(JSON.parse(new TextDecoder().decode(await data.vfs.read(ENGLISH_GLYPH_TABLE))));
    const fonts = new Map<string, BitmapFont>();
    for (const path of new Set(Object.values(files))) {
      const id = fontIdOfPath(path);
      fonts.set(id, bitmapFontFromSti(id, decodeSti(await data.vfs.read(path)), table));
    }
    return new FontSet(files, fonts);
  } finally {
    await data.close();
  }
}

export function fixedFont(id: string, widths: Readonly<Record<string, number>>, height = 10): BitmapFont {
  const table = new Map<number, number>();
  const glyphs = [{ width: 4, height, offsetX: 0, offsetY: 0 }];
  table.set(0x3f, 0);
  for (const [character, width] of Object.entries(widths)) {
    if (character === '?') {
      glyphs[0] = { width, height, offsetX: 0, offsetY: 0 };
      continue;
    }
    table.set(character.codePointAt(0) as number, glyphs.length);
    glyphs.push({ width, height, offsetX: 0, offsetY: 0 });
  }
  return { id, glyphs, table };
}

export function uniformFont(id: string, width: number, height = 10, extra = ''): BitmapFont {
  const characters = ` abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,-!'${extra}`;
  return fixedFont(id, Object.fromEntries([...characters].map((c) => [c, width])), height);
}
