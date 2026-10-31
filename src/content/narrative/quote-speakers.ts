// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-29. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/QArray.cc QuoteExp_PassingDislike, QuoteExp_GotGunOrUsedGun (2026-10-30), QuoteExp_GenderCode
// @src (2026-10-30) (transcribed in data/tables/merc-quotes.json).

import { asArray, asInt, asObject } from '../strategic/json-fields.ts';
import { parseJsoncBytes } from '../strategic/jsonc.ts';
import type { ReadFile } from '../world/tileset-loader.ts';

export const MERC_QUOTES_PATH = 'tables/merc-quotes.json';
const NO_GUN_QUOTE = 0;

export const LikablePersonGender = { MALE: 0, FEMALE: 1, EITHER: 2 } as const;

export interface QuoteSpeakers {
  readonly passingDislike: ReadonlySet<number>;
  readonly gotGunOrUsedGun: readonly number[];
  readonly genderCode: readonly number[];
}

export const NO_QUOTE_SPEAKERS: QuoteSpeakers = { passingDislike: new Set(), gotGunOrUsedGun: [], genderCode: [] };

export function gunQuoteOf(speakers: QuoteSpeakers, profile: number): number {
  return speakers.gotGunOrUsedGun[profile] ?? NO_GUN_QUOTE;
}

export function likablePersonGenderOf(speakers: QuoteSpeakers, profile: number): number {
  return speakers.genderCode[profile] ?? LikablePersonGender.EITHER;
}

function ints(json: unknown, label: string): number[] {
  return asArray(json, label).map((v, i) => asInt(v, `${label}[${i}]`));
}

export function parseQuoteSpeakers(json: unknown): QuoteSpeakers {
  const root = asObject(json, 'merc quotes');
  return {
    passingDislike: new Set(ints(root.passingDislike, 'merc quotes.passingDislike')),
    gotGunOrUsedGun: ints(root.gotGunOrUsedGun, 'merc quotes.gotGunOrUsedGun'),
    genderCode: ints(root.genderCode, 'merc quotes.genderCode'),
  };
}

export async function loadQuoteSpeakers(read: ReadFile): Promise<QuoteSpeakers> {
  const bytes = await read(MERC_QUOTES_PATH);
  return bytes ? parseQuoteSpeakers(parseJsoncBytes(bytes)) : NO_QUOTE_SPEAKERS;
}
