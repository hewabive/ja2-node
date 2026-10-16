import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { anim, animName } from '../anim-states.ts';
import { AnimHeight, endHeight } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { Team } from '../soldier.ts';
import { beginMercTurn } from '../turns/turns.ts';
import { calcSoldierNextBleed } from './bleeding.ts';

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
});
