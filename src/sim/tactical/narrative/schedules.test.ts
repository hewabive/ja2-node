import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { testProfile } from '../../../../tests/support/profiles.ts';
import { ScriptedRolls } from '../../../../tests/support/strategic.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import type { MapSchedule } from '../../../content/formats/map.ts';
import { parseDetailedPlacement, writeProfileDetailedPlacement } from '../../../content/formats/placement.ts';
import { WORLD_COLS, WORLD_MAX } from '../../../content/world/grid.ts';
import { REPO_ROOT } from '../../../node/repo.ts';
import { setCivGroupHostility } from '../../strategic/narrative/civ-groups.ts';
import { AiAction } from '../ai/actions.ts';
import { decideActionSchedule } from '../ai/decide-schedule.ts';
import type { TacticalContent } from '../content.ts';
import type { SoldierInitNode } from '../init-list.ts';
import { Body, CivilianGroup, NO_PROFILE, type Soldier, TEAM_FIRST_ID, Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { CivGroupHostility } from './constants.ts';
import { NO_NARRATIVE_PORT } from './port.ts';
import { getSchedule, loadMapSchedules, ScheduleAction, ScheduleFlags, UNSET_SCHEDULE_VALUE } from './schedule-state.ts';
import { extractScheduleDoorLockAndUnlockInfo, postNextSchedule, postSchedules, processTacticalSchedule } from './schedules.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const U = UNSET_SCHEDULE_VALUE;
const DAY = 1440;
const DAY_TWO = 2 * DAY;
const FIRST_CIV = TEAM_FIRST_ID[Team.CIV];
const SOUTH = 4;
const g = (x: number, y: number) => y * WORLD_COLS + x;
const HOME = g(80, 80);
const SQUARE = g(90, 80);
const BED = g(80, 90);
const OTHER_HOME = g(84, 84);
const FAKE_PROFILE = 150;

interface Clock {
  now: number;
  query: number;
  readonly events: [number, number][];
}

function schedule(entries: readonly (readonly [number, number, number?, number?])[]): MapSchedule {
  const times = [U, U, U, U];
  const data1 = [U, U, U, U];
  const data2 = [U, U, U, U];
  const actions = [0, 0, 0, 0];
  entries.forEach(([time, action, d1, d2], i) => {
    times[i] = time;
    actions[i] = action;
    if (d1 !== undefined) data1[i] = d1;
    if (d2 !== undefined) data2[i] = d2;
  });
  return { times, data1, data2, actions, flags: 0 };
}

function scheduleSim(minute: number): { sim: TacticalSim; clock: Clock } {
  const sim = newCombatSim(content);
  const t = sim.state;
  const info = {
    northGridNo: g(80, 40),
    eastGridNo: -1,
    southGridNo: -1,
    westGridNo: -1,
    numIndividuals: 0,
    mapVersion: 25,
    restrictedScrollId: 0,
    editorSmoothingType: 0,
    centerGridNo: g(80, 80),
    isolatedGridNo: -1,
  };
  Object.assign(t.world, { map: { ...t.world.map, info, rooms: new Uint8Array(WORLD_MAX) } });
  t.sector = { x: 9, y: 1, z: 0 };
  const clock: Clock = { now: minute, query: minute, events: [] };
  t.scheduleClock = {
    worldMinutes: () => clock.now,
    lastEventQueryMinutes: () => clock.query,
    addEvent: (m, id) => clock.events.push([m, id]),
    deleteEvent: (id) => {
      const at = clock.events.findIndex(([, e]) => e === id);
      if (at >= 0) clock.events.splice(at, 1);
    },
    deleteAllEvents: () => {
      clock.events.length = 0;
    },
  };
  return { sim, clock };
}

function civilian(sim: TacticalSim, k: number, at: number, scheduleId: number, body: number = Body.MANCIV): Soldier {
  const s = spawnSoldier(sim, FIRST_CIV + k, Team.CIV, at, SOUTH);
  s.bodyType = body;
  s.scheduleId = scheduleId;
  return s;
}

function link(sim: TacticalSim, soldiers: readonly (readonly [Soldier, number | null])[]): void {
  sim.state.initList = soldiers.map(([s, scheduleId], index): SoldierInitNode => {
    const detail =
      scheduleId === null
        ? null
        : parseDetailedPlacement(
            writeProfileDetailedPlacement({
              profile: NO_PROFILE,
              direction: SOUTH,
              insertionGridNo: s.gridNo,
              team: Team.CIV,
              attitude: 0,
              orders: 0,
              soldierClass: 0,
              scheduleId,
            }),
          );
    return {
      index,
      team: Team.CIV,
      soldierClass: 0,
      priorityExistence: true,
      detailed: detail !== null,
      hasSoldier: true,
      soldierId: s.id,
      basic: {
        startingGridNo: s.gridNo,
        relativeAttributeLevel: 2,
        relativeEquipmentLevel: 2,
        direction: SOUTH,
        orders: 0,
        attitude: 0,
        bodyType: s.bodyType,
        patrolGrid: [],
        patrolCount: 0,
        onRoof: false,
        civilianGroup: 0,
        hasKeys: false,
      },
      detail,
    };
  });
}

function scripted(sim: TacticalSim, values: readonly number[]): ScriptedRolls {
  const rolls = new ScriptedRolls(values);
  Object.assign(sim.state, { rng: rolls });
  return rolls;
}

const table = JSON.parse(readFileSync(join(REPO_ROOT, 'data/tables/narrative.json'), 'utf8')) as {
  scheduleActions: { id: number; name: string }[];
  scheduleFlags: { name: string; value: number }[];
};

describe('schedule constants', () => {
  it('match the transcribed schedule actions and flags', () => {
    expect(ScheduleAction).toEqual(Object.fromEntries(table.scheduleActions.map((a) => [a.name, a.id])));
    for (const [name, value] of Object.entries(ScheduleFlags)) expect(table.scheduleFlags).toContainEqual({ name, value });
  });
});

describe('posting schedules', () => {
  it('posts the map schedules and the default schedules in init-list order, drawing the sleep time and two default times', () => {
    const { sim, clock } = scheduleSim(DAY_TWO + 600);
    const t = sim.state;
    t.schedules = loadMapSchedules([
      schedule([
        [540, ScheduleAction.GRIDNO, SQUARE],
        [U, ScheduleAction.SLEEP, BED],
      ]),
    ]);
    const villager = civilian(sim, 0, HOME, 1);
    const passerby = civilian(sim, 1, OTHER_HOME, 0);
    const cow = civilian(sim, 2, g(70, 70), 0, Body.COW);
    link(sim, [
      [villager, 1],
      [passerby, null],
      [cow, null],
    ]);
    const rolls = scripted(sim, [100, 30, 60]);
    postSchedules(t, { loadingSave: false });
    expect(rolls.ranges).toEqual([180, 61, 121]);
    expect(t.schedules.nodes.map((n) => n.id)).toEqual([3, 1]);
    expect(getSchedule(t.schedules, 1)?.times).toEqual([540, 1360, U, U]);
    expect(getSchedule(t.schedules, 3)).toMatchObject({
      times: [450, 1140, U, U],
      actions: [ScheduleAction.ENTERSECTOR, ScheduleAction.LEAVESECTOR, 0, 0],
      data1: [OTHER_HOME, U, U, U],
      flags: ScheduleFlags.TEMPORARY,
      soldier: passerby.id,
    });
    expect([villager.gridNo, villager.ai.asleep, villager.ai.patrolGrid[0]]).toEqual([SQUARE, false, SQUARE]);
    expect([passerby.gridNo, passerby.away, passerby.placed]).toEqual([OTHER_HOME, false, true]);
    expect(cow.scheduleId).toBe(0);
    expect(clock.events).toEqual([
      [DAY_TWO + 1360, 1],
      [DAY_TWO + 1140, 3],
    ]);
  });

  it('adds an eight-hour wake entry in front of a sleep entry without a time when nothing else starts before noon', () => {
    const { sim } = scheduleSim(DAY_TWO + 600);
    const t = sim.state;
    t.schedules = loadMapSchedules([schedule([[U, ScheduleAction.SLEEP, BED]])]);
    const sleeper = civilian(sim, 0, HOME, 1);
    link(sim, [[sleeper, 1]]);
    scripted(sim, [179]);
    postSchedules(t, { loadingSave: true });
    expect(getSchedule(t.schedules, 1)).toMatchObject({
      actions: [ScheduleAction.WAKE, ScheduleAction.SLEEP, 0, 0],
      times: [(1439 + 480) % DAY, 1439, U, U],
      data1: [U, BED, U, U],
    });
  });

  it('gives a later civilian sharing the sleep spot the nearest other free tile', () => {
    const { sim } = scheduleSim(DAY_TWO + 600);
    const t = sim.state;
    t.schedules = loadMapSchedules([schedule([[1300, ScheduleAction.SLEEP, BED]]), schedule([[1310, ScheduleAction.SLEEP, BED]])]);
    const first = civilian(sim, 0, HOME, 1);
    const second = civilian(sim, 1, OTHER_HOME, 2);
    link(sim, [
      [first, 1],
      [second, 2],
    ]);
    postSchedules(t, { loadingSave: true });
    expect(getSchedule(t.schedules, 1)?.data1[0]).toBe(BED);
    expect(getSchedule(t.schedules, 2)?.data1[0]).toBe(BED - WORLD_COLS);
  });

  it('replays the past 24 hours: asleep in bed at night, away after leaving, back after entering', () => {
    const { sim } = scheduleSim(DAY_TWO + 120);
    const t = sim.state;
    t.schedules = loadMapSchedules([
      schedule([
        [420, ScheduleAction.WAKE],
        [540, ScheduleAction.GRIDNO, SQUARE],
        [1320, ScheduleAction.SLEEP, BED],
      ]),
    ]);
    const sleeper = civilian(sim, 0, HOME, 1);
    const passerby = civilian(sim, 1, OTHER_HOME, 0);
    link(sim, [
      [sleeper, 1],
      [passerby, null],
    ]);
    scripted(sim, [10, 10]);
    postSchedules(t, { loadingSave: false });
    expect([sleeper.gridNo, sleeper.ai.asleep]).toEqual([BED, true]);
    expect([passerby.away, passerby.placed, passerby.offWorldGridNo, t.awaySlots.includes(passerby)]).toEqual([
      true,
      false,
      OTHER_HOME,
      true,
    ]);
  });

  it('posts nothing for Kingpin’s unprofiled men in C5 while his group is hostile, but does for his profiled men', () => {
    const { sim, clock } = scheduleSim(DAY_TWO + 600);
    const t = sim.state;
    t.sector = { x: 5, y: 3, z: 0 };
    setCivGroupHostility(t.civGroups, CivilianGroup.KINGPIN, CivGroupHostility.HOSTILE);
    t.schedules = loadMapSchedules([schedule([[540, ScheduleAction.GRIDNO, SQUARE]]), schedule([[540, ScheduleAction.GRIDNO, BED]])]);
    const goon = civilian(sim, 0, HOME, 1);
    goon.civilianGroup = CivilianGroup.KINGPIN;
    const named = civilian(sim, 1, OTHER_HOME, 2);
    named.civilianGroup = CivilianGroup.KINGPIN;
    named.profile = FAKE_PROFILE;
    link(sim, [
      [goon, 1],
      [named, 2],
    ]);
    postSchedules(t, { loadingSave: false });
    expect(goon.gridNo).toBe(HOME);
    expect(named.gridNo).toBe(BED);
    expect(clock.events).toEqual([[DAY_TWO + DAY + 540, 2]]);
  });
});

describe('processing schedules', () => {
  it('activates the entry of the current minute in tactical and auto-processes on the map screen', () => {
    const { sim, clock } = scheduleSim(DAY_TWO + 540);
    const t = sim.state;
    t.schedules = loadMapSchedules([
      schedule([
        [540, ScheduleAction.GRIDNO, SQUARE],
        [1320, ScheduleAction.SLEEP, BED],
      ]),
    ]);
    const walker = civilian(sim, 0, HOME, 1);
    const node = getSchedule(t.schedules, 1);
    if (!node) throw new Error('no schedule');
    node.soldier = walker.id;
    processTacticalSchedule(t, 1, true);
    expect([node.flags, walker.ai.checkSchedule, walker.gridNo]).toEqual([ScheduleFlags.ACTIVE1, true, HOME]);
    walker.ai.checkSchedule = false;
    clock.query = DAY_TWO + 500;
    processTacticalSchedule(t, 1, false);
    expect([walker.gridNo, walker.ai.checkSchedule]).toEqual([SQUARE, false]);
    expect(clock.events).toEqual([[DAY_TWO + 1320, 1]]);
  });

  it('walks to the gridno, finishes there and posts the next entry, wrapping through midnight into the past', () => {
    const { sim, clock } = scheduleSim(DAY_TWO + 540);
    const t = sim.state;
    t.schedules = loadMapSchedules([
      schedule([
        [450, ScheduleAction.GRIDNO, SQUARE],
        [540, ScheduleAction.SLEEP, BED],
      ]),
    ]);
    const walker = civilian(sim, 0, HOME, 1);
    const node = getSchedule(t.schedules, 1);
    if (!node) throw new Error('no schedule');
    node.soldier = walker.id;
    node.flags = ScheduleFlags.ACTIVE1 << 1;
    walker.ai.checkSchedule = true;
    walker.ai.asleep = true;
    expect(decideActionSchedule(t, walker)).toBe(AiAction.SCHEDULE_MOVE);
    expect([walker.ai.actionData, walker.absoluteFinalDestination, walker.ai.asleep]).toEqual([BED, BED, false]);
    walker.gridNo = BED;
    expect(decideActionSchedule(t, walker)).toBe(AiAction.NONE);
    expect([walker.ai.asleep, walker.ai.checkSchedule, walker.ai.patrolGrid[0]]).toEqual([true, false, BED]);
    expect(clock.events).toEqual([[DAY_TWO + 450, 1]]);
  });

  it('tests the recruited flag instead of DONT_ADD_TO_SECTOR when the AI enters, and the real flag when auto-processing', () => {
    const { sim } = scheduleSim(DAY_TWO + 480);
    const t = sim.state;
    t.narrative = NO_NARRATIVE_PORT;
    t.schedules = loadMapSchedules([schedule([[480, ScheduleAction.ENTERSECTOR, SQUARE]])]);
    const p = testProfile(FAKE_PROFILE);
    t.profiles.set(FAKE_PROFILE, p);
    const npc = civilian(sim, 0, HOME, 1);
    npc.profile = FAKE_PROFILE;
    const node = getSchedule(t.schedules, 1);
    if (!node) throw new Error('no schedule');
    node.soldier = npc.id;
    node.flags = ScheduleFlags.ACTIVE1;
    npc.ai.checkSchedule = true;
    p.miscFlags2 = 0x01;
    expect(decideActionSchedule(t, npc)).toBe(AiAction.SCHEDULE_MOVE);
    npc.ai.scheduleProgress = 0;
    npc.ai.checkSchedule = true;
    p.miscFlags2 = 0;
    p.miscFlags = 0x01;
    expect(decideActionSchedule(t, npc)).toBe(AiAction.NONE);
    expect(npc.ai.checkSchedule).toBe(false);
  });

  it('extracts the shop hours from the unlock and lock entries', () => {
    const { sim } = scheduleSim(DAY_TWO);
    const t = sim.state;
    t.schedules = loadMapSchedules([
      schedule([
        [540, ScheduleAction.UNLOCKDOOR, HOME, SQUARE],
        [1080, ScheduleAction.LOCKDOOR, HOME, BED],
      ]),
      schedule([[540, ScheduleAction.UNLOCKDOOR, HOME, SQUARE]]),
    ]);
    const dealer = civilian(sim, 0, SQUARE, 1);
    const clerk = civilian(sim, 1, OTHER_HOME, 2);
    expect(extractScheduleDoorLockAndUnlockInfo(t, dealer)).toEqual({ open: 540, close: 1080 });
    expect(extractScheduleDoorLockAndUnlockInfo(t, clerk)).toBeNull();
  });

  it('posts the next entry after the current minute and none for the current minute', () => {
    const { sim, clock } = scheduleSim(DAY_TWO + 1150);
    const t = sim.state;
    t.schedules = loadMapSchedules([
      schedule([
        [450, ScheduleAction.ENTERSECTOR, HOME],
        [1150, ScheduleAction.LEAVESECTOR],
      ]),
    ]);
    const walker = civilian(sim, 0, HOME, 1);
    postNextSchedule(t, walker);
    expect(clock.events).toEqual([[DAY_TWO + 450, 1]]);
  });
});
