import { describe, expect, it } from 'vitest';
import {
  API_DEFAULT_DIFFICULTY,
  applyOptionChange,
  assignGameOptions,
  gameOptions,
  importNativeGameOptions,
  ORIGINAL_GAME_OPTIONS,
  parseOptionChange,
} from './options.ts';

describe('game options', () => {
  it('default to the original game init screen except the documented API difficulty', () => {
    expect(ORIGINAL_GAME_OPTIONS).toEqual({ difficulty: 1, sciFi: true, gunNut: false, saveMode: 'anywhere', bloodAndGore: true });
    expect(Object.isFrozen(ORIGINAL_GAME_OPTIONS)).toBe(true);
    expect(gameOptions()).toEqual({ ...ORIGINAL_GAME_OPTIONS, difficulty: API_DEFAULT_DIFFICULTY });
    expect(API_DEFAULT_DIFFICULTY).toBe(2);
  });

  it('builds a fresh object each time, never the module constant', () => {
    const a = gameOptions();
    const b = gameOptions();
    expect(a).not.toBe(b);
    a.bloodAndGore = false;
    expect(b.bloodAndGore).toBe(true);
    expect(ORIGINAL_GAME_OPTIONS.bloodAndGore).toBe(true);
  });

  it('takes the requested fields and refuses an unknown difficulty', () => {
    expect(gameOptions({ difficulty: 3, sciFi: false, gunNut: true, saveMode: 'ironMan', bloodAndGore: false })).toEqual({
      difficulty: 3,
      sciFi: false,
      gunNut: true,
      saveMode: 'ironMan',
      bloodAndGore: false,
    });
    expect(gameOptions({ difficulty: undefined }).difficulty).toBe(API_DEFAULT_DIFFICULTY);
    expect(() => gameOptions({ difficulty: 4 })).toThrow(/difficulty/);
  });

  it('reassigns the fields of a shared object in place', () => {
    const shared = gameOptions();
    const holder = { options: shared };
    assignGameOptions(shared, { sciFi: false, difficulty: 3 });
    expect(holder.options).toBe(shared);
    expect(shared).toEqual({ difficulty: 3, sciFi: false, gunNut: false, saveMode: 'anywhere', bloodAndGore: true });
  });

  it('maps a native header onto the options and drops the timed turns', () => {
    const imported = importNativeGameOptions({ gunNut: true, sciFi: false, difficulty: 3, turnTimeLimit: true, saveMode: 2 });
    expect(imported.options).toEqual({ difficulty: 3, sciFi: false, gunNut: true, saveMode: 'deadIsDead', bloodAndGore: true });
    expect(imported.dropped).toEqual(['turnTimeLimit']);
    const plain = importNativeGameOptions({ gunNut: false, sciFi: true, difficulty: 1, turnTimeLimit: false, saveMode: 1 });
    expect(plain.options.saveMode).toBe('ironMan');
    expect(plain.dropped).toEqual([]);
    expect(importNativeGameOptions({ gunNut: false, sciFi: true, difficulty: 9, turnTimeLimit: false, saveMode: 7 }).options).toMatchObject(
      {
        difficulty: 1,
        saveMode: 'anywhere',
      },
    );
  });

  it('lets only blood and gore change during a game', () => {
    expect(parseOptionChange({ type: 'setOption', bloodAndGore: false })).toEqual({ bloodAndGore: false });
    expect(parseOptionChange({ type: 'setOption', difficulty: 3 })).toMatch(/only bloodAndGore/);
    expect(parseOptionChange({ type: 'setOption' })).toMatch(/name an option/);
    expect(parseOptionChange({ type: 'setOption', bloodAndGore: 'no' })).toMatch(/true or false/);
    const options = gameOptions();
    applyOptionChange(options, { bloodAndGore: false });
    expect(options.bloodAndGore).toBe(false);
  });
});
