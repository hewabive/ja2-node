// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/sgp/Input.h SHIFT_DOWN, CTRL_DOWN, ALT_DOWN, KEY_DOWN, KEY_UP, KEY_REPEAT, TEXT_INPUT; src/sgp/Input.cc
// @src KeyDown, KeyUp, KeyChange (the keypad, its 5 dropped without NumLock), HandleSingleClicksAndButtonRepeats.

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

const POINTER_KINDS: ReadonlySet<string> = new Set<PointerKind>(['pointerDown', 'pointerUp', 'pointerMove', 'wheel']);

export function isPointerEvent(event: UiInputEvent): event is UiPointerEvent {
  return POINTER_KINDS.has(event.kind);
}

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
const DIGIT_ROW_CODE = /^Digit(\d)$/;
const SINGLE_DIGIT = /^\d$/;

const KEYPAD_CHARACTERS: Readonly<Record<string, string>> = {
  NumpadAdd: '+',
  NumpadSubtract: '-',
  NumpadMultiply: '*',
  NumpadDivide: '/',
  NumpadEnter: 'Enter',
};

interface KeypadNumberKey {
  readonly withNumLock: string;
  readonly withoutNumLock: string | null;
}

const KEYPAD_NUMBER_KEYS: Readonly<Record<string, KeypadNumberKey>> = {
  Numpad0: { withNumLock: '0', withoutNumLock: 'Insert' },
  Numpad1: { withNumLock: '1', withoutNumLock: 'End' },
  Numpad2: { withNumLock: '2', withoutNumLock: 'ArrowDown' },
  Numpad3: { withNumLock: '3', withoutNumLock: 'PageDown' },
  Numpad4: { withNumLock: '4', withoutNumLock: 'ArrowLeft' },
  Numpad5: { withNumLock: '5', withoutNumLock: null },
  Numpad6: { withNumLock: '6', withoutNumLock: 'ArrowRight' },
  Numpad7: { withNumLock: '7', withoutNumLock: 'Home' },
  Numpad8: { withNumLock: '8', withoutNumLock: 'ArrowUp' },
  Numpad9: { withNumLock: '9', withoutNumLock: 'PageUp' },
  NumpadDecimal: { withNumLock: '.', withoutNumLock: 'Delete' },
};

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
  if (DIGIT_ROW_CODE.test(code)) return code.slice(5);
  return CODE_CHARACTERS[code] ?? null;
}

function keypadTypesNumbers(raw: Pick<RawKey, 'key' | 'numLock'>): boolean {
  return raw.numLock || isPrintableAscii(raw.key);
}

function keypadKeyOf(raw: Pick<RawKey, 'key' | 'code' | 'numLock'>): string | null {
  const character = KEYPAD_CHARACTERS[raw.code];
  if (character !== undefined) return character;
  const numberKey = KEYPAD_NUMBER_KEYS[raw.code];
  if (numberKey === undefined) return raw.code;
  return keypadTypesNumbers(raw) ? numberKey.withNumLock : numberKey.withoutNumLock;
}

export function uiKeyOf(raw: Pick<RawKey, 'key' | 'code' | 'numLock'>): string | null {
  if (raw.code.startsWith(KEYPAD_PREFIX)) return keypadKeyOf(raw);
  if (isPrintableAscii(raw.key)) return raw.key.toLowerCase();
  return latinFromCode(raw.code) ?? raw.key;
}

export function digitKeyOf(event: Pick<UiKeyEvent, 'key' | 'code'>): number | null {
  const row = DIGIT_ROW_CODE.exec(event.code);
  if (row) return Number(row[1]);
  return event.code.startsWith(KEYPAD_PREFIX) && SINGLE_DIGIT.test(event.key) ? Number(event.key) : null;
}

export function modifierMask(raw: Pick<RawKey, 'shift' | 'ctrl' | 'alt'>): number {
  return (raw.shift ? KeyModifier.SHIFT : 0) | (raw.ctrl ? KeyModifier.CTRL : 0) | (raw.alt ? KeyModifier.ALT : 0);
}

export function keyDownEvents(raw: RawKey): UiInputEvent[] {
  const key = uiKeyOf(raw);
  if (key === null) return [];
  const event: UiKeyEvent = { kind: raw.repeat ? 'keyRepeat' : 'keyDown', key, code: raw.code, modifiers: modifierMask(raw) };
  const typesText = [...raw.key].length === 1 && !raw.ctrl && !raw.alt;
  return typesText ? [event, { kind: 'text', text: raw.key }] : [event];
}

export function keyUpEvents(raw: RawKey): UiKeyEvent[] {
  const key = uiKeyOf(raw);
  return key === null ? [] : [{ kind: 'keyUp', key, code: raw.code, modifiers: modifierMask(raw) }];
}
