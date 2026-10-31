import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { parseStubProfiles, STUB_PROFILES_PATH } from '../../../content/formats/stub-profiles.ts';
import { WORLD_COLS } from '../../../content/world/grid.ts';
import { createItem } from '../../items/object.ts';
import { ProfileFlag } from '../../narrative/narrative-ids.ts';
import { anim, animName } from '../anim-states.ts';
import { initNewSoldierAnim } from '../animation.ts';
import { deathOpcode } from '../combat/death.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { progressFromProfile } from '../profiles.ts';
import { CivilianGroup, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { NO_NARRATIVE_PORT } from './port.ts';
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

describe('a team change while the soldier is being hit (Soldier_Profile.cc gfPotentialTeamChangeDuringDeath)', () => {
  const REBEL_RECRUIT = 1;
  const SECOND_RECRUIT = 2;
  const LATER_RECRUIT = 3;
  const SHOOTER = 0;
  const FREE_CIV_SLOTS = [117, 118];
  const LATER_CIV_SLOT = 119;
  const UNCONSCIOUS_LIFE = 10;
  const DEATH_OR_RELEASE = 497;

  function recruitsUnderFire(recruitLife: number): { sim: TacticalSim; t: TacticalState; hit: Soldier } {
    const sim = newCombatSim(content);
    const t = sim.state;
    const freeSlots = [...FREE_CIV_SLOTS];
    t.narrative = {
      ...NO_NARRATIVE_PORT,
      changeSoldierTeam: (s, team) => changeSoldierTeam(t, s, team, { freeSoldierId: () => freeSlots.shift() ?? -1 }),
    };
    const shooter = spawnSoldier(sim, SHOOTER, Team.OUR, AT + 6, EAST);
    const hit = spawnSoldier(sim, REBEL_RECRUIT, Team.OUR, AT, EAST, { life: recruitLife, profile: STUB_ESCORT });
    const standing = spawnSoldier(sim, SECOND_RECRUIT, Team.OUR, AT + 3 * WORLD_COLS, EAST);
    for (const s of [hit, standing]) s.civilianGroup = CivilianGroup.REBEL;
    shooter.target = hit;
    shooter.attackNoticed = true;
    hit.attacker = shooter;
    hit.beingAttackedCount = 1;
    t.turn.attackBusyCount = 1;
    initNewSoldierAnim(t, hit, anim(t.content, 'FALLFORWARD_FROMHIT_STAND'), 0, true);
    hit.inNonInterruptibleAnimation = false;
    return { sim, t, hit };
  }

  function turnedHostile(t: TacticalState): string[] {
    return FREE_CIV_SLOTS.map((id) => {
      const s = t.soldiers[id];
      return s?.team === Team.CIV && s.placed ? animName(t.content, s.state) : '';
    });
  }

  it('runs the death checks for the old soldier, so the new one starts in the pose they leave him in', () => {
    const { t, hit } = recruitsUnderFire(UNCONSCIOUS_LIFE);
    expect(deathOpcode(t, hit, DEATH_OR_RELEASE)).toBe('stop');
    expect(turnedHostile(t)).toEqual(['STAND_FALLFORWARD_STOP', 'KNEEL_DOWN']);
    expect([hit.placed, hit.collapsed]).toEqual([false, true]);
  });

  it('keeps the flag up once the hit soldier is gone, so the next team change runs the checks as well (kept quirk)', () => {
    const { sim, t, hit } = recruitsUnderFire(UNCONSCIOUS_LIFE);
    deathOpcode(t, hit, DEATH_OR_RELEASE);
    expect(t.turn.potentialTeamChangeDuringDeath).toBe(true);
    const later = spawnSoldier(sim, LATER_RECRUIT, Team.OUR, AT + 6 * WORLD_COLS, EAST);
    const fresh = changeSoldierTeam(t, later, Team.CIV, { freeSoldierId: () => LATER_CIV_SLOT });
    expect(fresh && animName(t.content, fresh.state)).toBe('KNEEL_DOWN');
  });

  it('lowers the flag after the release when the hit soldier stays, and a team change then keeps the pose', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const hit = spawnSoldier(sim, REBEL_RECRUIT, Team.OUR, AT, EAST, { life: UNCONSCIOUS_LIFE });
    t.turn.potentialTeamChangeDuringDeath = true;
    initNewSoldierAnim(t, hit, anim(t.content, 'FALLFORWARD_FROMHIT_STAND'), 0, true);
    hit.inNonInterruptibleAnimation = false;
    deathOpcode(t, hit, DEATH_OR_RELEASE);
    expect(t.turn.potentialTeamChangeDuringDeath).toBe(false);
    const standing = spawnSoldier(sim, SECOND_RECRUIT, Team.OUR, AT + 3 * WORLD_COLS, EAST);
    const fresh = changeSoldierTeam(t, standing, Team.CIV, { freeSoldierId: () => FREE_CIV_SLOT });
    expect(fresh && animName(t.content, fresh.state)).toBe('STANDING');
  });
});
