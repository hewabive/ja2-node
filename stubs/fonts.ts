import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { encodeStiIndexed, type StiSubImage } from '../src/content/formats/sti.ts';
import { STUB_GLYPH_TABLE_FILE } from '../src/content/text/data-version.ts';
import { DEFAULT_SHADOW, FontColor } from '../src/content/text/font-colors.ts';
import { type GlyphTable, glyphCount, parseGlyphTable } from '../src/content/text/glyph-table.ts';
import { PROJECT_DATA_DIR } from '../src/node/repo.ts';

export const STUB_GLYPH_TABLE_PATH = STUB_GLYPH_TABLE_FILE;
export const STUB_FONT_LICENSE_FILES = ['fonts/OFL.txt', 'fonts/NOTICE.txt'] as const;
export const GLYPH_SOURCE_FORMAT = 'ja2-node.glyphs/1';
export const FONT_INK_INDEX = 2;
export const FONT_SHADOW_INDEX = 1;

const ENGLISH_GLYPH_TABLE = 'externalized/translation_tables/translation-table-eng.json';
const OWN_GLYPH_CHARACTERS = '`~«»–—…№';
const FALLBACK_CHARACTER = '?';
const FONT_SOURCE_DIR = join(import.meta.dirname, 'font');
const SHADOW_OFFSET = 1;
const BITS_PER_BYTE = 8;
const HEX_DIGITS_PER_BYTE = 2;
const PALETTE_COLOURS = 256;
const SHADOW_COLOUR = [32, 32, 32] as const;
const BLACK = [0, 0, 0] as const;

const NAMED_COLOURS: readonly (readonly [number, readonly [number, number, number]])[] = [
  [DEFAULT_SHADOW, BLACK],
  [FontColor.WHITE, [255, 255, 255]],
  [FontColor.GRAY1, [224, 224, 224]],
  [FontColor.GRAY2, [200, 200, 200]],
  [FontColor.GRAY3, [176, 176, 176]],
  [FontColor.GRAY4, [152, 152, 152]],
  [FontColor.GRAY5, [128, 128, 128]],
  [FontColor.GRAY6, [104, 104, 104]],
  [FontColor.GRAY7, [80, 80, 80]],
  [FontColor.GRAY8, [56, 56, 56]],
  [FontColor.NEARBLACK, [24, 24, 24]],
  [FontColor.LTRED, [255, 104, 104]],
  [FontColor.RED, [224, 40, 40]],
  [FontColor.MCOLOR_DKRED, [168, 24, 24]],
  [FontColor.DKRED, [128, 16, 16]],
  [FontColor.ORANGE, [240, 144, 32]],
  [FontColor.MCOLOR_LTYELLOW, [255, 255, 144]],
  [FontColor.YELLOW, [255, 232, 64]],
  [FontColor.DKYELLOW, [184, 152, 32]],
  [FontColor.LTGREEN, [128, 240, 128]],
  [FontColor.GREEN, [40, 200, 64]],
  [FontColor.DKGREEN, [24, 120, 40]],
  [FontColor.LTBLUE, [128, 176, 255]],
  [FontColor.BLUE, [64, 104, 240]],
  [FontColor.DKBLUE, [32, 48, 160]],
  [FontColor.BEIGE, [224, 200, 160]],
  [FontColor.METALGRAY, [144, 152, 168]],
  [FontColor.BURGUNDY, [128, 24, 56]],
  [FontColor.LTKHAKI, [200, 192, 136]],
  [FontColor.KHAKI, [168, 160, 104]],
  [FontColor.DKKHAKI, [120, 112, 64]],
];

export interface StubFontFace {
  readonly source: string;
  readonly path: string;
  readonly names: readonly string[];
}

export const STUB_FONT_FACES: readonly StubFontFace[] = [
  {
    source: 'stub-pixel-12.txt',
    path: 'fonts/stub-pixel-12.sti',
    names: [
      'tinyfont1',
      'smallfont1',
      'smallcompfont',
      'compfont',
      'font10arial',
      'font10arialbold',
      'font12arial',
      'font12arialfixedwidth',
      'font12point1',
      'blockfont',
      'blockfont2',
      'blockfontnarrow',
    ],
  },
  {
    source: 'stub-pixel-16b.txt',
    path: 'fonts/stub-pixel-16b.sti',
    names: ['font14arial', 'font14humanist', 'font16arial', 'largefont1', 'hugefont'],
  },
];

export interface GlyphSource {
  readonly name: string;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly glyphs: ReadonlyMap<number, readonly number[]>;
}

function codePoint(character: string): number {
  return character.codePointAt(0) as number;
}

export function stubGlyphTableFrom(english: GlyphTable): Map<number, number> {
  const table = new Map<number, number>();
  const taken = new Set<number>();
  let next = glyphCount(english);
  for (const [cp, glyph] of [...english].sort(([a], [b]) => a - b)) {
    if (taken.has(glyph)) table.set(cp, next++);
    else {
      table.set(cp, glyph);
      taken.add(glyph);
    }
  }
  for (const character of OWN_GLYPH_CHARACTERS) if (!table.has(codePoint(character))) table.set(codePoint(character), next++);
  return table;
}

export async function stubGlyphTable(): Promise<Map<number, number>> {
  return stubGlyphTableFrom(parseGlyphTable(JSON.parse(await readFile(join(PROJECT_DATA_DIR, ENGLISH_GLYPH_TABLE), 'utf8'))));
}

export function encodeGlyphTable(table: GlyphTable): string {
  const entries = [...table].sort(([a, ga], [b, gb]) => ga - gb || a - b);
  const lines = entries.map(([cp, glyph]) => `  ${JSON.stringify(String.fromCodePoint(cp))}: ${glyph}`);
  return `{\n${lines.join(',\n')}\n}\n`;
}

export function slotCharacters(table: GlyphTable): (number | null)[] {
  const slots: (number | null)[] = new Array(glyphCount(table)).fill(null);
  for (const [cp, glyph] of [...table].sort(([a], [b]) => a - b)) if (slots[glyph] === null) slots[glyph] = cp;
  return slots;
}

function field(lines: readonly string[], key: string, what: string): string {
  const line = lines.find((l) => l.startsWith(`${key}:`));
  if (!line) throw new Error(`${what}: missing '${key}:'`);
  return line.slice(key.length + 1).trim();
}

export function parseGlyphSource(text: string, what: string): GlyphSource {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines[0] !== GLYPH_SOURCE_FORMAT) throw new Error(`${what}: must start with ${GLYPH_SOURCE_FORMAT}`);
  const [cellWidth, cellHeight] = field(lines, 'cell', what).split(/\s+/).map(Number);
  if (!cellWidth || !cellHeight || cellWidth > BITS_PER_BYTE) throw new Error(`${what}: bad cell size`);
  const rowDigits = Math.ceil(cellWidth / BITS_PER_BYTE) * HEX_DIGITS_PER_BYTE;
  const glyphs = new Map<number, number[]>();
  for (const line of lines.filter((l) => l.startsWith('U+'))) {
    const m = /^U\+([0-9A-F]{4,6}) ([0-9A-F]+)$/.exec(line);
    if (!m || m[2]?.length !== rowDigits * cellHeight) throw new Error(`${what}: bad glyph line '${line}'`);
    const bitmap = m[2];
    const rows = Array.from({ length: cellHeight }, (_, y) => Number.parseInt(bitmap.slice(y * rowDigits, (y + 1) * rowDigits), 16));
    glyphs.set(Number.parseInt(m[1] ?? '', 16), rows);
  }
  return { name: field(lines, 'name', what), cellWidth, cellHeight, glyphs };
}

function inkAt(rows: readonly number[], cellWidth: number, x: number, y: number): boolean {
  if (x < 0 || x >= cellWidth || y < 0 || y >= rows.length) return false;
  return (((rows[y] ?? 0) >> (BITS_PER_BYTE - 1 - x)) & 1) === 1;
}

function inkColumns(rows: readonly number[], cellWidth: number): { left: number; right: number } | null {
  let left = cellWidth;
  let right = -1;
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < cellWidth; x++) {
      if (!inkAt(rows, cellWidth, x, y)) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  return right < 0 ? null : { left, right };
}

export function glyphImage(source: GlyphSource, rows: readonly number[]): StiSubImage {
  const height = source.cellHeight + SHADOW_OFFSET;
  const columns = inkColumns(rows, source.cellWidth);
  if (!columns) {
    const width = Math.ceil(source.cellWidth / 2);
    return { offsetX: 0, offsetY: 0, width, height, pixels: new Uint8Array(width * height) };
  }
  const width = columns.right - columns.left + 1 + SHADOW_OFFSET;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cx = columns.left + x;
      if (inkAt(rows, source.cellWidth, cx, y)) pixels[y * width + x] = FONT_INK_INDEX;
      else if (inkAt(rows, source.cellWidth, cx - SHADOW_OFFSET, y - SHADOW_OFFSET)) pixels[y * width + x] = FONT_SHADOW_INDEX;
    }
  }
  return { offsetX: 0, offsetY: 0, width, height, pixels };
}

export function stubFontPalette(): Uint8Array {
  const palette = new Uint8Array(PALETTE_COLOURS * 3);
  palette.set(SHADOW_COLOUR, FONT_SHADOW_INDEX * 3);
  for (const [index, rgb] of NAMED_COLOURS) palette.set(rgb, index * 3);
  return palette;
}

export function encodeStubFont(source: GlyphSource, table: GlyphTable): Uint8Array {
  const fallback = codePoint(FALLBACK_CHARACTER);
  const subImages = slotCharacters(table).map((cp) => {
    const rows = source.glyphs.get(cp ?? fallback);
    if (!rows) throw new Error(`${source.name}: no glyph for U+${(cp ?? fallback).toString(16).toUpperCase().padStart(4, '0')}`);
    return glyphImage(source, rows);
  });
  return encodeStiIndexed({ palette: stubFontPalette(), subImages });
}

export async function loadGlyphSource(file: string): Promise<GlyphSource> {
  return parseGlyphSource(await readFile(join(FONT_SOURCE_DIR, file), 'utf8'), file);
}

async function put(out: string, path: string, bytes: Uint8Array | string): Promise<string> {
  await mkdir(dirname(join(out, path)), { recursive: true });
  await writeFile(join(out, path), bytes);
  return path;
}

export async function buildStubFonts(out: string, aliases: Map<string, string>): Promise<string[]> {
  const table = await stubGlyphTable();
  const written = [await put(out, STUB_GLYPH_TABLE_PATH, encodeGlyphTable(table))];
  for (const face of STUB_FONT_FACES) {
    written.push(await put(out, face.path, encodeStubFont(await loadGlyphSource(face.source), table)));
    for (const name of face.names) aliases.set(`fonts/${name}.sti`, face.path);
  }
  for (const path of STUB_FONT_LICENSE_FILES) {
    const name = path.split('/').at(-1) ?? path;
    written.push(await put(out, path, await readFile(join(FONT_SOURCE_DIR, name))));
  }
  return written;
}
