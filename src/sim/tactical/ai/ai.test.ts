import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { QuoteActionId } from '../../../content/narrative/npc-constants.ts';
import { DIRECTION_INCREMENT, Direction, gridNo, newGridNo, spacesAway } from '../../../content/world/grid.ts';
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
import {
  aiForSlot,
  beginAiPass,
  createAiControl,
  executeAction,
  freeUpFromStanceChange,
  freeUpFromTurning,
  handleSoldierAI,
} from './control.ts';
import { decideActionGreen, decideAlertStatus, NO_AI_HOOKS } from './decide.ts';
import { randomFriendWithin } from './destinations.ts';

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

function world(seed: number, control = createAiControl()): { t: TacticalState; hooks: OverheadHooks } {
  const w = syntheticWorld(testDoorCosts());
  const t = createTacticalState({ ...w, mapDoors: new Map() }, content, Rng.fromSeed(seed));
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

  it('handles an NPC who turns toward the player on every pass, not only at the AI ticks', () => {
    let decisions = 0;
    const control = createAiControl({
      decideActionNamedNPC: () => {
        decisions++;
        return AiAction.ABSOLUTELY_NONE;
      },
    });
    const { t, hooks } = world(3, control);
    const npc = spawn(t, Team.CIV, gridNo(80, 80), Orders.STATIONARY);
    npc.profile = 94;
    npc.quoteRecord = 3;
    npc.quoteActionId = QuoteActionId.TURNTOWARDSPLAYER;
    npc.ai.handleEveryFrame = true;
    run(t, hooks, 500);
    expect(decisions).toBe(500 / 5);
  });

  it("cuts a random turn short: the turn ends through Stracciatella's movement branch and the queued wait stops it", () => {
    const { t, hooks } = world(3);
    const guard = spawn(t, Team.ENEMY, gridNo(80, 80), Orders.STATIONARY);
    const QUEUED_WAIT_MS = 10_000;
    guard.ai.action = AiAction.CHANGE_FACING;
    guard.ai.actionData = Direction.NORTH;
    guard.ai.nextAction = AiAction.WAIT;
    guard.ai.nextActionData = QUEUED_WAIT_MS;
    guard.ai.actionInProgress = executeAction(t, guard);
    const facings: number[] = [];
    run(t, hooks, 2000, () => {
      if (facings.at(-1) !== guard.direction) facings.push(guard.direction);
    });
    expect(facings.length).toBeLessThan(4);
    expect(guard.direction).not.toBe(Direction.NORTH);
    expect(guard.desiredDirection).toBe(guard.direction);
    expect(guard.ai.counter).toBeGreaterThan(QUEUED_WAIT_MS);
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

  it('queues no wait after an enemy seeks a friend, only after a civilian or militiaman does', () => {
    const PATROL_ROLL_FAILS = 99;
    const SEEK_FRIEND_ROLL_SUCCEEDS = 0;
    const nextActionAfterSeekingFriend = (team: number) => {
      const { t } = world(3);
      const s = spawn(t, team, gridNo(80, 80), Orders.FARPATROL);
      spawn(t, team, gridNo(80, 86), Orders.STATIONARY);
      Object.assign(t, { pre: new ScriptedStream([PATROL_ROLL_FAILS, SEEK_FRIEND_ROLL_SUCCEEDS], 0) });
      expect(decideActionGreen(t, s, createAiControl().green)).toBe(AiAction.SEEK_FRIEND);
      return s.ai.nextAction;
    };
    expect(nextActionAfterSeekingFriend(Team.ENEMY)).toBe(AiAction.NONE);
    expect(nextActionAfterSeekingFriend(Team.MILITIA)).toBe(AiAction.WAIT);
  });

  it('skips the seek-friend roll once the patrol searched a path, even one it could not use', () => {
    const { t } = world(3);
    const guard = spawn(t, Team.ENEMY, gridNo(80, 80), Orders.ONGUARD);
    guard.ai.patrolGrid[0] = gridNo(100, 80);
    const PATROL_ROLL_SUCCEEDS = 0;
    const LOOK_ROLL_FAILS = 99;
    const pre = new ScriptedStream([PATROL_ROLL_SUCCEEDS, LOOK_ROLL_FAILS], 0);
    Object.assign(t, { pre });
    expect(decideActionGreen(t, guard, createAiControl().green)).toBe(AiAction.NONE);
    expect(pre.requested).toEqual([100, 100]);
  });
});

describe('the friend to visit (AIUtils.cc RandomFriendWithin)', () => {
  it('never stands north of the friend and picks north-east twice as often: the direction is shifted by one', () => {
    const { t } = world(3);
    const visitor = spawn(t, Team.ENEMY, gridNo(80, 80), Orders.SEEKENEMY);
    const friend = spawn(t, Team.ENEMY, gridNo(80, 90), Orders.STATIONARY);
    const beside = (direction: number) => newGridNo(friend.gridNo, DIRECTION_INCREMENT[direction] ?? 0);
    const visits = new Map<number, number>();
    for (let i = 0; i < 400; i++) {
      expect(randomFriendWithin(t, visitor)).toBe(true);
      visits.set(visitor.ai.actionData, (visits.get(visitor.ai.actionData) ?? 0) + 1);
    }
    expect(visits.has(beside(Direction.NORTH))).toBe(false);
    expect(visits.size).toBe(7);
    const northEast = visits.get(beside(Direction.NORTHEAST)) ?? 0;
    for (const [tile, count] of visits) if (tile !== beside(Direction.NORTHEAST)) expect(count).toBeLessThan(northEast);
  });

  it("lets a neutral civilian visit an enemy soldier but not the other way round: the civilians' side is the enemy's", () => {
    const { t } = world(3);
    const civilian = spawn(t, Team.CIV, gridNo(80, 80), Orders.SEEKENEMY);
    const soldier = spawn(t, Team.ENEMY, gridNo(80, 90), Orders.SEEKENEMY);
    expect(randomFriendWithin(t, civilian)).toBe(true);
    expect(randomFriendWithin(t, soldier)).toBe(false);
  });
});
