import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo, spacesAway } from '../../../content/world/grid.ts';
import { syntheticWorld } from '../../../content/world/synthetic.ts';
import { Rng } from '../../../core/rng.ts';
import { initNewSoldierAnim, states } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { dequeueAllGameEvents } from '../game-events.ts';
import { setSoldierPosition } from '../movement.ts';
import { executeOverhead, type OverheadHooks } from '../overhead.ts';
import { createSoldier, Orders, type Soldier, Team } from '../soldier.ts';
import { createTacticalState, registerSoldier, type TacticalState } from '../state.ts';
import { AiAction } from './actions.ts';
import { aiForSlot, beginAiPass, createAiControl, freeUpFromStanceChange, freeUpFromTurning } from './control.ts';

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

function world(seed: number): { t: TacticalState; hooks: OverheadHooks } {
  const w = syntheticWorld(testDoorCosts());
  const t = createTacticalState({ ...w, mapDoors: new Map() }, content, Rng.fromSeed(seed));
  const control = createAiControl();
  t.hooks = { ...t.hooks, turnFinished: freeUpFromTurning, stanceChanged: freeUpFromStanceChange };
  return {
    t,
    hooks: {
      beforePass: (s) => beginAiPass(s, control),
      ai: (s, soldier, slot) => aiForSlot(s, soldier, slot, control),
      afterPass: dequeueAllGameEvents,
    },
  };
}

function spawn(t: TacticalState, team: number, at: number, orders: number): Soldier {
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
    ai: { orders, attitude: 5 },
  });
  registerSoldier(t, s);
  setSoldierPosition(t, s, at);
  initNewSoldierAnim(t, s, states(content.animations).STANDING, 0, true);
  return s;
}

function run(t: TacticalState, hooks: OverheadHooks, ms: number, each?: () => void): void {
  for (let i = 0; i < ms / 5; i++) {
    executeOverhead(t, hooks);
    each?.();
  }
}

describe('green real-time AI', () => {
  it('keeps a seek-enemy soldier wandering and a stationary one in place', () => {
    const { t, hooks } = world(3);
    const filler = spawn(t, Team.OUR, gridNo(40, 100), Orders.STATIONARY);
    const roamer = spawn(t, Team.ENEMY, gridNo(80, 80), Orders.SEEKENEMY);
    const guard = spawn(t, Team.ENEMY, gridNo(90, 90), Orders.STATIONARY);
    const start = roamer.gridNo;
    let maxAway = 0;
    const facings = new Set<number>();
    run(t, hooks, 10 * 60_000, () => {
      maxAway = Math.max(maxAway, spacesAway(start, roamer.gridNo));
      facings.add(guard.direction);
    });
    expect(maxAway).toBeGreaterThan(5);
    expect(guard.gridNo).toBe(gridNo(90, 90));
    expect(facings.size).toBeGreaterThan(1);
    expect(filler.gridNo).toBe(gridNo(40, 100));
  });

  it('keeps an on-call soldier within ten tiles of home', () => {
    const { t, hooks } = world(5);
    const home = gridNo(80, 80);
    const s = spawn(t, Team.ENEMY, home, Orders.ONCALL);
    let maxAway = 0;
    let moved = false;
    run(t, hooks, 15 * 60_000, () => {
      maxAway = Math.max(maxAway, spacesAway(home, s.gridNo));
      if (s.ai.action === AiAction.RANDOM_PATROL) moved = true;
    });
    expect(moved).toBe(true);
    expect(maxAway).toBeLessThanOrEqual(10);
  });

  it('runs the first AI tick after 55 ms starting at slot 1, so slot 0 is first visited at 110 ms', () => {
    const { t, hooks } = world(9);
    const s = spawn(t, Team.ENEMY, gridNo(80, 80), Orders.STATIONARY);
    const visits: number[] = [];
    let last = s.ai.counter;
    run(t, hooks, 2000, () => {
      if (s.ai.counter !== last) {
        visits.push(t.clockMs - 5);
        last = s.ai.counter;
      }
    });
    expect(visits[0]).toBe(110);
  });
});
