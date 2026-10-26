import { beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { fixedFont, originalFontSet, stubFontSet, uniformFont } from '../../../tests/support/ui-fonts.ts';
import { DEFAULT_SHADOW, FontColor, NO_SHADOW } from '../../content/text/font-colors.ts';
import { DrawList, type GlyphRunItem } from '../draw-list.ts';
import { type BitmapFont, drawableGlyph, fontHeight } from './bitmap-font.ts';
import { FontName, type FontSet } from './fonts.ts';
import { centerAlign, charWidth, hCenterVCenterAlign, rightAlign, stringPixLength } from './measure.ts';
import { sprintMoney, sprintMoneyNoDollarOnZero } from './money.ts';
import { fontColors, mprint } from './print.ts';
import { printf } from './printf.ts';
import { weightBasedOnMetricOption, weightUnit } from './weight.ts';
import {
  cleanOutControlCodes,
  displayWrappedString,
  drawTextToScreen,
  IAN_WRAP_NO_SHADOW,
  ianDisplayWrappedString,
  ianWrappedStringHeight,
  lineWrap,
  reduceStringLength,
  TextCode,
  TextFlag,
} from './wrap.ts';

const WHITE = fontColors(FontColor.MCOLOR_WHITE);
const NL = String.fromCodePoint(TextCode.NEWLINE);
const BOLD = String.fromCodePoint(TextCode.BOLD);
const CENTER = String.fromCodePoint(TextCode.CENTER);
const NEWCOLOR = String.fromCodePoint(TextCode.NEWCOLOR);
const DEFCOLOR = String.fromCodePoint(TextCode.DEFCOLOR);

function runs(list: DrawList): GlyphRunItem[] {
  return list.items.filter((i): i is GlyphRunItem => i.kind === 'glyphs');
}

function firstX(run: GlyphRunItem | undefined): number | undefined {
  return run?.glyphs[0]?.x;
}

describe('measuring', () => {
  const font: BitmapFont = {
    id: 'f',
    table: new Map([
      [0x3f, 0],
      [0x41, 1],
      [0x42, 2],
      [0x17a, 3],
    ]),
    glyphs: [
      { width: 5, height: 9, offsetX: 0, offsetY: 1 },
      { width: 6, height: 8, offsetX: 1, offsetY: 0 },
      { width: 3, height: 8, offsetX: -1, offsetY: 0 },
    ],
  };

  it('advances by width plus x offset, with no kerning', () => {
    expect(charWidth(font, 0x41)).toBe(7);
    expect(charWidth(font, 0x42)).toBe(2);
    expect(stringPixLength('ABBA', font)).toBe(18);
  });

  it("draws '?' for a code point outside the table and for a glyph the font does not have", () => {
    expect(drawableGlyph(font, 0x43)).toBe(0);
    expect(drawableGlyph(font, 0x17a)).toBe(0);
    expect(charWidth(font, 0x17a)).toBe(5);
  });

  it('takes the font height from glyph 0 (height plus y offset)', () => {
    expect(fontHeight(font)).toBe(10);
  });

  it('centres with (w − len + 1) / 2 and right-aligns with w − len, truncating towards zero', () => {
    expect(centerAlign(10, 0, 20, 'A', font)).toEqual({ x: 10 + 7, y: 0 });
    expect(centerAlign(10, 0, 3, 'AA', font)).toEqual({ x: 10 - 5, y: 0 });
    expect(rightAlign(10, 0, 20, 'AB', font)).toEqual({ x: 21, y: 0 });
    expect(hCenterVCenterAlign(0, 0, 21, 15, 'AB', font)).toEqual({ x: 6, y: 2 });
  });
});

describe('printing', () => {
  it('emits one glyph run with every glyph at the pen', () => {
    const font = fixedFont('f', { a: 3, b: 5 });
    const list = new DrawList();
    expect(mprint(list, font, 4, 7, 'abz', WHITE)).toBe(3 + 5 + 4);
    expect(runs(list)[0]?.glyphs).toEqual([
      { index: 1, x: 4, y: 7 },
      { index: 2, x: 7, y: 7 },
      { index: 0, x: 12, y: 7 },
    ]);
  });

  it('DrawTextToScreen centres without the +1, right-aligns and shades behind TEXT_SHADOWED text', () => {
    const font = uniformFont('f', 4);
    const list = new DrawList();
    drawTextToScreen(list, 'abc', 10, 5, 17, font, WHITE, TextFlag.CENTER_JUSTIFIED);
    drawTextToScreen(list, 'abc', 10, 5, 17, font, WHITE, TextFlag.RIGHT_JUSTIFIED | TextFlag.TEXT_SHADOWED);
    drawTextToScreen(list, 'abc', 10, 5, 17, font, WHITE, TextFlag.DONT_DISPLAY_TEXT);
    expect(runs(list).map(firstX)).toEqual([12, 15]);
    expect(list.items.find((i) => i.kind === 'shadow')).toMatchObject({ x: 14, y: 4, width: 14, height: 12 });
  });

  it('wraps the x position of DrawTextToScreen like a UINT16', () => {
    const list = new DrawList();
    drawTextToScreen(list, 'abcdef', 2, 0, 0, uniformFont('f', 4), WHITE, TextFlag.CENTER_JUSTIFIED);
    expect(firstX(runs(list)[0])).toBe(65536 + 2 - 12);
  });
});

describe('LineWrap', () => {
  const font = uniformFont('f', 4);

  it('breaks at spaces, drops the break space and keeps trailing spaces of the last line', () => {
    expect(lineWrap(font, 24, 'aaa bbb ccc  ')).toEqual(['aaa', 'bbb', 'ccc  ']);
    expect(lineWrap(font, 40, '   aaa bbb')).toEqual(['aaa bbb']);
  });

  it('breaks after a hyphen', () => {
    expect(lineWrap(font, 24, 'aaa-bbb')).toEqual(['aaa-', 'bbb']);
  });

  it('splits a word longer than the line where it overflows, without counting the overflowing character', () => {
    expect(lineWrap(font, 12, 'abcdefgh')).toEqual(['abc', 'defg', 'h']);
  });

  it('may break before any code point from U+4E00 on, one character early like Stracciatella', () => {
    const cjk = fixedFont('c', { 一: 8, 二: 8, 三: 8 });
    expect(lineWrap(cjk, 16, '一二三')).toEqual(['一', '二三']);
  });

  it('DisplayWrappedString steps by font height + gap and returns the total height', () => {
    const list = new DrawList();
    const height = displayWrappedString(list, 0, 10, 24, 2, font, WHITE, 'aaa bbb ccc', TextFlag.LEFT_JUSTIFIED);
    expect(height).toBe(3 * 12);
    expect(runs(list).map((r) => r.glyphs[0]?.y)).toEqual([10, 22, 34]);
  });
});

describe('the Ian codes', () => {
  const font = uniformFont('normal', 4, 10);
  const bold = uniformFont('bold', 5, 11);
  const options = { bold };

  it('breaks lines at code 177 and by words at the width', () => {
    const list = new DrawList();
    const text = `aa bb${NL}cc dd ee`;
    const height = ianDisplayWrappedString(list, 0, 0, 24, 2, font, WHITE, text, options);
    expect(runs(list).map((r) => [r.glyphs[0]?.x, r.glyphs[0]?.y, r.glyphs.length])).toEqual([
      [0, 0, 5],
      [0, 12, 6],
      [0, 24, 2],
    ]);
    expect(height).toBe(36);
    expect(ianWrappedStringHeight(24, 2, font, text, bold)).toBe(36);
  });

  it('switches to the bold font with the shadow off at code 178 and continues on the same line', () => {
    const list = new DrawList();
    ianDisplayWrappedString(
      list,
      0,
      0,
      200,
      2,
      font,
      fontColors(FontColor.MCOLOR_WHITE, DEFAULT_SHADOW),
      `ab ${BOLD}cd${BOLD} ef`,
      options,
    );
    const [plain, strong, after] = runs(list);
    expect([plain?.font, strong?.font, after?.font]).toEqual(['normal', 'bold', 'normal']);
    expect([plain?.shadow, strong?.shadow, after?.shadow]).toEqual([DEFAULT_SHADOW, NO_SHADOW, NO_SHADOW]);
    expect(firstX(strong)).toBe(12);
  });

  it('colours with 184 after code 180, whatever its argument, and goes back with 181', () => {
    const list = new DrawList();
    ianDisplayWrappedString(list, 0, 0, 200, 2, font, WHITE, `ab ${NEWCOLOR}xcd ${DEFCOLOR}ef`, options);
    expect(runs(list).map((r) => r.foreground)).toEqual([FontColor.MCOLOR_WHITE, 184, FontColor.MCOLOR_WHITE]);
  });

  it('centres the lines between two 179 codes in the full width', () => {
    const list = new DrawList();
    const height = ianDisplayWrappedString(list, 0, 0, 40, 0, font, WHITE, `${CENTER}ab${CENTER}cd`, options);
    expect(runs(list).map((r) => [r.glyphs[0]?.x, r.glyphs[0]?.y])).toEqual([
      [16, 0],
      [0, 10],
    ]);
    expect(height).toBe(20);
    expect(ianWrappedStringHeight(40, 0, font, `${CENTER}ab${CENTER}cd`, bold)).toBe(20);
  });

  it('turns every line shadowless with IAN_WRAP_NO_SHADOW', () => {
    const list = new DrawList();
    ianDisplayWrappedString(list, 0, 0, 200, 2, font, WHITE, `ab${NL}cd`, { bold, flags: IAN_WRAP_NO_SHADOW });
    expect(runs(list).map((r) => r.shadow)).toEqual([NO_SHADOW, NO_SHADOW]);
  });

  it('strips the codes like CleanOutControlCodesFromString', () => {
    expect(cleanOutControlCodes(`${CENTER} a${NL}b${NEWCOLOR} xc${BOLD}d`)).toBe('abxcd');
  });

  it('draws nothing for an empty string and still counts one line', () => {
    const list = new DrawList();
    expect(ianDisplayWrappedString(list, 0, 0, 100, 2, font, WHITE, '', options)).toBe(12);
    expect(ianWrappedStringHeight(100, 2, font, '', bold)).toBe(12);
  });
});

describe('ReduceStringLength, money and printf', () => {
  const font = uniformFont('f', 4);

  it('truncates with up to three dots so the result fits', () => {
    expect(reduceStringLength('abcdef', 24, font)).toBe('abcdef');
    expect(reduceStringLength('abcdefgh', 24, font)).toBe('abc...');
    expect(reduceStringLength('abcdefgh', 10, font)).toBe('..');
  });

  it('puts the minus after the dollar and a comma every three digits', () => {
    expect(sprintMoney(-1234)).toBe('$-1,234');
    expect(sprintMoney(1234567)).toBe('$1,234,567');
    expect(sprintMoney(-123)).toBe('$-123');
    expect(sprintMoney(0)).toBe('$0');
    expect(sprintMoneyNoDollarOnZero(0)).toBe('0');
    expect(sprintMoneyNoDollarOnZero(1000)).toBe('$1,000');
  });

  it('converts weights by the metric option and names the unit', () => {
    expect(weightBasedOnMetricOption(12, true)).toBe(12);
    expect(weightBasedOnMetricOption(12, false)).toBe(Math.fround(12 * Math.fround(2.2)));
    const text = { string: (table: string, index: number) => `${table}:${index}`, edt: () => null };
    expect([weightUnit(text, true), weightUnit(text, false)]).toEqual(['pMessageStrings:16', 'pMessageStrings:17']);
  });

  it('formats printf templates', () => {
    expect(printf('%s has %d%%', ['Ivan', 7.9])).toBe('Ivan has 7%');
  });
});

describe('the stub fonts', () => {
  let fonts: FontSet;
  beforeAll(async () => {
    fonts = await stubFontSet();
  });

  it('measure, wrap and lay out Latin and Cyrillic text', () => {
    const small = fonts.get(FontName.FONT10ARIAL);
    expect(stringPixLength('Hello', small)).toBeGreaterThan(10);
    expect(stringPixLength('Привет', small)).toBeGreaterThan(10);
    const lines = lineWrap(small, 60, 'Съешь же ещё этих мягких французских булок');
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) expect(stringPixLength(line.trimEnd(), small)).toBeLessThanOrEqual(60);
    const text = `Привет${BOLD} мир${BOLD} and more words to wrap`;
    const list = new DrawList();
    const bold = fonts.get(FontName.FONT10ARIALBOLD);
    expect(ianDisplayWrappedString(list, 0, 0, 80, 2, small, WHITE, text, { bold })).toBe(ianWrappedStringHeight(80, 2, small, text, bold));
  });
});

describe.skipIf(!ORIGINAL_DATA_DIR)('the original fonts', () => {
  let fonts: FontSet;
  beforeAll(async () => {
    fonts = await originalFontSet(ORIGINAL_DATA_DIR);
  });

  it('load all sixteen and guard the glyph index against fonts with one glyph fewer', () => {
    for (const name of Object.values(FontName)) expect(fonts.find(name)?.glyphs.length ?? 0).toBeGreaterThan(180);
    const block = fonts.get(FontName.BLOCKFONT);
    expect(drawableGlyph(block, 'ź'.codePointAt(0) as number)).toBe(drawableGlyph(block, 0x3f));
  });

  it('measure and wrap exactly as the original arithmetic over the real glyph widths', () => {
    const font = fonts.get(FontName.FONT12ARIAL);
    const bold = fonts.get(FontName.FONT10ARIALBOLD);
    const text = 'Are you sure you want to quit the game? All progress since the last save will be lost.';
    const height = ianWrappedStringHeight(220, 2, font, text, bold);
    const list = new DrawList();
    expect(ianDisplayWrappedString(list, 0, 0, 220, 2, font, WHITE, text, { bold })).toBe(height);
    expect(height % (fontHeight(font) + 2)).toBe(0);
    for (const line of lineWrap(font, 220, text)) expect(stringPixLength(line, font)).toBeLessThanOrEqual(220);
  });
});
