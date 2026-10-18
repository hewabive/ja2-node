import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { parseJsonc } from '../strategic/jsonc.ts';
import { UI_LANGUAGES } from './data-version.ts';
import {
  checkTranslation,
  LANGUAGE_FILES,
  languageFilePath,
  loadTranslationLayout,
  loadUiStrings,
  STRINGS_DIR,
  translationPath,
  uiString,
} from './strings.ts';

const read = async (path: string): Promise<Uint8Array | null> => readFile(join(PROJECT_DATA_DIR, path)).catch(() => null);
const CYRILLIC = /[Ѐ-ӿ]/;
const TRANSLATION_KEYS = 217;
const TRANSLATION_STRINGS = 1901;

async function readJson(path: string): Promise<unknown> {
  return parseJsonc(new TextDecoder().decode((await read(path)) ?? new Uint8Array()));
}

describe('UI string tables', () => {
  it('transcribes 217 keys with 1901 strings from Localization.h', async () => {
    const layout = await loadTranslationLayout(read);
    expect(layout.size).toBe(TRANSLATION_KEYS);
    expect([...layout.values()].reduce<number>((n, size) => n + (size ?? 1), 0)).toBe(TRANSLATION_STRINGS);
  });

  it('pass the per-array length check in all eight languages and in rusgold', async () => {
    const layout = await loadTranslationLayout(read);
    const suffixes = ['chs', 'dut', 'eng', 'fr', 'ger', 'it', 'pl', 'rus', 'rusgold'];
    for (const suffix of suffixes) {
      const tables = checkTranslation(await readJson(`${STRINGS_DIR}/translation-${suffix}.json`), layout);
      expect(Object.keys(tables)).toHaveLength(TRANSLATION_KEYS);
    }
  });

  it('refuse an array of the wrong length with the original message', async () => {
    const layout = await loadTranslationLayout(read);
    const json = (await readJson(translationPath('eng'))) as Record<string, unknown>;
    const broken = { ...json, pMoralStrings: ['only one'] };
    expect(() => checkTranslation(broken, layout)).toThrow('Translation of pMoralStrings has wrong length: expected 6, actual 1');
    const { sMapLevelString: _, ...missing } = json;
    expect(() => checkTranslation(missing, layout)).toThrow('Translation of sMapLevelString is missing');
  });

  it('read Russian from translation-rusgold and the -rus files, as Stracciatella does for both Russian versions', async () => {
    expect(translationPath('rus')).toBe(`${STRINGS_DIR}/translation-rusgold.json`);
    expect(languageFilePath('new-strings', 'rus')).toBe(`${STRINGS_DIR}/new-strings-rus.json`);
    expect(translationPath('ger')).toBe(`${STRINGS_DIR}/translation-ger.json`);
    const russian = await loadUiStrings(read, 'rus');
    expect(russian.files).toEqual([translationPath('rus'), ...LANGUAGE_FILES.map((f) => languageFilePath(f, 'rus'))]);
    expect(Object.keys(russian.tables)).toHaveLength(TRANSLATION_KEYS + LANGUAGE_FILES.length);
    expect(uiString(russian, 'pMoralStrings', 0)).toMatch(CYRILLIC);
    expect(uiString(russian, 'strategic-map-town-names', 1)).toMatch(CYRILLIC);
    expect(uiString(russian, 'sMapLevelString')).toMatch(CYRILLIC);
  });

  it('load every display language', async () => {
    const layout = await loadTranslationLayout(read);
    for (const language of UI_LANGUAGES) {
      const strings = await loadUiStrings(read, language, layout);
      expect(strings.language).toBe(language);
      expect(uiString(strings, 'pMoralStrings', 5)).not.toBeNull();
      expect(uiString(strings, 'pMoralStrings', 6)).toBeNull();
      expect(uiString(strings, 'noSuchTable', 0)).toBeNull();
    }
  });
});
