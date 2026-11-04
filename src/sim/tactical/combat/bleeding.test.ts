import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import { anim, animName } from '../anim-states.ts';
import { AnimHeight, endHeight } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { type Soldier, TEAM_FIRST_ID, Team, Visible } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { beginMercTurn } from '../turns/turns.ts';
import { calcSoldierNextBleed } from './bleeding.ts';
import { beginSoldierGetup } from './death.ts';
import { soldierTakeDamage } from './hit.ts';
import { DamageReason } from './types.ts';

let content: TacticalContent;

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
    Object.assign(sim.state.pathEnv, { autoBandage: true });
    s.nextBleed = 1;
    beginMercTurn(sim.state, s);
    expect([said, s.warnedAboutBleeding]).toEqual([[], false]);
    Object.assign(sim.state.pathEnv, { autoBandage: false });
    s.nextBleed = 1;
    beginMercTurn(sim.state, s);
    expect(said).toEqual([[s.id, STARTING_TO_BLEED]]);
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
    expect(feedback(sim)).toEqual([{ type: 'damageFeedback', soldier: s.id }]);
  });

  it('follows gas and electric damage, breath only included, but not a hit', () => {
    const sim = newCombatSim(content);
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { life: 50 });
    soldierTakeDamage(sim.state, s, 0, 500, DamageReason.GAS, null);
    soldierTakeDamage(sim.state, s, 2, 0, DamageReason.ELECTRICITY, null);
    soldierTakeDamage(sim.state, s, 2, 0, DamageReason.GUNFIRE, null);
    expect(feedback(sim)).toEqual([
      { type: 'damageFeedback', soldier: s.id },
      { type: 'damageFeedback', soldier: s.id },
    ]);
  });

  it('is sent for a soldier the squad sees, not for one out of sight', () => {
    const sim = newCombatSim(content);
    const seen = spawnSoldier(sim, TEAM_FIRST_ID[Team.ENEMY] ?? 20, Team.ENEMY, gridNo(80, 84), Direction.SOUTH);
    const unseen = spawnSoldier(sim, (TEAM_FIRST_ID[Team.ENEMY] ?? 20) + 1, Team.ENEMY, gridNo(80, 88), Direction.SOUTH);
    seen.visible = Visible.SEEN;
    unseen.visible = Visible.HIDDEN;
    soldierTakeDamage(sim.state, seen, 1, 0, DamageReason.GAS, null);
    soldierTakeDamage(sim.state, unseen, 1, 0, DamageReason.GAS, null);
    expect(feedback(sim)).toEqual([{ type: 'damageFeedback', soldier: seen.id }]);
  });
});
