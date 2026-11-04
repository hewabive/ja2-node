import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { itemId, objectOf } from '../../../../tests/support/explosives.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Orientation } from '../../../content/formats/jsd.ts';
import { Direction, gridNo, WORLD_COLS } from '../../../content/world/grid.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { syntheticStructure } from '../../../content/world/synthetic.ts';
import { createItem, ObjectFlags } from '../../items/object.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import {
  Detonator,
  ItemAction,
  PANIC_FREQUENCY,
  setActionValue,
  setBombItem,
  setDetonator,
  setFrequency,
  setTolerance,
} from '../bombs/bomb-object.ts';
import { activateSwitchInGridNo } from '../bombs/bomb-queue.ts';
import { handleSoldierDeath } from '../combat/death.ts';
import { soldierCollapse } from '../combat/hit.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { Profile } from '../narrative/constants.ts';
import { AlertStatus, Orders, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { addItemToPool, Visibility, type WorldItem, WorldItemFlags } from '../world-items.ts';
import { AiAction } from './actions.ts';
import { type CombatDeciderHooks, decideActionBlack, decideActionRed } from './combat-decide.ts';
import { executeAction } from './control.ts';
import { checkForChangingOrders } from './decide.ts';
import {
  closestPanicTrigger,
  initPanicSystem,
  NO_PANIC_TRIGGER,
  PanicFlags,
  percentEnemiesKilled,
  popPanicKeys,
  pushPanicKeys,
} from './panic-triggers.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const NO_GREEN_DECISION: CombatDeciderHooks = { decideActionGreen: () => AiAction.NONE, npcDoesAct: () => {} };
const SWITCH_AT = gridNo(80, 70);
const TRIGGER_SOUTH_OF_SWITCH = SWITCH_AT + WORLD_COLS;
const SECOND_SWITCH_AT = gridNo(100, 70);
const TRIGGER_EAST_OF_SECOND = SECOND_SWITCH_AT + 1;
const TIXA = { x: 9, y: 10, z: 0 } as const;
const MERC_AT = gridNo(60, 110);
const SECOND_PANIC_FREQUENCY = 126;
const THIRD_PANIC_FREQUENCY = 125;
const ENEMY = 20;
const WOUNDED = 10;

interface PanicSwitch {
  readonly at: number;
  readonly frequency: number;
  readonly tolerance?: number;
  readonly alarm?: boolean;
  readonly facing?: number;
}

function addSwitchStructure(t: TacticalState, at: number, facing: number): void {
  t.world.structures.add(at, 0, syntheticStructure(StructureFlags.SWITCH | StructureFlags.OPENABLE, facing));
}

function placePanicSwitch(
  t: TacticalState,
  { at, frequency, tolerance = 0, alarm = false, facing = Orientation.OUTSIDE_LEFT }: PanicSwitch,
): void {
  addSwitchStructure(t, at, facing);
  const o = objectOf(t, 'SWITCH');
  setDetonator(o, Detonator.SWITCH);
  setFrequency(o, frequency);
  setTolerance(o, tolerance);
  if (alarm) o.flags |= ObjectFlags.ALARM_TRIGGER;
  if (!addItemToPool(t, at, o, Visibility.BURIED, 0, WorldItemFlags.ARMED_BOMB)) throw new Error('cannot place the switch');
}

function placePanicItem(t: TacticalState, at: number, action: number, frequency = PANIC_FREQUENCY, bombItem = 'NOTHING'): WorldItem {
  const o = objectOf(t, 'ACTION_ITEM');
  setDetonator(o, Detonator.REMOTE);
  setFrequency(o, frequency);
  setActionValue(o, action);
  if (bombItem !== 'NOTHING') setBombItem(o, itemId(t, bombItem));
  const item = addItemToPool(t, at, o, Visibility.BURIED, 0, WorldItemFlags.ARMED_BOMB);
  if (!item) throw new Error('cannot place the action item');
  return item;
}

function enemyAt(sim: TacticalSim, id: number, at: number): Soldier {
  return spawnSoldier(sim, id, Team.ENEMY, at, Direction.SOUTH);
}

function stationWithTrigger(
  tolerance = 0,
  placeMore: (t: TacticalState) => void = () => {},
): { readonly sim: TacticalSim; readonly t: TacticalState } {
  const sim = newCombatSim(content);
  const t = sim.state;
  spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.NORTH);
  placePanicSwitch(t, { at: SWITCH_AT, frequency: PANIC_FREQUENCY, tolerance });
  placePanicItem(t, gridNo(120, 120), ItemAction.KLAXON);
  placeMore(t);
  initPanicSystem(t);
  return { sim, t };
}

function radioRedAlert(t: TacticalState, radioMan: Soldier): void {
  radioMan.ai.action = AiAction.RED_ALERT;
  executeAction(t, radioMan);
}

describe('panic triggers and bombs found at a sector entry (World_Items.cc FindPanicBombsAndTriggers, PanicButtons.cc InitPanicSystem)', () => {
  it('puts a trigger south of a left-facing panic switch and east of any other, with its tolerance and alarm flag, and counts every other armed item on a panic frequency as a bomb', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    placePanicItem(t, gridNo(90, 90), ItemAction.CLOSE_DOOR);
    placePanicSwitch(t, { at: SWITCH_AT, frequency: PANIC_FREQUENCY, tolerance: 35 });
    placePanicSwitch(t, { at: SECOND_SWITCH_AT, frequency: SECOND_PANIC_FREQUENCY, alarm: true, facing: Orientation.OUTSIDE_RIGHT });
    initPanicSystem(t);
    expect(t.panic.flags).toBe(PanicFlags.BOMBS_HERE | PanicFlags.TRIGGERS_HERE);
    expect(t.panic.triggers).toEqual([
      { gridNo: TRIGGER_SOUTH_OF_SWITCH, isAlarm: false, tolerance: 35 },
      { gridNo: TRIGGER_EAST_OF_SECOND, isAlarm: true, tolerance: 0 },
      { gridNo: -1, isAlarm: false, tolerance: 0 },
    ]);
  });

  it('stops at the third trigger: a panic bomb in a later bomb slot does not count', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    placePanicSwitch(t, { at: SWITCH_AT, frequency: THIRD_PANIC_FREQUENCY });
    placePanicItem(t, gridNo(90, 90), ItemAction.BLOW_UP, PANIC_FREQUENCY, 'C4');
    initPanicSystem(t);
    expect(t.panic.flags).toBe(PanicFlags.TRIGGERS_HERE);
  });

  it('forgets the chosen one: a sector entry starts without one', () => {
    const { sim, t } = stationWithTrigger();
    t.panic.chosenOne = enemyAt(sim, ENEMY, gridNo(80, 90));
    initPanicSystem(t);
    expect(t.panic.chosenOne).toBeNull();
  });
});

describe('who may go for a trigger (PanicButtons.cc ClosestPanicTrigger, PercentEnemiesKilled)', () => {
  it('holds a trigger back until the army has lost its tolerance in percent of its men: one dead of three opens 33, not 34', () => {
    const { sim, t } = stationWithTrigger(34);
    const guard = enemyAt(sim, ENEMY, gridNo(80, 90));
    enemyAt(sim, ENEMY + 1, gridNo(82, 90));
    t.panic.armyGuysKilled = 1;
    expect(percentEnemiesKilled(t)).toBe(33);
    expect(closestPanicTrigger(t, guard)).toBe(NO_PANIC_TRIGGER);
    const trigger = t.panic.triggers[0];
    if (trigger) trigger.tolerance = 33;
    expect(closestPanicTrigger(t, guard)).toBe(0);
  });

  it('counts each dead army soldier, and the death of the chosen one frees the choice', () => {
    const { sim, t } = stationWithTrigger();
    const guard = enemyAt(sim, ENEMY, gridNo(80, 90));
    const militia = spawnSoldier(sim, 60, Team.MILITIA, gridNo(70, 100), Direction.SOUTH);
    t.panic.chosenOne = guard;
    militia.life = 0;
    handleSoldierDeath(t, militia);
    expect([t.panic.armyGuysKilled, t.panic.chosenOne]).toEqual([0, guard]);
    guard.life = 0;
    handleSoldierDeath(t, guard);
    expect([t.panic.armyGuysKilled, t.panic.chosenOne]).toEqual([1, null]);
  });

  it('lets only the Warden go for a trigger in Tixa, and only for the first one still armed however close the second', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    t.sector = TIXA;
    placePanicSwitch(t, { at: SWITCH_AT, frequency: PANIC_FREQUENCY });
    placePanicSwitch(t, { at: SECOND_SWITCH_AT, frequency: SECOND_PANIC_FREQUENCY });
    initPanicSystem(t);
    const guard = enemyAt(sim, ENEMY, gridNo(100, 75));
    const warden = spawnSoldier(sim, 120, Team.CIV, gridNo(100, 75), Direction.SOUTH, { profile: Profile.WARDEN });
    expect([closestPanicTrigger(t, guard), closestPanicTrigger(t, warden)]).toEqual([NO_PANIC_TRIGGER, 0]);
    const first = t.panic.triggers[0];
    if (first) first.gridNo = -1;
    expect(closestPanicTrigger(t, warden)).toBe(1);
  });
});

describe("the army's first red alert sends its closest soldier to the trigger (AIMain.cc HandleInitialRedAlert, PanicButtons.cc MakeClosestEnemyChosenOne)", () => {
  it('chooses the soldier with the shortest walk, puts him on red alert with keys to every door, and he heads for the trigger', () => {
    const { sim, t } = stationWithTrigger();
    const radioMan = enemyAt(sim, ENEMY, gridNo(80, 120));
    const far = enemyAt(sim, ENEMY + 1, gridNo(80, 95));
    const near = enemyAt(sim, ENEMY + 2, gridNo(80, 85));
    radioRedAlert(t, radioMan);
    expect(t.panic.chosenOne).toBe(near);
    expect([near.ai.alertStatus, near.hasKeys, far.ai.alertStatus, far.hasKeys]).toEqual([AlertStatus.RED, 1, AlertStatus.GREEN, 0]);
    expect(decideActionRed(t, near, NO_GREEN_DECISION)).toBe(AiAction.GET_CLOSER);
    expect([near.ai.actionData, near.pathStored]).toEqual([TRIGGER_SOUTH_OF_SWITCH, true]);
  });

  it('passes over a soldier who sees one of ours, is in shock, stands on a roof or is out of breath', () => {
    const { sim, t } = stationWithTrigger();
    const radioMan = enemyAt(sim, ENEMY, gridNo(80, 120));
    const seeing = enemyAt(sim, ENEMY + 1, gridNo(80, 72));
    const shocked = enemyAt(sim, ENEMY + 2, gridNo(80, 74));
    const winded = enemyAt(sim, ENEMY + 3, gridNo(80, 76));
    const next = enemyAt(sim, ENEMY + 4, gridNo(80, 100));
    seeing.ai.oppCount = 1;
    shocked.shock = 3;
    winded.breath = 9;
    radioRedAlert(t, radioMan);
    expect(t.panic.chosenOne).toBe(next);
  });

  it('radios an initial alert again once the army knows of us while nobody has been sent', () => {
    const { sim, t } = stationWithTrigger(50);
    const radioMan = enemyAt(sim, ENEMY, gridNo(80, 120));
    const guard = enemyAt(sim, ENEMY + 1, gridNo(80, 85));
    radioRedAlert(t, radioMan);
    expect(t.panic.chosenOne).toBeNull();
    t.panic.armyGuysKilled = 2;
    radioRedAlert(t, radioMan);
    expect(t.panic.chosenOne).toBe(guard);
  });
});

describe('the chosen one at the trigger (PanicButtons.cc PanicAI, AIMain.cc ExecuteAction, Soldier_Ani.cc codes 762 and 499)', () => {
  function chosenOnTrigger(): { readonly sim: TacticalSim; readonly t: TacticalState; readonly puller: Soldier } {
    const { sim, t } = stationWithTrigger(0, (station) =>
      placePanicItem(station, gridNo(130, 130), ItemAction.BLOW_UP, PANIC_FREQUENCY, 'C4'),
    );
    const puller = enemyAt(sim, ENEMY, TRIGGER_SOUTH_OF_SWITCH);
    radioRedAlert(t, enemyAt(sim, ENEMY + 1, gridNo(80, 120)));
    t.inCombat = true;
    return { sim, t, puller };
  }

  it('turns to the switch, plays AI_PULL_SWITCH for 2 APs, sets off the frequency at code 762, gives the keys back and waits for the bombs', () => {
    const { sim, t, puller } = chosenOnTrigger();
    expect([t.panic.chosenOne, puller.hasKeys]).toEqual([puller, 1]);
    const action = decideActionRed(t, puller, NO_GREEN_DECISION);
    expect([action, puller.ai.actionData]).toEqual([AiAction.PULL_TRIGGER, TRIGGER_SOUTH_OF_SWITCH]);
    const actionPoints = puller.actionPoints;
    puller.ai.action = action;
    expect(executeAction(t, puller)).toBe(true);
    expect(t.content.animations.controls[puller.state]?.id).toBe('AI_PULL_SWITCH');
    expect(t.gameEvents).toContainEqual({ kind: 'desiredDirection', soldier: puller.id, direction: Direction.NORTH });
    expect([puller.actionPoints, t.panic.chosenOne]).toEqual([actionPoints - 2, null]);
    for (let k = 0; k < 200 && !t.explosionQueue.active; k++) sim.step();
    expect(t.explosionQueue.person).toBe(puller);
    expect([t.panic.triggers[0]?.gridNo, t.panic.flags, puller.hasKeys]).toEqual([-1, 0, 0]);
    for (let k = 0; k < 200 && t.content.animations.controls[puller.state]?.id === 'AI_PULL_SWITCH'; k++) sim.step();
    expect([t.explosionQueue.active, puller.ai.action]).toEqual([true, AiAction.PULL_TRIGGER]);
    for (let k = 0; k < 2000 && t.explosionQueue.active; k++) sim.step();
    expect(puller.ai.action).toBe(AiAction.NONE);
  });

  it('waits a turn on the trigger without the APs to pull it, and is replaced when the trigger is out of reach', () => {
    const { sim, t, puller } = chosenOnTrigger();
    puller.actionPoints = 1;
    expect(decideActionRed(t, puller, NO_GREEN_DECISION)).toBe(AiAction.NONE);
    const other = enemyAt(sim, ENEMY + 2, gridNo(80, 90));
    puller.actionPoints = 20;
    const trigger = t.panic.triggers[0];
    if (trigger) trigger.gridNo = gridNo(81, 90);
    t.world.structures.add(gridNo(81, 90), 0, syntheticStructure(StructureFlags.GENERIC | StructureFlags.BLOCKSMOVES));
    expect(decideActionRed(t, puller, NO_GREEN_DECISION)).not.toBe(AiAction.GET_CLOSER);
    expect(t.panic.chosenOne).not.toBe(puller);
    expect(other.hasKeys).toBe(t.panic.chosenOne === other ? 1 : 0);
  });

  it('a collapsing chosen one is replaced, unless he was sent to an alarm trigger', () => {
    const { sim, t, puller } = chosenOnTrigger();
    const other = enemyAt(sim, ENEMY + 2, gridNo(80, 90));
    puller.life = WOUNDED;
    soldierCollapse(t, puller);
    expect(t.panic.chosenOne).toBe(other);
    const alarm = t.panic.triggers[0];
    if (alarm) alarm.isAlarm = true;
    other.life = WOUNDED;
    soldierCollapse(t, other);
    expect(t.panic.chosenOne).toBe(other);
  });
});

describe('the remote bomb trigger (PanicButtons.cc PanicAI, AIMain.cc ExecuteAction AI_ACTION_USE_DETONATOR)', () => {
  it('an alerted soldier holding one sets off the first panic frequency at once for 2 APs; a panic door closer counts as a bomb', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const closer = placePanicItem(t, gridNo(90, 90), ItemAction.CLOSE_DOOR);
    placePanicSwitch(t, { at: SWITCH_AT, frequency: PANIC_FREQUENCY, tolerance: 100 });
    initPanicSystem(t);
    const guard = enemyAt(sim, ENEMY, gridNo(80, 100));
    guard.inv[InvSlot.BIGPOCK1] = createItem(content.items, itemId(t, 'REMOTEBOMBTRIGGER'), 100);
    t.inCombat = true;
    expect(decideActionRed(t, guard, NO_GREEN_DECISION)).not.toBe(AiAction.USE_DETONATOR);
    t.perception.awareOfOpposition[Team.ENEMY] = true;
    guard.ai.action = decideActionRed(t, guard, NO_GREEN_DECISION);
    expect(guard.ai.action).toBe(AiAction.USE_DETONATOR);
    const actionPoints = guard.actionPoints;
    expect(executeAction(t, guard)).toBe(false);
    expect([guard.actionPoints, guard.ai.action, guard.ai.lastAction]).toEqual([actionPoints - 2, AiAction.NONE, AiAction.USE_DETONATOR]);
    expect([t.panic.flags, t.panic.triggers[0]?.gridNo]).toEqual([0, -1]);
    expect(t.worldBombs[t.explosionQueue.entries[0]?.bomb ?? -1]?.item).toBe(closer);
  });
});

describe('a soldier in sight of us volunteers for a trigger close by (DecideAction.cc DecideActionBlack, PanicButtons.cc PossiblyMakeThisEnemyChosenOne)', () => {
  it('within 10 tiles he runs to it; an alarm trigger is left alone once the army knows of us', () => {
    const { sim, t } = stationWithTrigger();
    const guard = enemyAt(sim, ENEMY, gridNo(80, 79));
    const tooFar = enemyAt(sim, ENEMY + 1, gridNo(80, 81));
    expect(decideActionBlack(t, tooFar, NO_GREEN_DECISION)).not.toBe(AiAction.GET_CLOSER);
    expect(t.panic.chosenOne).toBeNull();
    const alarm = t.panic.triggers[0];
    if (alarm) alarm.isAlarm = true;
    t.perception.awareOfOpposition[Team.ENEMY] = true;
    decideActionBlack(t, guard, NO_GREEN_DECISION);
    expect(t.panic.chosenOne).toBeNull();
    t.perception.awareOfOpposition[Team.ENEMY] = false;
    expect(decideActionBlack(t, guard, NO_GREEN_DECISION)).toBe(AiAction.GET_CLOSER);
    expect([t.panic.chosenOne, guard.hasKeys, guard.ai.actionData]).toEqual([guard, 1, TRIGGER_SOUTH_OF_SWITCH]);
  });
});

describe('the red radio chance with a panic trigger here (DecideAction.cc DecideActionRed)', () => {
  it('radios as for a first alert while a trigger waits for someone to send, though the army knows of us and nothing is new', () => {
    const { sim, t } = stationWithTrigger();
    const guard = enemyAt(sim, ENEMY, gridNo(80, 100));
    enemyAt(sim, ENEMY + 1, gridNo(70, 100));
    guard.ai.alertStatus = AlertStatus.RED;
    guard.ai.orders = Orders.STATIONARY;
    t.perception.awareOfOpposition[Team.ENEMY] = true;
    const pre = new ScriptedStream([], 99);
    Object.assign(t, { pre });
    decideActionRed(t, guard, NO_GREEN_DECISION);
    expect(pre.requested[0]).toBe(100);
    t.panic.chosenOne = guard;
    const quiet = new ScriptedStream([], 99);
    Object.assign(t, { pre: quiet });
    const other = enemyAt(sim, ENEMY + 2, gridNo(60, 100));
    other.ai.alertStatus = AlertStatus.RED;
    decideActionRed(t, other, NO_GREEN_DECISION);
    expect(quiet.requested).not.toContain(100);
  });

  it('ignores the morale while the army does not know of us', () => {
    const { sim, t } = stationWithTrigger(100);
    const guard = enemyAt(sim, ENEMY, gridNo(80, 100));
    enemyAt(sim, ENEMY + 1, gridNo(70, 100));
    guard.ai.alertStatus = AlertStatus.RED;
    guard.ai.orders = Orders.STATIONARY;
    const pre = new ScriptedStream([60], 99);
    Object.assign(t, { pre });
    expect(decideActionRed(t, guard, NO_GREEN_DECISION)).toBe(AiAction.RED_ALERT);
    t.panic.flags = 0;
    const withMorale = new ScriptedStream([60], 99);
    Object.assign(t, { pre: withMorale });
    expect(decideActionRed(t, guard, NO_GREEN_DECISION)).not.toBe(AiAction.RED_ALERT);
  });
});

describe('the Warden (AIMain.cc CheckForChangingOrders)', () => {
  it('sends himself to the first trigger of Tixa when he goes on red alert', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    t.sector = TIXA;
    placePanicSwitch(t, { at: SWITCH_AT, frequency: PANIC_FREQUENCY });
    initPanicSystem(t);
    enemyAt(sim, ENEMY, gridNo(80, 80));
    const warden = spawnSoldier(sim, 120, Team.CIV, gridNo(80, 100), Direction.SOUTH, { profile: Profile.WARDEN });
    warden.ai.alertStatus = AlertStatus.RED;
    checkForChangingOrders(t, warden);
    expect([t.panic.chosenOne, warden.hasKeys]).toEqual([warden, 1]);
    expect(decideActionRed(t, warden, NO_GREEN_DECISION)).toBe(AiAction.GET_CLOSER);
  });
});

describe('a panic switch pulled by one of ours (Explosion_Control.cc ActivateSwitchInGridNo)', () => {
  it('sets off its frequency but leaves the trigger armed for the army', () => {
    const { sim, t } = stationWithTrigger();
    const merc = t.soldiers[0];
    if (!merc) throw new Error('no merc');
    activateSwitchInGridNo(t, merc, SWITCH_AT);
    expect(t.explosionQueue.active).toBe(true);
    expect([t.panic.triggers[0]?.gridNo, t.panic.flags]).toEqual([
      TRIGGER_SOUTH_OF_SWITCH,
      PanicFlags.BOMBS_HERE | PanicFlags.TRIGGERS_HERE,
    ]);
    expect(enemyAt(sim, ENEMY, gridNo(80, 90)).ai.alertStatus).toBe(AlertStatus.GREEN);
  });
});

describe('the keys given for a panic path (PanicButtons.cc bHasKeys)', () => {
  it('pushes a set bit onto the INT8 and pops it back, wrapping past 127 into a negative byte that still opens doors', () => {
    const sim = newCombatSim(content);
    const guard = enemyAt(sim, ENEMY, gridNo(80, 90));
    pushPanicKeys(guard);
    expect(guard.hasKeys).toBe(1);
    popPanicKeys(guard);
    expect(guard.hasKeys).toBe(0);
    guard.hasKeys = 64;
    pushPanicKeys(guard);
    expect(guard.hasKeys).toBe(-127);
    popPanicKeys(guard);
    expect(guard.hasKeys).toBe(-64);
  });
});

describe('a sector without panic bombs', () => {
  it('leaves a remote bomb trigger in the pocket of an alerted soldier', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const guard = enemyAt(sim, ENEMY, gridNo(80, 90));
    guard.inv[InvSlot.BIGPOCK1] = createItem(content.items, itemId(t, 'REMOTEBOMBTRIGGER'), 100);
    t.perception.awareOfOpposition[Team.ENEMY] = true;
    expect(decideActionRed(t, guard, NO_GREEN_DECISION)).not.toBe(AiAction.USE_DETONATOR);
  });
});
