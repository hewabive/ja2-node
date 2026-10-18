// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src rust/stracciatella/src/config/vanilla_version.rs VanillaVersion; rust/stracciatella/src/guess.rs
// @src guess_by_language_specific_resources; src/game/GameRes.cc getStringEncType; src/externalized/strings/Localization.cc
// @src GetSuffix; src/externalized/DefaultContentManager.cc loadTranslationTable; src/externalized/mercs/BinaryProfileData.cc
// @src (isCorrectlyEncoded); src/game/TacticalAI/NPC.cc (the Russian record layout); src/externalized/content/Dialogs.cc
// @src GetDialogueVoiceFilename. See docs/27 §5.

import type { EdtEncoding } from '../formats/edt.ts';
import type { NpcRecordLayout } from '../formats/npc.ts';
import type { ProfileNameEncoding } from '../formats/prof.ts';

export const VANILLA_VERSIONS = [
  'dutch',
  'english',
  'french',
  'german',
  'italian',
  'polish',
  'russian',
  'russianGold',
  'simplifiedChinese',
] as const;
export type VanillaVersion = (typeof VANILLA_VERSIONS)[number];

export const STUB_DATA_VERSION = 'stubs';
export type DataVersion = VanillaVersion | typeof STUB_DATA_VERSION;

export const DEFAULT_VANILLA_VERSION: VanillaVersion = 'english';
export const STUB_TEXT_VERSION: VanillaVersion = 'english';

export const UI_LANGUAGES = ['chs', 'dut', 'eng', 'fr', 'ger', 'it', 'pl', 'rus'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export interface DataDecoding {
  readonly edt: EdtEncoding;
  readonly npcRecords: NpcRecordLayout;
  readonly profileNames: ProfileNameEncoding;
}

const COMBINED_SUFFIX: Readonly<Record<VanillaVersion, UiLanguage>> = {
  simplifiedChinese: 'chs',
  dutch: 'dut',
  english: 'eng',
  french: 'fr',
  german: 'ger',
  italian: 'it',
  polish: 'pl',
  russian: 'rus',
  russianGold: 'rus',
};
const RUSSIAN_GOLD_SUFFIX = 'rusgold';

const LANGUAGE_VERSION: Readonly<Record<UiLanguage, VanillaVersion>> = {
  chs: 'simplifiedChinese',
  dut: 'dutch',
  eng: 'english',
  fr: 'french',
  ger: 'german',
  it: 'italian',
  pl: 'polish',
  rus: 'russianGold',
};

const GLYPH_TABLE_SUFFIX: Partial<Readonly<Record<VanillaVersion, string>>> = {
  french: 'fr',
  russian: 'rus',
  russianGold: 'rus-gold',
  simplifiedChinese: 'chs',
};
const DEFAULT_GLYPH_TABLE_SUFFIX = 'eng';

const LANGUAGE_FOLDERS: readonly (readonly [string, VanillaVersion])[] = [
  ['dutch/', 'dutch'],
  ['german/', 'german'],
  ['italian/', 'italian'],
  ['polish/', 'polish'],
  ['russian/', 'russian'],
];

export function textVersion(version: DataVersion): VanillaVersion {
  return version === STUB_DATA_VERSION ? STUB_TEXT_VERSION : version;
}

export function isRussianVersion(version: DataVersion): boolean {
  return version === 'russian' || version === 'russianGold';
}

export function edtEncodingOf(version: DataVersion): EdtEncoding {
  const v = textVersion(version);
  if (isRussianVersion(v)) return 'russian';
  if (v === 'polish') return 'polish';
  if (v === 'english' || v === 'simplifiedChinese') return 'english';
  return 'other';
}

export function dataDecoding(version: DataVersion): DataDecoding {
  return {
    edt: edtEncodingOf(version),
    npcRecords: version === 'russian' ? 'russian' : 'standard',
    profileNames: isRussianVersion(version) ? 'russian' : 'correct',
  };
}

export const DEFAULT_DATA_DECODING: DataDecoding = dataDecoding(DEFAULT_VANILLA_VERSION);

export function stringSuffix(version: VanillaVersion, combineRussianVersions: boolean): string {
  return `-${isRussianVersion(version) && !combineRussianVersions ? RUSSIAN_GOLD_SUFFIX : COMBINED_SUFFIX[version]}`;
}

export function displayLanguageOf(version: DataVersion): UiLanguage {
  return COMBINED_SUFFIX[textVersion(version)];
}

export function languageVersion(language: UiLanguage): VanillaVersion {
  return LANGUAGE_VERSION[language];
}

export function isUiLanguage(value: string): value is UiLanguage {
  return (UI_LANGUAGES as readonly string[]).includes(value);
}

export function glyphTablePath(version: DataVersion): string {
  return `externalized/translation_tables/translation-table-${GLYPH_TABLE_SUFFIX[textVersion(version)] ?? DEFAULT_GLYPH_TABLE_SUFFIX}.json`;
}

export function rpcSpeechPrefixed(version: DataVersion): boolean {
  return isRussianVersion(version);
}

function canonicalName(name: string): string {
  return name.toLowerCase().replaceAll(/[\s_-]/g, '');
}

export function parseVanillaVersion(name: string): VanillaVersion | null {
  const wanted = canonicalName(name);
  return VANILLA_VERSIONS.find((v) => canonicalName(v) === wanted) ?? null;
}

export function guessVanillaVersion(paths: Iterable<string>): VanillaVersion | null {
  const counts = new Map<VanillaVersion, number>();
  for (const path of paths) {
    const folder = LANGUAGE_FOLDERS.find(([prefix]) => path.toLowerCase().startsWith(prefix));
    if (folder) counts.set(folder[1], (counts.get(folder[1]) ?? 0) + 1);
  }
  const [only, ...others] = counts.keys();
  return only !== undefined && others.length === 0 ? only : null;
}
