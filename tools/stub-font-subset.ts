import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { GLYPH_SOURCE_FORMAT, stubGlyphTable } from '../stubs/fonts.ts';

const FALLBACK_CHARACTER = '?';

interface BdfGlyph {
  readonly encoding: number;
  readonly width: number;
  readonly height: number;
  readonly rows: readonly string[];
}

interface BdfFont {
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly glyphs: ReadonlyMap<number, BdfGlyph>;
}

function parseBdf(text: string): BdfFont {
  const lines = text.split(/\r?\n/);
  const box =
    lines
      .find((l) => l.startsWith('FONTBOUNDINGBOX '))
      ?.split(/\s+/)
      .slice(1)
      .map(Number) ?? [];
  const [cellWidth = 0, cellHeight = 0] = box;
  const glyphs = new Map<number, BdfGlyph>();
  let encoding = -1;
  let size = [0, 0];
  let rows: string[] | null = null;
  for (const line of lines) {
    if (line.startsWith('ENCODING ')) encoding = Number(line.split(/\s+/)[1]);
    else if (line.startsWith('BBX ')) size = line.split(/\s+/).slice(1, 3).map(Number);
    else if (line === 'BITMAP') rows = [];
    else if (line === 'ENDCHAR') {
      if (rows) glyphs.set(encoding, { encoding, width: size[0] ?? 0, height: size[1] ?? 0, rows });
      rows = null;
    } else if (rows) rows.push(line.trim().toUpperCase());
  }
  return { cellWidth, cellHeight, glyphs };
}

function glyphLine(font: BdfFont, cp: number): string {
  const glyph = font.glyphs.get(cp);
  if (!glyph) throw new Error(`the font has no glyph for U+${cp.toString(16).toUpperCase()}`);
  if (glyph.width !== font.cellWidth || glyph.height !== font.cellHeight || glyph.rows.length !== font.cellHeight)
    throw new Error(`U+${cp.toString(16).toUpperCase()} does not fill the cell`);
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')} ${glyph.rows.join('')}`;
}

const { values } = parseArgs({
  options: { bdf: { type: 'string' }, name: { type: 'string' }, source: { type: 'string' }, out: { type: 'string' } },
});
if (!values.bdf || !values.name || !values.source || !values.out) {
  console.error('usage: node tools/stub-font-subset.ts --bdf <font.bdf> --name <name> --source <text> --out <stubs/font/file.txt>');
  process.exit(2);
}
const font = parseBdf(await readFile(values.bdf, 'utf8'));
const wanted = [...new Set([...(await stubGlyphTable()).keys(), FALLBACK_CHARACTER.codePointAt(0) as number])].sort((a, b) => a - b);
const lines = [
  GLYPH_SOURCE_FORMAT,
  `name: ${values.name}`,
  `cell: ${font.cellWidth} ${font.cellHeight}`,
  `source: ${values.source}`,
  ...wanted.map((cp) => glyphLine(font, cp)),
];
await writeFile(values.out, `${lines.join('\n')}\n`);
console.log(`${values.out}: ${wanted.length} glyphs, cell ${font.cellWidth}x${font.cellHeight}`);
