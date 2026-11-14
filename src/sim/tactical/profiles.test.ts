import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MercProfile, ProfileStatGains } from '../../content/formats/prof.ts';
import type { SavedMercProfile } from '../../content/formats/savegame-profile.ts';
import { parseStubProfiles, STUB_PROFILES_PATH } from '../../content/formats/stub-profiles.ts';
import { progressFromProfile, progressFromSavedProfile } from './profiles.ts';
import { Body, NOWHERE } from './soldier.ts';

const LEFTOVER_GRIDNO = 25700;
const ANY_ITEM = 1;
const KICKED_OUT_BODY = Body.REGMALE;
const REVEALED_NAME = 'True Name';
const SAVED_NOWHERE = 25601;
const PRE_COMBAT_TILE = 9035;
const NO_DELTAS: ProfileStatGains = {
  expLevel: 0,
  life: 0,
  agility: 0,
  dexterity: 0,
  wisdom: 0,
  marksmanship: 0,
  medical: 0,
  mechanical: 0,
  explosives: 0,
  leadership: 0,
  strength: 0,
};

function savedProfile(p: MercProfile): SavedMercProfile {
  return { ...p, kills: 0, assists: 0, shotsFired: 0, shotsHit: 0, battlesFought: 0, timesWounded: 0, deltas: NO_DELTAS, checksum: 0 };
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

  it("takes a savegame profile's stat deltas, which a new game's profile starts at zero", () => {
    const content = profileWithLeftovers();
    const deltas = { ...NO_DELTAS, life: -2, agility: -3, expLevel: 1 };
    const progress = progressFromSavedProfile({ ...savedProfile(content), deltas }, content);
    expect([progress.deltas.lifeMax, progress.deltas.agility, progress.deltas.experience, progress.deltas.wisdom]).toEqual([-2, -3, 1, 0]);
    expect(Object.values(progressFromProfile(content).deltas).every((delta) => delta === 0)).toBe(true);
  });

  it("reads a saved pre-combat tile of NOWHERE (GRIDSIZE + 1) as ours, so a neutral civilian's next combat records his tile", () => {
    const content = profileWithLeftovers();
    expect(progressFromSavedProfile({ ...savedProfile(content), preCombatGridNo: SAVED_NOWHERE }, content).preCombatGridNo).toBe(NOWHERE);
    expect(progressFromSavedProfile({ ...savedProfile(content), preCombatGridNo: PRE_COMBAT_TILE }, content).preCombatGridNo).toBe(
      PRE_COMBAT_TILE,
    );
  });
});
