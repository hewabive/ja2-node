import { beforeAll, describe, expect, it } from 'vitest';
import { testProfile } from '../../../../tests/support/profiles.ts';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { QuoteActionId } from '../../../content/narrative/npc-constants.ts';
import { DIRECTION_INCREMENT, Direction, gridNo, newGridNo, spacesAway } from '../../../content/world/grid.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../../content/world/synthetic.ts';
import { Rng } from '../../../core/rng.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import { Npc } from '../../strategic/narrative/npc-ids.ts';
import { AnimHeight, initNewSoldierAnim, states } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { inGas, SmokeTile } from '../explosions/smoke.ts';
import { dequeueAllGameEvents } from '../game-events.ts';
import { setSoldierPosition } from '../movement.ts';
import { BROTHEL_SECTOR, BrothelRooms } from '../narrative/constants.ts';
import { NO_NARRATIVE_PORT } from '../narrative/port.ts';
import { executeOverhead, type OverheadHooks } from '../overhead.ts';
import { NOWHERE } from '../pathfinding.ts';
import { AP } from '../points.ts';
import { AlertStatus, Body, CivilianGroup, createSoldier, Orders, type Soldier, Team } from '../soldier.ts';
import { createTacticalState, registerSoldier, type TacticalState, unregisterSoldier } from '../state.ts';
import { AI_DELAY, AiAction, Situation } from './actions.ts';
import {
  aiForSlot,
  beginAiPass,
  createAiControl,
  executeAction,
  freeUpFromStanceChange,
  freeUpFromTurning,
  handleSoldierAI,
} from './control.ts';
import { decideActionGreen, decideAlertStatus, determineMovementMode, NO_AI_HOOKS, realtimeDelay, setNewSituation } from './decide.ts';
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

describe('the pause for a quote trigger (AIMain.cc HandleSoldierAI)', () => {
  function speakerOnHisTurn(profile: number, inCombat: boolean, dialogueBusy: boolean) {
    const { t } = world(3);
    const speaker = spawn(t, Team.ENEMY, gridNo(80, 80), Orders.STATIONARY);
    speaker.profile = profile;
    t.inCombat = inCombat;
    t.turn.currentTeam = Team.ENEMY;
    t.narrative = { ...NO_NARRATIVE_PORT, dialogueBusy: () => dialogueBusy };
    speaker.aiTurnControl = true;
    speaker.ai.newSituation = Situation.IS_NEW;
    const pre = new ScriptedStream([], 0);
    Object.assign(t, { pre });
    handleSoldierAI(t, speaker, createAiControl());
    return { speaker, draws: pre.requested };
  }

  it.each([Npc.SERGEANT, Npc.MIKE, Npc.JOE])('holds the AI of profile %i in combat while dialogue is pending', (profile) => {
    const { speaker, draws } = speakerOnHisTurn(profile, true, true);
    expect(speaker.ai.newSituation).toBe(Situation.IS_NEW);
    expect(speaker.aiTurnControl).toBe(true);
    expect(draws).toEqual([]);
  });

  it('lets Krott decide once the dialogue is over, and lets anyone else decide during it', () => {
    expect(speakerOnHisTurn(Npc.SERGEANT, true, false).speaker.ai.newSituation).not.toBe(Situation.IS_NEW);
    expect(speakerOnHisTurn(Npc.CONRAD, true, true).speaker.ai.newSituation).not.toBe(Situation.IS_NEW);
  });

  it('never holds Krott out of combat', () => {
    expect(speakerOnHisTurn(Npc.SERGEANT, false, true).speaker.ai.newSituation).not.toBe(Situation.IS_NEW);
  });
});

describe('a scripted walk to a destination he cannot reach (AIMain.cc ExecuteAction)', () => {
  const HERE = gridNo(80, 80);
  const SCRIPTED_NPC = 94;
  const QUOTE_RECORD = 4;
  const CLOSE = HERE + 3;
  const NOT_CLOSE = HERE + 4;
  const NO_QUOTE_RECORD = 0;

  interface Walk {
    readonly destination: number;
    readonly onSchedule?: boolean;
    readonly quoteRecord?: number;
  }

  function blockedWalk(walk: Walk) {
    const { t } = world(7);
    const calls: string[] = [];
    t.narrative = {
      ...NO_NARRATIVE_PORT,
      replaceLocationInNpcData: (profile, from, to) => calls.push(`replace ${profile} ${from} ${to}`),
      npcGotoGridNo: (profile, g, record) => calls.push(`goto ${profile} ${g} ${record}`),
    };
    t.world.structures.add(walk.destination, 0, syntheticStructure(StructureFlags.GENERIC));
    const npc = spawn(t, Team.CIV, HERE, Orders.STATIONARY);
    npc.profile = SCRIPTED_NPC;
    npc.quoteRecord = walk.quoteRecord ?? QUOTE_RECORD;
    npc.ai.checkSchedule = walk.onSchedule ?? false;
    npc.absoluteFinalDestination = walk.destination;
    npc.ai.action = AiAction.WALK;
    npc.ai.actionData = walk.destination;
    expect(executeAction(t, npc)).toBe(false);
    return { npc, calls };
  }

  it('settles for his own tile under four tiles away: his records take the tile and a walk there is queued', () => {
    const { npc, calls } = blockedWalk({ destination: CLOSE });
    expect(calls).toEqual([`replace ${SCRIPTED_NPC} ${CLOSE} ${HERE}`, `goto ${SCRIPTED_NPC} ${HERE} ${QUOTE_RECORD - 1}`]);
    expect([npc.ai.action, npc.ai.nextAction]).toEqual([AiAction.NONE, AiAction.NONE]);
  });

  it('queues the walk for record 255 when he has no quote record: the record number wraps as a UINT8', () => {
    expect(blockedWalk({ destination: CLOSE, quoteRecord: NO_QUOTE_RECORD }).calls[1]).toBe(`goto ${SCRIPTED_NPC} ${HERE} 255`);
  });

  it('waits to try again four tiles away or more, and on a schedule', () => {
    for (const walk of [blockedWalk({ destination: NOT_CLOSE }), blockedWalk({ destination: CLOSE, onSchedule: true })]) {
      expect(walk.calls).toEqual([]);
      expect(walk.npc.ai.nextAction).toBe(AiAction.WAIT);
    }
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

describe('the return to the pre-combat tile (AIMain.cc CheckForChangingOrders, Realtime.cc RTHandleAI)', () => {
  const NAMED_NPC = 94;
  const HERE = gridNo(80, 80);
  const PRE_COMBAT_TILE = gridNo(80, 86);
  const UNSET_IN_PROF_DAT = 0;

  interface Calming {
    readonly preCombatGridNo: number;
    readonly neutral?: boolean;
    readonly civilianGroup?: number;
    readonly quoteRecord?: number;
  }

  function calmingNpc(calming: Calming) {
    const { t } = world(3);
    const npc = spawn(t, Team.CIV, HERE, Orders.STATIONARY);
    Object.assign(npc, {
      profile: NAMED_NPC,
      neutral: calming.neutral ?? true,
      civilianGroup: calming.civilianGroup ?? CivilianGroup.NONE,
      quoteRecord: calming.quoteRecord ?? 0,
    });
    npc.ai.alertStatus = AlertStatus.YELLOW;
    const profile = testProfile(NAMED_NPC, { preCombatGridNo: calming.preCombatGridNo });
    t.profiles.set(NAMED_NPC, profile);
    return { t, npc, profile };
  }

  function calmDown(calming: Calming) {
    const { t, npc, profile } = calmingNpc(calming);
    decideAlertStatus(t, npc, NO_AI_HOOKS);
    expect(npc.ai.alertStatus).toBe(AlertStatus.GREEN);
    return { next: [npc.ai.nextAction, npc.ai.nextActionData], preCombatGridNo: profile.preCombatGridNo };
  }

  it('sends a neutral named civilian who calms down back to where combat found him, once', () => {
    expect(calmDown({ preCombatGridNo: PRE_COMBAT_TILE })).toEqual({
      next: [AiAction.END_COWER_AND_MOVE, PRE_COMBAT_TILE],
      preCombatGridNo: NOWHERE,
    });
  });

  it('sends him to tile 0 when no combat came yet: prof.dat starts every profile at 0, which only the combat entry reads as unset', () => {
    expect(calmDown({ preCombatGridNo: UNSET_IN_PROF_DAT })).toEqual({
      next: [AiAction.END_COWER_AND_MOVE, UNSET_IN_PROF_DAT],
      preCombatGridNo: NOWHERE,
    });
  });

  it("only stands up anyone else: no tile, not neutral, or one of the Queen's people", () => {
    const standUp = { next: [AiAction.CHANGE_STANCE, AnimHeight.STAND] };
    expect(calmDown({ preCombatGridNo: NOWHERE })).toEqual({ ...standUp, preCombatGridNo: NOWHERE });
    expect(calmDown({ preCombatGridNo: PRE_COMBAT_TILE, neutral: false })).toEqual({ ...standUp, preCombatGridNo: PRE_COMBAT_TILE });
    expect(calmDown({ preCombatGridNo: PRE_COMBAT_TILE, civilianGroup: CivilianGroup.QUEENS })).toEqual({
      ...standUp,
      preCombatGridNo: PRE_COMBAT_TILE,
    });
  });

  function returnAfterTwoVisits(quoteRecord: number) {
    const { t, npc } = calmingNpc({ preCombatGridNo: PRE_COMBAT_TILE, quoteRecord });
    const control = createAiControl();
    handleSoldierAI(t, npc, control);
    const queued = [npc.ai.nextAction, npc.ai.nextActionData];
    t.clockMs = npc.ai.counter;
    handleSoldierAI(t, npc, control);
    return { queued, walking: npc.ai.action === AiAction.WALK && npc.ai.actionData === PRE_COMBAT_TILE };
  }

  it('waits, then walks back when nothing new comes up, as for an NPC acting out a quote record', () => {
    expect(returnAfterTwoVisits(3)).toEqual({ queued: [AiAction.WALK, PRE_COMBAT_TILE], walking: true });
  });

  it('drops the walk back at the new situation his calming raised: the original spares it only while the cancelled action is END_COWER_AND_MOVE, never the case', () => {
    expect(returnAfterTwoVisits(0)).toEqual({ queued: [AiAction.WALK, PRE_COMBAT_TILE], walking: false });
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

  it('runs a merc under AI control whom the player had switched to running', () => {
    const { t } = world(3);
    const merc = spawn(t, Team.OUR, gridNo(80, 80), Orders.STATIONARY);
    merc.underAiControl = true;
    const moves = states(content.animations);
    expect(determineMovementMode(t, merc, AiAction.WALK)).toBe(moves.WALKING);
    merc.uiMovementFast = true;
    expect(determineMovementMode(t, merc, AiAction.WALK)).toBe(moves.RUNNING);
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

  it('rolls the look-around in combat only with the APs to turn', () => {
    const PATROL_ROLL_FAILS = 99;
    const SEEK_FRIEND_ROLL_FAILS = 99;
    const LOOK_ROLL_SUCCEEDS = 0;
    const lookAroundInCombat = (actionPoints: number) => {
      const { t } = world(3);
      const guard = spawn(t, Team.ENEMY, gridNo(80, 80), Orders.STATIONARY);
      t.inCombat = true;
      guard.actionPoints = actionPoints;
      const pre = new ScriptedStream([PATROL_ROLL_FAILS, SEEK_FRIEND_ROLL_FAILS, LOOK_ROLL_SUCCEEDS, Direction.NORTH]);
      Object.assign(t, { pre });
      return { action: decideActionGreen(t, guard, createAiControl().green), draws: pre.requested };
    };
    expect(lookAroundInCombat(AP.LOOK_STANDING)).toEqual({ action: AiAction.CHANGE_FACING, draws: [100, 100, 100, 8] });
    expect(lookAroundInCombat(AP.LOOK_STANDING - 1)).toEqual({ action: AiAction.NONE, draws: [100, 100] });
  });

  it('turns only to a facing his stance allows there: an escort, who may not lie down, keeps facing as he lies', () => {
    const PATROL_ROLL_FAILS = 99;
    const SEEK_FRIEND_ROLL_FAILS = 99;
    const LOOK_ROLL_SUCCEEDS = 0;
    const { t } = world(3);
    const escort = spawn(t, Team.OUR, gridNo(80, 80), Orders.STATIONARY);
    escort.state = states(content.animations).PRONE;
    t.narrative = { ...NO_NARRATIVE_PORT, isEpc: (s) => s === escort };
    Object.assign(t, { pre: new ScriptedStream([PATROL_ROLL_FAILS, SEEK_FRIEND_ROLL_FAILS, LOOK_ROLL_SUCCEEDS, Direction.NORTH]) });
    expect(decideActionGreen(t, escort, createAiControl().green)).toBe(AiAction.NONE);
    expect(escort.ai.nextAction).toBe(AiAction.NONE);
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

  it('lists the friends in merc-slot order, not by soldier id', () => {
    const { t } = world(3);
    const visitor = spawn(t, Team.ENEMY, gridNo(80, 80), Orders.SEEKENEMY);
    const firstById = spawn(t, Team.ENEMY, gridNo(80, 90), Orders.STATIONARY);
    const secondById = spawn(t, Team.ENEMY, gridNo(90, 80), Orders.STATIONARY);
    unregisterSoldier(t, firstById);
    spawn(t, Team.OUR, gridNo(40, 100), Orders.STATIONARY);
    registerSoldier(t, firstById);
    expect(t.mercSlots.indexOf(secondById)).toBeLessThan(t.mercSlots.indexOf(firstById));
    const FIRST_LISTED = 0;
    Object.assign(t, { pre: new ScriptedStream([FIRST_LISTED]) });
    expect(randomFriendWithin(t, visitor)).toBe(true);
    expect(spacesAway(visitor.ai.actionData, secondById.gridNo)).toBe(1);
  });

  it("lets a neutral civilian visit an enemy soldier but not the other way round: the civilians' side is the enemy's", () => {
    const { t } = world(3);
    const civilian = spawn(t, Team.CIV, gridNo(80, 80), Orders.SEEKENEMY);
    const soldier = spawn(t, Team.ENEMY, gridNo(80, 90), Orders.SEEKENEMY);
    expect(randomFriendWithin(t, civilian)).toBe(true);
    expect(randomFriendWithin(t, soldier)).toBe(false);
  });
});

describe('the real-time delay (Realtime.cc RealtimeDelay)', () => {
  const BROTHEL_ROOM = BrothelRooms.FIRST;

  function delayOf(civilianGroup: number, inBrothel: boolean, draw: number): number {
    const { t } = world(3);
    const s = spawn(t, Team.CIV, gridNo(80, 80), Orders.STATIONARY);
    s.civilianGroup = civilianGroup;
    t.sector = { ...BROTHEL_SECTOR, z: 0 };
    if (inBrothel) t.world.level.rooms[s.gridNo] = BROTHEL_ROOM;
    Object.assign(t, { rng: new ScriptedStream([draw]) });
    return realtimeDelay(t, s);
  }

  it("gives Kingpin's men a soldier's delay of 10 to 11 seconds, cut to a third in the brothel", () => {
    const SOLDIER_DRAW = 500;
    expect(delayOf(CivilianGroup.KINGPIN, false, SOLDIER_DRAW)).toBe(10_500);
    expect(delayOf(CivilianGroup.KINGPIN, true, SOLDIER_DRAW)).toBe(3_500);
  });

  it('gives other civilians the delay that grows with the people in the sector, in the brothel too', () => {
    const CIVILIAN_DRAW = 2;
    const ONE_MAN_IN_SECTOR = 1000;
    expect(delayOf(CivilianGroup.NONE, true, CIVILIAN_DRAW)).toBe(ONE_MAN_IN_SECTOR + 5000 + 2000 * CIVILIAN_DRAW);
  });
});

describe('the soldiers a new situation spares (AIMain.cc HandleSoldierAI, SetNewSituation)', () => {
  const SCRIPTED_NPC = 94;
  const NO_QUOTE_RECORD = 0;
  const QUOTE_RECORD = 3;

  function busyWithNewSituation(quoteRecord: number, autoBandage: boolean) {
    const { t } = world(3);
    Object.assign(t.pathEnv, { autoBandage });
    const s = spawn(t, Team.CIV, gridNo(80, 80), Orders.STATIONARY);
    s.profile = SCRIPTED_NPC;
    s.quoteRecord = quoteRecord;
    s.ai.alertStatus = AlertStatus.YELLOW;
    s.ai.action = AiAction.PENDING_ACTION;
    s.ai.actionInProgress = true;
    s.ai.newSituation = Situation.IS_NEW;
    handleSoldierAI(t, s, createAiControl());
    return { t, s };
  }

  it('keeps an NPC acting out a quote record on his action and puts him back to GREEN', () => {
    const { s } = busyWithNewSituation(QUOTE_RECORD, false);
    expect([s.ai.action, s.ai.alertStatus, s.ai.newSituation]).toEqual([AiAction.PENDING_ACTION, AlertStatus.GREEN, Situation.WAS_NEW]);
  });

  it('keeps everybody on his action during auto-bandage, and raises no new situation then', () => {
    const { t, s } = busyWithNewSituation(NO_QUOTE_RECORD, true);
    expect([s.ai.action, s.ai.alertStatus, s.ai.newSituation]).toEqual([AiAction.PENDING_ACTION, AlertStatus.YELLOW, Situation.WAS_NEW]);
    setNewSituation(t, s);
    expect(s.ai.newSituation).toBe(Situation.WAS_NEW);
  });

  it('cancels the action of anyone else', () => {
    expect(busyWithNewSituation(NO_QUOTE_RECORD, false).s.ai.action).not.toBe(AiAction.PENDING_ACTION);
  });
});
