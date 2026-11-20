// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/externalized/strings/Localization.cc GetSuffix, GetArray, L10n_t::L10n_t (sizes in data/tables/l10n.json);
// @src src/externalized/DefaultContentManager.cc loadStringRes, loadGameData, loadPrioritizedData;
// @src src/externalized/strings/TranslatableString.cc FileLoader::getJsonTranslations; src/externalized/CalibreModel.cc,
// @src ShippingDestinationModel.cc, strategic/TownModel.cc (the translation prefixes).

import { FormatError } from '../binary/errors.ts';
import { parseJsoncBytes } from '../strategic/jsonc.ts';
import type { ReadFile } from '../world/tileset-loader.ts';
import { languageVersion, stringSuffix, type UiLanguage } from './data-version.ts';

export const L10N_TABLE_PATH = 'tables/l10n.json';
export const STRINGS_DIR = 'externalized/strings';
const TRANSLATION_PREFIX = 'translation';
export const KEPT_MASTER_LINES_PATH = 'strings/kept-master-lines.json';
export const KEPT_MASTER_LINES = 'kept-master-lines';
export const KeptMasterLine = { STR_LOSES_1_HP: 0 } as const;

export const LANGUAGE_FILES = [
  'new-strings',
  'strategic-map-land-types',
  'strategic-map-town-names',
  'strategic-map-town-name-locatives',
  'ammo-calibre',
  'ammo-calibre-bobbyray',
  'shipping-destinations',
] as const;
export type LanguageFile = (typeof LANGUAGE_FILES)[number];

export type TranslationLayout = ReadonlyMap<string, number | null>;
export type UiStringValue = string | readonly string[];

export interface UiStrings {
  readonly language: UiLanguage;
  readonly files: readonly string[];
  readonly tables: Readonly<Record<string, UiStringValue>>;
}

export class TranslationError extends FormatError {}

function translationSuffix(language: UiLanguage): string {
  return stringSuffix(languageVersion(language), false);
}

export function translationPath(language: UiLanguage): string {
  return `${STRINGS_DIR}/${TRANSLATION_PREFIX}${translationSuffix(language)}.json`;
}

function keptMasterLines(json: unknown, language: UiLanguage): string[] {
  const lines = (json as { lines?: Record<string, unknown> } | null)?.lines;
  const suffix = translationSuffix(language).slice(1);
  return stringArray(lines?.[suffix], `${KEPT_MASTER_LINES_PATH} ${suffix}`);
}

export function languageFilePath(file: LanguageFile, language: UiLanguage): string {
  return `${STRINGS_DIR}/${file}${stringSuffix(languageVersion(language), true)}.json`;
}

export function parseTranslationLayout(json: unknown): TranslationLayout {
  const translation = (json as { translation?: unknown } | null)?.translation;
  if (typeof translation !== 'object' || translation === null) throw new FormatError('malformed l10n table');
  const layout = new Map<string, number | null>();
  for (const [key, size] of Object.entries(translation)) {
    if (size !== null && (typeof size !== 'number' || !Number.isInteger(size) || size < 0)) throw new FormatError(`bad size for ${key}`);
    layout.set(key, size);
  }
  return layout;
}

function stringArray(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new TranslationError(`${what} is not a list of strings`);
  return value as string[];
}

export function checkTranslation(json: unknown, layout: TranslationLayout): Record<string, UiStringValue> {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new TranslationError('translation is not an object');
  const source = json as Record<string, unknown>;
  const tables: Record<string, UiStringValue> = {};
  for (const [key, size] of layout) {
    const value = source[key];
    if (value === undefined) throw new TranslationError(`Translation of ${key} is missing`);
    if (size === null) {
      if (typeof value !== 'string') throw new TranslationError(`Translation of ${key} is not a string`);
      tables[key] = value;
      continue;
    }
    const strings = stringArray(value, `Translation of ${key}`);
    if (strings.length !== size)
      throw new TranslationError(`Translation of ${key} has wrong length: expected ${size}, actual ${strings.length}`);
    tables[key] = strings;
  }
  return tables;
}

async function readJson(read: ReadFile, path: string): Promise<unknown> {
  const bytes = await read(path);
  if (!bytes) throw new FormatError(`missing ${path}`);
  return parseJsoncBytes(bytes);
}

export async function loadTranslationLayout(read: ReadFile): Promise<TranslationLayout> {
  return parseTranslationLayout(await readJson(read, L10N_TABLE_PATH));
}

export async function loadUiStrings(read: ReadFile, language: UiLanguage, layout?: TranslationLayout): Promise<UiStrings> {
  const translationFile = translationPath(language);
  const paths = LANGUAGE_FILES.map((file) => languageFilePath(file, language));
  const [translationJson, translationLayout, languageJson, keptJson] = await Promise.all([
    readJson(read, translationFile),
    layout ?? loadTranslationLayout(read),
    Promise.all(paths.map((path) => readJson(read, path))),
    readJson(read, KEPT_MASTER_LINES_PATH),
  ]);
  const tables: Record<string, UiStringValue> = { ...checkTranslation(translationJson, translationLayout) };
  LANGUAGE_FILES.forEach((file, i) => {
    tables[file] = stringArray(languageJson[i], paths[i] as string);
  });
  tables[KEPT_MASTER_LINES] = keptMasterLines(keptJson, language);
  return { language, files: [translationFile, ...paths, KEPT_MASTER_LINES_PATH], tables };
}

export function uiString(strings: UiStrings, table: string, index?: number): string | null {
  const value = strings.tables[table];
  if (value === undefined) return null;
  if (typeof value === 'string') return index === undefined || index === 0 ? value : null;
  if (index === undefined || !Number.isInteger(index)) return null;
  return value[index] ?? null;
}
