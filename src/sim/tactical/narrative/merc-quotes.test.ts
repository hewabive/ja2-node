import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MercQuote } from './merc-quotes.ts';

const TABLE = join(import.meta.dirname, '../../../../data/tables/merc-quotes.json');
const quotes = (JSON.parse(readFileSync(TABLE, 'utf8')) as { quotes: { id: number; name: string }[] }).quotes;

describe('the tactical merc quote numbers', () => {
  it('match the transcribed quote table by name', () => {
    for (const [name, id] of Object.entries(MercQuote)) expect(quotes.find((q) => q.name === name)?.id, name).toBe(id);
  });
});
