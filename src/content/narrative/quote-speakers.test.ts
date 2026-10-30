import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseQuoteSpeakers } from './quote-speakers.ts';

const IRA = 59;
const IVAN = 7;
const TABLE = join(import.meta.dirname, '../../../data/tables/merc-quotes.json');
const speakers = parseQuoteSpeakers(JSON.parse(readFileSync(TABLE, 'utf8')));

describe('the transcribed quote speakers', () => {
  it('gives Ira the passing-dislike quote and leaves it out for Ivan', () => {
    expect(speakers.passingDislike.has(IRA)).toBe(true);
    expect(speakers.passingDislike.has(IVAN)).toBe(false);
  });
});
