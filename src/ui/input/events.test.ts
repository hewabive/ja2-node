import { describe, expect, it } from 'vitest';
import { KeyModifier, keyDownEvents, keyUpEvent, modifierMask, type RawKey, uiKeyOf } from './events.ts';

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

describe('key events (docs/28 §3.8)', () => {
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

  it('names special keys by the key and the keypad by the code unless NumLock is off', () => {
    expect(uiKeyOf(raw('Escape', 'Escape'))).toBe('Escape');
    expect(uiKeyOf(raw('F5', 'F5'))).toBe('F5');
    expect(uiKeyOf(raw('8', 'Numpad8'))).toBe('Numpad8');
    expect(uiKeyOf(raw('ArrowUp', 'Numpad8', { numLock: false }))).toBe('ArrowUp');
    expect(uiKeyOf(raw('+', 'NumpadAdd', { numLock: false }))).toBe('NumpadAdd');
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
