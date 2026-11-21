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
import { createTacticalState, mercs, registerSoldier, type TacticalState, unregisterSoldier } from './state.ts';

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

describe('merc slots (Overhead.cc GetFreeMercSlot, RecountMercSlots, AddMercSlot, RemoveMercSlot)', () => {
  it('puts a soldier entering the sector in the first empty slot, and leaves the slot of one who left empty until then', () => {
    const t = sector();
    const first = entered(t, Team.ENEMY, 70);
    const second = entered(t, Team.ENEMY, 72);
    const third = entered(t, Team.ENEMY, 74);
    expect(unregisterSoldier(t, second)).toBe(true);
    expect(t.mercSlots).toEqual([first, null, third]);
    const fourth = entered(t, Team.CIV, 76);
    expect(t.mercSlots).toEqual([first, fourth, third]);
    registerSoldier(t, second);
    expect(t.mercSlots).toEqual([first, fourth, third, second]);
    expect(unregisterSoldier(t, soldier(t, Team.CIV, 78))).toBe(false);
  });

  it('counts the slots up to the last soldier: one who leaves the last slot takes the empty slots before him along', () => {
    const t = sector();
    const first = entered(t, Team.ENEMY, 70);
    const second = entered(t, Team.ENEMY, 72);
    const third = entered(t, Team.ENEMY, 74);
    unregisterSoldier(t, second);
    unregisterSoldier(t, third);
    expect(t.mercSlots).toEqual([first]);
    const fourth = entered(t, Team.CIV, 76);
    expect(t.mercSlots).toEqual([first, fourth]);
  });

  it('sends a soldier leaving for the away slots to the first empty one and brings him back to the first empty merc slot', () => {
    const t = sector();
    const walker = entered(t, Team.CIV, 70);
    const stayer = entered(t, Team.CIV, 72);
    const otherWalker = entered(t, Team.CIV, 74);
    moveSoldierFromMercToAwaySlot(t, otherWalker);
    moveSoldierFromMercToAwaySlot(t, walker);
    expect([t.mercSlots, t.awaySlots]).toEqual([
      [null, stayer],
      [otherWalker, walker],
    ]);
    expect(moveSoldierFromAwayToMercSlot(t, otherWalker)).toBe(true);
    expect([t.mercSlots, t.awaySlots]).toEqual([
      [otherWalker, stayer],
      [null, walker],
    ]);
  });
});

describe('the placed soldiers of the merc slots (FOR_EACH_MERC as a list taken at the start of a loop)', () => {
  it('hands out the same list until a slot or a placement changes, and never changes a list already handed out', () => {
    const t = sector();
    const first = entered(t, Team.ENEMY, 70);
    const second = entered(t, Team.CIV, 72);
    const before = mercs(t);
    expect(mercs(t)).toBe(before);
    second.placed = false;
    const afterLeaving = mercs(t);
    expect([before, afterLeaving]).toEqual([[first, second], [first]]);
    second.placed = true;
    expect(mercs(t)).toEqual([first, second]);
    const third = entered(t, Team.CIV, 74);
    expect(mercs(t)).toEqual([first, second, third]);
    unregisterSoldier(t, first);
    expect([mercs(t), afterLeaving]).toEqual([[second, third], [first]]);
  });
});

describe('the soldier pass (Overhead.cc ExecuteOverhead): it walks the fixed array by index and reads its count at every step', () => {
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

  function enterDuringPass(t: TacticalState, newcomer: Soldier): void {
    registerSoldier(t, newcomer);
    setSoldierPosition(t, newcomer, newcomer.gridNo);
  }

  it('still handles the soldier after one who leaves during the pass: the slot he leaves stays empty', () => {
    const t = sector();
    const leaver = entered(t, Team.ENEMY, 70);
    const next = entered(t, Team.ENEMY, 72);
    const last = entered(t, Team.ENEMY, 74);
    expect(pass(t, (state, s) => s === leaver && unregisterSoldier(state, leaver))).toEqual([leaver, next, last]);
    expect(pass(t, () => {})).toEqual([next, last]);
  });

  it('handles a soldier who enters during the pass in that pass only when the empty slot he takes lies after the current one', () => {
    const t = sector();
    const caller = entered(t, Team.ENEMY, 70);
    const newcomer = soldier(t, Team.ENEMY, 76);
    expect(pass(t, (state, s) => s === caller && enterDuringPass(state, newcomer))).toEqual([caller, newcomer]);
    const late = soldier(t, Team.ENEMY, 78);
    unregisterSoldier(t, caller);
    expect(pass(t, (state, s) => s === newcomer && enterDuringPass(state, late))).toEqual([newcomer]);
    expect(t.mercSlots).toEqual([late, newcomer]);
  });
});
