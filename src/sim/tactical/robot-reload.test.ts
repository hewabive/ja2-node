import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { NOTHING } from '../../content/items/items.ts';
import { DIRECTION_COUNT, DIRECTION_INCREMENT, Direction, gridNo, pythSpacesAway } from '../../content/world/grid.ts';
import { TravelCost } from '../../content/world/movement-costs.ts';
import { cloneObject, createItem, createItems, type ItemObject } from '../items/object.ts';
import type { TacticalSim } from '../tactical/tactical-sim.ts';
import { animName } from './anim-states.ts';
import type { TacticalContent } from './content.ts';
import { InvSlot } from './inventory.ts';
import { setSoldierPosition } from './movement.ts';
import { AP } from './points.ts';
import { apsToReloadRobot, robotReloadRefusal, soldierReloadRobot } from './robot-reload.ts';
import { Body, type Soldier, Team } from './soldier.ts';
import { enterCombatMode } from './turns/turns.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const MERC_AT = gridNo(80, 80);
const ROBOT_AT = gridNo(84, 80);
const AP_RELOAD_ROBOT = 4;
const FULL_CLIP = 15;
const PART_CLIP = 10;

const item = (name: string) => content.items.byName.get(name)?.index ?? -1;

function stepUntil(sim: TacticalSim, done: () => boolean, ticks = 20_000): void {
  for (let k = 0; k < ticks && !done(); k++) sim.step();
}

function pocketWith(s: Soldier, slot: number, name: string, count: number): ItemObject {
  Object.assign(s.inv[slot] as object, createItems(content.items, item(name), 100, count));
  return s.inv[slot] as ItemObject;
}

function rounds(s: Soldier, name: string): number[] {
  return s.inv.filter((o) => o.item === item(name)).flatMap((o) => o.status.slice(0, o.count));
}

interface Scene {
  readonly sim: TacticalSim;
  readonly merc: Soldier;
  readonly robot: Soldier;
  readonly gun: ItemObject;
}

function scene(robotAt = ROBOT_AT, blocked: readonly number[] = []): Scene {
  const sim = newCombatSim(content, [], 3, new Set(), (world) => {
    for (const g of blocked)
      for (let direction = 0; direction < DIRECTION_COUNT; direction++) world.costs.force(g, direction, 0, TravelCost.OBSTACLE);
  });
  const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.EAST);
  const robot = spawnSoldier(sim, 1, Team.OUR, robotAt, Direction.WEST, { body: Body.ROBOTNOWEAPON });
  const gun = robot.inv[InvSlot.HAND] as ItemObject;
  gun.gunShotsLeft = 0;
  return { sim, merc, robot, gun };
}

function loadPartly(gun: ItemObject): void {
  gun.gunShotsLeft = PART_CLIP;
  gun.gunAmmoItem = item('CLIP9_15');
  gun.gunAmmoType = content.items.byIndex.get(item('CLIP9_15'))?.magazine?.ammoType ?? 0;
}

function intoCombat(sim: TacticalSim): void {
  spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 110), Direction.SOUTH);
  enterCombatMode(sim.state, Team.OUR);
  expect(sim.state.inCombat).toBe(true);
  expect(sim.state.turn.currentTeam).toBe(Team.OUR);
}

function reload({ sim, merc, robot }: Scene, slot: number, count?: number): number | null {
  const object = cloneObject(merc.inv[slot] as ItemObject);
  if (count !== undefined) {
    object.count = count;
    object.status = object.status.slice(0, count);
  }
  return soldierReloadRobot(sim.state, merc, robot, object, slot);
}

describe('reloading the robot from the item cursor (Interface_Items.cc, Soldier_Ani.cc code 756)', () => {
  it('takes the magazine out of the pocket at once, walks next to the robot and loads its empty gun at code 756', () => {
    const s = scene();
    pocketWith(s.merc, InvSlot.BIGPOCK1, 'CLIP9_15', 1);
    const to = reload(s, InvSlot.BIGPOCK1);
    expect(to).not.toBeNull();
    expect(pythSpacesAway(to ?? 0, ROBOT_AT)).toBe(1);
    expect(s.merc.inv[InvSlot.BIGPOCK1]?.item).toBe(NOTHING);
    expect(s.merc.tempObject).toMatchObject({ item: item('CLIP9_15'), count: 1 });
    expect(s.merc.pendingRobotReload).toMatchObject({ targetGridNo: ROBOT_AT });
    stepUntil(s.sim, () => animName(content, s.merc.state) === 'RELOAD_ROBOT');
    expect(s.merc.gridNo).toBe(to);
    expect(s.merc.direction).toBe(Direction.EAST);
    expect(s.gun.gunShotsLeft).toBe(0);
    const events = runUntilIdle(s.sim);
    expect(s.gun).toMatchObject({ gunShotsLeft: FULL_CLIP, gunAmmoItem: item('CLIP9_15') });
    expect(s.merc.tempObject).toBeNull();
    expect(rounds(s.merc, 'CLIP9_15')).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'reloaded', soldier: s.robot.id, item: s.gun.item }));
  });

  it('starts at once next to the robot', () => {
    const s = scene(MERC_AT + (DIRECTION_INCREMENT[Direction.EAST] ?? 0));
    pocketWith(s.merc, InvSlot.BIGPOCK1, 'CLIP9_15', 1);
    expect(reload(s, InvSlot.BIGPOCK1)).toBe(MERC_AT);
    expect(s.merc.pendingRobotReload).toBeNull();
    runUntilIdle(s.sim);
    expect(s.gun.gunShotsLeft).toBe(FULL_CLIP);
  });

  it('needs the walk plus 4 AP, charges the merc the walk and the kneel and the robot the reload in combat', () => {
    const s = scene();
    intoCombat(s.sim);
    pocketWith(s.merc, InvSlot.BIGPOCK1, 'CLIP9_15', 1);
    const needed = apsToReloadRobot(s.sim.state, s.merc, s.robot);
    expect(needed).toBeGreaterThan(AP_RELOAD_ROBOT);
    const merc = s.merc.actionPoints;
    const robot = s.robot.actionPoints;
    reload(s, InvSlot.BIGPOCK1);
    runUntilIdle(s.sim);
    expect(s.gun.gunShotsLeft).toBe(FULL_CLIP);
    expect(merc - s.merc.actionPoints).toBe(needed - AP_RELOAD_ROBOT + AP.CROUCH);
    expect(robot - s.robot.actionPoints).toBe(AP.RELOAD_GUN);
  });

  it('tops off a gun with the same ammo out of combat and puts the rest of the magazine back into the pockets', () => {
    const s = scene();
    loadPartly(s.gun);
    pocketWith(s.merc, InvSlot.BIGPOCK1, 'CLIP9_15', 1);
    reload(s, InvSlot.BIGPOCK1);
    runUntilIdle(s.sim);
    expect(s.gun.gunShotsLeft).toBe(FULL_CLIP);
    expect(rounds(s.merc, 'CLIP9_15')).toEqual([PART_CLIP]);
  });

  it('swaps magazines in combat and puts the robot’s old one into the merc’s pockets', () => {
    const s = scene();
    intoCombat(s.sim);
    loadPartly(s.gun);
    pocketWith(s.merc, InvSlot.BIGPOCK1, 'CLIP9_15', 1);
    reload(s, InvSlot.BIGPOCK1);
    runUntilIdle(s.sim);
    expect(s.gun.gunShotsLeft).toBe(FULL_CLIP);
    expect(rounds(s.merc, 'CLIP9_15')).toEqual([PART_CLIP]);
  });

  it('leaves the gun alone and gives the magazine back when the robot lacks the APs for the reload', () => {
    const s = scene();
    intoCombat(s.sim);
    pocketWith(s.merc, InvSlot.BIGPOCK1, 'CLIP9_15', 1);
    reload(s, InvSlot.BIGPOCK1);
    s.robot.actionPoints = AP.RELOAD_GUN - 1;
    runUntilIdle(s.sim);
    expect(s.gun.gunShotsLeft).toBe(0);
    expect(rounds(s.merc, 'CLIP9_15')).toEqual([FULL_CLIP]);
    expect(s.robot.actionPoints).toBe(AP.RELOAD_GUN - 1);
  });

  it('reloads from a copy of a whole stack: the pocket keeps all but its first magazine and gets the rest of the copy back too, as in the original', () => {
    const s = scene();
    pocketWith(s.merc, InvSlot.BIGPOCK1, 'CLIP9_15', 3);
    reload(s, InvSlot.BIGPOCK1);
    expect(rounds(s.merc, 'CLIP9_15')).toEqual([FULL_CLIP, FULL_CLIP]);
    runUntilIdle(s.sim);
    expect(s.gun.gunShotsLeft).toBe(FULL_CLIP);
    expect(rounds(s.merc, 'CLIP9_15')).toEqual([FULL_CLIP, FULL_CLIP, FULL_CLIP, FULL_CLIP]);
  });

  it('loses the robot’s old magazine when it does not fit the merc’s pockets: the original ignores the failed placement', () => {
    const s = scene();
    loadPartly(s.gun);
    const full: number[] = [InvSlot.SECOND_HAND, InvSlot.BIGPOCK1, InvSlot.BIGPOCK2, InvSlot.BIGPOCK3, InvSlot.BIGPOCK4];
    for (let slot: number = InvSlot.SMALLPOCK2; slot <= InvSlot.SMALLPOCK8; slot++) full.push(slot);
    for (const slot of full) Object.assign(s.merc.inv[slot] as object, createItem(content.items, item('GLOCK_17'), 100));
    pocketWith(s.merc, InvSlot.SMALLPOCK1, 'CLIP9_15_AP', 2);
    reload(s, InvSlot.SMALLPOCK1, 1);
    runUntilIdle(s.sim);
    expect(s.gun).toMatchObject({ gunShotsLeft: FULL_CLIP, gunAmmoItem: item('CLIP9_15_AP') });
    expect(rounds(s.merc, 'CLIP9_15_AP')).toEqual([FULL_CLIP]);
    expect(rounds(s.merc, 'CLIP9_15')).toEqual([]);
    expect(s.sim.state.worldItems).toEqual([]);
  });

  it('puts the magazine back into the merc’s pockets when the robot has left its tile before he gets there', () => {
    const s = scene();
    pocketWith(s.merc, InvSlot.BIGPOCK1, 'CLIP9_15', 1);
    reload(s, InvSlot.BIGPOCK1);
    setSoldierPosition(s.sim.state, s.robot, gridNo(90, 90));
    runUntilIdle(s.sim);
    expect(s.gun.gunShotsLeft).toBe(0);
    expect(s.merc.tempObject).toBeNull();
    expect(animName(content, s.merc.state)).toBe('STANDING');
    expect(rounds(s.merc, 'CLIP9_15')).toEqual([FULL_CLIP]);
  });

  it('puts the magazine back when a move order drops the reload on the way', () => {
    const s = scene();
    pocketWith(s.merc, InvSlot.BIGPOCK1, 'CLIP9_15', 1);
    reload(s, InvSlot.BIGPOCK1);
    s.sim.step();
    expect(s.sim.dispatch({ type: 'move', soldier: s.merc.id, to: gridNo(80, 84) }).ok).toBe(true);
    expect(s.merc.pendingRobotReload).toBeNull();
    expect(rounds(s.merc, 'CLIP9_15')).toEqual([FULL_CLIP]);
    runUntilIdle(s.sim);
    expect(s.gun.gunShotsLeft).toBe(0);
  });

  it('puts the magazine back when the merc collapses on the way', () => {
    const s = scene();
    pocketWith(s.merc, InvSlot.BIGPOCK1, 'CLIP9_15', 1);
    reload(s, InvSlot.BIGPOCK1);
    s.sim.step();
    s.sim.state.hooks.collapse(s.sim.state, s.merc);
    expect(s.merc.tempObject).toBeNull();
    expect(rounds(s.merc, 'CLIP9_15')).toEqual([FULL_CLIP]);
  });

  it('refuses ammo of another calibre, too few APs and a robot nobody can reach, in the order of HandleItemPointerClick', () => {
    const s = scene();
    const clip45 = createItem(content.items, item('CLIP45_7'), 100);
    const clip9 = createItem(content.items, item('CLIP9_15'), 100);
    expect(robotReloadRefusal(s.sim.state, s.merc, s.robot, clip45)).toBe('robotNeedsCalibre');
    expect(robotReloadRefusal(s.sim.state, s.merc, s.robot, clip9)).toBeNull();
    intoCombat(s.sim);
    s.merc.actionPoints = apsToReloadRobot(s.sim.state, s.merc, s.robot) - 1;
    expect(robotReloadRefusal(s.sim.state, s.merc, s.robot, clip45)).toBe('notEnoughAP');
    const walled = scene(
      ROBOT_AT,
      DIRECTION_INCREMENT.map((step) => ROBOT_AT + step),
    );
    expect(apsToReloadRobot(walled.sim.state, walled.merc, walled.robot)).toBe(0);
    expect(robotReloadRefusal(walled.sim.state, walled.merc, walled.robot, clip9)).toBe('noPath');
  });
});
