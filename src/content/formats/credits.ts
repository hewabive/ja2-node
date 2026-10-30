// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Credits.cc CRDT_* codes and flags, EnterCreditsScreen defaults, GetNextCreditFromTextFile, GetNumber,
// @src HandleCreditFlags, AddCreditNode; src/game/Utils/Font_Control.h FONT_MCOLOR_*.

import { u8, u32 } from '../../core/int.ts';

export const CREDITS_FILE = 'binarydata/credits.edt';
export const FIRST_CREDIT_ROW = 1;

export const CreditCode = {
  START: '@',
  SEPARATOR: ',',
  END: ';',
  NODE_GAP: 'D',
  SECTION_GAP: 'B',
  SCROLL_DELAY: 'S',
  JUSTIFICATION: 'J',
  TITLE_COLOUR: 'C',
  ACTIVE_COLOUR: 'R',
  TITLE: 'T',
  START_SECTION: '{',
  END_SECTION: '}',
} as const;

export const FontColour = {
  WHITE: 208,
  DARK_WHITE: 134,
  DARK_GRAY: 136,
  LIGHT_BLUE: 203,
  LIGHT_RED: 162,
  RED: 163,
  DARK_RED: 164,
} as const;

export type CreditJustification = 'left' | 'center' | 'right';
const JUSTIFICATIONS: readonly CreditJustification[] = ['left', 'center', 'right'];

export const CREDIT_NODE_GAP = 12;
export const CREDIT_SECTION_GAP = 50;
export const CREDIT_SCROLL_DELAY_MS = 25;

export interface CreditStyle {
  readonly nodeGap: number;
  readonly sectionGap: number;
  readonly gapBeforeNextRow: number;
  readonly scrollDelayMs: number;
  readonly justification: CreditJustification;
  readonly titleColour: number;
  readonly activeColour: number;
}

export const INITIAL_CREDIT_STYLE: CreditStyle = {
  nodeGap: CREDIT_NODE_GAP,
  sectionGap: CREDIT_SECTION_GAP,
  gapBeforeNextRow: CREDIT_NODE_GAP,
  scrollDelayMs: CREDIT_SCROLL_DELAY_MS,
  justification: 'center',
  titleColour: FontColour.RED,
  activeColour: FontColour.DARK_WHITE,
};

export interface CreditNode {
  readonly text: string;
  readonly title: boolean;
  readonly justification: CreditJustification;
  readonly colour: number;
}

export interface CreditRow {
  readonly style: CreditStyle;
  readonly node: CreditNode | null;
  readonly unknownCodes: readonly string[];
}

const UINT32_MAX = 0xffffffff;
const DECIMAL = 10;
const WHITESPACE = /\s/;
const DIGIT = /[0-9]/;

export function scanUnsigned(text: string, at: number): number {
  let i = at;
  while (i < text.length && WHITESPACE.test(text[i] as string)) i++;
  const negative = text[i] === '-';
  if (text[i] === '-' || text[i] === '+') i++;
  let value = 0;
  while (i < text.length && DIGIT.test(text[i] as string)) {
    value = Math.min(UINT32_MAX, value * DECIMAL + Number(text[i]));
    i++;
  }
  return negative ? u32(-value) : value;
}

interface Flags {
  title: boolean;
  startSection: boolean;
  endSection: boolean;
}

function applyCode(code: string, text: string, at: number, style: CreditStyle, flags: Flags): CreditStyle | null {
  switch (code) {
    case CreditCode.NODE_GAP:
      return { ...style, nodeGap: scanUnsigned(text, at) };
    case CreditCode.SECTION_GAP:
      return { ...style, sectionGap: scanUnsigned(text, at) };
    case CreditCode.SCROLL_DELAY:
      return { ...style, scrollDelayMs: scanUnsigned(text, at) };
    case CreditCode.TITLE_COLOUR:
      return { ...style, titleColour: u8(scanUnsigned(text, at)) };
    case CreditCode.ACTIVE_COLOUR:
      return { ...style, activeColour: u8(scanUnsigned(text, at)) };
    case CreditCode.JUSTIFICATION: {
      const justification = JUSTIFICATIONS[scanUnsigned(text, at)];
      return justification ? { ...style, justification } : null;
    }
    case CreditCode.TITLE:
      flags.title = true;
      return style;
    case CreditCode.START_SECTION:
      flags.startSection = true;
      return style;
    case CreditCode.END_SECTION:
      flags.endSection = true;
      return style;
    default:
      return null;
  }
}

export function readCreditRow(text: string, current: CreditStyle): CreditRow {
  let style = current;
  const flags: Flags = { title: false, startSection: false, endSection: false };
  const unknownCodes: string[] = [];
  let at = 0;
  if (text.startsWith(CreditCode.START)) {
    let open = true;
    while (open) {
      at++;
      const code = text[at++];
      if (code === undefined) break;
      const next = applyCode(code, text, at, style, flags);
      if (next) style = next;
      else unknownCodes.push(code);
      while (text[at] !== CreditCode.SEPARATOR) {
        if (at >= text.length) {
          open = false;
          break;
        }
        if (text[at++] === CreditCode.END) {
          open = false;
          break;
        }
      }
    }
  }
  const rest = text.slice(Math.min(at, text.length));
  const node: CreditNode | null =
    rest.length > 0
      ? { text: rest, title: flags.title, justification: style.justification, colour: flags.title ? style.titleColour : style.activeColour }
      : null;
  if (flags.startSection) style = { ...style, gapBeforeNextRow: style.nodeGap };
  if (flags.endSection) style = { ...style, gapBeforeNextRow: style.sectionGap };
  return { style, node, unknownCodes };
}
