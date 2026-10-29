import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo, spacesAway } from '../../../content/world/grid.ts';
import { syntheticWorld } from '../../../content/world/synthetic.ts';
import { Rng } from '../../../core/rng.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import { initNewSoldierAnim, states } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { inGas, SmokeTile } from '../explosions/smoke.ts';
import { dequeueAllGameEvents } from '../game-events.ts';
import { setSoldierPosition } from '../movement.ts';
import { executeOverhead, type OverheadHooks } from '../overhead.ts';
import { AlertStatus, Body, createSoldier, Orders, type Soldier, Team } from '../soldier.ts';
import { createTacticalState, registerSoldier, type TacticalState } from '../state.ts';
import { AI_DELAY, AiAction } from './actions.ts';
import { aiForSlot, beginAiPass, createAiControl, freeUpFromStanceChange, freeUpFromTurning, handleSoldierAI } from './control.ts';
import { decideActionGreen, decideAlertStatus, NO_AI_HOOKS } from './decide.ts';

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
  t.hooks = { ...t.hooks, turnFinished: freeUpFromTurning, stanceFreeUp: freeUpFromStanceChange };
  return {
    t,
    hooks: {
      beforePass: beginAiPass,
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

describe('the soldiers the AI leaves alone (AIMain.cc HandleSoldierAI)', () => {
  it('never decides for a vehicle, while a tank still takes his turn at the AI', () => {
    const { t } = world(3);
    const truck = spawn(t, Team.CIV, gridNo(80, 80), Orders.STATIONARY);
    truck.bodyType = Body.ICECREAMTRUCK;
    const pre = new ScriptedStream([], 0);
    Object.assign(t, { pre });
    handleSoldierAI(t, truck, createAiControl());
    expect([truck.ai.counter, pre.requested]).toEqual([AI_DELAY, []]);
    const tank = spawn(t, Team.ENEMY, gridNo(90, 90), Orders.STATIONARY);
    tank.bodyType = Body.TANK_NE;
    handleSoldierAI(t, tank, createAiControl());
    expect(tank.ai.counter).toBeGreaterThan(AI_DELAY);
  });
});

describe('a sleeper in turn-based combat (AIMain.cc HandleSoldierAI)', () => {
  const UNSEEN = -1;
  const NEVER_SEEN = 0;

  function sleeperOnHisTurn(visible: number): Soldier {
    const { t } = world(3);
    const sleeper = spawn(t, Team.CIV, gridNo(80, 80), Orders.STATIONARY);
    t.inCombat = true;
    t.turn.currentTeam = Team.CIV;
    sleeper.aiTurnControl = true;
    sleeper.ai.asleep = true;
    sleeper.visible = visible;
    handleSoldierAI(t, sleeper, createAiControl());
    return sleeper;
  }

  it('wakes up when the player does not see him: the original tests bVisible as a boolean and -1 is true', () => {
    expect(sleeperOnHisTurn(UNSEEN).ai.asleep).toBe(false);
    expect(sleeperOnHisTurn(NEVER_SEEN).ai.asleep).toBe(true);
  });
});

describe('alert status (DecideAction.cc DecideAlertStatus, AIMain.cc CheckForChangingOrders)', () => {
  it('sends an on-guard soldier who spots an enemy on far patrol at once: the original raises his orders twice', () => {
    const { t } = world(3);
    const guard = spawn(t, Team.ENEMY, gridNo(80, 80), Orders.ONGUARD);
    guard.ai.oppCount = 1;
    decideAlertStatus(t, guard, NO_AI_HOOKS);
    expect(guard.ai.alertStatus).toBe(AlertStatus.BLACK);
    expect(guard.ai.orders).toBe(Orders.FARPATROL);
  });
});

describe('the green decision (DecideAction.cc DecideActionGreen)', () => {
  it('leaves a tear gas cloud for the nearest land outside it', () => {
    const { t } = world(3);
    const guard = spawn(t, Team.ENEMY, gridNo(80, 80), Orders.STATIONARY);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) t.explosives.smokeTiles[0][gridNo(80 + dx, 80 + dy)] = SmokeTile.TEARGAS;
    expect(decideActionGreen(t, guard, createAiControl().green)).toBe(AiAction.LEAVE_WATER_GAS);
    expect(inGas(t, guard, guard.ai.actionData)).toBe(false);
  });

  it('leaves a tank standing without a single draw', () => {
    const { t } = world(3);
    const tank = spawn(t, Team.ENEMY, gridNo(80, 80), Orders.FARPATROL);
    tank.bodyType = Body.TANK_NW;
    const pre = new ScriptedStream([], 0);
    Object.assign(t, { pre });
    expect(decideActionGreen(t, tank, createAiControl().green)).toBe(AiAction.NONE);
    expect(pre.requested).toEqual([]);
  });
});
