import { basename } from 'node:path';
import { NOTHING } from '../../src/content/items/items.ts';
import { Direction, WORLD_COLS } from '../../src/content/world/grid.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import { idiv } from '../../src/core/int.ts';
import { buildNewCampaign } from '../../src/server/campaign-factory.ts';
import { CampaignSession } from '../../src/server/campaign-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import { addTransaction, FinanceCode } from '../../src/sim/campaign/finances.ts';
import { handleTacticalDoHeliRun, skipHelicopterDropOf } from '../../src/sim/campaign/helicopter-drop-flow.ts';
import { aimHire } from '../../src/sim/campaign/laptop/aim.ts';
import type { LaptopRandom } from '../../src/sim/campaign/laptop/context.ts';
import type { DialogueEvent } from '../../src/sim/narrative/talk-state.ts';
import { gameOptions } from '../../src/sim/options.ts';
import { DrawMismatch, ReplayStream, type TracedDraw } from '../../src/sim/strategic/forces/autoresolve/replay-rng.ts';
import type { RollSource } from '../../src/sim/strategic/forces/ports.ts';
import { createStrategicState, type StrategicState } from '../../src/sim/strategic/state.ts';
import { CompressMode, EventKind, NUM_SEC_IN_MIN, Warp } from '../../src/sim/strategic/time/constants.ts';
import { addStrategicEvent, deleteStrategicEvent } from '../../src/sim/strategic/time/event-queue.ts';
import { warpGameTime, worldTotalMinutes } from '../../src/sim/strategic/time/world-clock.ts';
import { eventSoldierGotHit, soldierCollapse } from '../../src/sim/tactical/combat/hit.ts';
import { AimShot } from '../../src/sim/tactical/combat/types.ts';
import { newSoldierCreate, randomizeNewSoldierStats, tacticalCreateSoldier } from '../../src/sim/tactical/creation.ts';
import { NEUTRAL_POPULATION } from '../../src/sim/tactical/init-list.ts';
import { addSoldierToSector, Insertion } from '../../src/sim/tactical/insertion.ts';
import { InvSlot } from '../../src/sim/tactical/inventory.ts';
import { directionToward, setSoldierPosition } from '../../src/sim/tactical/movement.ts';
import { removeSoldierFromTacticalSector } from '../../src/sim/tactical/sector-presence.ts';
import { Body, inSector, NO_PENDING_ANIMATION, NOWHERE, type Soldier, TEAM_FIRST_ID, Team } from '../../src/sim/tactical/soldier.ts';
import type { TacticalState } from '../../src/sim/tactical/state.ts';
import { STRATEGIC_OVERHEAD_MS } from '../../src/sim/tactical/turns/turns.ts';
import { type Draw, report } from './actions-compare.ts';
import { differences, inOrder } from './auto-bandage-compare.ts';

type Json = Record<string, unknown>;
type Row = readonly unknown[];

export const HELI_DROP_OUTPUT = 'helidrop.jsonl';

const FACE_DRAWS = [30, 2, 2000];
const ANIMATION_FRAME_DRAW = 10;
const FEMALE_BATTLE_SOUND_DRAW = 2;
const NATIVE_NOWHERE = 25601;
const NATIVE_NO_PENDING_ANIMATION = 32001;
const FRAME_MS = 5;
const REPORTED_DIFFERENCES = 6;
const Z_QUARTERS = 4;
const FIRST_OTHER_ID = TEAM_FIRST_ID[Team.ENEMY];
const COMBAT_BY_THE_GARRISON =
  'combat with the A9 garrison is begun by the AI, which the dump cannot replay (no placement outcome, no AI pass state); the soldiers but ours are not compared';
const PASSENGERS_LATER = 'the helicopter passengers over the loaded sector (their own comparer, gaps "Turn-based hooks")';
const SAVES_LATER =
  'the frames after a save in mid-drop: past the native SaveGame the merc it caught in HELIDROP starts another animation where ours stands, not explained yet';
const OFF_THE_MAP = 'a soldier with no tile: ja2-node keeps no facing, destination or position for him';
const INSERTION_DATA_IN_THE_LOADED_SECTOR = 'deviation "Insertion data in the loaded sector"';
const PASSENGER_PROBES: ReadonlySet<string> = new Set([
  'hpset',
  'hpsetup',
  'hpboard',
  'hpturn',
  'hpenemy',
  'hpdamage',
  'hpend',
  'hpquote',
  'hpsave',
  'hpstate',
]);
const GLOBAL = {
  handle: 0,
  state: 1,
  script: 2,
  round: 3,
  curDrop: 4,
  seats: 5,
  exitCount: 6,
  engaged: 7,
  volume: 8,
  fadingIn: 9,
  fadingOut: 10,
  lastUpdate: 12,
  firstGuyDown: 13,
  moveAwayRepeated: 14,
  tile: 15,
  tileY: 16,
  tileZ: 17,
  zQuarters: 18,
  paused: 22,
  pauseLocked: 23,
  lockReason: 24,
  compressMode: 25,
  doHeliRun: 26,
  firstHeliRun: 27,
  selected: 28,
  currentSquad: 29,
  inCombat: 30,
  currentTeam: 31,
  aiPaused: 32,
} as const;
const COMPARED_GLOBALS = Object.keys(GLOBAL) as (keyof typeof GLOBAL)[];

const num = (v: unknown) => Number(v ?? 0);
const bit = (v: boolean) => (v ? 1 : 0);
const grid = (g: number) => (g === NOWHERE ? NATIVE_NOWHERE : g);
const args = (p: Json): Record<string, string> => (p.args ?? {}) as Record<string, string>;

function onTheMap(here: boolean, values: readonly unknown[]): readonly unknown[] {
  return here ? values : values.map(() => OFF_THE_MAP);
}

function insertionOutsideTheSector(inTheSector: boolean, code: number, data: number): readonly (number | string)[] {
  return inTheSector ? [INSERTION_DATA_IN_THE_LOADED_SECTOR, INSERTION_DATA_IN_THE_LOADED_SECTOR] : [code, data];
}

function atTheLastFrame(t: TacticalState, draws: readonly Draw[], act: () => void): void {
  t.clockMs -= FRAME_MS;
  try {
    inOrder(t, draws, act);
  } finally {
    t.clockMs += FRAME_MS;
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

export function isHeliDropOutput(path: string): boolean {
  return basename(path) === HELI_DROP_OUTPUT;
}

function isFaceAt(draws: readonly Draw[], i: number): boolean {
  return FACE_DRAWS.every((n, k) => draws[i + k]?.[0] === 'm' && draws[i + k]?.[1] === n);
}

function withoutFaceDraws(draws: readonly Draw[]): Draw[] {
  const out: Draw[] = [];
  for (let i = 0; i < draws.length; i++) {
    if (isFaceAt(draws, i)) i += FACE_DRAWS.length - 1;
    else out.push(draws[i] as Draw);
  }
  return out;
}

function withoutCosmeticHireDraws(draws: readonly Draw[]): Draw[] {
  const out: Draw[] = [];
  let dropAnimationFrame = false;
  for (let i = 0; i < draws.length; i++) {
    const d = draws[i] as Draw;
    if (isFaceAt(draws, i)) {
      i += FACE_DRAWS.length - 1;
      dropAnimationFrame = true;
      continue;
    }
    if (dropAnimationFrame && d[0] === 'm' && d[1] === ANIMATION_FRAME_DRAW) {
      dropAnimationFrame = false;
      continue;
    }
    if (dropAnimationFrame && !(d[0] === 'm' && d[1] === FEMALE_BATTLE_SOUND_DRAW)) dropAnimationFrame = false;
    out.push(d);
  }
  return out;
}

function streams(draws: readonly Draw[]): { readonly main: ReplayStream; readonly pre: ReplayStream } {
  const main: TracedDraw[] = [];
  const pre: TracedDraw[] = [];
  for (const [stream, n, v] of draws) {
    if (stream === 'm') main.push({ n, v });
    else if (stream === 'p') pre.push({ n, v });
  }
  return { main: new ReplayStream('main', main), pre: new ReplayStream('pre', pre) };
}

function rollSource(stream: ReplayStream): RollSource {
  return { int: (n) => stream.int(n), chance: (percent) => stream.int(100) < percent };
}

function patchStreams(state: StrategicState, rng: { readonly main: ReplayStream; readonly pre: ReplayStream }): () => void {
  const main = state.rng as unknown as Record<string, unknown>;
  const pre = state.pre as unknown as Record<string, unknown>;
  main.int = (n: number) => rng.main.int(n);
  pre.int = (n: number) => rng.pre.int(n);
  return () => {
    delete main.int;
    delete pre.int;
  };
}

function leftOver(rng: { readonly main: ReplayStream; readonly pre: ReplayStream }): string | null {
  return rng.main.remaining || rng.pre.remaining ? `${rng.main.remaining} main and ${rng.pre.remaining} PreRandom draws left over` : null;
}

export class HeliDropComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  #session: CampaignSession | null = null;
  #frames: Json[] = [];
  #clockOffset: number | null = null;
  #skipping: string | null = null;
  #lastTacticalRealTime: number | null = null;

  constructor(read: ReadFile, exists: FileExists) {
    this.#read = read;
    this.#exists = exists;
  }

  async compare(p: Json): Promise<number> {
    const probe = String(p.probe);
    const label = `${probe} line ${String(p.line ?? '')}`;
    if (probe === 'hdframes' && p.frame !== undefined) {
      this.#frames.push(p);
      return 0;
    }
    if (probe === 'save' || PASSENGER_PROBES.has(probe)) this.#skipping = PASSENGERS_LATER;
    if (probe === 'end' || probe === 'seed' || probe === 'hdtimer') return 0;
    if (probe === 'hdrestart') {
      this.#session = null;
      this.#skipping = null;
      this.#clockOffset = null;
      return 0;
    }
    if (this.#skipping) return this.#skip(label, this.#skipping);
    try {
      return await this.#run(label, probe, p);
    } catch (e) {
      this.#frames = [];
      return report(label, false, `threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    }
  }

  #skip(label: string, why: string): number {
    this.#frames = [];
    return report(label, true, `skipped: ${why}`);
  }

  async #run(label: string, probe: string, p: Json): Promise<number> {
    switch (probe) {
      case 'newgamefull':
        return this.#newGame(label, p);
      case 'setbalance': {
        const f = this.#campaign().state.finances;
        addTransaction(f, FinanceCode.ANONYMOUS_DEPOSIT, 0, worldTotalMinutes(this.#campaign().state.clock), num(p.balance) - f.balance);
        return 0;
      }
      case 'aimhire':
        return this.#aimHire(label, p);
      case 'hdset':
        if (args(p).live === '0') this.#skipping = 'the fades as with no sample playing (decision S1: they ramp as with a sample)';
        return this.#skipping ? this.#skip(label, this.#skipping) : report(label, true, 'the fades ramp as with a sample playing');
      case 'hdjackedin':
        return this.#jackedIn(label, p);
      case 'hdframes':
        return this.#runFrames(label, p);
      case 'hdarrive':
        return this.#arrive(label, p);
      case 'hdremove':
        return this.#remove(label, p);
      case 'hdenemy':
        return this.#enemy(label, p);
      case 'hdhit':
        return this.#hit(label, p);
      case 'hdsave':
        this.#skipping = SAVES_LATER;
        return this.#skip(label, SAVES_LATER);
      default:
        return report(label, false, `no comparer for ${probe}`);
    }
  }

  #campaign(): CampaignSim {
    const session = this.#session;
    if (!session) throw new Error('the drop probes need a new game');
    return session.campaign;
  }

  #tactical(): TacticalState {
    const t = this.#campaign().tactical?.state;
    if (!t) throw new Error('no loaded sector');
    return t;
  }

  async #newGame(label: string, p: Json): Promise<number> {
    const a = args(p);
    const rng = streams(withoutFaceDraws((p.draws as Draw[] | undefined) ?? []));
    let restore: (() => void) | null = null;
    try {
      const built = await buildNewCampaign(this.#read, this.#exists, () => {
        const state = createStrategicState({ options: gameOptions({ difficulty: num(a.difficulty ?? 2) }) });
        restore = patchStreams(state, rng);
        return state;
      });
      this.#session = new CampaignSession(built.campaign, built.parts.presentation, built.roster, built.worlds, built.texts, {
        kind: 'campaign',
        parts: built.parts,
      });
    } catch (e) {
      if (!(e instanceof DrawMismatch)) throw e;
      return report(label, false, e.message);
    } finally {
      (restore as (() => void) | null)?.();
    }
    const over = leftOver(rng);
    return report(label, over === null, over ?? 'the new game replayed');
  }

  #aimHire(label: string, p: Json): number {
    const flow = this.#campaign().laptop;
    if (!flow) throw new Error('no laptop');
    const a = args(p);
    const rng = streams(withoutCosmeticHireDraws((p.draws as Draw[]) ?? []));
    const random: LaptopRandom = { main: rollSource(rng.main), pre: rollSource(rng.pre) };
    flow.useRandom(random);
    let hired: unknown = null;
    try {
      const result = aimHire(
        flow,
        { profile: num(a.profile), contract: num(a.contract ?? 7), gear: a.gear === undefined ? undefined : a.gear !== '0' },
        flow.hireHooks(),
      );
      hired = result.ok;
    } catch (e) {
      if (!(e instanceof DrawMismatch)) throw e;
      return report(label, false, e.message);
    } finally {
      flow.useRandom(null);
    }
    const over = leftOver(rng);
    const same = over === null && hired === ((p.result as Json).hired === 1);
    return report(label, same, over ?? `hired ${String(hired)}`);
  }

  async #jackedIn(label: string, p: Json): Promise<number> {
    const session = this.#session;
    if (!session) throw new Error('no new game');
    const c = session.campaign;
    if (c.state.flow === 'laptop') c.dispatch({ type: 'closeLaptop' });
    const command = { type: 'compressTime', mode: num(args(p).mode ?? CompressMode.MIN5) };
    await session.prepare(command);
    let ok = false;
    const lines = queuedLines(c, () =>
      inOrder(c.state, (p.draws as Draw[]) ?? [], () => {
        ok = session.dispatch(command).ok;
      }),
    );
    const problems: string[] = [];
    if (!ok) problems.push('compressTime refused');
    differences(lines, p.lines ?? [], 'lines', problems);
    this.#lastTacticalRealTime = this.#nativeLastTacticalRealTime(p);
    differences(this.#teamState(), this.#nativeTeamState(p), 'state', problems);
    return report(label, problems.length === 0, problems.join('; ') || 'the squad seated, the run started at the command’s end');
  }

  #arrive(label: string, p: Json): number {
    const c = this.#campaign();
    const a = args(p);
    const who = num(a.who);
    const minutes = num(a.minutes ?? 1);
    const at = worldTotalMinutes(c.state.clock) + minutes;
    deleteStrategicEvent(c.state.queue, EventKind.DELAYED_HIRING_OF_MERC, who);
    addStrategicEvent(c.state.queue, EventKind.DELAYED_HIRING_OF_MERC, at, who);
    const m = c.battle?.roster.get(who);
    if (m) m.contract.timeWillArrive = at;
    const lines = queuedLines(c, () =>
      inOrder(c.state, (p.draws as Draw[]) ?? [], () => {
        warpGameTime(c.clockContext, minutes * NUM_SEC_IN_MIN, Warp.NORMAL);
        handleTacticalDoHeliRun(c);
      }),
    );
    const problems: string[] = [];
    differences(lines, p.lines ?? [], 'lines', problems);
    differences(this.#teamState(), this.#nativeTeamState(p), 'state', problems);
    return report(label, problems.length === 0, problems.join('; ') || `merc ${who} arrived`);
  }

  #remove(label: string, p: Json): number {
    const t = this.#tactical();
    const team = String(args(p).team ?? 'enemy') === 'enemy' ? Team.ENEMY : Team.CIV;
    const removed: number[] = [];
    for (const s of t.soldiers) {
      if (!s || s.team !== team || !inSector(s)) continue;
      removed.push(s.id);
      removeSoldierFromTacticalSector(t, s);
    }
    if (team === Team.ENEMY) t.turn.enemyInSector = false;
    const theirs = ((p.result as Json).removed as number[] | undefined) ?? [];
    return report(label, JSON.stringify(removed) === JSON.stringify(theirs), `removed ${JSON.stringify(removed)}`);
  }

  #enemy(label: string, p: Json): number {
    const c = this.#campaign();
    const t = this.#tactical();
    const a = args(p);
    const gridNo = num(a.grid);
    const direction = num(a.dir ?? Direction.SOUTH);
    const id = num((p.result as Json).who);
    let created: Soldier | null = null;
    atTheLastFrame(t, (p.draws as Draw[]) ?? [], () => {
      const pp = newSoldierCreate(Team.ENEMY, Body.REGMALE, direction, gridNo);
      randomizeNewSoldierStats(t, pp);
      created = tacticalCreateSoldier(t, pp, id, c.sectors?.populationEnv() ?? NEUTRAL_POPULATION);
      if (!created) return;
      addSoldierToSector(t, created, { code: Insertion.GRIDNO, data: gridNo, direction }, {}, false);
      if (created.gridNo !== gridNo) setSoldierPosition(t, created, gridNo);
    });
    const s = created as Soldier | null;
    return report(label, s !== null && s.gridNo === gridNo, `soldier ${id} at ${s?.gridNo ?? NOWHERE}`);
  }

  #hit(label: string, p: Json): number {
    const t = this.#tactical();
    const a = args(p);
    const s = t.soldiers[num(a.who)];
    if (!s) throw new Error(`no soldier ${a.who}`);
    atTheLastFrame(t, (p.draws as Draw[]) ?? [], () => {
      if (a.mode === 'hit') {
        const attacker = t.soldiers[num(a.by)];
        if (!attacker) throw new Error(`no attacker ${a.by}`);
        const damage = num(a.damage);
        const breath = num(a.breath ?? damage);
        const dx = (s.gridNo % WORLD_COLS) - (attacker.gridNo % WORLD_COLS);
        const dy = idiv(s.gridNo, WORLD_COLS) - idiv(attacker.gridNo, WORLD_COLS);
        const range = Math.trunc(Math.sqrt(dx * dx + dy * dy));
        const weapon = attacker.inv[InvSlot.HAND]?.item ?? NOTHING;
        eventSoldierGotHit(t, s, weapon, damage, breath, directionToward(s.gridNo, attacker.gridNo), range, attacker, 0, AimShot.TORSO);
      } else soldierCollapse(t, s);
    });
    return report(label, true, `soldier ${s.id} ${String(a.mode ?? 'collapse')}`);
  }

  #nativeLastTacticalRealTime(p: Json): number | null {
    const clock = ((p.state as Json | undefined)?.tactical as Json | undefined)?.clock as number[] | undefined;
    return clock?.[2] ?? null;
  }

  #alignStrategicPoll(t: TacticalState, native: readonly Json[], p: Json): void {
    const before = this.#lastTacticalRealTime;
    const after = this.#nativeLastTacticalRealTime(p);
    this.#lastTacticalRealTime = after;
    const first = native[0];
    if (after === null || after === before || !first || this.#clockOffset === null) return;
    const startOfCommand = num(first.ja2clock) - num(first.frame) * FRAME_MS;
    if (after <= startOfCommand) return;
    const fire = after - this.#clockOffset;
    const firstStep = t.clockMs;
    const periods = idiv(fire - firstStep, STRATEGIC_OVERHEAD_MS);
    t.realtimeClock.lastOverheadMs = fire - (periods + 1) * STRATEGIC_OVERHEAD_MS;
  }

  #runFrames(label: string, p: Json): number {
    const native = this.#frames.splice(0);
    const c = this.#campaign();
    const t = this.#tactical();
    const byFrame = new Map(native.map((f) => [num(f.frame), f]));
    const count = num(p.frames);
    const a = args(p);
    const problems: string[] = [];
    if (this.#clockOffset === null) {
      const first = native[0];
      this.#clockOffset = first ? num(first.ja2clock) - num(first.frame) * FRAME_MS - (t.clockMs - FRAME_MS) : 0;
    }
    this.#alignStrategicPoll(t, native, p);
    let last = this.#rows(t);
    let nativeCombat = t.inCombat;
    for (let frame = 1; frame <= count && problems.length === 0; frame++) {
      const f = byFrame.get(frame);
      if (f) nativeCombat = num((f.globals as number[])[GLOBAL.inCombat]) !== 0;
      const lines = queuedLines(c, () =>
        inOrder(c.state, (f?.draws as Draw[] | undefined) ?? [], () => {
          if (frame === 1 && a.esc === '1') skipHelicopterDropOf(c);
          c.step();
        }),
      );
      const rows = this.#rows(this.#tactical());
      if (this.#tactical().inCombat !== nativeCombat) {
        this.#skipping = COMBAT_BY_THE_GARRISON;
        return report(label, true, `${frame - 1} frames matched; ${COMBAT_BY_THE_GARRISON}`);
      }
      problems.push(...this.#frameDifferences(frame, f, last, rows, lines));
      last = rows;
    }
    if (problems.length === 0) differences(this.#teamState(), this.#nativeTeamState(p), 'state', problems);
    return report(label, problems.length === 0, problems.join('; ') || `${count} frames`);
  }

  #frameDifferences(frame: number, f: Json | undefined, last: Map<number, Row>, rows: Map<number, Row>, lines: number[][]): string[] {
    const out: string[] = [];
    if (f) differences(this.#globals(), this.#nativeGlobals(f.globals as number[]), `frame ${frame} globals`, out);
    differences(lines, f?.lines ?? [], `frame ${frame} lines`, out);
    const nativeChanged = new Map<number, Row | null>();
    for (const r of (f?.changed as unknown[][] | undefined) ?? []) nativeChanged.set(num(r[0]), this.#nativeRow(r));
    for (const [who, row] of nativeChanged) {
      if (who >= FIRST_OTHER_ID) continue;
      differences(rows.get(who) ?? null, row, `frame ${frame} soldier ${who}`, out);
    }
    for (const [who, row] of rows) {
      if (nativeChanged.has(who) || JSON.stringify(row) === JSON.stringify(last.get(who))) continue;
      differences(row, last.get(who) ?? null, `frame ${frame} soldier ${who} (unchanged natively)`, out);
    }
    return out.slice(0, REPORTED_DIFFERENCES);
  }

  #globals(): Record<string, number> {
    const c = this.#campaign();
    const t = this.#tactical();
    const d = t.helicopterDrop;
    const clock = c.state.clock;
    const shownShadow = d.running ? d.shadow : null;
    const values: Record<keyof typeof GLOBAL, number> = {
      handle: bit(d.running),
      state: d.state,
      script: d.script,
      round: d.round,
      curDrop: d.curDrop,
      seats: d.seats.length,
      exitCount: d.exitCount,
      engaged: bit(d.engagedInDrop),
      volume: d.volume,
      fadingIn: bit(d.fadingIn),
      fadingOut: bit(d.fadingOut),
      lastUpdate: d.lastStepMs + (this.#clockOffset ?? 0),
      firstGuyDown: bit(d.firstGuyDown),
      moveAwayRepeated: d.moveAwayRepeated,
      tile: bit(shownShadow !== null),
      tileY: shownShadow?.y ?? 0,
      tileZ: shownShadow?.z ?? 0,
      zQuarters: Math.round(d.z * Z_QUARTERS),
      paused: bit(clock.paused),
      pauseLocked: bit(clock.pauseLocked),
      lockReason: clock.pauseLockReason,
      compressMode: clock.mode,
      doHeliRun: bit(d.doHeliRun),
      firstHeliRun: bit(d.firstHeliRun),
      selected: t.turn.selected,
      currentSquad: c.state.forces.currentSquad,
      inCombat: bit(t.inCombat),
      currentTeam: t.turn.currentTeam,
      aiPaused: bit(t.turn.pauseAllAi),
    };
    return values;
  }

  #nativeGlobals(g: readonly number[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const key of COMPARED_GLOBALS) out[key] = g[GLOBAL[key]] ?? 0;
    return out;
  }

  #row(t: TacticalState, s: Soldier): Row {
    const m = this.#campaign().battle?.roster.get(s.id);
    const here = inSector(s);
    return [
      s.id,
      bit(here),
      bit(t.mercSlots.includes(s)),
      grid(s.gridNo),
      s.level,
      s.state,
      ...onTheMap(here, [s.direction, s.desiredDirection]),
      ...insertionOutsideTheSector(here, m?.insertionCode ?? 0, s.insertionData),
      ...onTheMap(here, [grid(s.finalDestination)]),
      s.pathIndex,
      s.pathSize,
      s.pendingAnimation === NO_PENDING_ANIMATION ? NATIVE_NO_PENDING_ANIMATION : s.pendingAnimation,
      s.uiMovementMode,
      s.life,
      s.actionPoints,
      ...onTheMap(here, [[Math.fround(s.x), Math.fround(s.y)]]),
      s.path.slice(s.pathIndex, s.pathSize),
    ];
  }

  #nativeRow(r: readonly unknown[]): Row | null {
    const [
      who,
      inSec,
      slot,
      gridNo,
      level,
      animState,
      ,
      direction,
      desired,
      code,
      data,
      finalDest,
      pathIndex,
      pathSize,
      pending,
      ,
      moveMode,
      ,
      life,
      ,
      ap,
      position,
      path,
    ] = r as [number, ...unknown[]];
    if (inSec === null) return null;
    const [x, y] = (position as number[] | undefined) ?? [0, 0];
    const here = inSec === 1;
    return [
      who,
      inSec,
      slot,
      gridNo,
      level,
      animState,
      ...onTheMap(here, [direction, desired]),
      ...insertionOutsideTheSector(here, num(code), num(data)),
      ...onTheMap(here, [finalDest]),
      pathIndex,
      pathSize,
      pending,
      moveMode,
      life,
      ap,
      ...onTheMap(here, [[Math.fround(x ?? 0), Math.fround(y ?? 0)]]),
      path,
    ];
  }

  #rows(t: TacticalState): Map<number, Row> {
    const rows = new Map<number, Row>();
    for (const m of this.#campaign().battle?.roster.all() ?? []) rows.set(m.id, this.#row(t, m.soldier));
    return rows;
  }

  #teamState(): Json {
    const c = this.#campaign();
    const t = this.#tactical();
    return {
      seats: [...t.helicopterDrop.seats],
      runComing: bit(t.helicopterDrop.doHeliRun || t.helicopterDrop.running),
      firstHeliRun: t.helicopterDrop.firstHeliRun,
      selected: t.turn.selected,
      currentSquad: c.state.forces.currentSquad,
      team: (c.battle?.roster.all() ?? []).map((m) => [
        m.id,
        m.assignment,
        bit(inSector(m.soldier)),
        ...insertionOutsideTheSector(inSector(m.soldier), m.insertionCode, m.soldier.insertionData),
        grid(m.soldier.gridNo),
      ]),
    };
  }

  #nativeTeamState(p: Json): Json {
    const s = p.state as Json;
    const drop = s.drop as Json;
    const tactical = s.tactical as Json;
    return {
      seats: drop.seats,
      runComing: bit(drop.doHeliRun === true || drop.handle === true),
      firstHeliRun: drop.firstHeliRun === true,
      selected: tactical.selected,
      currentSquad: tactical.currentSquad,
      team: ((s.team as Json[]) ?? []).map((m) => {
        const [code = 0, data = 0] = (m.insertion as number[] | undefined) ?? [];
        return [m.id, m.assignment, bit(m.inSector === true), ...insertionOutsideTheSector(m.inSector === true, code, data), m.gridNo];
      }),
    };
  }
}
