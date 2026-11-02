import { describe, expect, it } from 'vitest';
import { digitKeyOf, KeyModifier, keyDownEvents, keyUpEvent, modifierMask, type RawKey, uiKeyOf } from './events.ts';

const raw = (key: string, code: string, extra: Partial<RawKey> = {}): RawKey => ({
  key,
  code,
  repeat: false,
  shift: false,
  ctrl: false,
  alt: false,
  numLock: true,
  ...extra,
});

describe('key events', () => {
  it('takes printable ASCII from the key, lower-cased', () => {
    expect(uiKeyOf(raw('A', 'KeyA'))).toBe('a');
    expect(uiKeyOf(raw('/', 'Slash'))).toBe('/');
    expect(uiKeyOf(raw(' ', 'Space'))).toBe(' ');
  });

  it('falls back to the Latin key of the code on other layouts', () => {
    expect(uiKeyOf(raw('ф', 'KeyA'))).toBe('a');
    expect(uiKeyOf(raw('ж', 'Semicolon'))).toBe(';');
    expect(uiKeyOf(raw('"', 'Digit2'))).toBe('"');
    expect(uiKeyOf(raw('é', 'Digit2'))).toBe('2');
  });

  it('names special keys by the key', () => {
    expect(uiKeyOf(raw('Escape', 'Escape'))).toBe('Escape');
    expect(uiKeyOf(raw('F5', 'F5'))).toBe('F5');
  });

  it('types the main keys with the keypad: its operators always, its digits and point with NumLock on', () => {
    for (const numLock of [true, false]) {
      expect(uiKeyOf(raw('+', 'NumpadAdd', { numLock }))).toBe('+');
      expect(uiKeyOf(raw('-', 'NumpadSubtract', { numLock }))).toBe('-');
      expect(uiKeyOf(raw('*', 'NumpadMultiply', { numLock }))).toBe('*');
      expect(uiKeyOf(raw('/', 'NumpadDivide', { numLock }))).toBe('/');
      expect(uiKeyOf(raw('Enter', 'NumpadEnter', { numLock }))).toBe('Enter');
    }
    expect(uiKeyOf(raw('8', 'Numpad8'))).toBe('8');
    expect(uiKeyOf(raw('0', 'Numpad0'))).toBe('0');
    expect(uiKeyOf(raw(',', 'NumpadDecimal'))).toBe('.');
  });

  it('turns the keypad digits and point into the navigation keys with NumLock off and names no key for the 5', () => {
    const off = { numLock: false };
    expect(uiKeyOf(raw('ArrowUp', 'Numpad8', off))).toBe('ArrowUp');
    expect(uiKeyOf(raw('Insert', 'Numpad0', off))).toBe('Insert');
    expect(uiKeyOf(raw('PageDown', 'Numpad3', off))).toBe('PageDown');
    expect(uiKeyOf(raw('Delete', 'NumpadDecimal', off))).toBe('Delete');
    expect(uiKeyOf(raw('Clear', 'Numpad5', off))).toBe('Numpad5');
    expect(uiKeyOf(raw('8', 'Numpad8', off))).toBe('8');
  });

  it('reads a digit from the digit row whatever the Shift, and from the keypad only when it types one', () => {
    expect(digitKeyOf({ key: '!', code: 'Digit1' })).toBe(1);
    expect(digitKeyOf({ key: '0', code: 'Digit0' })).toBe(0);
    expect(digitKeyOf({ key: '3', code: 'Numpad3' })).toBe(3);
    expect(digitKeyOf({ key: 'PageDown', code: 'Numpad3' })).toBeNull();
    expect(digitKeyOf({ key: '3', code: '' })).toBeNull();
  });

  it('builds the original modifier masks', () => {
    expect(modifierMask(raw('a', 'KeyA', { shift: true, alt: true }))).toBe(KeyModifier.SHIFT | KeyModifier.ALT);
    expect(modifierMask(raw('a', 'KeyA', { ctrl: true }))).toBe(KeyModifier.CTRL);
  });

  it('reports repeats and text input only for printable keys without Ctrl or Alt', () => {
    expect(keyDownEvents(raw('ж', 'Semicolon'))).toEqual([
      { kind: 'keyDown', key: ';', code: 'Semicolon', modifiers: 0 },
      { kind: 'text', text: 'ж' },
    ]);
    expect(keyDownEvents(raw('s', 'KeyS', { alt: true }))).toEqual([
      { kind: 'keyDown', key: 's', code: 'KeyS', modifiers: KeyModifier.ALT },
    ]);
    expect(keyDownEvents(raw('Enter', 'Enter', { repeat: true }))).toEqual([
      { kind: 'keyRepeat', key: 'Enter', code: 'Enter', modifiers: 0 },
    ]);
    expect(keyUpEvent(raw('S', 'KeyS', { shift: true }))).toEqual({ kind: 'keyUp', key: 's', code: 'KeyS', modifiers: KeyModifier.SHIFT });
  });
});
