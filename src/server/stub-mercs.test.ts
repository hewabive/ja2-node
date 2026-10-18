import { describe, expect, it } from 'vitest';
import { loadTestContent } from '../../tests/support/tactical.ts';
import { stubMerc } from './stub-mercs.ts';

describe('stub mercs', () => {
  it('give every merc its own stats, so a stat gain stays with one merc and one session', async () => {
    const content = await loadTestContent();
    const first = stubMerc(content, 0);
    const second = stubMerc(content, 1);
    const marksmanship = second.stats.marksmanship;
    first.stats.marksmanship++;
    expect(second.stats.marksmanship).toBe(marksmanship);
    expect(stubMerc(content, 2).stats.marksmanship).toBe(marksmanship);
  });
});
