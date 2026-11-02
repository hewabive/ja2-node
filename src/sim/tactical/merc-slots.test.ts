import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent, testDoorCosts } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { syntheticWorld } from '../../content/world/synthetic.ts';
import { Rng } from '../../core/rng.ts';
import { initNewSoldierAnim, states } from './animation.ts';
import { moveSoldierFromAwayToMercSlot, moveSoldierFromMercToAwaySlot } from './away-slots.ts';
import type { TacticalContent } from './content.ts';
import { setSoldierPosition } from './movement.ts';
import { executeOverhead } from './overhead.ts';
import { createSoldier, Orders, type Soldier, Team } from './soldier.ts';
import { createTacticalState, registerSoldier, type TacticalState, unregisterSoldier } from './state.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const STATS = {
  agility: 50,
  dexterity: 50,
  strength: 50,
  wisdom: 50,
  leadership: 50,
  marksmanship: 50,
  mechanical: 30,
  explosives: 30,
  medical: 30,
  experience: 3,
};

function sector(): TacticalState {
  const w = syntheticWorld(testDoorCosts());
  return createTacticalState({ ...w, mapDoors: new Map() }, content, Rng.fromSeed(1));
}

function soldier(t: TacticalState, team: number, x: number): Soldier {
  const at = gridNo(x, 80);
  const s = createSoldier({
    id: t.soldiers.length,
    team,
    name: '',
    bodyType: 0,
    palettes: { hair: '', skin: '', vest: '', pants: '' },
    stats: STATS,
    life: 60,
    breath: 99,
    gridNo: at,
    direction: Direction.SOUTH,
    state: states(content.animations).STANDING,
    ai: { orders: Orders.STATIONARY, attitude: 5 },
  });
  t.soldiers[s.id] = s;
  return s;
}

function entered(t: TacticalState, team: number, x: number): Soldier {
  const s = soldier(t, team, x);
  registerSoldier(t, s);
  setSoldierPosition(t, s, s.gridNo);
  initNewSoldierAnim(t, s, states(content.animations).STANDING, 0, true);
  return s;
}

describe('merc slots (Overhead.cc AddMercSlot, RemoveMercSlot)', () => {
  it('puts a soldier entering the sector after everyone, even behind the place of one who left: the vector closes the gap', () => {
    const t = sector();
    const first = entered(t, Team.ENEMY, 70);
    const second = entered(t, Team.ENEMY, 72);
    const third = entered(t, Team.ENEMY, 74);
    expect(unregisterSoldier(t, second)).toBe(true);
    expect(t.mercSlots).toEqual([first, third]);
    const fourth = entered(t, Team.CIV, 76);
    expect(t.mercSlots).toEqual([first, third, fourth]);
    registerSoldier(t, second);
    expect(t.mercSlots).toEqual([first, third, fourth, second]);
    expect(unregisterSoldier(t, soldier(t, Team.CIV, 78))).toBe(false);
  });

  it('sends a soldier leaving for the away slots to their end and brings him back at the end of the merc slots', () => {
    const t = sector();
    const walker = entered(t, Team.CIV, 70);
    const stayer = entered(t, Team.CIV, 72);
    const otherWalker = entered(t, Team.CIV, 74);
    moveSoldierFromMercToAwaySlot(t, otherWalker);
    moveSoldierFromMercToAwaySlot(t, walker);
    expect([t.mercSlots, t.awaySlots]).toEqual([[stayer], [otherWalker, walker]]);
    expect(moveSoldierFromAwayToMercSlot(t, otherWalker)).toBe(true);
    expect([t.mercSlots, t.awaySlots]).toEqual([[stayer, otherWalker], [walker]]);
  });
});

describe('the soldier pass (Overhead.cc ExecuteOverhead): it walks the vector by index and reads its size at every step', () => {
  function pass(t: TacticalState, during: (t: TacticalState, s: Soldier) => void): Soldier[] {
    const handled: Soldier[] = [];
    executeOverhead(t, {
      ai: (state, s) => {
        handled.push(s);
        during(state, s);
      },
    });
    return handled;
  }

  it('skips the soldier after one who leaves during the pass until the next pass', () => {
    const t = sector();
    const leaver = entered(t, Team.ENEMY, 70);
    const skipped = entered(t, Team.ENEMY, 72);
    const last = entered(t, Team.ENEMY, 74);
    expect(pass(t, (state, s) => s === leaver && unregisterSoldier(state, leaver))).toEqual([leaver, last]);
    expect(pass(t, () => {})).toEqual([skipped, last]);
  });

  it('handles a soldier who enters during the pass in the same pass', () => {
    const t = sector();
    const caller = entered(t, Team.ENEMY, 70);
    const newcomer = soldier(t, Team.ENEMY, 76);
    const handled = pass(t, (state, s) => {
      if (s !== caller) return;
      registerSoldier(state, newcomer);
      setSoldierPosition(state, newcomer, newcomer.gridNo);
    });
    expect(handled).toEqual([caller, newcomer]);
  });
});
