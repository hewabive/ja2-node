import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MercProfile } from '../../content/formats/prof.ts';
import { parseStubProfiles, STUB_PROFILES_PATH } from '../../content/formats/stub-profiles.ts';
import { progressFromProfile } from './profiles.ts';
import { Body } from './soldier.ts';

const LEFTOVER_GRIDNO = 25700;
const ANY_ITEM = 1;
const KICKED_OUT_BODY = Body.REGMALE;

function profileWithLeftovers(): MercProfile {
  const json = JSON.parse(readFileSync(join(import.meta.dirname, '../../..', STUB_PROFILES_PATH), 'utf8'));
  const [first] = parseStubProfiles(json, () => ANY_ITEM);
  if (!first) throw new Error('no stub profile');
  return { ...first, useProfileInsertion: true, gridNo: LEFTOVER_GRIDNO };
}

describe('profile progress', () => {
  it('clears the insertion flag and grid number prof.dat holds as leftovers, as InitProfileFromContent does', () => {
    const progress = progressFromProfile(profileWithLeftovers());
    expect(progress.useProfileInsertion).toBe(false);
    expect(progress.gridNo).toBe(0);
  });

  it('keeps them for a profile read from a savegame', () => {
    const progress = progressFromProfile(profileWithLeftovers(), undefined, true);
    expect(progress.useProfileInsertion).toBe(true);
    expect(progress.gridNo).toBe(LEFTOVER_GRIDNO);
  });

  it("takes a savegame profile's body type over the content's, as a kick-out out of the wheelchair saves it", () => {
    const saved = { ...profileWithLeftovers(), bodyType: KICKED_OUT_BODY };
    expect(progressFromProfile(saved, undefined, true).bodyType).toBe(KICKED_OUT_BODY);
    expect(progressFromProfile(saved).bodyType).toBeUndefined();
  });
});
