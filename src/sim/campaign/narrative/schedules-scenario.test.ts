import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad, runTicks } from '../../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../../tests/support/sectors.ts';
import { pythSpacesAway } from '../../../content/world/grid.ts';
import { CompressMode, EventKind, Warp } from '../../strategic/time/constants.ts';
import { warpGameTime, worldHour, worldTotalMinutes } from '../../strategic/time/world-clock.ts';
import { AiAction } from '../../tactical/ai/actions.ts';
import { getSchedule, ScheduleAction } from '../../tactical/narrative/schedule-state.ts';
import { NO_PROFILE, type Soldier, Team } from '../../tactical/soldier.ts';
import type { CampaignSim } from '../campaign-sim.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const NO_GARRISON = { admins: 0, troops: 0, elites: 0 };
const A10 = { x: 10, y: 1, z: 0 };
const ORIGIN = 66;
const local = (x: number, y: number) => (ORIGIN + y) * 160 + ORIGIN + x;
const VILLAGER_HOME = local(22, 4);
const SQUARE = local(15, 5);
const BED = local(22, 9);
const PASSERBY_HOME = local(5, 10);
const MINUTES_PER_DAY = 1440;
const SECONDS_PER_MINUTE = 60;
const BEFORE_NINE = 8 * 60 + 58;
const MID_MORNING = 10 * 60;
const LEAVE_BUDGET = 200_000;
const STUCK_TICKS = 20_000;
const TILES_PAST_EDGE = 2;
const WALK_BUDGET = 120_000;
const MIN_TILES_WALKED = 5;
const COMPRESSION_BUDGET = 400_000;

function warpToMinuteOfDay(c: CampaignSim, minuteOfDay: number): void {
  const now = worldTotalMinutes(c.state.clock);
  const ahead = (minuteOfDay - (now % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  warpGameTime(c.clockContext, ahead * SECONDS_PER_MINUTE, Warp.NO_PROCESSING);
}

function civilians(c: CampaignSim): { villager: Soldier; passerby: Soldier } {
  const t = c.tactical?.state;
  if (!t) throw new Error('no sector');
  const placed = t.soldiers.filter((s): s is Soldier => s !== undefined && s.team === Team.CIV && s.profile === NO_PROFILE);
  const villager = placed.find((s) => s.initialGridNo === VILLAGER_HOME);
  const passerby = placed.find((s) => s.initialGridNo === PASSERBY_HOME);
  if (!villager || !passerby) throw new Error('stub civilians missing');
  return { villager, passerby };
}

function compressUntil(c: CampaignSim, done: () => boolean): void {
  if (!c.dispatch({ type: 'mapScreen' }).ok) throw new Error('no map screen');
  if (!c.dispatch({ type: 'compressTime', mode: CompressMode.MIN30 }).ok) throw new Error('cannot compress');
  for (let i = 0; i < COMPRESSION_BUDGET && !done(); i++) c.step();
  c.dispatch({ type: 'stopTime' });
  if (!done()) throw new Error('compression budget exhausted');
}

describe('NPC schedules in the stub A10 (docs/25 §5)', () => {
  it('walks the villager to the square at 09:00, puts him to bed by compression and sends the default civilian away overnight', () => {
    const { campaign: c } = createTestCampaign(kit, { seed: 21, garrison: NO_GARRISON });
    landFirstSquad(c);
    warpToMinuteOfDay(c, BEFORE_NINE);
    const flow = c.sectors;
    if (!flow) throw new Error('no sector flow');
    for (const m of flow.setup.roster.all()) m.sector = { ...A10 };
    expect(flow.setCurrentWorldSector(A10)).toBe(true);
    const { villager, passerby } = civilians(c);
    expect([villager.gridNo, villager.ai.asleep]).toEqual([BED, true]);
    expect([passerby.placed, passerby.away]).toEqual([true, false]);
    const t = c.tactical?.state;
    const passerbySchedule = t ? getSchedule(t.schedules, passerby.scheduleId) : null;
    expect(passerbySchedule?.actions.slice(0, 2)).toEqual([ScheduleAction.ENTERSECTOR, ScheduleAction.LEAVESECTOR]);
    const visited = new Set<number>();
    runTicks(c, WALK_BUDGET, () => {
      visited.add(villager.gridNo);
      return villager.gridNo === SQUARE && !villager.ai.checkSchedule;
    });
    expect([villager.gridNo, villager.ai.asleep, villager.ai.checkSchedule]).toEqual([SQUARE, false, false]);
    expect(visited.size).toBeGreaterThan(MIN_TILES_WALKED);
    compressUntil(c, () => worldHour(c.state.clock) === 21);
    expect([passerby.away, passerby.placed]).toEqual([true, false]);
    compressUntil(c, () => worldHour(c.state.clock) === 23);
    expect([villager.gridNo, villager.ai.asleep]).toEqual([BED, true]);
    compressUntil(c, () => worldHour(c.state.clock) === 8);
    expect([passerby.away, passerby.placed, passerby.gridNo]).toEqual([false, true, PASSERBY_HOME]);
  });

  it('walks the default civilian two tiles past the map edge at his leave time and leaves him stuck there, in the sector (kept quirk)', () => {
    const { campaign: c } = createTestCampaign(kit, { seed: 22, garrison: NO_GARRISON });
    landFirstSquad(c);
    warpToMinuteOfDay(c, MID_MORNING);
    const flow = c.sectors;
    if (!flow) throw new Error('no sector flow');
    for (const m of flow.setup.roster.all()) m.sector = { ...A10 };
    expect(flow.setCurrentWorldSector(A10)).toBe(true);
    const t = c.tactical?.state;
    if (!t) throw new Error('no sector');
    const { passerby } = civilians(c);
    const schedule = getSchedule(t.schedules, passerby.scheduleId);
    const leave = schedule?.times[1];
    if (leave === undefined) throw new Error('no default schedule');
    warpToMinuteOfDay(c, leave - 1);
    const pathEnded = () => passerby.offMap && passerby.pathIndex === passerby.pathSize && passerby.ai.action !== AiAction.SCHEDULE_MOVE;
    runTicks(c, LEAVE_BUDGET, pathEnded);
    expect(pathEnded()).toBe(true);
    const edge = passerby.absoluteFinalDestination;
    const offEdge = passerby.gridNo;
    expect(passerby.offWorldGridNo).toBe(edge);
    expect(pythSpacesAway(edge, offEdge)).toBe(TILES_PAST_EDGE);
    runTicks(c, STUCK_TICKS);
    const state = [passerby.gridNo, passerby.away, passerby.offMap, t.awaySlots.includes(passerby), t.mercSlots.includes(passerby)];
    expect(state).toEqual([offEdge, false, true, false, true]);
    expect([passerby.ai.checkSchedule, passerby.ai.scheduleProgress, passerby.absoluteFinalDestination]).toEqual([true, 2, edge]);
    const pending = c.state.queue.events.filter((e) => e.kind === EventKind.PROCESS_TACTICAL_SCHEDULE && e.param === passerby.scheduleId);
    expect(pending).toEqual([]);
  });
});
