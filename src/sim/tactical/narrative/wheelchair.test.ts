import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { parseStubProfiles, STUB_PROFILES_PATH } from '../../../content/formats/stub-profiles.ts';
import type { TacticalContent } from '../content.ts';
import { tacticalCreateSoldier } from '../creation.ts';
import { NEUTRAL_POPULATION } from '../init-list.ts';
import { progressFromProfile } from '../profiles.ts';
import { Body, Team } from '../soldier.ts';
import { profileSoldierCreate } from './profile-insertion.ts';
import { kickOutWheelchair } from './wheelchair.ts';

const CRIPPLED_PROFILE = 123;
const AT = 12080;
const EAST = 2;
const SECOND_CIV_SLOT = 117;

let content: TacticalContent;

beforeAll(async () => {
  const base = await loadTestContent();
  const json = JSON.parse(readFileSync(join(import.meta.dirname, '../../../..', STUB_PROFILES_PATH), 'utf8'));
  const profiles = [...parseStubProfiles(json, (name) => base.items.byName.get(name)?.index)];
  const record = profiles[CRIPPLED_PROFILE];
  if (!record) throw new Error('no stub profile');
  profiles[CRIPPLED_PROFILE] = { ...record, bodyType: Body.CRIPPLECIV };
  content = { ...base, profiles };
});

describe('KickOutWheelchair (Soldier_Ani.cc code 482)', () => {
  it('stands the profile up too: a soldier created again from it no longer sits in the wheelchair', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const record = content.profiles[CRIPPLED_PROFILE];
    if (!record) throw new Error('no profile');
    t.profiles.set(CRIPPLED_PROFILE, progressFromProfile(record));
    const create = () =>
      tacticalCreateSoldier(t, profileSoldierCreate(CRIPPLED_PROFILE, Team.CIV, EAST), SECOND_CIV_SLOT, NEUTRAL_POPULATION);
    expect(create()?.bodyType).toBe(Body.CRIPPLECIV);
    const s = spawnSoldier(sim, 116, Team.CIV, AT, EAST);
    Object.assign(s, { profile: CRIPPLED_PROFILE, bodyType: Body.CRIPPLECIV });
    kickOutWheelchair(t, s);
    expect(s.bodyType).toBe(Body.REGMALE);
    expect(t.profiles.get(CRIPPLED_PROFILE)?.bodyType).toBe(Body.REGMALE);
    expect(create()?.bodyType).toBe(Body.REGMALE);
  });
});
