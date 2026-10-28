// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Utils/WordWrap.cc LineWrap, DisplayWrappedString, DrawTextToScreen, IanDrawTextToScreen,
// @src IanDisplayWrappedString, CleanOutControlCodesFromString, IanWrappedStringHeight, ReduceStringLength;
// @src src/game/Utils/WordWrap.h (the text codes and flags).

import { DEFAULT_SHADOW, NO_SHADOW } from '../../content/text/font-colors.ts';
import { idiv, u16 } from '../../core/int.ts';
import type { DrawList, FontColors } from '../draw-list.ts';
import { type BitmapFont, fontHeight } from './bitmap-font.ts';
import { charWidth, codePoints, stringPixLength } from './measure.ts';
import { mprint } from './print.ts';

export const TEXT_SPACE = 32;
export const TextCode = { NEWLINE: 177, BOLD: 178, CENTER: 179, NEWCOLOR: 180, DEFCOLOR: 181 } as const;
export const TextFlag = {
  LEFT_JUSTIFIED: 0x01,
  CENTER_JUSTIFIED: 0x02,
  RIGHT_JUSTIFIED: 0x04,
  TEXT_SHADOWED: 0x08,
  INVALIDATE_TEXT: 0x10,
  DONT_DISPLAY_TEXT: 0x20,
  MARK_DIRTY: 0x40,
} as const;
export const IAN_WRAP_NO_SHADOW = 32;
export const IAN_NEW_COLOR = 184;

const END = 0;
const HYPHEN = 0x2d;
const DOT = 0x2e;
const DOTS = 3;
const FIRST_CHINESE = 0x4e00;
const MEASURED_FLAGS = TextFlag.CENTER_JUSTIFIED | TextFlag.RIGHT_JUSTIFIED | TextFlag.TEXT_SHADOWED | TextFlag.INVALIDATE_TEXT;

function isChinese(c: number | undefined): boolean {
  return c !== undefined && c >= FIRST_CHINESE;
}

function isControl(c: number | undefined): boolean {
  return c === TextCode.NEWLINE || c === TextCode.BOLD || c === TextCode.CENTER || c === TextCode.NEWCOLOR || c === TextCode.DEFCOLOR;
}

function terminated(text: string): number[] {
  return [...codePoints(text), END];
}

function textOf(cps: readonly number[], from: number, to: number): string {
  return String.fromCodePoint(...cps.slice(from, to));
}

export function lineWrap(font: BitmapFont, lineWidth: number, text: string): string[] {
  const cps = terminated(text);
  const maxWidth = u16(lineWidth);
  const result: string[] = [];
  let i = 0;
  while (cps[i] === TEXT_SPACE) i++;
  let lineW = 0;
  let lineStart = i;
  let lineEnd = i;
  let wordStart = i;
  let wordW = 0;
  for (; ; i++) {
    if (cps[i] === TEXT_SPACE) {
      lineEnd = i;
      for (; cps[i] === TEXT_SPACE; i++) lineW += charWidth(font, TEXT_SPACE);
      wordStart = i;
      wordW = 0;
    }
    const c = cps[i] ?? END;
    if (c === END) {
      if (lineStart !== i) result.push(textOf(cps, lineStart, i));
      return result;
    }
    const w = charWidth(font, c);
    wordW += w;
    lineW += w;
    if (lineW > maxWidth) {
      if (lineStart === lineEnd) {
        lineEnd = i;
        wordStart = i;
        wordW = 0;
      }
      result.push(textOf(cps, lineStart, lineEnd));
      lineStart = wordStart;
      lineEnd = wordStart;
      lineW = wordW;
    }
    if (c === HYPHEN) {
      lineEnd = i + 1;
      wordStart = i + 1;
      wordW = 0;
    }
    if (isChinese(c)) {
      wordStart = i;
      lineEnd = i;
      wordW = w;
    }
  }
}

export function drawTextToScreen(
  list: DrawList,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  font: BitmapFont,
  colors: FontColors,
  flags: number,
): void {
  if (flags & TextFlag.DONT_DISPLAY_TEXT) return;
  const width = flags & MEASURED_FLAGS ? stringPixLength(text, font) : 0;
  let px = u16(x);
  if (flags & TextFlag.CENTER_JUSTIFIED) px = u16(px + idiv(u16(maxWidth) - width, 2));
  else if (flags & TextFlag.RIGHT_JUSTIFIED) px = u16(px + u16(maxWidth) - width);
  const py = u16(y);
  if (flags & TextFlag.TEXT_SHADOWED) list.shadow(px - 1, py - 1, px + width, py + fontHeight(font));
  mprint(list, font, px, py, text, colors);
}

export function displayWrappedString(
  list: DrawList,
  x: number,
  y: number,
  width: number,
  gap: number,
  font: BitmapFont,
  colors: FontColors,
  text: string,
  flags: number,
): number {
  const lineHeight = u16(fontHeight(font) + gap);
  let total = 0;
  let py = u16(y);
  for (const line of lineWrap(font, width, text)) {
    drawTextToScreen(list, line, x, py, width, font, colors, flags);
    total = u16(total + lineHeight);
    py = u16(py + lineHeight);
  }
  return total;
}

export function cleanOutControlCodes(text: string): string {
  const cps = terminated(text);
  const out: number[] = [];
  let s = 0;
  for (;;) {
    const c = cps[s] ?? END;
    switch (c) {
      case TextCode.CENTER:
      case TextCode.NEWCOLOR:
      case TextCode.BOLD:
      case TextCode.DEFCOLOR:
        s++;
        if (cps[s] === TEXT_SPACE) s++;
        break;
      case TextCode.NEWLINE:
        s++;
        break;
      case END:
        return String.fromCodePoint(...out);
      default:
        out.push(c);
        s++;
        break;
    }
  }
}

export interface IanWrapOptions {
  readonly bold: BitmapFont;
  readonly flags?: number;
}

export function ianDisplayWrappedString(
  list: DrawList,
  sx: number,
  sy: number,
  maxWidth: number,
  gap: number,
  font: BitmapFont,
  colors: FontColors,
  text: string,
  options: IanWrapOptions,
): number {
  const flags = options.flags ?? 0;
  const cps = terminated(text);
  const maxW = u16(maxWidth);
  let line: number[] = [];
  let i = 0;
  let curMaxW = maxW;
  let lineW = 0;
  let x = u16(sx);
  let y = u16(sy);
  let curFont = font;
  let lineHeight = u16(fontHeight(curFont) + gap);
  let bold = false;
  let foreground = colors.foreground;
  let justification: number = TextFlag.LEFT_JUSTIFIED;
  let shadow = colors.shadow;
  const draw = (fg: number) => {
    const lineShadow = flags & IAN_WRAP_NO_SHADOW ? NO_SHADOW : shadow;
    const lineText = cleanOutControlCodes(String.fromCodePoint(...line));
    drawTextToScreen(
      list,
      lineText,
      x,
      y,
      curMaxW,
      curFont,
      { foreground: fg, shadow: lineShadow, background: colors.background },
      justification,
    );
    if (flags & IAN_WRAP_NO_SHADOW) shadow = DEFAULT_SHADOW;
  };
  const advanceX = () => {
    x = u16(x + stringPixLength(String.fromCodePoint(...line), curFont));
  };
  const skipSpace = () => {
    if (cps[i + 1] === TEXT_SPACE) i++;
  };
  do {
    const c = cps[i] ?? END;
    switch (c) {
      case TextCode.CENTER:
        if (justification !== TextFlag.CENTER_JUSTIFIED) justification = TextFlag.CENTER_JUSTIFIED;
        else {
          draw(foreground);
          x = u16(sx);
          y = u16(y + lineHeight);
          justification = TextFlag.LEFT_JUSTIFIED;
        }
        line = [];
        lineW = 0;
        skipSpace();
        break;
      case TextCode.NEWLINE:
        draw(foreground);
        x = u16(sx);
        y = u16(y + lineHeight);
        line = [];
        lineW = 0;
        curMaxW = maxW;
        skipSpace();
        break;
      case TextCode.BOLD:
        draw(colors.foreground);
        advanceX();
        curMaxW = u16(curMaxW - lineW);
        bold = !bold;
        if (bold) {
          shadow = NO_SHADOW;
          curFont = options.bold;
        } else curFont = font;
        lineHeight = u16(fontHeight(curFont) + gap);
        line = [];
        skipSpace();
        break;
      case TextCode.NEWCOLOR:
        draw(foreground);
        advanceX();
        i++;
        foreground = IAN_NEW_COLOR;
        curMaxW = u16(curMaxW - lineW);
        line = [];
        skipSpace();
        break;
      case TextCode.DEFCOLOR:
        draw(foreground);
        advanceX();
        curMaxW = u16(curMaxW - lineW);
        line = [];
        foreground = colors.foreground;
        skipSpace();
        break;
      default: {
        if (c === END) break;
        let wordW = 0;
        const wordStart = i;
        do {
          wordW = u16(wordW + charWidth(curFont, cps[i] ?? END));
          i++;
        } while (cps[i] !== TEXT_SPACE && !isChinese(cps[i]) && !isControl(cps[i]) && cps[i] !== END);
        if (lineW + wordW > maxW) {
          draw(foreground);
          x = u16(sx);
          y = u16(y + lineHeight);
          line = [];
          lineW = 0;
          curMaxW = maxW;
        }
        lineW = u16(lineW + wordW);
        line.push(...cps.slice(wordStart, i));
        if (isChinese(cps[i]) || isControl(cps[i])) i--;
        else if (cps[i] !== END) {
          line.push(TEXT_SPACE);
          lineW = u16(lineW + charWidth(curFont, TEXT_SPACE));
        }
        break;
      }
    }
  } while (cps[i] !== END && cps[++i] !== END && i < cps.length);
  draw(foreground);
  y = u16(y + lineHeight);
  return u16(y - u16(sy));
}

export function ianWrappedStringHeight(maxWidth: number, gap: number, font: BitmapFont, text: string, boldFont: BitmapFont): number {
  const cps = terminated(text);
  const maxW = u16(maxWidth);
  let lineW = 0;
  let lines = 1;
  let curFont = font;
  let justification: number = TextFlag.LEFT_JUSTIFIED;
  let bold = false;
  let i = 0;
  const skipSpace = () => {
    if (cps[i + 1] === TEXT_SPACE) i++;
  };
  do {
    const c = cps[i] ?? END;
    switch (c) {
      case TextCode.CENTER:
        if (justification !== TextFlag.CENTER_JUSTIFIED) justification = TextFlag.CENTER_JUSTIFIED;
        else {
          lines++;
          justification = TextFlag.LEFT_JUSTIFIED;
        }
        lineW = 0;
        skipSpace();
        break;
      case TextCode.NEWLINE:
        lines++;
        lineW = 0;
        skipSpace();
        break;
      case TextCode.BOLD:
        bold = !bold;
        curFont = bold ? boldFont : font;
        skipSpace();
        break;
      case TextCode.NEWCOLOR:
      case TextCode.DEFCOLOR:
        skipSpace();
        break;
      default: {
        if (c === END) break;
        let wordW = 0;
        do {
          wordW = u16(wordW + charWidth(curFont, cps[i] ?? END));
          i++;
        } while (cps[i] !== TEXT_SPACE && !isChinese(cps[i]) && !isControl(cps[i]) && cps[i] !== END);
        if (lineW + wordW > maxW) {
          lines++;
          lineW = 0;
        }
        lineW = u16(lineW + wordW);
        if (isChinese(cps[i]) || isControl(cps[i])) i--;
        else if (cps[i] !== END) lineW = u16(lineW + charWidth(curFont, TEXT_SPACE));
        break;
      }
    }
  } while (cps[i] !== END && cps[++i] !== END && i < cps.length);
  return u16(lines * (fontHeight(font) + gap));
}

export function reduceStringLength(text: string, widthToFitIn: number, font: BitmapFont): string {
  if (stringPixLength(text, font) <= widthToFitIn) return text;
  const dotWidth = charWidth(font, DOT);
  const dotsWidth = dotWidth * DOTS;
  let out = '';
  let width = 0;
  for (const c of text) {
    const w = charWidth(font, c.codePointAt(0) as number);
    if (width + w + dotsWidth > widthToFitIn) break;
    out += c;
    width += w;
  }
  for (let k = 0; k < DOTS; k++) {
    if (width + dotWidth > widthToFitIn) break;
    out += '.';
    width += dotWidth;
  }
  return out;
}
