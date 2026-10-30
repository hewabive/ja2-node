// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-29. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/QArray.cc QuoteExp_PassingDislike (transcribed in data/tables/merc-quotes.json).

import { asArray, asInt, asObject } from '../strategic/json-fields.ts';
import { parseJsoncBytes } from '../strategic/jsonc.ts';
import type { ReadFile } from '../world/tileset-loader.ts';

export const MERC_QUOTES_PATH = 'tables/merc-quotes.json';

export interface QuoteSpeakers {
  readonly passingDislike: ReadonlySet<number>;
}

export const NO_QUOTE_SPEAKERS: QuoteSpeakers = { passingDislike: new Set() };

export function parseQuoteSpeakers(json: unknown): QuoteSpeakers {
  const root = asObject(json, 'merc quotes');
  const profiles = asArray(root.passingDislike, 'merc quotes.passingDislike');
  return { passingDislike: new Set(profiles.map((v, i) => asInt(v, `merc quotes.passingDislike[${i}]`))) };
}

export async function loadQuoteSpeakers(read: ReadFile): Promise<QuoteSpeakers> {
  const bytes = await read(MERC_QUOTES_PATH);
  return bytes ? parseQuoteSpeakers(parseJsoncBytes(bytes)) : NO_QUOTE_SPEAKERS;
}
