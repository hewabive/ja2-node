import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import type { TacticalSim } from '../tactical/tactical-sim.ts';
import { MeleeKind } from './combat/melee.ts';
import type { TacticalContent } from './content.ts';
import { getNewSoldierPath } from './movement.ts';
import { NO_NARRATIVE_PORT } from './narrative/port.ts';
import { adoptSavedPendingAction } from './saved-pending-action.ts';
import { Body, MERC_GIVE_ITEM, NOBODY, type SavedPendingAction, type Soldier, Team } from './soldier.ts';
import { placeOutOfVehicle } from './vehicle-boarding.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const MERC_OPENDOOR = 0;
const MERC_OPENSTRUCT = 1;
const MERC_PICKUPITEM = 2;
const MERC_PUNCH = 3;
const MERC_KNIFEATTACK = 4;
const MERC_GIVEAID = 5;
const MERC_WAITFOROTHERSTOTRIGGER = 7;
const MERC_CUTFFENCE = 8;
const MERC_DROPBOMB = 9;
const MERC_STEAL = 10;
const MERC_TALK = 11;
const MERC_ENTER_VEHICLE = 12;
const MERC_REPAIR = 13;
const MERC_RELOADROBOT = 14;
const MERC_TAKEBLOOD = 15;
const MERC_ATTACH_CAN = 16;
const MERC_FUEL_VEHICLE = 17;
const OUT_OF_THE_VEHICLE = gridNo(80, 80);
const WALKED_TO = gridNo(80, 83);
const TARGET_TILE = gridNo(81, 83);
const SAVED_FACING = Direction.EAST;
const TALK_TARGET = 61;

function saved(action: number, giveTarget = NOBODY): SavedPendingAction {
  return { action, giveTarget, direction: SAVED_FACING, animCount: 0 };
}

function animationOf(sim: TacticalSim, s: Soldier): string | undefined {
  return sim.state.content.animations.controls[s.state]?.id;
}

function stepUntil(sim: TacticalSim, done: () => boolean, ticks = 20_000): void {
  for (let k = 0; k < ticks && !done(); k++) sim.step();
}

function outOfTheVehicle(sim: TacticalSim, action: SavedPendingAction): Soldier {
  const merc = spawnSoldier(sim, 0, Team.OUR, OUT_OF_THE_VEHICLE, Direction.SOUTH);
  const vehicle = spawnSoldier(sim, 2, Team.OUR, gridNo(78, 80), Direction.SOUTH);
  merc.savedPendingAction = action;
  merc.pendingActionData2 = TARGET_TILE;
  placeOutOfVehicle(sim.state, merc, vehicle, OUT_OF_THE_VEHICLE);
  return merc;
}

function walkWithoutAnOrder(sim: TacticalSim, s: Soldier): void {
  expect(getNewSoldierPath(sim.state, s, WALKED_TO, s.uiMovementMode, 0, false)).toBe(true);
  stepUntil(sim, () => s.gridNo === WALKED_TO && s.pathSize === 0);
}

describe("a native save's pending action at the end of a walk no order started (Overhead.cc:817, Soldier.cc:104)", () => {
  it('runs a saved give from its saved tile and facing after the merc got out of a vehicle: nothing to hand over, as pTempObject comes back NULL', () => {
    const sim = newCombatSim(content);
    const mate = spawnSoldier(sim, 1, Team.OUR, TARGET_TILE, Direction.WEST);
    const merc = outOfTheVehicle(sim, saved(MERC_GIVE_ITEM, mate.id));
    walkWithoutAnOrder(sim, merc);
    expect([animationOf(sim, merc), merc.direction, merc.savedPendingAction, merc.heldGiveAction]).toEqual([
      'GIVE_ITEM',
      SAVED_FACING,
      null,
      null,
    ]);
  });

  it('runs a saved punch in the saved facing at the target the saved sTargetGridNo holds', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 1, Team.OUR, TARGET_TILE, Direction.WEST);
    const merc = outOfTheVehicle(sim, saved(MERC_PUNCH));
    merc.targetGridNo = TARGET_TILE;
    walkWithoutAnOrder(sim, merc);
    expect([animationOf(sim, merc), merc.direction, merc.savedPendingAction, merc.pendingMelee]).toEqual([
      'PUNCH',
      SAVED_FACING,
      null,
      null,
    ]);
  });

  it('stands the merc at the end of a saved robot reload, which has no ammo to load, and the action is gone (deviation "Saved robot reload")', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 1, Team.OUR, TARGET_TILE, Direction.WEST, { body: Body.ROBOTNOWEAPON });
    const merc = outOfTheVehicle(sim, saved(MERC_RELOADROBOT));
    walkWithoutAnOrder(sim, merc);
    expect([animationOf(sim, merc), merc.savedPendingAction, merc.pendingRobotReload]).toEqual(['STANDING', null, null]);
  });

  it('starts the conversation a saved talk walked up to, with the soldier its uiPendingActionData1 names', () => {
    const sim = newCombatSim(content);
    const talks: [number, number][] = [];
    sim.state.narrative = { ...NO_NARRATIVE_PORT, startTalking: (s, target) => talks.push([s.id, target]) };
    const merc = outOfTheVehicle(sim, saved(MERC_TALK));
    merc.pendingActionData1 = TALK_TARGET;
    walkWithoutAnOrder(sim, merc);
    expect([talks, merc.savedPendingAction]).toEqual([[[merc.id, TALK_TARGET]], null]);
  });
});

describe('the typed record a saved pending action becomes (Soldier.cc handlePendingAction)', () => {
  function adopted(action: SavedPendingAction): Soldier {
    const sim = newCombatSim(content);
    const s = spawnSoldier(sim, 0, Team.OUR, OUT_OF_THE_VEHICLE, Direction.SOUTH);
    s.savedPendingAction = action;
    s.pendingActionData1 = TALK_TARGET;
    s.pendingActionData2 = TARGET_TILE;
    adoptSavedPendingAction(s);
    return s;
  }

  it('takes sPendingActionData2 and bPendingActionData3 for the melee, first aid and tile tool actions, and the count for a melee', () => {
    const counted = { ...saved(MERC_KNIFEATTACK), animCount: 2 };
    const melee = [saved(MERC_PUNCH), counted, saved(MERC_STEAL)].map((a) => adopted(a).pendingMelee);
    expect(melee).toEqual([
      { kind: MeleeKind.PUNCH, targetGridNo: TARGET_TILE, direction: SAVED_FACING, animCount: 0 },
      { kind: MeleeKind.BLADE, targetGridNo: TARGET_TILE, direction: SAVED_FACING, animCount: 2 },
      { kind: MeleeKind.STEAL, targetGridNo: TARGET_TILE, direction: SAVED_FACING, animCount: 0 },
    ]);
    expect(adopted(saved(MERC_GIVEAID)).pendingAid).toEqual({ targetGridNo: TARGET_TILE, direction: SAVED_FACING });
    expect(adopted(saved(MERC_RELOADROBOT)).pendingRobotReload).toEqual({ targetGridNo: TARGET_TILE, direction: SAVED_FACING });
    const tools = [MERC_CUTFFENCE, MERC_ENTER_VEHICLE, MERC_REPAIR, MERC_TAKEBLOOD, MERC_ATTACH_CAN, MERC_FUEL_VEHICLE];
    expect(tools.map((code) => adopted(saved(code)).pendingTileTool?.tool)).toEqual([
      'cutFence',
      'enterVehicle',
      'repair',
      'takeBlood',
      'attachCan',
      'refuel',
    ]);
    expect(adopted(saved(MERC_REPAIR)).pendingTileTool).toEqual({ tool: 'repair', gridNo: TARGET_TILE, direction: SAVED_FACING });
  });

  it('holds a saved give as the give held after one on the spot, and takes a bomb drop and a talk', () => {
    expect(adopted(saved(MERC_GIVE_ITEM, 1)).heldGiveAction).toEqual({
      target: 1,
      targetGridNo: TARGET_TILE,
      direction: SAVED_FACING,
      animCount: 0,
    });
    expect([adopted(saved(MERC_DROPBOMB)).pendingDropBomb, adopted(saved(MERC_TALK)).pendingTalk]).toEqual([true, TALK_TARGET]);
  });

  it('leaves saved the doors, the containers, the pickup and the wait for a trigger', () => {
    const kept = [MERC_OPENDOOR, MERC_OPENSTRUCT, MERC_PICKUPITEM, MERC_WAITFOROTHERSTOTRIGGER];
    expect(kept.map((code) => adopted(saved(code)).savedPendingAction?.action)).toEqual(kept);
  });
});
