import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { parseStubProfiles, STUB_PROFILES_PATH } from '../../../content/formats/stub-profiles.ts';
import { createItem } from '../../items/object.ts';
import { ProfileFlag } from '../../narrative/narrative-ids.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { progressFromProfile } from '../profiles.ts';
import { type Soldier, Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { changeSoldierTeam } from './team-change.ts';

let content: TacticalContent;

beforeAll(async () => {
  const base = await loadTestContent();
  const json = JSON.parse(readFileSync(join(import.meta.dirname, '../../../..', STUB_PROFILES_PATH), 'utf8'));
  content = { ...base, profiles: parseStubProfiles(json, (name) => base.items.byName.get(name)?.index) };
});

const STUB_ESCORT = 123;
const AT = 12080;
const EAST = 2;
const FREE_OUR_SLOT = 4;
const FREE_CIV_SLOT = 117;
const FEMALE_BATTLE_SOUNDS = 2;
const STANDING_FRAMES = 10;

function civilianWithProfile(sim: TacticalSim): Soldier {
  const s = spawnSoldier(sim, 116, Team.CIV, AT, EAST, { life: 33 });
  Object.assign(s, { profile: STUB_ESCORT });
  s.stats.wisdom = 91;
  s.stats.experience = 4;
  s.lifeMax = 48;
  s.camo = 20;
  s.bleeding = 7;
  s.inv[InvSlot.BIGPOCK1] = createItem(content.items, content.items.byName.get('CANTEEN')?.index ?? 0, 100);
  const record = content.profiles[STUB_ESCORT];
  if (record) sim.state.profiles.set(STUB_ESCORT, progressFromProfile(record));
  return s;
}

function recordDraws(sim: TacticalSim): number[] {
  const ranges: number[] = [];
  const rng = sim.state.rng as unknown as { int(n: number): number };
  const int = rng.int.bind(rng);
  rng.int = (n: number) => {
    ranges.push(n);
    return int(n);
  };
  return ranges;
}

describe('ChangeSoldierTeam (Soldier_Profile.cc)', () => {
  it('replaces the soldier on the new team in place, copying life, stats, camouflage, level and inventory', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const old = civilianWithProfile(sim);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, AT + 8, EAST);
    enemy.target = old;
    const draws = recordDraws(sim);
    const fresh = changeSoldierTeam(t, old, Team.OUR, { freeSoldierId: () => FREE_OUR_SLOT });
    if (!fresh) throw new Error('no new soldier');
    expect(draws.slice(0, 2)).toEqual([FEMALE_BATTLE_SOUNDS, STANDING_FRAMES]);
    expect(fresh).toMatchObject({ id: FREE_OUR_SLOT, team: Team.OUR, profile: STUB_ESCORT, gridNo: AT, direction: EAST, placed: true });
    expect(fresh).toMatchObject({ life: 33, lifeMax: 48, camo: 20, visible: 1, bleeding: 0 });
    expect(fresh.stats).toMatchObject({ wisdom: 91, experience: 4 });
    expect(fresh.inv[InvSlot.BIGPOCK1]?.item).toBe(content.items.byName.get('CANTEEN')?.index);
    expect(old.placed).toBe(false);
    expect(old.inv[InvSlot.BIGPOCK1]?.item).toBe(0);
    expect(t.soldiers[FREE_OUR_SLOT]).toBe(fresh);
    expect(enemy.target).toBe(fresh);
    expect((t.profiles.get(STUB_ESCORT)?.miscFlags ?? 0) & ProfileFlag.RECRUITED).toBe(ProfileFlag.RECRUITED);
  });

  it('clears the recruited flag on the way back to the civilian team, which computes neutrality', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const ours = changeSoldierTeam(t, civilianWithProfile(sim), Team.OUR, { freeSoldierId: () => FREE_OUR_SLOT });
    if (!ours) throw new Error('no recruit');
    const back = changeSoldierTeam(t, ours, Team.CIV, { freeSoldierId: () => FREE_CIV_SLOT });
    expect(back).toMatchObject({ id: FREE_CIV_SLOT, team: Team.CIV, neutral: true, gridNo: AT, placed: true });
    expect((t.profiles.get(STUB_ESCORT)?.miscFlags ?? 0) & ProfileFlag.RECRUITED).toBe(0);
  });

  it('creates the new soldier off the map when the old one was not in the loaded sector, with the same draws', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const old = civilianWithProfile(sim);
    old.placed = false;
    const draws = recordDraws(sim);
    const fresh = changeSoldierTeam(t, old, Team.OUR, { freeSoldierId: () => FREE_OUR_SLOT });
    expect(draws).toEqual([FEMALE_BATTLE_SOUNDS, STANDING_FRAMES]);
    expect(fresh?.placed).toBe(false);
    expect(t.soldiers[FREE_OUR_SLOT]).toBeUndefined();
  });

  it('gives up without a free slot', () => {
    const sim = newCombatSim(content);
    expect(changeSoldierTeam(sim.state, civilianWithProfile(sim), Team.OUR, { freeSoldierId: () => -1 })).toBeNull();
  });
});
