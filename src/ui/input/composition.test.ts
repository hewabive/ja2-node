import { beforeEach, describe, expect, it } from 'vitest';
import { type TestRuntime, testRuntime } from '../../../tests/support/ui-runtime.ts';
import { FontName } from '../text/fonts.ts';
import { defaultTextFieldScheme, TextFieldGroup } from '../widgets/text-field.ts';
import { IME_PROCESS_KEY, TextComposition, TextInputState } from './composition.ts';

const key = (key: string, code: string) => ({ key, code });
const ATTACHED = true;
const DETACHED = false;

let t: TestRuntime;

beforeEach(async () => {
  t = await testRuntime();
});

function fieldGroup(input: TextInputState | null = null): TextFieldGroup {
  return new TextFieldGroup(t.runtime.regions, t.sounds, defaultTextFieldScheme(t.fonts.get(FontName.FONT12POINT1)), {}, input);
}

describe('IME composition', () => {
  it('keeps every key the IME takes from the game, the key-up of the commit included, and passes the next keys again', () => {
    const ime = new TextComposition();
    expect(ime.takesKeyDown(key(IME_PROCESS_KEY, 'KeyN'), ATTACHED)).toBe(true);
    ime.start();
    expect(ime.takesKeyDown(key('i', 'KeyI'), ATTACHED)).toBe(true);
    expect(ime.takesKeyUp(key('n', 'KeyN'))).toBe(true);
    expect(ime.takesKeyDown(key('Enter', 'Enter'), ATTACHED)).toBe(true);
    expect(ime.commit('你')).toEqual([{ kind: 'text', text: '你' }]);
    expect(ime.takesKeyUp(key('Enter', 'Enter'))).toBe(true);
    expect(ime.takesKeyUp(key('i', 'KeyI'))).toBe(true);
    expect(ime.takesKeyDown(key('Enter', 'Enter'), ATTACHED)).toBe(false);
    expect(ime.takesKeyUp(key('Enter', 'Enter'))).toBe(false);
  });

  it('leaves a key the browser marks Process to the game while no field takes text, as the IME is not attached then', () => {
    const ime = new TextComposition();
    expect(ime.takesKeyDown(key(IME_PROCESS_KEY, 'KeyA'), DETACHED)).toBe(false);
    expect(ime.takesKeyUp(key('a', 'KeyA'))).toBe(false);
  });

  it('gives the game nothing of a composition before its commit and nothing for a cancelled one', () => {
    const ime = new TextComposition();
    ime.start();
    expect(ime.composing).toBe(true);
    expect(ime.commit('')).toEqual([]);
    expect(ime.composing).toBe(false);
  });

  it('matches a key-up to the latest key-down of its key, so a key the IME took once passes once it types again', () => {
    const ime = new TextComposition();
    expect(ime.takesKeyDown(key(IME_PROCESS_KEY, 'KeyA'), ATTACHED)).toBe(true);
    expect(ime.takesKeyDown(key('a', 'KeyA'), ATTACHED)).toBe(false);
    expect(ime.takesKeyUp(key('a', 'KeyA'))).toBe(false);
  });

  it('puts the committed text into the edited field as typed characters, replacing the selection within its limit and glyphs', () => {
    const group = fieldGroup();
    const name = group.add({ x: 10, y: 10, width: 100, height: 20, text: 'Ivan', maxLength: 6 });
    const ime = new TextComposition();
    ime.start();
    for (const event of ime.commit('Zoë中國abcd')) group.input(event);
    expect(t.fonts.get(FontName.FONT12POINT1).table.has('中'.codePointAt(0) as number)).toBe(false);
    expect(name.text).toBe('Zoëabc');
  });

  it('keeps only the ASCII digits of a commit in a numeric field, as INPUTTYPE_NUMERICSTRICT drops the full-width ones', () => {
    const group = fieldGroup();
    const number = group.add({ x: 10, y: 10, width: 100, height: 20, maxLength: 3, filter: 'numeric' });
    const ime = new TextComposition();
    ime.start();
    for (const event of ime.commit('１２3４5')) group.input(event);
    expect(number.text).toBe('35');
  });

  it('starts text input while a field is edited and stops it as editing stops or the fields go, as SetEditingStatus does', () => {
    const input = new TextInputState();
    const changes: boolean[] = [];
    input.listen((editing) => changes.push(editing));
    const group = fieldGroup(input);
    group.add({ id: 'name', x: 10, y: 10, width: 100, height: 20, maxLength: 6 });
    group.addUser({ id: 'box' });
    expect(input.editing).toBe(true);
    group.input({ kind: 'keyDown', key: 'Tab', code: 'Tab', modifiers: 0 });
    expect(input.editing).toBe(false);
    group.setActive('name');
    expect(input.editing).toBe(true);
    group.dispose();
    expect(input.editing).toBe(false);
    expect(changes).toEqual([true, false, true, false]);
  });
});
