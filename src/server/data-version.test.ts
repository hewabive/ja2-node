import { describe, expect, it } from 'vitest';
import { PROJECT_DATA_LAYER, STUBS_LAYER } from '../content/vfs/layers.ts';
import { MemoryLayer, Vfs } from '../content/vfs/vfs.ts';
import { chooseDataVersion, chooseDisplayLanguage, detectDataVersion, originalDataPaths } from './data-version.ts';

const nothing = () => [];

describe('data version at server start', () => {
  it('is stubs without original data, whatever the override says', () => {
    expect(chooseDataVersion({ originalData: false, paths: nothing })).toEqual({ version: 'stubs', source: 'stubs' });
    expect(chooseDataVersion({ originalData: false, paths: nothing, override: 'german' })).toMatchObject({
      version: 'stubs',
      warning: expect.stringContaining('JA2_DATA_VERSION'),
    });
  });

  it('takes a named override, Russian Gold included, and refuses unknown names', () => {
    expect(chooseDataVersion({ originalData: true, paths: nothing, override: 'russianGold' })).toEqual({
      version: 'russianGold',
      source: 'override',
    });
    expect(() => chooseDataVersion({ originalData: true, paths: nothing, override: 'elvish' })).toThrow('JA2_DATA_VERSION');
  });

  it('guesses from language folders in the original layers only, English otherwise', () => {
    const vfs = new Vfs([
      new MemoryLayer(PROJECT_DATA_LAYER, [['german/readme.txt', new Uint8Array(1)]]),
      new MemoryLayer(STUBS_LAYER, [['stubs/polish/x.sti', new Uint8Array(1)]]),
      new MemoryLayer('interface.slf', [['russian/interface/panel_russian.sti', new Uint8Array(1)]]),
    ]);
    expect(originalDataPaths(vfs)).toEqual(['russian/interface/panel_russian.sti']);
    expect(detectDataVersion(vfs, true, {})).toEqual({ version: 'russian', source: 'detected' });
    expect(detectDataVersion(new Vfs([]), true, {})).toEqual({ version: 'english', source: 'default' });
  });

  it('picks the display language from JA2_LANG or the data version', () => {
    expect(chooseDisplayLanguage(undefined, 'russianGold')).toBe('rus');
    expect(chooseDisplayLanguage(undefined, 'stubs')).toBe('eng');
    expect(chooseDisplayLanguage('RUS', 'english')).toBe('rus');
    expect(() => chooseDisplayLanguage('russian', 'english')).toThrow('JA2_LANG');
  });
});
