import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import type { MapSchedule } from '../../../content/formats/map.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { TICK_MS } from '../../clock.ts';
import { AiAction } from '../ai/actions.ts';
import { decideActionSchedule } from '../ai/decide-schedule.ts';
import { handleDoorChangeFromGridNo, isDoorOpenAt } from '../doors.ts';
import { NO_NARRATIVE_PORT } from '../narrative/port.ts';
import { getSchedule, loadMapSchedules, ScheduleAction, ScheduleFlags, UNSET_SCHEDULE_VALUE } from '../narrative/schedule-state.ts';
import { performActionOnDoorAdjacentToGridNo } from '../narrative/schedules.ts';
import { doorState } from '../pathfinding.ts';
import { revealRoofsAndItems } from '../perception/fov.ts';
import { type Soldier, TEAM_FIRST_ID, Team, Visible } from '../soldier.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { isDoorBusy, loadDoorStatusArray, mercLooksForDoors, storedDoorStatuses, updateDoorGraphicsFromStatus } from './door-status.ts';
import { DoorTrap, updateDoor } from './door-table.ts';

const VILLAGE = 'stubs/world/maps/village.dat';
const TOWN = 'stubs/world/maps/town.dat';
const DOOR = 11429;
const OUTSIDE = DOOR + 160;
const IN_SIGHT_OF_DOOR = DOOR + 3;
const NORTH = 0;
const FIRST_ENEMY = TEAM_FIRST_ID[Team.ENEMY];
const FIRST_CIV = TEAM_FIRST_ID[Team.CIV];
const FIVE_FRAMES_MS = 375;
const ONE_FRAME_MS = 75;
const TOWN_DOORS_IN_SIGHT = [9033, 9691, 10643] as const;
const SEES_TOWN_DOORS = 9840;
const STEP_BUDGET = 2_000;
const ALMA_PRISON = { x: 13, y: 9, z: 0 };
const SEEN_OPEN_LEFT_CLOSED = { gridNo: DOOR, open: false, perceivedOpen: true, perceivedNotSet: false };

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

function village(): TacticalSim {
  const sim = new TacticalSim(kit.world(VILLAGE), kit.content, 5);
  updateDoor(sim.state, DOOR, { locked: false, trapId: DoorTrap.NONE });
  return sim;
}

function stepUntil(sim: TacticalSim, done: () => boolean): void {
  for (let i = 0; i < STEP_BUDGET && !done(); i++) sim.step();
  expect(done()).toBe(true);
}

function busyWindowMs(sim: TacticalSim, change: () => void): number {
  change();
  const changedAt = sim.state.clockMs;
  expect(isDoorBusy(sim.state, DOOR)).toBe(true);
  stepUntil(sim, () => !isDoorBusy(sim.state, DOOR));
  const freedInPassAt = sim.state.clockMs - TICK_MS;
  return freedInPassAt - changedAt;
}

function doorChanges(sim: TacticalSim): boolean[] {
  return sim.drainEvents().flatMap((e) => (e.type === 'doorChanged' ? [e.open] : []));
}

function enemyAt(sim: TacticalSim, at: number): Soldier {
  return spawnSoldier(sim, FIRST_ENEMY, Team.ENEMY, at, NORTH);
}

describe('the busy door (DOOR_BUSY while its tile animation plays)', () => {
  it('holds the door five frames of 70 + 5 ms when its graphic shows the old state', () => {
    const sim = village();
    const merc = spawnSoldier(sim, 0, Team.OUR, OUTSIDE, NORTH);
    expect(busyWindowMs(sim, () => handleDoorChangeFromGridNo(sim.state, merc, DOOR))).toBe(FIVE_FRAMES_MS);
    expect(busyWindowMs(sim, () => handleDoorChangeFromGridNo(sim.state, merc, DOOR))).toBe(FIVE_FRAMES_MS);
  });

  it('holds it one frame when the graphic already shows the new state, running the animation backward', () => {
    const sim = village();
    handleDoorChangeFromGridNo(sim.state, enemyAt(sim, OUTSIDE), DOOR);
    expect([isDoorOpenAt(sim.state, DOOR), sim.openDoors()]).toEqual([true, []]);
    const merc = spawnSoldier(sim, 0, Team.OUR, OUTSIDE, NORTH);
    expect(busyWindowMs(sim, () => handleDoorChangeFromGridNo(sim.state, merc, DOOR))).toBe(ONE_FRAME_MS);
  });

  it('ends the running animation when the door changes again, and starts the window anew', () => {
    const sim = village();
    const merc = spawnSoldier(sim, 0, Team.OUR, OUTSIDE, NORTH);
    handleDoorChangeFromGridNo(sim.state, merc, DOOR);
    stepUntil(sim, () => sim.state.explosives.aniTiles.some((a) => a.frame === 2));
    expect(busyWindowMs(sim, () => handleDoorChangeFromGridNo(sim.state, merc, DOOR))).toBe(FIVE_FRAMES_MS);
    expect(sim.state.explosives.aniTiles).toEqual([]);
  });

  it('stops our merc who comes to change a swinging door until the animation ends', () => {
    const sim = village();
    const merc = spawnSoldier(sim, 0, Team.OUR, OUTSIDE, NORTH);
    sim.lookAround();
    expect(sim.dispatch({ type: 'door', soldier: merc.id, gridNo: DOOR, action: 'open' })).toMatchObject({ ok: true });
    runUntilIdle(sim);
    expect(isDoorOpenAt(sim.state, DOOR)).toBe(true);
    expect(isDoorBusy(sim.state, DOOR)).toBe(true);
    expect(sim.dispatch({ type: 'door', soldier: merc.id, gridNo: DOOR, action: 'close' })).toMatchObject({
      ok: true,
      data: { started: 'busy' },
    });
    expect(sim.dispatch({ type: 'door', soldier: merc.id, gridNo: DOOR, action: 'closeManually' })).toMatchObject({
      ok: true,
      data: { started: 'busy' },
    });
    expect(sim.drainEvents().some((e) => e.type === 'doorMenu')).toBe(false);
    stepUntil(sim, () => !isDoorBusy(sim.state, DOOR));
    expect(sim.dispatch({ type: 'door', soldier: merc.id, gridNo: DOOR, action: 'close' })).toMatchObject({
      ok: true,
      data: { closed: false },
    });
  });

  it('makes a scheduled civilian do nothing at a busy door, and act once it is free', () => {
    const sim = village();
    const t = sim.state;
    const U = UNSET_SCHEDULE_VALUE;
    const entry: MapSchedule = {
      times: [480, U, U, U],
      data1: [OUTSIDE, U, U, U],
      data2: [OUTSIDE, U, U, U],
      actions: [ScheduleAction.CLOSEDOOR, 0, 0, 0],
      flags: 0,
    };
    t.schedules = loadMapSchedules([entry]);
    const civ = spawnSoldier(sim, FIRST_CIV, Team.CIV, OUTSIDE, NORTH);
    civ.scheduleId = 1;
    const node = getSchedule(t.schedules, 1);
    if (!node) throw new Error('no schedule');
    node.soldier = civ.id;
    node.flags = ScheduleFlags.ACTIVE1;
    handleDoorChangeFromGridNo(t, spawnSoldier(sim, 0, Team.OUR, IN_SIGHT_OF_DOOR, NORTH), DOOR);
    expect(decideActionSchedule(t, civ)).toBe(AiAction.NONE);
    stepUntil(sim, () => !isDoorBusy(t, DOOR));
    civ.ai.scheduleProgress = 0;
    expect(decideActionSchedule(t, civ)).toBe(AiAction.OPEN_OR_CLOSE_DOOR);
  });

  it('is not saved with the sector: a returning squad finds every door free', () => {
    const sim = village();
    handleDoorChangeFromGridNo(sim.state, spawnSoldier(sim, 0, Team.OUR, OUTSIDE, NORTH), DOOR);
    expect(isDoorBusy(sim.state, DOOR)).toBe(true);
    const later = village();
    loadDoorStatusArray(later.state, storedDoorStatuses(sim.state));
    expect(later.state.doorStatus.get(DOOR)).toEqual({
      open: true,
      perceivedOpen: true,
      perceivedNotSet: false,
      busy: false,
      shownOpen: true,
    });
  });
});

describe('a door changed out of sight (HandleDoorsOpenClose, MercLooksForDoors)', () => {
  it('keeps its perceived state and shown graphic, with no animation or sound, until a merc sees it', () => {
    const sim = village();
    const t = sim.state;
    expect(handleDoorChangeFromGridNo(t, enemyAt(sim, OUTSIDE), DOOR)).toBe(true);
    expect(isDoorOpenAt(t, DOOR)).toBe(true);
    expect(t.doorStatus.get(DOOR)).toEqual({ open: true, perceivedOpen: false, perceivedNotSet: true, busy: false, shownOpen: false });
    expect(sim.openDoors()).toEqual([]);
    expect(doorState(t.pathEnv, DOOR, true) & StructureFlags.OPEN).toBe(0);
    expect(doorChanges(sim)).toEqual([]);
    revealRoofsAndItems(t, spawnSoldier(sim, 0, Team.OUR, IN_SIGHT_OF_DOOR, NORTH), false);
    expect(t.doorStatus.get(DOOR)).toEqual({ open: true, perceivedOpen: true, perceivedNotSet: false, busy: false, shownOpen: true });
    expect(sim.openDoors()).toEqual([DOOR]);
    expect(doorState(t.pathEnv, DOOR, true) & StructureFlags.OPEN).not.toBe(0);
  });

  it('animates the change of an unseen soldier a merc watches the door for', () => {
    const sim = village();
    spawnSoldier(sim, 0, Team.OUR, IN_SIGHT_OF_DOOR, NORTH);
    handleDoorChangeFromGridNo(sim.state, enemyAt(sim, OUTSIDE), DOOR);
    expect(sim.state.doorStatus.get(DOOR)).toEqual({
      open: true,
      perceivedOpen: true,
      perceivedNotSet: false,
      busy: true,
      shownOpen: true,
    });
    expect(doorChanges(sim)).toEqual([true]);
  });

  it('skips only a soldier hidden at -1: one fading out (-2) still animates the door and updates what the player perceives', () => {
    const sim = village();
    const enemy = enemyAt(sim, OUTSIDE);
    enemy.visible = Visible.FADING_OUT;
    handleDoorChangeFromGridNo(sim.state, enemy, DOOR);
    expect(sim.state.doorStatus.get(DOOR)).toEqual({
      open: true,
      perceivedOpen: true,
      perceivedNotSet: false,
      busy: true,
      shownOpen: true,
    });
    expect(sim.openDoors()).toEqual([DOOR]);
    expect(doorChanges(sim)).toEqual([true]);
  });

  it('animates a door changed by no soldier (an action item) only when a merc sees the door or a tile next to it', () => {
    const unseen = village();
    spawnSoldier(unseen, 0, Team.OUR, OUTSIDE, NORTH);
    handleDoorChangeFromGridNo(unseen.state, null, DOOR);
    expect(unseen.state.doorStatus.get(DOOR)).toEqual({
      open: true,
      perceivedOpen: false,
      perceivedNotSet: true,
      busy: false,
      shownOpen: false,
    });
    const seen = village();
    spawnSoldier(seen, 0, Team.OUR, IN_SIGHT_OF_DOOR, NORTH);
    handleDoorChangeFromGridNo(seen.state, null, DOOR);
    expect(seen.state.doorStatus.get(DOOR)).toEqual({
      open: true,
      perceivedOpen: true,
      perceivedNotSet: false,
      busy: true,
      shownOpen: true,
    });
  });

  it('updates one door per look, in the order the doors got their status (the break in MercLooksForDoors)', () => {
    const sim = new TacticalSim(kit.world(TOWN), kit.content, 5);
    const t = sim.state;
    const [first, second, third] = TOWN_DOORS_IN_SIGHT;
    for (const door of [second, first]) handleDoorChangeFromGridNo(t, null, door);
    expect(sim.openDoors()).toEqual([]);
    const merc = spawnSoldier(sim, 0, Team.OUR, SEES_TOWN_DOORS, NORTH);
    mercLooksForDoors(t, merc);
    expect(sim.openDoors()).toEqual([second]);
    mercLooksForDoors(t, merc);
    expect(sim.openDoors()).toEqual([first, second]);
    mercLooksForDoors(t, merc);
    expect(sim.openDoors()).toEqual([first, second]);
    expect(t.doorStatus.has(third)).toBe(false);
  });

  it('keeps the not-set flag and shows the perceived state after the sector is reloaded', () => {
    const sim = village();
    handleDoorChangeFromGridNo(sim.state, enemyAt(sim, OUTSIDE), DOOR);
    const saved = storedDoorStatuses(sim.state);
    expect(saved).toEqual([{ gridNo: DOOR, open: true, perceivedOpen: false, perceivedNotSet: true }]);
    const later = village();
    loadDoorStatusArray(later.state, saved);
    expect([isDoorOpenAt(later.state, DOOR), later.openDoors()]).toEqual([true, []]);
    expect(later.state.doorStatus.get(DOOR)).toEqual({
      open: true,
      perceivedOpen: false,
      perceivedNotSet: true,
      busy: false,
      shownOpen: false,
    });
  });
});

describe('a door the player perceives otherwise than it is after a load (UpdateDoorGraphicsFromStatus)', () => {
  it('takes the structure of its perceived state while the map draws the real one, so pathing follows the perceived door until a merc sees it', () => {
    const sim = village();
    const t = sim.state;
    loadDoorStatusArray(t, [SEEN_OPEN_LEFT_CLOSED]);
    expect([isDoorOpenAt(t, DOOR), t.doorStatus.get(DOOR)?.open, sim.openDoors()]).toEqual([true, false, [DOOR]]);
    expect(doorState(t.pathEnv, DOOR, false) & StructureFlags.OPEN).not.toBe(0);
    revealRoofsAndItems(t, spawnSoldier(sim, 0, Team.OUR, IN_SIGHT_OF_DOOR, NORTH), false);
    expect([isDoorOpenAt(t, DOOR), sim.openDoors()]).toEqual([false, []]);
    expect(t.doorStatus.get(DOOR)).toEqual({ open: false, perceivedOpen: false, perceivedNotSet: false, busy: false, shownOpen: false });
    expect(doorState(t.pathEnv, DOOR, false) & StructureFlags.OPEN).toBe(0);
  });

  it('gets the structure of its real state back from the second update of a sector entry, still shown as perceived', () => {
    const sim = village();
    const t = sim.state;
    loadDoorStatusArray(t, [SEEN_OPEN_LEFT_CLOSED]);
    updateDoorGraphicsFromStatus(t);
    expect([isDoorOpenAt(t, DOOR), t.doorStatus.get(DOOR)?.shownOpen, sim.openDoors()]).toEqual([false, true, [DOOR]]);
  });
});

describe('a door a schedule opens on the map screen (PerformActionOnDoorAdjacentToGridNo with DONTSETDOORSTATUS)', () => {
  it('changes only the real state: the structure follows when a merc sees the door', () => {
    const sim = village();
    const t = sim.state;
    performActionOnDoorAdjacentToGridNo(t, ScheduleAction.OPENDOOR, DOOR);
    expect([isDoorOpenAt(t, DOOR), sim.openDoors()]).toEqual([false, []]);
    expect(t.doorStatus.get(DOOR)).toEqual({ open: true, perceivedOpen: false, perceivedNotSet: true, busy: false, shownOpen: false });
    revealRoofsAndItems(t, spawnSoldier(sim, 0, Team.OUR, IN_SIGHT_OF_DOOR, NORTH), false);
    expect([isDoorOpenAt(t, DOOR), sim.openDoors()]).toEqual([true, [DOOR]]);
  });

  it('changes only the real state: the next load syncs the structure and keeps showing the door closed', () => {
    const sim = village();
    const t = sim.state;
    performActionOnDoorAdjacentToGridNo(t, ScheduleAction.OPENDOOR, DOOR);
    updateDoorGraphicsFromStatus(t);
    expect([isDoorOpenAt(t, DOOR), sim.openDoors()]).toEqual([true, []]);
  });
});

describe('the Alma POW path checks of a door (DoPOWPathChecks in HandleDoorsOpenClose)', () => {
  it('run before an opening door opens, while the player still perceives it closed, and not when it closes', () => {
    const sim = village();
    const t = sim.state;
    t.sector = ALMA_PRISON;
    const checks: (readonly [boolean, number])[] = [];
    t.narrative = {
      ...NO_NARRATIVE_PORT,
      powPathChecks: () => checks.push([isDoorOpenAt(t, DOOR), doorState(t.pathEnv, DOOR, true) & StructureFlags.OPEN]),
    };
    const merc = spawnSoldier(sim, 0, Team.OUR, OUTSIDE, NORTH);
    handleDoorChangeFromGridNo(t, merc, DOOR);
    handleDoorChangeFromGridNo(t, merc, DOOR);
    expect(checks).toEqual([[false, 0]]);
  });
});
