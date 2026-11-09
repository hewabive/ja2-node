import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Orientation } from '../../content/formats/jsd.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { has, StructureFlags, type StructureInstance } from '../../content/world/structures.ts';
import { syntheticStructure } from '../../content/world/synthetic.ts';
import { createItem } from '../items/object.ts';
import type { TacticalSim } from '../tactical/tactical-sim.ts';
import { MeleeKind } from './combat/melee.ts';
import type { TacticalContent } from './content.ts';
import { doorApCost } from './doors/door-actions.ts';
import { OPEN_STRUCT_ACTION } from './doors/door-command.ts';
import { HandleDoor } from './doors/door-table.ts';
import { apsToMovePlusAction } from './give.ts';
import { getNewSoldierPath } from './movement.ts';
import { NO_NARRATIVE_PORT } from './narrative/port.ts';
import { adoptSavedPendingAction } from './saved-pending-action.ts';
import { Body, MERC_GIVE_ITEM, NOBODY, type SavedPendingAction, type Soldier, Team } from './soldier.ts';
import { placeOutOfVehicle } from './vehicle-boarding.ts';
import { addItemToPool, Visibility } from './world-items.ts';

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
  return { action, giveTarget, data3: SAVED_FACING, animCount: 0 };
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

const AWAY_FROM_THE_WALK = gridNo(83, 83);
const RAISED_ITEM_HEIGHT = 40;
const ON_A_STRUCTURE = 1;
const NO_SUCH_ITEM_INDEX = 9999;

function openablePair(flags: number) {
  const closed = { ...syntheticStructure(StructureFlags.OPENABLE | flags, Orientation.INSIDE_LEFT), number: 0, partnerDelta: 1 };
  const open = {
    ...syntheticStructure(StructureFlags.OPENABLE | StructureFlags.OPEN | flags, Orientation.INSIDE_LEFT),
    number: 1,
    partnerDelta: -1,
  };
  return { closed, file: { structureCount: 2, auxData: null, tileLocations: [], structures: [closed, open] } };
}

function addOpenable(sim: TacticalSim, g: number, flags: number): StructureInstance {
  const { closed, file } = openablePair(flags);
  const placed = sim.state.world.structures.add(g, 0, closed, undefined, file);
  if (!placed) throw new Error('no openable');
  return placed;
}

function isOpen(sim: TacticalSim, g: number): boolean {
  return has(sim.state.world.structures.find(g, StructureFlags.OPENABLE)?.flags ?? 0, StructureFlags.OPEN);
}

function savedOpening(sim: TacticalSim, action: number, at: number, structureId: number): Soldier {
  const merc = outOfTheVehicle(sim, saved(action));
  merc.pendingActionData1 = structureId;
  merc.pendingActionData2 = at;
  merc.doorHandleCode = HandleDoor.OPEN;
  return merc;
}

function animationsUntilIdle(sim: TacticalSim, s: Soldier): string[] {
  const seen: string[] = [];
  for (let k = 0; k < 20_000 && !sim.isIdle(); k++) {
    sim.step();
    const id = animationOf(sim, s);
    if (id && seen.at(-1) !== id) seen.push(id);
  }
  return seen;
}

function canteen(sim: TacticalSim) {
  const items = sim.state.content.items;
  return createItem(items, items.byName.get('CANTEEN')?.index ?? -1, 100);
}

function canteensOf(sim: TacticalSim, s: Soldier): number {
  const index = sim.state.content.items.byName.get('CANTEEN')?.index;
  return s.inv.filter((o) => o.item === index).reduce((count, o) => count + o.count, 0);
}

function savedPickup(sim: TacticalSim, itemsAt: number, zLevel: number): Soldier {
  const merc = outOfTheVehicle(sim, { ...saved(MERC_PICKUPITEM), data3: zLevel });
  merc.pendingActionData1 = NO_SUCH_ITEM_INDEX;
  merc.pendingActionData2 = WALKED_TO;
  merc.pendingActionData4 = itemsAt;
  return merc;
}

describe("a native save's door, container or pickup at the end of a walk no order started (Overhead.cc:821, Soldier.cc:106)", () => {
  it('opens the door or container its saved structure ID names at sPendingActionData2 from wherever the walk ends, in the saved facing, as the original never checks the tile', () => {
    for (const [action, flags] of [
      [MERC_OPENDOOR, StructureFlags.DOOR],
      [MERC_OPENSTRUCT, 0],
    ] as const) {
      const sim = newCombatSim(content);
      const openable = addOpenable(sim, AWAY_FROM_THE_WALK, flags);
      const merc = savedOpening(sim, action, AWAY_FROM_THE_WALK, openable.id);
      walkWithoutAnOrder(sim, merc);
      runUntilIdle(sim);
      expect([isOpen(sim, AWAY_FROM_THE_WALK), merc.gridNo, merc.direction, merc.savedPendingAction, merc.pendingDoorAction]).toEqual([
        true,
        WALKED_TO,
        SAVED_FACING,
        null,
        null,
      ]);
    }
  });

  it('plays the opening of a saved door whose structure ID names no structure at its tile, as a load in another process numbers the structures anew, and the door stays shut (Interactive_Tiles.cc:98)', () => {
    const sim = newCombatSim(content);
    const door = addOpenable(sim, AWAY_FROM_THE_WALK, StructureFlags.DOOR);
    const merc = savedOpening(sim, MERC_OPENDOOR, AWAY_FROM_THE_WALK, door.id + 1);
    walkWithoutAnOrder(sim, merc);
    expect(animationsUntilIdle(sim, merc)).toContain('OPEN_DOOR');
    expect([isOpen(sim, AWAY_FROM_THE_WALK), merc.savedPendingAction, merc.pendingDoorAction]).toEqual([false, null, null]);
  });

  it('halts a merc short of the APs of his saved door handle code in combat, keeping the action, and opens once he can pay (Overhead.cc:837, :863)', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const crate = addOpenable(sim, AWAY_FROM_THE_WALK, 0);
    const merc = savedOpening(sim, MERC_OPENSTRUCT, AWAY_FROM_THE_WALK, crate.id);
    merc.doorHandleCode = HandleDoor.OPEN_DIAG_LONG;
    t.inCombat = true;
    merc.actionPoints = apsToMovePlusAction(t, merc, WALKED_TO, doorApCost(HandleDoor.OPEN_DIAG_LONG) - 1);
    walkWithoutAnOrder(sim, merc);
    runUntilIdle(sim);
    expect([isOpen(sim, AWAY_FROM_THE_WALK), merc.noAPToFinishMove, merc.pendingDoorAction?.gridNo]).toEqual([
      false,
      true,
      AWAY_FROM_THE_WALK,
    ]);
    merc.actionPoints = doorApCost(HandleDoor.OPEN_DIAG_LONG);
    merc.noAPToFinishMove = false;
    runUntilIdle(sim);
    expect([isOpen(sim, AWAY_FROM_THE_WALK), merc.pendingDoorAction]).toEqual([true, null]);
  });

  it('steps onto the tile a saved pickup names in uiPendingActionData4 and picks up its pile there, whatever item index it saved: HandleSoldierPickupItem reads the index for another team only', () => {
    const sim = newCombatSim(content);
    addItemToPool(sim.state, TARGET_TILE, canteen(sim), Visibility.VISIBLE, 0);
    const merc = savedPickup(sim, TARGET_TILE, 0);
    walkWithoutAnOrder(sim, merc);
    runUntilIdle(sim);
    expect([merc.gridNo, canteensOf(sim, merc), sim.state.worldItems.length, merc.savedPendingAction, merc.pendingPickup]).toEqual([
      TARGET_TILE,
      1,
      0,
      null,
      null,
    ]);
  });

  it('takes every item of the height bPendingActionData3 names, where the original opens the pickup menu on more than one (deviation "Pickup menu")', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    for (const height of [RAISED_ITEM_HEIGHT, RAISED_ITEM_HEIGHT, 0])
      addItemToPool(t, WALKED_TO, canteen(sim), Visibility.VISIBLE, 0, 0, height);
    const merc = savedPickup(sim, WALKED_TO, ON_A_STRUCTURE);
    walkWithoutAnOrder(sim, merc);
    runUntilIdle(sim);
    expect([canteensOf(sim, merc), t.worldItems.map((wi) => wi.zHeight), merc.savedPendingAction]).toEqual([2, [0], null]);
  });
});

describe('the typed record a saved pending action becomes (Soldier.cc handlePendingAction)', () => {
  function adoptedIn(sim: TacticalSim, action: SavedPendingAction): Soldier {
    const s = spawnSoldier(sim, 0, Team.OUR, OUT_OF_THE_VEHICLE, Direction.SOUTH);
    s.savedPendingAction = action;
    s.pendingActionData1 = TALK_TARGET;
    s.pendingActionData2 = TARGET_TILE;
    s.pendingActionData4 = WALKED_TO;
    adoptSavedPendingAction(s);
    return s;
  }

  function adopted(action: SavedPendingAction): Soldier {
    return adoptedIn(newCombatSim(content), action);
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

  it('takes sPendingActionData2 and bPendingActionData3 for a door or a container, to run on the tile the walk ended on, and the low word of uiPendingActionData1 as the ID of the structure its codes 494 and 495 handle', () => {
    const LOW_WORD_WRAP = 0x10000;
    for (const action of [MERC_OPENDOOR, MERC_OPENSTRUCT]) {
      const sim = newCombatSim(content);
      const id = addOpenable(sim, TARGET_TILE, 0).id;
      const s = adoptedIn(sim, { ...saved(action), data3: Direction.NORTH });
      expect(s.pendingDoorAction).toEqual({
        gridNo: TARGET_TILE,
        actionGridNo: OUT_OF_THE_VEHICLE,
        direction: Direction.NORTH,
        action: OPEN_STRUCT_ACTION,
      });
      const interactions = [id, id + 1, id + LOW_WORD_WRAP].map((data1) => {
        s.pendingActionData1 = data1;
        s.savedPendingAction = saved(action);
        adoptSavedPendingAction(s);
        return [s.pendingDoorGridNo, s.pendingDoorStructureId];
      });
      expect(interactions).toEqual([
        [TARGET_TILE, id],
        [TARGET_TILE, id + 1],
        [TARGET_TILE, id],
      ]);
    }
  });

  it('takes uiPendingActionData4 as the tile, sPendingActionData2 as the tile to pick up from and bPendingActionData3 as the height for a pickup, with no item chosen', () => {
    expect(adopted({ ...saved(MERC_PICKUPITEM), data3: ON_A_STRUCTURE }).pendingPickup).toEqual({
      gridNo: WALKED_TO,
      actionGridNo: TARGET_TILE,
      zLevel: ON_A_STRUCTURE,
      selection: null,
    });
  });

  it('leaves saved the wait for a trigger, which no order sets', () => {
    expect(adopted(saved(MERC_WAITFOROTHERSTOTRIGGER)).savedPendingAction?.action).toBe(MERC_WAITFOROTHERSTOTRIGGER);
  });
});
