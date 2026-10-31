import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gunQuoteOf, LikablePersonGender, likablePersonGenderOf, parseQuoteSpeakers } from './quote-speakers.ts';

const IRA = 59;
const IVAN = 7;
const RED = 11;
const BARRY = 0;
const DEVIN = 61;
const BEYOND_THE_TABLE = 75;
const FOUND_SOMETHING_SPECIAL = 61;
const SATISFACTION_WITH_GUN_AFTER_KILL = 62;
const TABLE = join(import.meta.dirname, '../../../data/tables/merc-quotes.json');
const speakers = parseQuoteSpeakers(JSON.parse(readFileSync(TABLE, 'utf8')));

describe('the transcribed quote speakers', () => {
  it('gives Ira the passing-dislike quote and leaves it out for Ivan', () => {
    expect(speakers.passingDislike.has(IRA)).toBe(true);
    expect(speakers.passingDislike.has(IVAN)).toBe(false);
  });

  it('gives each profile of QArray.cc its gun quote and none to a profile past the 75 entries', () => {
    expect([BARRY, IVAN, DEVIN, BEYOND_THE_TABLE].map((p) => gunQuoteOf(speakers, p))).toEqual([
      SATISFACTION_WITH_GUN_AFTER_KILL,
      FOUND_SOMETHING_SPECIAL,
      0,
      0,
    ]);
  });

  it('gives each profile of QArray.cc the sex of the likable person he speaks of, and either to a profile past the table', () => {
    expect([BARRY, IVAN, RED, BEYOND_THE_TABLE].map((p) => likablePersonGenderOf(speakers, p))).toEqual([
      LikablePersonGender.MALE,
      LikablePersonGender.EITHER,
      LikablePersonGender.FEMALE,
      LikablePersonGender.EITHER,
    ]);
  });
});
