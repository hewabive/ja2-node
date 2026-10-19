// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/sgp/Input.h SHIFT_DOWN, CTRL_DOWN, ALT_DOWN, KEY_DOWN, KEY_UP, KEY_REPEAT, TEXT_INPUT; src/sgp/Input.cc
// @src KeyDown, KeyUp, HandleSingleClicksAndButtonRepeats. See docs/28 §3.8.

export const KeyModifier = { SHIFT: 1, CTRL: 2, ALT: 4 } as const;

export const MouseButton = { LEFT: 0, MIDDLE: 1, RIGHT: 2, BACK: 3, FORWARD: 4 } as const;
export type MouseButton = (typeof MouseButton)[keyof typeof MouseButton];

export type PointerKind = 'pointerDown' | 'pointerUp' | 'pointerMove' | 'wheel';
export type KeyKind = 'keyDown' | 'keyUp' | 'keyRepeat';

export interface UiPointerEvent {
  readonly kind: PointerKind;
  readonly x: number;
  readonly y: number;
  readonly button: number;
  readonly buttons: number;
  readonly wheel: number;
  readonly modifiers: number;
}

export interface UiKeyEvent {
  readonly kind: KeyKind;
  readonly key: string;
  readonly code: string;
  readonly modifiers: number;
}

export interface UiTextEvent {
  readonly kind: 'text';
  readonly text: string;
}

export type UiInputEvent = UiPointerEvent | UiKeyEvent | UiTextEvent;

export interface RawKey {
  readonly key: string;
  readonly code: string;
  readonly repeat: boolean;
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly numLock: boolean;
}

const FIRST_PRINTABLE = 0x20;
const LAST_PRINTABLE = 0x7e;
const KEYPAD_PREFIX = 'Numpad';
const KEYPAD_DIGIT = /^Numpad\d$/;

const CODE_CHARACTERS: Readonly<Record<string, string>> = {
  Space: ' ',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  IntlBackslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
};

function isPrintableAscii(text: string): boolean {
  if (text.length !== 1) return false;
  const c = text.charCodeAt(0);
  return c >= FIRST_PRINTABLE && c <= LAST_PRINTABLE;
}

function latinFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return CODE_CHARACTERS[code] ?? null;
}

export function uiKeyOf(raw: Pick<RawKey, 'key' | 'code' | 'numLock'>): string {
  if (raw.code.startsWith(KEYPAD_PREFIX)) {
    const navigates = KEYPAD_DIGIT.test(raw.code) && !raw.numLock && !isPrintableAscii(raw.key);
    return navigates ? raw.key : raw.code;
  }
  if (isPrintableAscii(raw.key)) return raw.key.toLowerCase();
  return latinFromCode(raw.code) ?? raw.key;
}

export function modifierMask(raw: Pick<RawKey, 'shift' | 'ctrl' | 'alt'>): number {
  return (raw.shift ? KeyModifier.SHIFT : 0) | (raw.ctrl ? KeyModifier.CTRL : 0) | (raw.alt ? KeyModifier.ALT : 0);
}

export function keyDownEvents(raw: RawKey): UiInputEvent[] {
  const event: UiKeyEvent = { kind: raw.repeat ? 'keyRepeat' : 'keyDown', key: uiKeyOf(raw), code: raw.code, modifiers: modifierMask(raw) };
  const typesText = [...raw.key].length === 1 && !raw.ctrl && !raw.alt;
  return typesText ? [event, { kind: 'text', text: raw.key }] : [event];
}

export function keyUpEvent(raw: RawKey): UiKeyEvent {
  return { kind: 'keyUp', key: uiKeyOf(raw), code: raw.code, modifiers: modifierMask(raw) };
}
