import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HistoryCode, PRECEDENT_QUOTES, precedentBitMask, Quote, type QuoteName, quoteKey, SpecialProfile } from './quotes.ts';

const TABLES = join(import.meta.dirname, '../../../../data/tables');
const quotes = JSON.parse(readFileSync(join(TABLES, 'merc-quotes.json'), 'utf8')) as {
  quotes: { id: number; name: string; key: string }[];
};
const contracts = JSON.parse(readFileSync(join(TABLES, 'merc-contracts.json'), 'utf8')) as {
  precedentQuotes: { quote: number }[];
  specialProfiles: Record<string, number>;
  historyCodes: Record<string, number>;
};

describe('the quote constants', () => {
  it('match the transcribed quote table by name, number and event key', () => {
    for (const name of Object.keys(Quote) as QuoteName[]) {
      const entry = quotes.quotes.find((q) => q.name === name);
      expect(entry, name).toBeDefined();
      expect(Quote[name]).toBe(entry?.id);
      expect(quoteKey(name)).toBe(entry?.key);
    }
  });

  it('match the precedent list, the special profiles and the history codes', () => {
    expect(PRECEDENT_QUOTES).toEqual(contracts.precedentQuotes.map((p) => p.quote));
    for (const [name, id] of Object.entries(SpecialProfile)) expect(contracts.specialProfiles[name]).toBe(id);
    for (const [name, code] of Object.entries(HistoryCode)) expect(contracts.historyCodes[name]).toBe(code);
  });

  it('puts precedent quote n on bit n - 1, and the first entry and unknown quotes on bit 31', () => {
    expect(precedentBitMask(Quote.DEATH_RATE_REFUSAL)).toBe(1);
    expect(precedentBitMask(Quote.HATE_MERC_1_ON_TEAM_WONT_RENEW)).toBe(512);
    expect(precedentBitMask(Quote.REPUTATION_REFUSAL)).toBe(0x80000000);
    expect(precedentBitMask(Quote.RENEWING_CAUSE_BUDDY_1_ON_TEAM)).toBe(0x80000000);
  });
});
