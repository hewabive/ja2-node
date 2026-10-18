import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeSti, type StiIndexed } from '../src/content/formats/sti.ts';
import { glyphCount, glyphIndexOf, parseGlyphTable } from '../src/content/text/glyph-table.ts';
import { encodeVfsAliases, VFS_ALIASES_FILE } from '../src/content/vfs/aliases.ts';
import { type DataVfs, openDataVfs, STUBS_PREFIX } from '../src/node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../src/node/repo.ts';
import {
  buildStubFonts,
  FONT_INK_INDEX,
  FONT_SHADOW_INDEX,
  glyphImage,
  parseGlyphSource,
  STUB_FONT_FACES,
  STUB_GLYPH_TABLE_PATH,
} from './fonts.ts';

const ORIGINAL_FONT_NAMES = [
  'font10arial',
  'font10arialbold',
  'font12arial',
  'font12arialfixedwidth',
  'font12point1',
  'font14arial',
  'font14humanist',
  'font16arial',
  'blockfontnarrow',
  'blockfont',
  'blockfont2',
  'compfont',
  'largefont1',
  'smallcompfont',
  'smallfont1',
  'tinyfont1',
  'hugefont',
];
const PRINTABLE_ASCII = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCodePoint(0x20 + i)).join('');
const CYRILLIC = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя';
const BLANK = ' ';

const dirs: string[] = [];
let first: { dir: string; written: string[]; aliases: Map<string, string> };
let data: DataVfs;

async function build(): Promise<{ dir: string; written: string[]; aliases: Map<string, string> }> {
  const dir = await mkdtemp(join(tmpdir(), 'ja2-stub-fonts-'));
  dirs.push(dir);
  const aliases = new Map<string, string>();
  const written = await buildStubFonts(dir, aliases);
  await writeFile(join(dir, VFS_ALIASES_FILE), encodeVfsAliases(aliases));
  return { dir, written, aliases };
}

async function read(path: string): Promise<Uint8Array> {
  return data.vfs.read(`${STUBS_PREFIX}/${path}`);
}

async function font(name: string): Promise<StiIndexed> {
  const sti = decodeSti(await read(`fonts/${name}.sti`));
  if (sti.kind !== 'indexed') throw new Error(`${name} is not indexed`);
  return sti;
}

async function stubTable(): Promise<Map<number, number>> {
  return parseGlyphTable(JSON.parse(new TextDecoder().decode(await read(STUB_GLYPH_TABLE_PATH))));
}

beforeAll(async () => {
  first = await build();
  data = await openDataVfs({ stubsDir: first.dir });
});

afterAll(async () => {
  await data.close();
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe('stub fonts', () => {
  it('build byte-identical twice', async () => {
    const second = await build();
    expect(second.written).toEqual(first.written);
    expect([...second.aliases]).toEqual([...first.aliases]);
    for (const f of first.written) expect((await readFile(join(first.dir, f))).equals(await readFile(join(second.dir, f))), f).toBe(true);
  });

  it('answer every font name of Font_Control.cc through the alias manifest', () => {
    for (const name of ORIGINAL_FONT_NAMES) expect(data.vfs.stat(`${STUBS_PREFIX}/fonts/${name}.sti`), name).toBeDefined();
    expect(first.aliases.size).toBe(ORIGINAL_FONT_NAMES.length);
    expect(new Set(first.aliases.values())).toEqual(new Set(STUB_FONT_FACES.map((f) => f.path)));
  });

  it('decode through the STI decoder with a glyph for every entry of the stub table', async () => {
    const table = await stubTable();
    for (const name of ORIGINAL_FONT_NAMES) {
      const sti = await font(name);
      expect(sti.anomalies, name).toBe(0);
      expect(sti.subImages.length, name).toBe(glyphCount(table));
      const height = sti.subImages[0]?.height;
      for (const [cp, glyph] of table) {
        const image = sti.subImages[glyph];
        const character = String.fromCodePoint(cp);
        expect(image, `${name} ${character}`).toBeDefined();
        expect(image?.height, `${name} ${character}`).toBe(height);
        expect([image?.offsetX, image?.offsetY]).toEqual([0, 0]);
        expect(image?.pixels.every((p) => p === 0 || p === FONT_INK_INDEX || p === FONT_SHADOW_INDEX)).toBe(true);
        const inked = image?.pixels.some((p) => p === FONT_INK_INDEX);
        expect(inked, `${name} ${character}`).toBe(character !== BLANK);
      }
    }
  });

  it('cover ASCII and Cyrillic with their own glyphs and keep the English glyph slots', async () => {
    const table = await stubTable();
    for (const character of PRINTABLE_ASCII + CYRILLIC) expect(table.has(character.codePointAt(0) as number), character).toBe(true);
    const own = (c: string) => glyphIndexOf(table, c.codePointAt(0) as number);
    expect(new Set([...CYRILLIC].map(own)).size).toBe(CYRILLIC.length);
    const english = parseGlyphTable(
      JSON.parse(await readFile(join(PROJECT_DATA_DIR, 'externalized/translation_tables/translation-table-eng.json'), 'utf8')),
    );
    const owners = new Map<number, number>();
    for (const [cp, glyph] of [...english].sort(([a], [b]) => a - b)) if (!owners.has(glyph)) owners.set(glyph, cp);
    for (const [glyph, cp] of owners) expect(table.get(cp), String.fromCodePoint(cp)).toBe(glyph);
  });

  it('crops glyphs to their ink and adds a one-pixel shadow', () => {
    const source = parseGlyphSource(['ja2-node.glyphs/1', 'name: t', 'cell: 4 2', 'U+0041 4000', 'U+0020 0000'].join('\n'), 'test');
    const image = glyphImage(source, source.glyphs.get(0x41) ?? []);
    expect([image.width, image.height]).toEqual([2, 3]);
    expect([...image.pixels]).toEqual([FONT_INK_INDEX, 0, 0, FONT_SHADOW_INDEX, 0, 0]);
    const blank = glyphImage(source, source.glyphs.get(0x20) ?? []);
    expect([blank.width, blank.height, blank.pixels.some((p) => p !== 0)]).toEqual([2, 3, false]);
  });
});
