// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/sgp/MouseSystem.cc RenderFastHelp (600 ms while the pointer rests with no button down), DisplayFastHelp
// @src (size, placement and the double frame, the interior shaded twice), GetWidthOfString, DisplayHelpTokenizedString
// @src ('|' bold gold 146, '^' light green, '~' light red, else beige). See docs/28 §3.2.

import { DEFAULT_SHADOW, FontColor } from '../../content/text/font-colors.ts';
import { type DrawList, rgb } from '../draw-list.ts';
import { type BitmapFont, fontHeight } from '../text/bitmap-font.ts';
import { FontName, type FontSet } from '../text/fonts.ts';
import { charWidth } from '../text/measure.ts';
import { mprint } from '../text/print.ts';
import type { MouseRegion, RegionDispatcher } from './regions.ts';

export const TOOLTIP_GOLD = 146;
const BOX_PADDING = 10;
const LINE_GAP = 1;
const BOX_EXTRA_HEIGHT = 8;
const OFFSET_X = 10;
const RIGHT_MARGIN = 4;
const BOTTOM_MARGIN = 15;
const TEXT_INSET = 5;
const OUTER_FRAME = rgb(65, 57, 15);
const INNER_FRAME = rgb(227, 198, 88);
const NEWLINE = '\n';

interface Token {
  readonly character: string;
  readonly bold: boolean;
  readonly foreground: number;
}

const TOKEN_STYLES: Readonly<Record<string, { readonly bold: boolean; readonly foreground: number }>> = {
  '|': { bold: true, foreground: TOOLTIP_GOLD },
  '^': { bold: false, foreground: FontColor.LTGREEN },
  '~': { bold: false, foreground: FontColor.LTRED },
};
const PLAIN = { bold: false, foreground: FontColor.BEIGE };

function tokenLines(text: string): Token[][] {
  const lines: Token[][] = [[]];
  const characters = [...text];
  for (let i = 0; i < characters.length; i++) {
    const c = characters[i] as string;
    if (c === NEWLINE) {
      lines.push([]);
      continue;
    }
    const style = TOKEN_STYLES[c];
    const character = style ? characters[++i] : c;
    if (character === undefined) break;
    lines.at(-1)?.push({ character, ...(style ?? PLAIN) });
  }
  return lines;
}

export interface TooltipBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function tooltipBox(region: MouseRegion, text: string, fonts: FontSet, screenWidth: number, screenHeight: number): TooltipBox {
  const normal = fonts.get(FontName.FONT10ARIAL);
  const bold = fonts.get(FontName.FONT10ARIALBOLD);
  const lines = tokenLines(text);
  const textWidth = Math.max(
    0,
    ...lines.map((line) => line.reduce((w, t) => w + charWidth(t.bold ? bold : normal, t.character.codePointAt(0) as number), 0)),
  );
  const width = textWidth + BOX_PADDING;
  const height = lines.length * (fontHeight(normal) + LINE_GAP) + BOX_EXTRA_HEIGHT;
  let x = region.x1 + OFFSET_X;
  if (x < 0) x = 0;
  if (x >= screenWidth - width) x = screenWidth - width - RIGHT_MARGIN;
  let y = region.y1;
  if (region.y2 - region.y1 < height) y += -height - 1;
  else y += Math.trunc((-height * 3) / 4);
  if (y < 0) y = 0;
  if (y >= screenHeight - height) y = screenHeight - height - BOTTOM_MARGIN;
  return { x, y, width, height };
}

function drawTokens(list: DrawList, lines: readonly Token[][], x: number, y: number, normal: BitmapFont, bold: BitmapFont): void {
  const lineHeight = fontHeight(normal) + LINE_GAP;
  lines.forEach((line, row) => {
    let pen = x;
    for (const token of line) {
      const font = token.bold ? bold : normal;
      pen += mprint(list, font, pen, y + row * lineHeight, token.character, {
        foreground: token.foreground,
        shadow: DEFAULT_SHADOW,
        background: FontColor.MCOLOR_BLACK,
      });
    }
  });
}

export function drawTooltip(list: DrawList, box: TooltipBox, text: string, fonts: FontSet): void {
  const { x, y, width: w, height: h } = box;
  list.rectangle(x + 1, y + 1, x + w - 1, y + h - 1, OUTER_FRAME);
  list.rectangle(x, y, x + w - 2, y + h - 2, INNER_FRAME);
  list.shadow(x + 2, y + 2, x + w - 3, y + h - 3);
  list.shadow(x + 2, y + 2, x + w - 3, y + h - 3);
  drawTokens(list, tokenLines(text), x + TEXT_INSET, y + TEXT_INSET, fonts.get(FontName.FONT10ARIAL), fonts.get(FontName.FONT10ARIALBOLD));
}

export class FastHelp {
  #lastClock = 0;

  render(
    list: DrawList,
    regions: RegionDispatcher,
    now: number,
    fonts: FontSet,
    screenWidth: number,
    screenHeight: number,
  ): MouseRegion | null {
    const delta = now - this.#lastClock;
    this.#lastClock = now;
    const region = regions.current;
    if (!region || region.tooltip.length === 0) return null;
    if (!(region.allowDisabledTooltip || region.enabled)) return null;
    if (region.tooltipTimer === 0) {
      region.tooltipShown = region.inArea;
      if (!region.inArea) region.tooltipReset = false;
      if (!region.tooltipShown) return null;
      drawTooltip(list, tooltipBox(region, region.tooltip, fonts, screenWidth, screenHeight), region.tooltip, fonts);
      return region;
    }
    if (region.inArea && region.buttonState === 0) region.tooltipTimer = Math.max(0, region.tooltipTimer - delta);
    return null;
  }
}
