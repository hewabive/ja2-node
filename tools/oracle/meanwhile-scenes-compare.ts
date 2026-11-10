import { basename, dirname } from 'node:path';
import { QuoteFlag } from '../../src/content/formats/npc.ts';
import { parseSectorString } from '../../src/content/strategic/sector-ids.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import { MemoryInstallation } from '../../src/sim/campaign/installation.ts';
import type { RosterMerc } from '../../src/sim/campaign/roster.ts';
import { leaveTacticalScreenForTheMap, openTacticalScreen } from '../../src/sim/campaign/screens.ts';
import type { SimEvent } from '../../src/sim/events.ts';
import type { DialogueEvent } from '../../src/sim/narrative/talk-state.ts';
import { Meanwhile } from '../../src/sim/strategic/ai/constants.ts';
import { handleMeanwhileEvent } from '../../src/sim/strategic/ai/meanwhile.ts';
import { PromptKind } from '../../src/sim/strategic/forces/battle-state.ts';
import { getGroup, setGroupSectorValue } from '../../src/sim/strategic/forces/groups.ts';
import { sectorInfo } from '../../src/sim/strategic/map/sectors.ts';
import { EventKind } from '../../src/sim/strategic/time/constants.ts';
import { setGameTimeCompressionLevel } from '../../src/sim/strategic/time/world-clock.ts';
import { Insertion } from '../../src/sim/tactical/insertion.ts';
import { inSector, NOWHERE, type Soldier, Team } from '../../src/sim/tactical/soldier.ts';
import type { TacticalState } from '../../src/sim/tactical/state.ts';
import type { Draw } from './actions-compare.ts';
import { firstDifference, report } from './actions-compare.ts';
import { inOrder } from './auto-bandage-compare.ts';
import { meanwhileProfiles, nativeMeanwhileState, ourMeanwhileState, postMeanwhile, replayedOnQueen } from './meanwhile-compare.ts';
import { createTacticalSaveSession } from './tactical-import.ts';

type Json = Record<string, unknown>;

const SCENES_OUTPUT = 'scenes.jsonl';
const SCENES_DIR = 'meanwhile-scenes';
const IMPORT_SEED = 1;
const MAIN_STREAM = 'm';
const PRE_STREAM = 'p';
const MARK_STREAM = 'k';
const LOAD_BEGIN = 5101;
const LOAD_END = 5100;
const DROPPED_MARKS: ReadonlyMap<number, number> = new Map([
  [301, 302],
  [3001, 3000],
  [4001, 4000],
]);
const NATIVE_NOWHERE = 25601;
const STEP_BUDGET = 40000;
const OK_SKIP = 'okskip';
const OK_ONLY = 'ok';
const BOX_TAKEN =
  'an OK box, which ja2-node takes as given at once (deviation "Meanwhile box timing"): its frame, the box’s own pause lock and the OK come with the next phase';
const GAME_SCREEN = 'game';
const MAP_SCREEN = 'map';
const SCENE_NPC_RECORDS = 'records';
const NO_GARRISON = { numAdmins: 0, numTroops: 0, numElites: 0 };
const REPORTED = 8;
const NO_PROFILE = 200;
const ENDED_WITH_THE_WAY_BACK =
  'ja2-node ends a palace scene and comes back in one step (the fade’s callback waits only for the step): the end is compared with the way back';

const num = (v: unknown) => Number(v ?? 0);
const bit = (v: boolean) => (v ? 1 : 0);
const grid = (g: number) => (g === NOWHERE ? NATIVE_NOWHERE : g);

export function isMeanwhileScenesOutput(path: string): boolean {
  return basename(path) === SCENES_OUTPUT && basename(dirname(path)) === SCENES_DIR;
}

interface SplitDraws {
  readonly plain: Draw[];
  readonly loads: Draw[][];
}

function splitDraws(trace: readonly Draw[]): SplitDraws {
  const plain: Draw[] = [];
  const loads: Draw[][] = [];
  const open: number[] = [];
  let load: Draw[] | null = null;
  for (const d of trace) {
    if (d[0] === MARK_STREAM) {
      if (d[1] === LOAD_BEGIN) load = [];
      else if (d[1] === LOAD_END && load) {
        loads.push(load);
        load = null;
      }
      const end = DROPPED_MARKS.get(d[1]);
      if (end !== undefined) open.push(end);
      else if (open[open.length - 1] === d[1]) open.pop();
      continue;
    }
    if (open.length > 0) continue;
    (load ?? plain).push(d);
  }
  return { plain, loads };
}

class CheckedReplay {
  readonly #draws: readonly Draw[];
  readonly #own: (n: number) => number;
  readonly #name: string;
  #at = 0;
  problem: string | null = null;

  constructor(draws: readonly Draw[], own: (n: number) => number, name: string) {
    this.#draws = draws;
    this.#own = own;
    this.#name = name;
  }

  get left(): number {
    return this.#draws.length - this.#at;
  }

  int(n: number): number {
    if (n === 0) return 0;
    if (this.problem) return this.#own(n);
    const d = this.#draws[this.#at];
    if (!d) {
      this.problem = `${this.#name} #${this.#at}: native log exhausted, ja2-node wants range ${n}`;
      return this.#own(n);
    }
    if (d[1] !== n) {
      this.problem = `${this.#name} #${this.#at}: ja2-node wants range ${n}, native drew ${JSON.stringify(d)}`;
      return this.#own(n);
    }
    this.#at++;
    return d[2];
  }
}

class InOrderFeed {
  readonly #draws: Draw[] = [];
  readonly #own: (n: number) => number;
  #at = 0;

  constructor(own: (n: number) => number) {
    this.#own = own;
  }

  push(draws: readonly Draw[]): void {
    this.#draws.push(...draws);
  }

  int(n: number): number {
    if (n === 0) return 0;
    for (let k = this.#at; k < this.#draws.length; k++) {
      const d = this.#draws[k];
      if (d?.[1] !== n) continue;
      this.#at = k + 1;
      return d[2];
    }
    return this.#own(n);
  }
}

function ownDraw(stream: object): (n: number) => number {
  const generator = Object.getPrototypeOf(stream) as { int(this: object, n: number): number };
  return (n) => generator.int.call(stream, n);
}

interface Strict {
  readonly main: CheckedReplay;
  readonly pre: CheckedReplay;
}

class SceneDraws {
  readonly #main: InOrderFeed;
  readonly #pre: InOrderFeed;
  readonly #loads: Draw[][] = [];
  readonly #ownMain: (n: number) => number;
  readonly #ownPre: (n: number) => number;
  #strict: Strict | null = null;
  readonly problems: string[] = [];
  loadsChecked = 0;

  constructor(c: CampaignSim) {
    this.#ownMain = ownDraw(c.state.rng);
    this.#ownPre = ownDraw(c.state.pre);
    this.#main = new InOrderFeed(this.#ownMain);
    this.#pre = new InOrderFeed(this.#ownPre);
  }

  push(trace: readonly Draw[]): void {
    const { plain, loads } = splitDraws(trace);
    this.#main.push(plain.filter((d) => d[0] === MAIN_STREAM));
    this.#pre.push(plain.filter((d) => d[0] === PRE_STREAM));
    this.#loads.push(...loads);
  }

  main(n: number): number {
    return this.#strict ? this.#strict.main.int(n) : this.#main.int(n);
  }

  pre(n: number): number {
    return this.#strict ? this.#strict.pre.int(n) : this.#pre.int(n);
  }

  strictLoad<T>(what: string, act: () => T): T {
    const load = this.#loads.shift();
    if (!load) {
      this.problems.push(`${what}: no native load left to replay`);
      return act();
    }
    const strict: Strict = {
      main: new CheckedReplay(
        load.filter((d) => d[0] === MAIN_STREAM),
        this.#ownMain,
        `${what} Random`,
      ),
      pre: new CheckedReplay(
        load.filter((d) => d[0] === PRE_STREAM),
        this.#ownPre,
        `${what} PreRandom`,
      ),
    };
    this.#strict = strict;
    try {
      return act();
    } finally {
      this.#strict = null;
      this.loadsChecked++;
      const problem = strict.main.problem ?? strict.pre.problem;
      if (problem) this.problems.push(problem);
      else if (strict.main.left || strict.pre.left)
        this.problems.push(`${what}: ${strict.main.left} Random and ${strict.pre.left} PreRandom native draws left over`);
    }
  }
}

function queuedLines(c: CampaignSim, act: () => void): number[][] {
  const queue = c.talk?.talk.queue;
  const lines: number[][] = [];
  if (!queue) {
    act();
    return lines;
  }
  const push = queue.push;
  queue.push = (...events: DialogueEvent[]) => {
    for (const e of events) if (e.kind === 'quote') lines.push([e.speaker, e.quote]);
    return push.apply(queue, events);
  };
  try {
    act();
  } finally {
    queue.push = push;
  }
  return lines;
}

function withSceneDraws<T>(c: CampaignSim, draws: SceneDraws, act: () => T): T {
  const rng = c.state.rng as unknown as Record<string, unknown>;
  const pre = c.state.pre as unknown as Record<string, unknown>;
  Object.assign(rng, { int: (n: number) => draws.main(n), chance: (x: number) => draws.main(100) < x });
  Object.assign(pre, { int: (n: number) => draws.pre(n), chance: (x: number) => draws.pre(100) < x });
  try {
    return act();
  } finally {
    delete rng.int;
    delete rng.chance;
    delete pre.int;
    delete pre.chance;
  }
}

function strictLoadsOf(c: CampaignSim, draws: SceneDraws): () => void {
  const flow = c.meanwhile as unknown as Record<string, unknown>;
  const goThere = c.meanwhile.goToThePalace.bind(c.meanwhile);
  const comeBack = c.meanwhile.returnFromThePalace.bind(c.meanwhile);
  flow.goToThePalace = () => draws.strictLoad('the hall’s load', goThere);
  flow.returnFromThePalace = () => draws.strictLoad('the way back', comeBack);
  return () => {
    delete flow.goToThePalace;
    delete flow.returnFromThePalace;
  };
}

function sectorTriple(s: { readonly x: number; readonly y: number; readonly z: number } | null | undefined): number[] {
  return s ? [s.x, s.y, s.z] : [0, 0, 0];
}

function ourSoldierRow(s: Soldier): number[] {
  return [s.id, s.team, s.profile, grid(s.gridNo), s.level, s.life, s.bodyType];
}

function nativeSoldierRow(r: readonly number[]): number[] {
  const [id, team, profile, , gridNo, level, life, body] = r;
  return [num(id), num(team), num(profile), num(gridNo), num(level), num(life), num(body)];
}

function ourTeamRow(m: RosterMerc): number[] {
  const s = m.soldier;
  return [s.id, m.sector.x, m.sector.y, m.sector.z, inSector(s) ? 1 : 0, grid(s.gridNo), m.insertionCode, s.insertionData];
}

function differencesOf(ours: unknown, theirs: unknown, what: string): string[] {
  const d = firstDifference(ours, theirs, what);
  return d ? [d] : [];
}

function othersInSector(t: TacticalState): Soldier[] {
  return t.soldiers.filter((s): s is Soldier => !!s && s.team !== Team.OUR && inSector(s));
}

function nativeOthersInSector(state: Json): (readonly number[])[] {
  return ((state.soldiers as number[][]) ?? []).filter((r) => num(r[1]) !== Team.OUR && num(r[3]) !== 0);
}

function nativeTeamRow(r: readonly number[]): number[] {
  const [id, , , here, gridNo, , , , , x, y, z, code, data] = r;
  return [num(id), num(x), num(y), num(z), num(here), num(gridNo), num(code), num(data)];
}

function saidRecords(c: CampaignSim): Json[] {
  const arrays = c.talk?.host.records.arrays ?? [];
  return [75, 135, 79].map((profile) => {
    const records = arrays[profile] ?? null;
    const said = (records ?? []).flatMap((r, i) => (((r?.flags ?? 0) & QuoteFlag.SAID) !== 0 ? [i] : []));
    return { profile, loaded: records !== null, said };
  });
}

function nativeSaid(state: Json): Json[] {
  return ((state[SCENE_NPC_RECORDS] as Json[] | undefined) ?? []).map((r) => ({
    profile: num(r.profile),
    loaded: r.loaded === true,
    said: (r.said as number[] | undefined) ?? [],
  }));
}

function changedFlags(before: readonly number[], after: readonly number[]): number[][] {
  const out: number[][] = [];
  for (const [i, f] of after.entries()) if (f !== before[i]) out.push([i, before[i] ?? 0, f]);
  return out;
}

export class MeanwhileSceneComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  readonly #save: (name: string) => Uint8Array;
  #session: CampaignSession | null = null;
  #installation = new MemoryInstallation();
  #frames: Json[] = [];
  #draws: SceneDraws | null = null;
  #events: SimEvent[] = [];
  #flagsAtLoad: { ours: number[]; theirs: number[] } | null = null;
  #camera: number | null = null;
  #mapScreen = false;
  #nativeEnded: Json | null = null;
  #escPending = false;
  readonly #nativeLines: number[][] = [];

  constructor(read: ReadFile, exists: FileExists, save: (name: string) => Uint8Array) {
    this.#read = read;
    this.#exists = exists;
    this.#save = save;
  }

  async compare(p: Json, loadDraws: readonly Draw[]): Promise<number> {
    const probe = String(p.probe);
    const label = `${probe} line ${String(p.line ?? '')}`;
    if (p.error) return report(label, false, `oracle error: ${String(p.error)}`);
    if (probe === 'mwframes' && p.frame !== undefined) {
      this.#frames.push(p);
      return 0;
    }
    if (probe === 'end' || probe === 'hdtimer' || probe === 'draws' || probe === 'seed') return 0;
    try {
      switch (probe) {
        case 'save':
          return await this.#load(label, p, loadDraws);
        case 'mwset':
          return this.#set(label, p);
        case 'meanwhilepost':
          return this.#post(label, p);
        case 'mwbegin':
          return this.#begin(label, p);
        case 'mwframes':
          return await this.#runFrames(label, p);
        case 'mwstate':
          return report(label, true, 'state printed');
        case 'setnpcprofile':
          return this.#npcProfile(label, p);
        case 'mwsquad':
          return await this.#squad(label, p);
        default:
          return report(label, false, `no comparer for ${probe}`);
      }
    } catch (e) {
      return report(label, false, `threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    }
  }

  #campaign(): CampaignSim {
    const s = this.#session;
    if (!s) throw new Error('the scene probes need a save');
    return s.campaign;
  }

  async #load(label: string, p: Json, loadDraws: readonly Draw[]): Promise<number> {
    this.#frames = [];
    this.#events = [];
    this.#nativeLines.length = 0;
    this.#camera = null;
    this.#mapScreen = false;
    this.#installation = new MemoryInstallation();
    const imported = await createTacticalSaveSession(
      this.#read,
      this.#save(String(p.name)),
      IMPORT_SEED,
      this.#exists,
      undefined,
      undefined,
      (t, restart) => inOrder(t, loadDraws, restart),
    );
    this.#session = imported.session;
    const c = this.#campaign();
    c.meanwhile.useInstallation(this.#installation);
    this.#draws = new SceneDraws(c);
    this.#flagsAtLoad = { ours: this.#ourFlags(), theirs: [] };
    return report(label, true, `imported ${String(p.name)}`);
  }

  #ourFlags(): number[] {
    return this.#campaign().state.map.sectors.map((s) => s.flags);
  }

  #set(label: string, p: Json): number {
    const c = this.#campaign();
    const a = (p.args ?? {}) as Record<string, string>;
    if (a.seen !== undefined) this.#installation.meanwhileScenesSeen = num(a.seen);
    if (a.screen === MAP_SCREEN && c.state.flow !== 'strategic') leaveTacticalScreenForTheMap(c);
    if (a.screen === GAME_SCREEN && c.state.flow !== 'tactical') {
      const entered = openTacticalScreen(c);
      if (!entered.ok) return report(label, false, `cannot enter the loaded sector: ${entered.reason}`);
    }
    if (a.compress !== undefined) setGameTimeCompressionLevel(c.clockContext, num(a.compress));
    const selected = a.select !== undefined ? parseSectorString(a.select) : null;
    if (selected) c.state.map.selectedSector = { x: selected.x, y: selected.y, z: 0 };
    const state = p.state as Json;
    const mw = state.meanwhile as Json;
    c.state.clock.paused = mw.paused === true;
    c.state.clock.pauseLocked = mw.pauseLocked === true;
    c.state.meanwhile.currentId = num(mw.lastScheduled);
    if (this.#flagsAtLoad) this.#flagsAtLoad = { ours: this.#ourFlags(), theirs: (state.sectorFlags as number[]) ?? [] };
    const problems: string[] = [];
    const diff = firstDifference(
      {
        screen: c.state.flow === 'strategic' ? MAP_SCREEN : GAME_SCREEN,
        seen: this.#installation.meanwhileScenesSeen,
        compression: [c.state.clock.mode, bit(c.state.clock.compressionOn)],
        selected: sectorTriple(c.state.map.selectedSector),
      },
      { screen: state.screen, seen: state.seen, compression: state.compression, selected: state.selected },
    );
    if (diff) problems.push(diff);
    return report(label, problems.length === 0, problems.join('; ') || `screen ${String(state.screen)}`);
  }

  #npcProfile(label: string, p: Json): number {
    const a = (p.args ?? {}) as Record<string, string>;
    const profile = this.#campaign().narrative.profile(num(a.id));
    if (!profile) return report(label, false, `no profile ${String(a.id)}`);
    const sector = a.sector !== undefined ? parseSectorString(a.sector) : null;
    if (sector) Object.assign(profile, { sectorX: sector.x, sectorY: sector.y });
    if (a.z !== undefined) profile.sectorZ = num(a.z);
    return report(label, true, `profile ${String(a.id)} in ${profile.sectorX},${profile.sectorY},${profile.sectorZ}`);
  }

  async #squad(label: string, p: Json): Promise<number> {
    const session = this.#session;
    const c = this.#campaign();
    const ctx = c.strategic;
    const roster = c.battle?.roster;
    if (!session || !ctx || !roster || !c.sectors) throw new Error('the session has no strategic layer');
    const a = (p.args ?? {}) as Record<string, string>;
    const sector = parseSectorString(String(a.sector));
    if (!sector) throw new Error(`bad sector ${String(a.sector)}`);
    const grids = String(a.grids).split(',').map(Number);
    Object.assign(sectorInfo(c.state.map, sector), NO_GARRISON);
    String(a.who)
      .split(',')
      .map(Number)
      .forEach((id, i) => {
        const m = roster.get(id);
        if (!m) throw new Error(`no merc ${id}`);
        const group = getGroup(ctx, m.groupId);
        if (group) setGroupSectorValue(ctx, sector, group);
        else m.sector = sector;
        m.insertionCode = Insertion.GRIDNO;
        m.soldier.insertionData = grids[i] ?? NOWHERE;
      });
    await session.prepare({ type: 'enterSector', sector: String(a.sector) });
    let loaded = false;
    inOrder(c.state, (p.draws as Draw[]) ?? [], () => {
      loaded = c.sectors?.setCurrentWorldSector(sector) ?? false;
    });
    if (!loaded) return report(label, false, 'sector map not loaded');
    if (this.#flagsAtLoad) this.#flagsAtLoad = { ours: this.#ourFlags(), theirs: [] };
    const state = p.state as Json;
    const t = c.tactical?.state;
    const problems = t ? this.#loadedSector(c, t, state) : ['no sector loaded'];
    return report(label, problems.length === 0, problems.slice(0, REPORTED).join('; ') || `the squad in ${String(a.sector)}`);
  }

  #post(label: string, p: Json): number {
    const c = this.#campaign();
    const q = c.queen;
    if (!q) return report(label, false, 'no strategic AI');
    const replay = replayedOnQueen(c, q, (p.draws as Draw[]) ?? [], () => postMeanwhile(q, (p.args ?? {}) as Json));
    if (replay) return report(label, false, replay);
    const diff = firstDifference(ourMeanwhileState(c), nativeMeanwhileState(p.meanwhile as Json));
    return report(label, diff === null, diff ?? `posted, flags ${c.state.meanwhile.flags}`);
  }

  #begin(label: string, p: Json): number {
    const c = this.#campaign();
    const q = c.queen;
    if (!q) return report(label, false, 'no strategic AI');
    const events = c.state.queue.events;
    const at = events.findIndex((e) => e.kind === EventKind.MEANWHILE);
    const e = events[at];
    if (!e) return report(label, false, 'no meanwhile event');
    events.splice(at, 1);
    const replay = replayedOnQueen(c, q, (p.draws as Draw[]) ?? [], () => handleMeanwhileEvent(q, e));
    if (replay) return report(label, false, replay);
    const diff = firstDifference(ourMeanwhileState(c), nativeMeanwhileState((p.state as Json).meanwhile as Json));
    return report(label, diff === null, diff ?? `event ${e.param} begun, trying ${c.state.meanwhile.trying}`);
  }

  async #prepareMaps(): Promise<void> {
    const session = this.#session;
    const flow = session?.campaign.sectors;
    if (session && flow) await session.prepareMaps(flow.mapsNeededSoon());
  }

  async #runFrames(label: string, p: Json): Promise<number> {
    const native = this.#frames.splice(0);
    const c = this.#campaign();
    await this.#prepareMaps();
    const draws = this.#draws;
    if (!draws) throw new Error('no draw feed');
    for (const f of native) {
      draws.push((f.draws as Draw[] | undefined) ?? []);
      this.#nativeLines.push(...((f.lines as number[][] | undefined) ?? []));
    }
    const a = (p.args ?? {}) as Record<string, string>;
    const until = a.until ?? '';
    const state = p.state as Json;
    const problems: string[] = [];
    if (p.reached !== true) problems.push(`the native frames did not reach ${until}`);
    const boxes = native.flatMap((f) => (f.boxes as Json[] | undefined) ?? []);
    if (until === 'box') {
      const box = this.#boxFlags(c);
      if (boxes[0]?.flags !== box) problems.push(`box: ours ${box}, oracle ${String(boxes[0]?.flags)}`);
      if (box !== OK_SKIP) return report(label, problems.length === 0, problems.join('; ') || BOX_TAKEN);
    }
    if (until === 'ended') {
      this.#nativeEnded = state;
      this.#escPending = a.esc === '1';
      return report(label, problems.length === 0, problems.join('; ') || ENDED_WITH_THE_WAY_BACK);
    }
    const restore = strictLoadsOf(c, draws);
    const ended = this.#snapshotAtTheEnd(c);
    let steps = 0;
    try {
      const lines = queuedLines(c, () =>
        withSceneDraws(c, draws, () => {
          steps = this.#phase(c, until, a.answer ?? '', num(p.frames), a.esc === '1' || this.#escPending);
        }),
      );
      problems.push(...differencesOf(lines, this.#nativeLines.splice(0), 'lines said'));
    } finally {
      restore();
      ended.restore();
    }
    this.#escPending = false;
    problems.push(...draws.problems.splice(0));
    const nativeEnded = this.#nativeEnded;
    this.#nativeEnded = null;
    if (nativeEnded && ended.snapshot) problems.push(...differencesOf(ended.snapshot, this.#theirEnd(nativeEnded), 'at the end'));
    else if (nativeEnded) problems.push('ja2-node never ended the scene');
    problems.push(...this.#checkpoint(c, until, state));
    return report(
      label,
      problems.length === 0,
      problems.slice(0, REPORTED).join('; ') ||
        `${until}: ${p.frames} native frames, ${steps} ja2-node steps, ${draws.loadsChecked} loads replayed`,
    );
  }

  #snapshotAtTheEnd(c: CampaignSim): { snapshot: Json | null; restore: () => void } {
    const flow = c.meanwhile as unknown as Record<string, unknown>;
    const end = c.meanwhile.endMeanwhile.bind(c.meanwhile);
    const out: { snapshot: Json | null; restore: () => void } = {
      snapshot: null,
      restore: () => {
        delete flow.endMeanwhile;
      },
    };
    flow.endMeanwhile = () => {
      end();
      out.snapshot = this.#ourEnd(c);
    };
    return out;
  }

  #ourEnd(c: CampaignSim): Json {
    const t = c.tactical?.state ?? null;
    return {
      meanwhile: ourMeanwhileState(c),
      seen: this.#installation.meanwhileScenesSeen,
      showAll: t?.pathEnv.showAllMercs ?? false,
      engaged: c.talk?.host.engaged() ?? false,
      refCount: c.talk?.talk.referenceCount ?? 0,
      records: saidRecords(c),
      soldiers: t ? othersInSector(t).map(ourSoldierRow) : [],
    };
  }

  #theirEnd(state: Json): Json {
    return {
      meanwhile: nativeMeanwhileState(state.meanwhile as Json),
      seen: state.seen,
      showAll: state.showAll,
      engaged: state.engaged,
      refCount: state.refCount,
      records: nativeSaid(state),
      soldiers: nativeOthersInSector(state).map(nativeSoldierRow),
    };
  }

  #boxFlags(c: CampaignSim): string {
    const id = c.state.meanwhile.current.id;
    return id !== Meanwhile.INTERROGATION && this.#installation.meanwhileSceneSeen(id) ? OK_SKIP : OK_ONLY;
  }

  #stepUntil(c: CampaignSim, done: () => boolean): number {
    let steps = 0;
    while (!done() && steps < STEP_BUDGET) {
      c.step();
      this.#events.push(...c.drainEvents());
      steps++;
    }
    if (!done()) throw new Error(`no ja2-node state matching the phase after ${STEP_BUDGET} steps`);
    return steps;
  }

  #promptUp(c: CampaignSim): boolean {
    return c.state.battle.prompt?.kind === PromptKind.MEANWHILE;
  }

  #phase(c: CampaignSim, until: string, answer: string, frames: number, esc: boolean): number {
    const m = c.state.meanwhile;
    if (esc) {
      const result = c.dispatch({ type: 'endMeanwhile' });
      this.#events.push(...c.drainEvents());
      if (!result.ok) throw new Error('endMeanwhile refused');
    }
    switch (until) {
      case '': {
        let left = frames;
        return this.#stepUntil(c, () => left-- <= 0);
      }
      case 'box':
        return this.#stepUntil(c, () => this.#promptUp(c));
      case 'loaded':
      case 'back':
      case 'ended':
      case 'scene': {
        if (answer && this.#promptUp(c)) {
          const prompt = c.state.battle.prompt;
          const result = c.dispatch({ type: 'answer', prompt: prompt?.id ?? '', choice: answer });
          this.#events.push(...c.drainEvents());
          if (!result.ok) throw new Error(`answer ${answer} refused`);
        }
        if (until === 'loaded') return this.#stepUntil(c, () => this.#started());
        if (until === 'scene') return this.#stepUntil(c, () => m.inScene && c.state.clock.pauseLocked);
        if (until === 'ended') return this.#stepUntil(c, () => !m.inScene && !m.trying && !this.#promptUp(c));
        return this.#stepUntil(c, () => !m.inScene && !m.trying && m.returnTrip === null && !this.#promptUp(c));
      }
      default:
        throw new Error(`unknown phase ${until}`);
    }
  }

  #started(): boolean {
    const started = this.#events.find((e) => e.type === 'meanwhileStarted') as
      | (SimEvent & { gridNo?: number; mapScreen?: true })
      | undefined;
    if (!started) return false;
    this.#camera = started.gridNo ?? null;
    this.#mapScreen = started.mapScreen === true;
    return true;
  }

  #checkpoint(c: CampaignSim, until: string, state: Json): string[] {
    const problems: string[] = [];
    const t = c.tactical?.state ?? null;
    const m = c.state.meanwhile;
    const nativeMw = state.meanwhile as Json;
    const add = (ours: unknown, theirs: unknown, what: string) => problems.push(...differencesOf(ours, theirs, what));
    add(
      { trying: m.trying, inScene: m.inScene, paused: c.state.clock.paused, pauseLocked: c.state.clock.pauseLocked },
      { trying: nativeMw.trying, inScene: nativeMw.inScene, paused: nativeMw.paused, pauseLocked: nativeMw.pauseLocked },
      'meanwhile',
    );
    add(meanwhileProfiles(c), nativeMw.profiles, 'profiles');
    if (until === 'box') return problems;
    const world = c.tactical ? c.state.worldSector : null;
    add(
      { worldLoaded: world !== null, world: sectorTriple(world), selected: sectorTriple(c.state.map.selectedSector) },
      { worldLoaded: state.worldLoaded, world: state.worldLoaded === true ? state.world : [0, 0, 0], selected: state.selected },
      'sector',
    );
    const before = this.#flagsAtLoad;
    if (before)
      add(changedFlags(before.ours, this.#ourFlags()), changedFlags(before.theirs, (state.sectorFlags as number[]) ?? []), 'sector flags');
    if (until === 'loaded' || until === 'scene') problems.push(...this.#hall(c, state));
    if (until === 'scene') {
      add(
        { engaged: c.talk?.host.engaged() ?? false, refCount: c.talk?.talk.referenceCount ?? 0, showAll: t?.pathEnv.showAllMercs ?? false },
        { engaged: state.engaged, refCount: state.refCount, showAll: state.showAll },
        'scene',
      );
    }
    if (until === 'back') {
      add(
        {
          screen: c.state.flow === 'strategic' ? MAP_SCREEN : GAME_SCREEN,
          seen: this.#installation.meanwhileScenesSeen,
          showAll: t?.pathEnv.showAllMercs ?? false,
          engaged: c.talk?.host.engaged() ?? false,
          refCount: c.talk?.talk.referenceCount ?? 0,
          compression: c.state.clock.mode,
        },
        {
          screen: state.screen,
          seen: state.seen,
          showAll: state.showAll,
          engaged: state.engaged,
          refCount: state.refCount,
          compression: ((state.compression as number[]) ?? [])[0],
        },
        'after the scene',
      );
      add(ourMeanwhileState(c), nativeMeanwhileState(nativeMw), 'meanwhile state');
    }
    if (t) problems.push(...this.#loadedSector(c, t, state));
    return problems;
  }

  #hall(c: CampaignSim, state: Json): string[] {
    const m = c.state.meanwhile;
    const trip = m.returnTrip;
    return [
      ...differencesOf(this.#camera, num(state.camera), 'camera'),
      ...differencesOf(this.#mapScreen, state.oldScreen === MAP_SCREEN, 'started on the map screen'),
      ...differencesOf(this.#camera, num(state.renderGridNo), 'render centre'),
      ...differencesOf(
        m.npcSaves.map((s) => [s.profile, s.sector.x, s.sector.y, s.sector.z, s.gridNo]),
        ((state.npcSaves as number[][]) ?? []).filter((s) => s[0] !== NO_PROFILE),
        'npc saves',
      ),
      ...differencesOf(
        {
          worldWasLoaded: trip?.sector != null,
          oldSelected: sectorTriple(trip?.selectedSector),
          oldScreen: trip?.screen === 'strategic' ? MAP_SCREEN : GAME_SCREEN,
          oldSector: trip?.sector ? sectorTriple(trip.sector) : state.oldSector,
        },
        { worldWasLoaded: state.worldWasLoaded, oldSelected: state.oldSelected, oldScreen: state.oldScreen, oldSector: state.oldSector },
        'return trip',
      ),
    ];
  }

  #loadedSector(c: CampaignSim, t: TacticalState, state: Json): string[] {
    const natives = (state.soldiers as number[][]) ?? [];
    const team = c.battle?.roster.all() ?? [];
    return [
      ...differencesOf(othersInSector(t).map(ourSoldierRow), nativeOthersInSector(state).map(nativeSoldierRow), 'soldiers in sector'),
      ...differencesOf(
        team.map((m) => ourTeamRow(m)),
        natives.filter((r) => num(r[1]) === Team.OUR).map(nativeTeamRow),
        'our team',
      ),
      ...differencesOf(
        t.worldItems
          .filter((w) => w.object.item !== 0)
          .map((w) => [grid(w.gridNo), w.level, w.object.item, w.object.count, w.visible, w.flags])
          .sort(),
        ((state.items as number[][]) ?? []).map((r) => [...r]).sort(),
        'items',
      ),
    ];
  }
}
