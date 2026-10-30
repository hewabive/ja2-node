import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MercProfile } from '../../content/formats/prof.ts';
import type { SavedMercProfile } from '../../content/formats/savegame-profile.ts';
import { parseStubProfiles, STUB_PROFILES_PATH } from '../../content/formats/stub-profiles.ts';
import { progressFromProfile, progressFromSavedProfile } from './profiles.ts';
import { Body } from './soldier.ts';

const LEFTOVER_GRIDNO = 25700;
const ANY_ITEM = 1;
const KICKED_OUT_BODY = Body.REGMALE;
const REVEALED_NAME = 'True Name';

function savedProfile(p: MercProfile): SavedMercProfile {
  return { ...p, kills: 0, assists: 0, shotsFired: 0, shotsHit: 0, battlesFought: 0, timesWounded: 0, checksum: 0 };
}

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

  it("takes a savegame profile's nickname where it differs from the content's, as a terrorist's reveal saves his full name", () => {
    const content = profileWithLeftovers();
    const revealed = { ...savedProfile(content), nickname: REVEALED_NAME };
    expect(progressFromSavedProfile(revealed, content).nickname).toBe(REVEALED_NAME);
    expect(progressFromSavedProfile(savedProfile(content), content).nickname).toBeUndefined();
  });
});
