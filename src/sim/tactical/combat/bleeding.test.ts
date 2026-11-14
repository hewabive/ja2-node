import { beforeAll, describe, expect, it } from 'vitest';
import { progressFor } from '../../../../tests/support/autoresolve.ts';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import { anim, animName } from '../anim-states.ts';
import { AnimHeight, endHeight } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { type Soldier, TEAM_FIRST_ID, Team, Visible } from '../soldier.ts';
import { setAutoBandageMode } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { beginMercTurn } from '../turns/turns.ts';
import { calcSoldierNextBleed, checkBleeding } from './bleeding.ts';
import { beginSoldierGetup } from './death.ts';
import { soldierTakeDamage } from './hit.ts';
import { DamageReason } from './types.ts';

let content: TacticalContent;

const MERC_PROFILE = 5;

beforeAll(async () => {
  content = await loadTestContent();
});

describe('bleeding at turn start', () => {
  it('loses a point of life when the bleed counter runs out and restarts it', () => {
    const sim = newCombatSim(content);
    sim.state.inCombat = true;
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { life: 50 });
    s.lifeMax = 80;
    s.bleeding = 30;
    s.nextBleed = 1;
    beginMercTurn(sim.state, s);
    expect(s.life).toBe(49);
    expect(s.bleeding).toBe(31);
    expect(s.nextBleed).toBe(calcSoldierNextBleed(s));
  });

  it('does not bleed below the threshold and counts down otherwise', () => {
    const sim = newCombatSim(content);
    sim.state.inCombat = true;
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { life: 70 });
    s.lifeMax = 80;
    s.bleeding = 10;
    s.nextBleed = 1;
    beginMercTurn(sim.state, s);
    expect(s.life).toBe(70);
    s.bleeding = 13;
    s.nextBleed = 3;
    beginMercTurn(sim.state, s);
    expect(s.life).toBe(70);
    expect(s.nextBleed).toBe(2);
  });

  it('bleeds through bandages: the bandaged point opens and the lost point bleeds too', () => {
    const sim = newCombatSim(content);
    sim.state.inCombat = true;
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { life: 50 });
    s.lifeMax = 80;
    s.bleeding = 20;
    s.nextBleed = 1;
    beginMercTurn(sim.state, s);
    expect(s.life).toBe(49);
    expect(s.bleeding).toBe(22);
  });

  it('costs a permanent point of maximum life while dying', () => {
    const sim = newCombatSim(content);
    sim.state.inCombat = true;
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { life: 10 });
    s.lifeMax = 80;
    s.bleeding = 70;
    s.nextBleed = 1;
    beginMercTurn(sim.state, s);
    expect(s.lifeMax).toBe(79);
    expect(s.life).toBe(9);
    expect(s.bleeding).toBe(70);
  });

  it("takes that point off his profile's maximum life, life and life delta", () => {
    const sim = newCombatSim(content);
    sim.state.inCombat = true;
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { life: 10, profile: MERC_PROFILE });
    s.lifeMax = 80;
    s.bleeding = 70;
    s.nextBleed = 1;
    const p = progressFor(MERC_PROFILE, { life: 10 });
    p.stats.lifeMax = 80;
    sim.state.profiles.set(MERC_PROFILE, p);
    beginMercTurn(sim.state, s);
    expect([p.stats.lifeMax, p.life, p.deltas.lifeMax]).toEqual([79, 9, -1]);
  });
});

describe("the bleeding presentation of our merc (Soldier_Control.cc CheckBleeding's STR_LOSES_1_HP, SoldierBleed)", () => {
  function bleeder(team: number, life: number, lifeMax = 80): { sim: TacticalSim; s: Soldier } {
    const sim = newCombatSim(content);
    sim.state.inCombat = true;
    const id = team === Team.OUR ? 0 : TEAM_FIRST_ID[Team.ENEMY];
    const s = spawnSoldier(sim, id, team, gridNo(80, 80), Direction.SOUTH, { life });
    s.lifeMax = lifeMax;
    s.bleeding = lifeMax - life;
    s.nextBleed = 1;
    sim.state.events.length = 0;
    return { sim, s };
  }

  const bled = (sim: TacticalSim) => sim.state.events.filter((e) => e.type === 'mercBled');

  it('tells of every point our merc bleeds before the damage it does, bandaged or not', () => {
    const { sim, s } = bleeder(Team.OUR, 50);
    s.bleeding = 20;
    beginMercTurn(sim.state, s);
    const types = sim.state.events.map((e) => e.type);
    expect(bled(sim)).toEqual([{ type: 'mercBled', soldier: s.id }]);
    expect(types.indexOf('mercBled')).toBeLessThan(types.indexOf('damageFeedback'));
  });

  it('marks the bleed that costs a dying merc a point of maximum life, never once that is below OKLIFE', () => {
    const dying = bleeder(Team.OUR, 10);
    beginMercTurn(dying.sim.state, dying.s);
    expect(bled(dying.sim)).toEqual([{ type: 'mercBled', soldier: dying.s.id, lifeMaxLost: true }]);
    const spent = bleeder(Team.OUR, 10, 14);
    beginMercTurn(spent.sim.state, spent.s);
    expect(spent.s.lifeMax).toBe(14);
    expect(bled(spent.sim)).toEqual([{ type: 'mercBled', soldier: spent.s.id }]);
  });

  it('tells nothing of a bleeding soldier of another team', () => {
    const { sim, s } = bleeder(Team.ENEMY, 10);
    beginMercTurn(sim.state, s);
    expect(s.lifeMax).toBe(79);
    expect(bled(sim)).toEqual([]);
  });
});

describe('the bleeding lines (Soldier_Control.cc CheckBleeding)', () => {
  const SERIOUSLY_WOUNDED = 14;
  const STARTING_TO_BLEED = 24;
  const CONSCIOUS_BUT_DYING = 12;
  const UNCONSCIOUS = 9;

  function bleedingMerc(life: number): { sim: TacticalSim; s: Soldier; said: [number, number][] } {
    const sim = newCombatSim(content);
    sim.state.inCombat = true;
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { life });
    s.lifeMax = 80;
    s.bleeding = 80 - life;
    s.nextBleed = 1;
    s.dyingComment = false;
    const said: [number, number][] = [];
    sim.state.narrative = { ...sim.state.narrative, sayQuote: (who, quote) => said.push([who.id, quote]) };
    return { sim, s, said };
  }

  it('warns once that he is bleeding, after the point of life is lost', () => {
    const { sim, s, said } = bleedingMerc(50);
    beginMercTurn(sim.state, s);
    expect(said).toEqual([[s.id, STARTING_TO_BLEED]]);
    expect([s.life, s.warnedAboutBleeding]).toEqual([49, true]);
    s.nextBleed = 1;
    beginMercTurn(sim.state, s);
    expect(said).toHaveLength(1);
  });

  it('does not warn while he is being bandaged or in auto-bandage mode, and warns at a later bleed', () => {
    const { sim, s, said } = bleedingMerc(50);
    s.serviceCount = 1;
    beginMercTurn(sim.state, s);
    s.serviceCount = 0;
    setAutoBandageMode(sim.state, true);
    s.nextBleed = 1;
    checkBleeding(sim.state, s);
    expect([said, s.warnedAboutBleeding]).toEqual([[], false]);
    setAutoBandageMode(sim.state, false);
    s.nextBleed = 1;
    beginMercTurn(sim.state, s);
    expect(said).toEqual([[s.id, STARTING_TO_BLEED]]);
  });

  it('bleeds nobody at the turn start while auto-bandage runs, and bleeds him at the first turn after (Soldier_Control.cc EVENT_BeginMercTurn)', () => {
    const { sim, s, said } = bleedingMerc(50);
    setAutoBandageMode(sim.state, true);
    beginMercTurn(sim.state, s);
    expect([s.life, s.nextBleed, said]).toEqual([50, 1, []]);
    setAutoBandageMode(sim.state, false);
    beginMercTurn(sim.state, s);
    expect(s.life).toBe(49);
  });

  it('says the seriously-wounded line once while dying and conscious, and no bleeding warning after it', () => {
    const { sim, s, said } = bleedingMerc(CONSCIOUS_BUT_DYING);
    beginMercTurn(sim.state, s);
    expect(said).toEqual([[s.id, SERIOUSLY_WOUNDED]]);
    expect(s.dyingComment).toBe(true);
    s.life = 60;
    s.nextBleed = 1;
    beginMercTurn(sim.state, s);
    expect(said).toHaveLength(1);
  });

  it('keeps an unconscious dying merc quiet', () => {
    const { sim, s, said } = bleedingMerc(UNCONSCIOUS);
    beginMercTurn(sim.state, s);
    expect([said, s.dyingComment]).toEqual([[], false]);
  });

  it('counts a soldier created dying as having made his dying comment (CreateSoldierCommon)', () => {
    const sim = newCombatSim(content);
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { life: CONSCIOUS_BUT_DYING });
    expect(s.dyingComment).toBe(true);
  });
});

describe('no bleeding under care (Soldier_Control.cc CheckBleeding)', () => {
  const LIFE_MAX = 80;
  const DYING = 12;

  function bleeder(life: number): { sim: TacticalSim; s: Soldier } {
    const sim = newCombatSim(content);
    sim.state.inCombat = true;
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { life });
    s.lifeMax = LIFE_MAX;
    s.bleeding = LIFE_MAX - life;
    s.nextBleed = 1;
    return { sim, s };
  }

  function untouched(sim: TacticalSim, s: Soldier, life: number): void {
    expect([s.life, s.lifeMax, s.bleeding, s.nextBleed, sim.state.smell.blood[s.gridNo]]).toEqual([life, LIFE_MAX, LIFE_MAX - life, 1, 0]);
  }

  it('neither bleeds nor drops blood while he is being bandaged (ubServiceCount), dying or not', () => {
    for (const life of [50, DYING]) {
      const { sim, s } = bleeder(life);
      s.serviceCount = 1;
      beginMercTurn(sim.state, s);
      untouched(sim, s, life);
    }
  });

  it('neither bleeds nor drops blood while a doctor can heal him (AnyDoctorWhoCanHealThisPatient), dying or not', () => {
    for (const life of [50, DYING]) {
      const { sim, s } = bleeder(life);
      const asked: Soldier[] = [];
      sim.state.narrative = {
        ...sim.state.narrative,
        anyDoctorWhoCanHeal: (patient) => {
          asked.push(patient);
          return true;
        },
      };
      beginMercTurn(sim.state, s);
      untouched(sim, s, life);
      expect(asked).toEqual([s]);
    }
  });

  it('bleeds and drops blood with nobody bandaging him and no doctor for him', () => {
    const { sim, s } = bleeder(50);
    beginMercTurn(sim.state, s);
    expect(s.life).toBe(49);
    expect(sim.state.smell.blood[s.gridNo]).not.toBe(0);
  });
});

describe('getting up at turn start', () => {
  it('rolls a soldier lying on his back over, turns him around and gets him up', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { life: 40 });
    t.inCombat = true;
    s.state = anim(t.content, 'FALLBACKHIT_STOP');
    s.pc = 0;
    s.collapsed = true;
    s.breath = 60;
    beginMercTurn(t, s);
    expect(s.collapsed).toBe(false);
    expect(animName(t.content, s.state)).toBe('ROLLOVER');
    runUntilIdle(sim);
    expect(s.direction).toBe(Direction.NORTH);
    expect(endHeight(t.content, s.state)).toBe(AnimHeight.STAND);
  });

  it('keeps a soldier down while he is out of breath', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { life: 40 });
    t.inCombat = true;
    s.state = anim(t.content, 'FALLBACKHIT_STOP');
    s.pc = 0;
    s.collapsed = true;
    s.breath = 0;
    s.actionPoints = 0;
    beginMercTurn(t, s);
    expect(s.collapsed).toBe(true);
    expect(s.collapsedTurns).toBe(1);
  });

  it('keeps a soldier put to sleep by a dart down until the drug wears off, one turn at a time', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { life: 40 });
    t.inCombat = true;
    s.state = anim(t.content, 'FALLBACKHIT_STOP');
    s.collapsed = true;
    s.breath = 60;
    s.sleepDrugCounter = 2;
    beginMercTurn(t, s);
    expect(s.collapsed).toBe(true);
    expect(s.sleepDrugCounter).toBe(1);
    beginMercTurn(t, s);
    expect(s.collapsed).toBe(true);
    expect(s.sleepDrugCounter).toBe(0);
    beginMercTurn(t, s);
    expect(s.collapsed).toBe(false);
  });

  it('puts a drugged soldier who is still up to sleep when he fails the PreRandom roll against the drug', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { life: 60 });
    t.inCombat = true;
    s.sleepDrugCounter = 5;
    Object.assign(t, { pre: new ScriptedStream([0]) });
    beginSoldierGetup(t, s);
    expect(s.collapsed).toBe(true);
    expect(s.breath).toBe(0);
    expect(s.sleepDrugCounter).toBe(4);
  });
});

describe('the damage feedback (Soldier_Control.cc HandleSoldierTakeDamageFeedback)', () => {
  const feedback = (sim: TacticalSim) => sim.state.events.filter((e) => e.type === 'damageFeedback');

  it('flashes the portrait of a merc who bleeds a point of life', () => {
    const sim = newCombatSim(content);
    sim.state.inCombat = true;
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { life: 50 });
    s.lifeMax = 80;
    s.bleeding = 30;
    s.nextBleed = 1;
    beginMercTurn(sim.state, s);
    expect(feedback(sim)).toEqual([{ type: 'damageFeedback', soldier: s.id, cause: 'bleeding' }]);
  });

  it('follows gas and electric damage, breath only included, but not a hit, and says whether gas left him conscious for his second grunt', () => {
    const sim = newCombatSim(content);
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { life: 50 });
    soldierTakeDamage(sim.state, s, 0, 500, DamageReason.GAS, null);
    soldierTakeDamage(sim.state, s, 2, 0, DamageReason.ELECTRICITY, null);
    soldierTakeDamage(sim.state, s, 2, 0, DamageReason.GUNFIRE, null);
    soldierTakeDamage(sim.state, s, 40, 0, DamageReason.GAS, null);
    expect(feedback(sim)).toEqual([
      { type: 'damageFeedback', soldier: s.id, cause: 'gas', conscious: true },
      { type: 'damageFeedback', soldier: s.id, cause: 'electricity' },
      { type: 'damageFeedback', soldier: s.id, cause: 'gas' },
    ]);
  });

  it('carries the voice of a soldier out of sight and where the squad hears him instead of his tile, and nothing of a muted one', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const seen = spawnSoldier(sim, TEAM_FIRST_ID[Team.ENEMY] ?? 20, Team.ENEMY, gridNo(80, 84), Direction.SOUTH);
    const unseen = spawnSoldier(sim, (TEAM_FIRST_ID[Team.ENEMY] ?? 20) + 1, Team.ENEMY, gridNo(81, 81), Direction.SOUTH);
    const muted = spawnSoldier(sim, (TEAM_FIRST_ID[Team.ENEMY] ?? 20) + 2, Team.ENEMY, gridNo(80, 90), Direction.SOUTH);
    seen.visible = Visible.SEEN;
    unseen.visible = Visible.HIDDEN;
    muted.visible = Visible.HIDDEN;
    muted.muted = true;
    for (const s of [seen, unseen, muted]) soldierTakeDamage(sim.state, s, 1, 0, DamageReason.BLOODLOSS, null);
    expect(feedback(sim)).toEqual([
      { type: 'damageFeedback', soldier: seen.id, cause: 'bleeding' },
      {
        type: 'damageFeedback',
        soldier: unseen.id,
        cause: 'bleeding',
        unseen: { voice: `bad${unseen.battleSoundId}`, bodyType: unseen.bodyType },
        heard: expect.objectContaining({ by: 0 }),
      },
      { type: 'damageFeedback', soldier: muted.id, cause: 'bleeding' },
    ]);
  });

  it('carries the voice of a merc of ours off the loaded map, an I.M.P. by the voice he chose, and marks the map screen', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { life: 50, profile: 51 });
    Object.assign(merc, { placed: false, offMap: false });
    t.sectorHooks = { ...t.sectorHooks, profileVoice: (_t, profile) => (profile === 51 ? 52 : profile), inMapScreen: () => true };
    soldierTakeDamage(t, merc, 1, 0, DamageReason.BLOODLOSS, null);
    expect(feedback(sim)).toEqual([
      {
        type: 'damageFeedback',
        soldier: merc.id,
        cause: 'bleeding',
        mapScreen: true,
        cry: { voice: '052', bodyType: merc.bodyType, team: Team.OUR },
      },
    ]);
  });
});

describe("the death sound of a seen soldier hurt by gas or electricity (Soldier_Control.cc HandleTakeDamageDeath's DIE1)", () => {
  it('counts as played at every gas or electric hurt of a soldier in sight, alive or not, never at bleeding or out of sight', () => {
    const played = (reason: number, visible: number) => {
      const sim = newCombatSim(content);
      const s = spawnSoldier(sim, TEAM_FIRST_ID[Team.ENEMY] ?? 20, Team.ENEMY, gridNo(80, 84), Direction.SOUTH, { life: 50 });
      s.visible = visible;
      soldierTakeDamage(sim.state, s, 1, 0, reason, null);
      return [s.life > 0, s.deadSoundPlayed];
    };
    expect(played(DamageReason.GAS, Visible.SEEN)).toEqual([true, true]);
    expect(played(DamageReason.ELECTRICITY, Visible.LIMBO)).toEqual([true, true]);
    expect(played(DamageReason.BLOODLOSS, Visible.SEEN)).toEqual([true, false]);
    expect(played(DamageReason.GAS, Visible.HIDDEN)).toEqual([true, false]);
  });
});
