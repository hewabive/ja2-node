import { describe, expect, it } from 'vitest';
import {
  dataDecoding,
  displayLanguageOf,
  glyphTablePath,
  guessVanillaVersion,
  languageVersion,
  parseVanillaVersion,
  rpcSpeechPrefixed,
  stringSuffix,
  UI_LANGUAGES,
  VANILLA_VERSIONS,
} from './data-version.ts';

describe('data version', () => {
  it('picks the string file suffix like GetSuffix', () => {
    expect(stringSuffix('english', false)).toBe('-eng');
    expect(stringSuffix('simplifiedChinese', true)).toBe('-chs');
    expect(stringSuffix('russian', false)).toBe('-rusgold');
    expect(stringSuffix('russianGold', false)).toBe('-rusgold');
    expect(stringSuffix('russian', true)).toBe('-rus');
    expect(stringSuffix('russianGold', true)).toBe('-rus');
    expect([...new Set(VANILLA_VERSIONS.map((v) => stringSuffix(v, true).slice(1)))].sort()).toEqual([...UI_LANGUAGES].sort());
  });

  it('maps every display language back to a version with the same suffix', () => {
    for (const language of UI_LANGUAGES) expect(stringSuffix(languageVersion(language), true)).toBe(`-${language}`);
    expect(displayLanguageOf('russian')).toBe('rus');
    expect(displayLanguageOf('russianGold')).toBe('rus');
    expect(displayLanguageOf('german')).toBe('ger');
    expect(displayLanguageOf('stubs')).toBe('eng');
  });

  it('selects the EDT mode, the NPC record layout, the profile name fix and the R.P.C. speech prefix', () => {
    expect(dataDecoding('english')).toEqual({ edt: 'english', npcRecords: 'standard', profileNames: 'correct', rpcSpeechPrefixed: false });
    expect(dataDecoding('simplifiedChinese').edt).toBe('english');
    expect(dataDecoding('stubs')).toEqual(dataDecoding('english'));
    expect(dataDecoding('polish').edt).toBe('polish');
    expect(dataDecoding('german').edt).toBe('other');
    expect(dataDecoding('russian')).toEqual({ edt: 'russian', npcRecords: 'russian', profileNames: 'russian', rpcSpeechPrefixed: true });
    expect(dataDecoding('russianGold')).toEqual({
      edt: 'russian',
      npcRecords: 'standard',
      profileNames: 'russian',
      rpcSpeechPrefixed: true,
    });
  });

  it('names the glyph table and the speech prefix per version', () => {
    expect(glyphTablePath('russianGold')).toBe('externalized/translation_tables/translation-table-rus-gold.json');
    expect(glyphTablePath('german')).toBe('externalized/translation_tables/translation-table-eng.json');
    expect(glyphTablePath('stubs')).toBe('stubs/translation_tables/translation-table-stub.json');
    expect(rpcSpeechPrefixed('russian') && rpcSpeechPrefixed('russianGold')).toBe(true);
    expect(rpcSpeechPrefixed('english') || rpcSpeechPrefixed('stubs')).toBe(false);
  });

  it('parses override names leniently and refuses unknown ones', () => {
    expect(parseVanillaVersion('russianGold')).toBe('russianGold');
    expect(parseVanillaVersion('RUSSIAN_GOLD')).toBe('russianGold');
    expect(parseVanillaVersion('simplified-chinese')).toBe('simplifiedChinese');
    expect(parseVanillaVersion('klingon')).toBeNull();
  });

  it('guesses the version from exclusively one language folder', () => {
    expect(guessVanillaVersion(['russian/interface/x.sti', 'maps/a9.dat'])).toBe('russian');
    expect(guessVanillaVersion(['German/x.sti'])).toBe('german');
    expect(guessVanillaVersion(['maps/a9.dat'])).toBeNull();
    expect(guessVanillaVersion(['german/x.sti', 'polish/y.sti'])).toBeNull();
  });
});
