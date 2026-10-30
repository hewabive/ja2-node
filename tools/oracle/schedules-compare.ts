import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSaveGame, type SaveGame } from '../../src/content/formats/savegame.ts';
import { parseSaveEncryptionTable, SAVE_ENCRYPTION_PATH } from '../../src/content/formats/savegame-header.ts';
import { parseSectorString } from '../../src/content/strategic/sector-ids.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import { EventKind, Warp } from '../../src/sim/strategic/time/constants.ts';
import { warpGameTime } from '../../src/sim/strategic/time/world-clock.ts';
import { AiAction } from '../../src/sim/tactical/ai/actions.ts';
import { decideActionSchedule } from '../../src/sim/tactical/ai/decide-schedule.ts';
import { isDoorOpenAt } from '../../src/sim/tactical/doors.ts';
import { loadSavedSchedules, type ScheduleNode } from '../../src/sim/tactical/narrative/schedule-state.ts';
import { postSchedules, processTacticalSchedule, setSoldierPositionNoCenter } from '../../src/sim/tactical/narrative/schedules.ts';
import { NOWHERE, type Soldier, TEAM_FIRST_ID, TEAM_SIZES, Team } from '../../src/sim/tactical/soldier.ts';
import type { TacticalState } from '../../src/sim/tactical/state.ts';
import { createTacticalSaveSession } from './tactical-import.ts';

type Json = Record<string, unknown>;
type Draw = readonly [string, number, number, number];

export const SCHEDULE_PROBES: ReadonlySet<string> = new Set([
  'schedules',
  'schedload',
  'schedentry',
  'schedclock',
  'schedwarp',
  'schedprocess',
  'scheddecide',
  'schedshophours',
  'schedmove',
]);

const SEED = 1;
const MAIN_STREAM = 'm';
const MARK_STREAM = 'k';
const SCHEDULES_BEGIN = 2001;
const SCHEDULES_END = 2000;
const PATH_BEGIN = 301;
const PATH_END = 302;
const ORACLE_NOWHERE = 25601;
const SEF_DELETION_PENDING = 0x02;
const SECONDS_PER_MINUTE = 60;
const FIRST_CIV = TEAM_FIRST_ID[Team.CIV] ?? 0;
const LAST_CIV = FIRST_CIV + (TEAM_SIZES[Team.CIV] ?? 0) - 1;

const num = (v: unknown) => Number(v ?? 0);
const grid = (v: unknown) => (num(v) === ORACLE_NOWHERE ? NOWHERE : num(v));

function report(label: string, same: boolean, detail: string): number {
  console.log(`${label}: ${same ? 'ok' : 'MISMATCH'} ${detail}`);
  return same ? 0 : 1;
}

class ReplayMismatch extends Error {}

class StrictReplay {
  readonly #draws: Draw[];
  #at = 0;

  constructor(draws: Draw[]) {
    this.#draws = draws;
  }

  get left(): number {
    return this.#draws.length - this.#at;
  }

  int(n: number): number {
    if (n === 0) return 0;
    const d = this.#draws[this.#at];
    if (!d) throw new ReplayMismatch(`schedule draw #${this.#at}: native log exhausted, ja2-node wants range ${n}`);
    if (d[1] !== n) throw new ReplayMismatch(`schedule draw #${this.#at}: ja2-node wants range ${n}, native drew ${JSON.stringify(d)}`);
    this.#at++;
    return d[2];
  }

  chance(percent: number): boolean {
    return this.int(100) < percent;
  }
}

function scheduleWindowDraws(draws: readonly Draw[]): Draw[] {
  const out: Draw[] = [];
  let inside = false;
  let pathDepth = 0;
  for (const d of draws) {
    if (d[0] === MARK_STREAM && d[1] === SCHEDULES_BEGIN) inside = true;
    else if (d[0] === MARK_STREAM && d[1] === SCHEDULES_END) inside = false;
    else if (d[0] === MARK_STREAM && d[1] === PATH_BEGIN) pathDepth++;
    else if (d[0] === MARK_STREAM && d[1] === PATH_END) pathDepth--;
    else if (inside && pathDepth === 0 && d[0] === MAIN_STREAM) out.push(d);
  }
  return out;
}

function withReplayedSchedules(t: TacticalState, draws: Draw[], run: () => void): string | null {
  const replay = new StrictReplay(draws);
  const saved = t.rng;
  Object.assign(t, { rng: replay });
  try {
    run();
    return replay.left ? `${replay.left} schedule draws left over` : null;
  } catch (e) {
    if (e instanceof ReplayMismatch) return e.message;
    throw e;
  } finally {
    Object.assign(t, { rng: saved });
  }
}

function activeSoldier(s: Soldier | undefined): s is Soldier {
  return s !== undefined && (s.placed || s.offMap || s.away);
}

function nodeDump(n: ScheduleNode): Json {
  return {
    id: n.id,
    flags: n.flags,
    times: [...n.times],
    data1: [...n.data1],
    data2: [...n.data2],
    actions: [...n.actions],
    soldier: n.soldier,
  };
}

function civilianDump(s: Soldier): Json {
  return {
    id: s.id,
    profile: s.profile,
    gridNo: s.gridNo,
    level: s.level,
    inSector: s.placed || s.offMap,
    away: s.away,
    asleep: s.ai.asleep,
    checkSchedule: s.ai.checkSchedule,
    lockIncludesClose: s.ai.lockDoorIncludesClose,
    scheduleId: s.scheduleId,
    progress: s.ai.scheduleProgress,
    initialGridNo: s.initialGridNo,
    offWorldGridNo: s.offWorldGridNo,
    patrol0: s.ai.patrolGrid[0] ?? 0,
    quoteAction: s.quoteActionId,
  };
}

function oracleCivilian(o: Json): Json {
  const { body: _body, life: _life, ...rest } = o;
  return {
    ...rest,
    gridNo: grid(o.gridNo),
    offWorldGridNo: grid(o.offWorldGridNo),
    patrol0: grid(o.patrol0),
    initialGridNo: grid(o.initialGridNo),
  };
}

function ourState(c: CampaignSim): Json {
  const t = c.tactical?.state;
  const q = c.state.queue;
  const civilians: Json[] = [];
  if (t)
    for (let id = FIRST_CIV; id <= LAST_CIV; id++)
      if (activeSoldier(t.soldiers[id])) civilians.push(civilianDump(t.soldiers[id] as Soldier));
  const doors = t
    ? [...t.world.mapDoors.values()]
        .sort((a, b) => a.gridNo - b.gridNo)
        .map((d) => [d.gridNo, d.locked ? 1 : 0, isDoorOpenAt(t, d.gridNo) ? 1 : 0])
    : [];
  return {
    worldSeconds: c.state.clock.seconds,
    lastEventQuery: c.state.clock.lastEventQuerySeconds,
    lastId: t?.schedules.lastId ?? 0,
    schedules: t?.schedules.nodes.map(nodeDump) ?? [],
    civilians,
    doors,
    events: q.events.filter((e) => e.kind === EventKind.PROCESS_TACTICAL_SCHEDULE).map((e) => [e.stamp, e.param]),
  };
}

function theirState(p: Json): Json {
  const st = p.state as Json;
  return {
    worldSeconds: st.worldSeconds,
    lastEventQuery: st.lastEventQuery,
    lastId: st.lastId,
    schedules: st.schedules,
    civilians: (st.civilians as Json[]).map(oracleCivilian),
    doors: [...(st.doors as number[][])].sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0)),
    events: st.events,
  };
}

function firstDifference(ours: unknown, theirs: unknown, path = ''): string | null {
  if (Array.isArray(ours) && Array.isArray(theirs)) {
    if (ours.length !== theirs.length) return `${path}: length ${ours.length} vs ${theirs.length}`;
    for (let i = 0; i < ours.length; i++) {
      const d = firstDifference(ours[i], theirs[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (ours && theirs && typeof ours === 'object' && typeof theirs === 'object') {
    const keys = new Set([...Object.keys(ours), ...Object.keys(theirs)]);
    for (const k of keys) {
      const d = firstDifference((ours as Json)[k], (theirs as Json)[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return ours === theirs ? null : `${path}: ours ${JSON.stringify(ours)} oracle ${JSON.stringify(theirs)}`;
}

export class ScheduleComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  readonly #savesDir: string;
  #session: CampaignSession | null = null;

  constructor(read: ReadFile, exists: FileExists, savesDir: string) {
    this.#read = read;
    this.#exists = exists;
    this.#savesDir = savesDir;
  }

  async #load(name: string, draws: readonly Draw[]): Promise<string | null> {
    const bytes = new Uint8Array(readFileSync(join(this.#savesDir, `${name}.sav`)));
    const table = await this.#read(SAVE_ENCRYPTION_PATH);
    if (!table) throw new Error(`missing ${SAVE_ENCRYPTION_PATH}`);
    const save = parseSaveGame(bytes, parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode(table))));
    const { session } = await createTacticalSaveSession(this.#read, bytes, SEED, this.#exists);
    this.#session = session;
    const t = session.campaign.tactical?.state;
    if (!t) return 'no tactical world after the load';
    revertPostLoadSchedules(session.campaign, t, save);
    return withReplayedSchedules(t, scheduleWindowDraws(draws), () => postSchedules(t, { loadingSave: true }));
  }

  async compare(p: Json): Promise<number> {
    const label = `${String(p.probe)} line ${String(p.line ?? '')}`;
    const a = (p.args as Json | undefined) ?? {};
    const draws = (p.draws as Draw[] | undefined) ?? [];
    let replay: string | null = null;
    let extraOurs: unknown = null;
    let extraTheirs: unknown = null;
    if (p.probe === 'schedload') replay = await this.#load(String(a.name), draws);
    const session = this.#session;
    if (!session) return report(label, false, 'schedule probes need schedload first');
    const c = session.campaign;
    switch (p.probe) {
      case 'schedload':
      case 'schedules':
        break;
      case 'schedentry':
        await session.prepare({ type: 'enterSector', sector: String(a.sector) });
        replay = this.#enter(c, a, draws);
        break;
      case 'schedclock':
        c.state.clock.seconds = num(a.seconds);
        c.state.clock.lastEventQuerySeconds = a.query === undefined ? num(a.seconds) : num(a.query);
        break;
      case 'schedwarp':
        this.#asScreen(c, String(a.screen ?? 'map'), () => warpGameTime(c.clockContext, num(a.minutes) * SECONDS_PER_MINUTE, Warp.NORMAL));
        break;
      case 'schedprocess': {
        const t = c.tactical?.state;
        if (!t) return report(label, false, 'no tactical world');
        processTacticalSchedule(t, num(a.id), String(a.screen ?? 'map') === 'game');
        break;
      }
      case 'scheddecide': {
        const t = c.tactical?.state;
        const s = t?.soldiers[num(a.soldier)];
        if (!t || !s) return report(label, false, 'no such soldier');
        const action = decideActionSchedule(t, s);
        const moved = action !== AiAction.NONE;
        extraOurs = moved
          ? { action, actionData: s.ai.actionData, absoluteFinalDestination: s.absoluteFinalDestination, soldier: s.id }
          : { action, soldier: s.id };
        const r = p.result as Json;
        extraTheirs = moved
          ? {
              action: r.action,
              actionData: grid(r.actionData),
              absoluteFinalDestination: grid(r.absoluteFinalDestination),
              soldier: r.soldier,
            }
          : { action: r.action, soldier: r.soldier };
        break;
      }
      case 'schedmove': {
        const t = c.tactical?.state;
        const s = t?.soldiers[num(a.soldier)];
        if (!t || !s) return report(label, false, 'no such soldier');
        setSoldierPositionNoCenter(t, s, num(a.gridNo));
        break;
      }
      case 'schedshophours': {
        const hours = c.merchants?.hooks.shopHours(num(a.profile)) ?? null;
        extraOurs = hours ? { found: true, open: hours.open, close: hours.close } : { found: false, open: 0, close: 0 };
        extraTheirs = p.result;
        break;
      }
      default:
        return report(label, false, 'unknown schedule probe');
    }
    if (replay) return report(label, false, replay);
    const ours = { state: ourState(c), extra: extraOurs };
    const theirs = { state: theirState(p), extra: extraTheirs };
    const diff = firstDifference(ours, theirs);
    const st = p.state as Json;
    return report(
      label,
      diff === null,
      diff ?? `${(st.schedules as unknown[]).length} schedules, ${(st.events as unknown[]).length} events`,
    );
  }

  #enter(c: CampaignSim, a: Json, draws: readonly Draw[]): string | null {
    const flow = c.sectors;
    if (!flow) return 'no sector flow';
    const sector = parseSectorString(String(a.sector), num(a.z));
    let replayed: string | null = 'PostSchedules did not run';
    const window = scheduleWindowDraws(draws);
    flow.postSchedulesOfLoadedSector = (t, loadingSave) => {
      replayed = withReplayedSchedules(t, window, () => postSchedules(t, { loadingSave }));
    };
    try {
      for (const m of flow.setup.roster.all()) {
        m.betweenSectors = false;
        m.sector = { ...sector };
      }
      if (!flow.setCurrentWorldSector(sector)) return 'sector map not loaded';
    } finally {
      delete (flow as { postSchedulesOfLoadedSector?: unknown }).postSchedulesOfLoadedSector;
    }
    return replayed;
  }

  #asScreen(c: CampaignSim, screen: string, run: () => void): void {
    const saved = c.state.flow;
    c.state.flow = screen === 'game' ? 'tactical' : 'strategic';
    try {
      run();
    } finally {
      c.state.flow = saved;
    }
  }
}

function revertPostLoadSchedules(c: CampaignSim, t: TacticalState, save: SaveGame): void {
  t.schedules = loadSavedSchedules(save.schedules, (id) => activeSoldier(t.soldiers[id]));
  for (const entry of save.soldiers) {
    const s = t.soldiers[entry.soldier.id];
    if (activeSoldier(s)) s.scheduleId = entry.soldier.ai.scheduleId;
  }
  const saved = save.strategicEvents.filter(
    (e) => e.callbackId === EventKind.PROCESS_TACTICAL_SCHEDULE && !(e.flags & SEF_DELETION_PENDING),
  );
  const q = c.state.queue;
  const posted = q.events
    .filter((e) => e.kind === EventKind.PROCESS_TACTICAL_SCHEDULE)
    .sort((x, y) => x.seq - y.seq)
    .slice(saved.length);
  q.events.splice(0, q.events.length, ...q.events.filter((e) => !posted.includes(e)));
}
