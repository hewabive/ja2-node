import type { FontId } from '../draw-list.ts';
import { type BitmapFont, fontIdOfPath } from './bitmap-font.ts';

export const FONTS_TABLE_PATH = 'tables/ui-constants/Font_Control.json';

export const FontName = {
  FONT10ARIAL: 'FONT10ARIAL',
  FONT10ARIALBOLD: 'FONT10ARIALBOLD',
  FONT12ARIAL: 'FONT12ARIAL',
  FONT12ARIALFIXEDWIDTH: 'FONT12ARIALFIXEDWIDTH',
  FONT12POINT1: 'FONT12POINT1',
  FONT14ARIAL: 'FONT14ARIAL',
  FONT14HUMANIST: 'FONT14HUMANIST',
  FONT16ARIAL: 'FONT16ARIAL',
  BLOCKFONT: 'BLOCKFONT',
  BLOCKFONT2: 'BLOCKFONT2',
  BLOCKFONTNARROW: 'BLOCKFONTNARROW',
  COMPFONT: 'COMPFONT',
  SMALLCOMPFONT: 'SMALLCOMPFONT',
  LARGEFONT1: 'LARGEFONT1',
  SMALLFONT1: 'SMALLFONT1',
  TINYFONT1: 'TINYFONT1',
} as const;
export type FontName = (typeof FontName)[keyof typeof FontName];

export type FontFiles = Readonly<Record<string, string>>;

export const EMPTY_FONT: BitmapFont = { id: '', glyphs: [], table: new Map([[0x3f, 0]]) };

export function parseFontFiles(json: unknown): FontFiles {
  const fonts = (json as { fonts?: unknown } | null)?.fonts;
  if (typeof fonts !== 'object' || fonts === null) throw new Error('the font table has no fonts');
  const files: Record<string, string> = {};
  for (const [name, path] of Object.entries(fonts)) {
    if (typeof path !== 'string') throw new Error(`font ${name} has no file`);
    files[name] = path;
  }
  return files;
}

export class FontSet {
  readonly files: FontFiles;
  readonly #fonts: ReadonlyMap<FontId, BitmapFont>;

  constructor(files: FontFiles, fonts: ReadonlyMap<FontId, BitmapFont>) {
    this.files = files;
    this.#fonts = fonts;
  }

  idOf(name: string): FontId {
    const path = this.files[name];
    return path ? fontIdOfPath(path) : name.toLowerCase();
  }

  knows(name: string): boolean {
    return name in this.files;
  }

  find(name: string): BitmapFont | null {
    return this.#fonts.get(this.idOf(name)) ?? null;
  }

  get(name: string): BitmapFont {
    return this.find(name) ?? EMPTY_FONT;
  }

  paths(): string[] {
    return [...new Set(Object.values(this.files))];
  }
}
