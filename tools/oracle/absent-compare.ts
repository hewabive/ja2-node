import { parseSectorString, type Sector } from '../../src/content/strategic/sector-ids.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import type { RosterMerc } from '../../src/sim/campaign/roster.ts';
import { sectorKey } from '../../src/sim/campaign/sector-diff.ts';
import { UnloadCode } from '../../src/sim/campaign/sector-flow.ts';
import { handleMapScreenRealtimeTurns } from '../../src/sim/campaign/turn-world.ts';
import { createItem } from '../../src/sim/items/object.ts';
import type { DialogueEvent } from '../../src/sim/narrative/talk-state.ts';
import { EventKind } from '../../src/sim/strategic/time/constants.ts';
import { isTimeBeingCompressed } from '../../src/sim/strategic/time/world-clock.ts';
import { anim } from '../../src/sim/tactical/anim-states.ts';
import { soldierTakeDamage } from '../../src/sim/tactical/combat/hit.ts';
import { DamageReason } from '../../src/sim/tactical/combat/types.ts';
import { newSmokeEffect, smokeEffectOnTile } from '../../src/sim/tactical/explosions/smoke.ts';
import { setSoldierPosition } from '../../src/sim/tactical/movement.ts';
import { restoreFogOfWar } from '../../src/sim/tactical/perception/fov.ts';
import { type DrugCourse, NOWHERE, Personality, type Soldier, Team } from '../../src/sim/tactical/soldier.ts';
import type { RealtimeClock, TacticalState } from '../../src/sim/tactical/state.ts';
import type { TacticalSim } from '../../src/sim/tactical/tactical-sim.ts';
import { beginTeamTurn, handleRealtimeTurns, handleTacticalEndTurn, STRATEGIC_OVERHEAD_MS } from '../../src/sim/tactical/turns/turns.ts';
import { addItemToPool, Visibility } from '../../src/sim/tactical/world-items.ts';
import { type Draw, firstDifference, ReplayMismatch, report, StrictReplay } from './actions-compare.ts';
import { createTacticalSaveSession } from './tactical-import.ts';

type Json = Record<string, unknown>;
type Row = readonly number[];

export const ABSENT_PROBES: ReadonlySet<string> = new Set([
  'abclock',
  'abscreen',
  'abcompress',
  'abaway',
  'abset',
  'abturn',
  'abpoll',
  'abteamturn',
  'abdamage',
  'absmoke',
  'abhide',
  'ablight',
  'abrecords',
  'abunload',
]);

const SEED = 1;
const MAIN_STREAM = 'm';
const PRE_STREAM = 'p';
const MARK_STREAM = 'k';
const DROPPED_MARKS: ReadonlyMap<number, number> = new Map([
  [301, 302],
  [3001, 3000],
  [4001, 4000],
]);
const NATIVE_NOWHERE = 25601;
const DEFAULT_POLL_STEP_MS = 20;
const DEFAULT_ITEM_STATUS = 100;
const NOT_RAISED = 0;
const CORPSE_FIND_SWEETSPOT = 1;
const REPORTED_DIFFERENCES = 6;
const PERSONALITIES: Readonly<Record<string, number>> = {
  none: Personality.NONE,
  claustrophobic: Personality.CLAUSTROPHOBIC,
  nervous: Personality.NERVOUS,
};
const DAMAGE_REASONS: Readonly<Record<string, number>> = {
  bloodloss: DamageReason.BLOODLOSS,
  gas: DamageReason.GAS,
  gunfire: DamageReason.GUNFIRE,
};

const num = (v: unknown) => Number(v ?? 0);
const has = (a: Json, key: string) => a[key] !== undefined;
const grid = (g: number) => (g === NOWHERE ? NATIVE_NOWHERE : g);
const bit = (b: boolean) => (b ? 1 : 0);

function withoutDroppedDraws(trace: readonly Draw[]): Draw[] {
  const kept: Draw[] = [];
  const open: number[] = [];
  for (const d of trace) {
    if (d[0] === MARK_STREAM) {
      const end = DROPPED_MARKS.get(d[1]);
      if (end !== undefined) open.push(end);
      else if (open[open.length - 1] === d[1]) open.pop();
      continue;
    }
    if (open.length === 0) kept.push(d);
  }
  return kept;
}

function differences(ours: unknown, theirs: unknown, path: string, out: string[]): void {
  if (out.length >= REPORTED_DIFFERENCES) return;
  if (Array.isArray(ours) && Array.isArray(theirs) && ours.length === theirs.length) {
    for (const [i, o] of ours.entries()) differences(o, theirs[i], `${path}[${i}]`, out);
    return;
  }
  if (ours && theirs && typeof ours === 'object' && typeof theirs === 'object' && !Array.isArray(ours) && !Array.isArray(theirs)) {
    for (const k of new Set([...Object.keys(ours), ...Object.keys(theirs)]))
      differences((ours as Json)[k], (theirs as Json)[k], `${path}.${k}`, out);
    return;
  }
  const diff = firstDifference(ours, theirs, path);
  if (diff) out.push(diff);
}

function sectorArgument(a: Json): Sector {
  const s = parseSectorString(String(a.sector ?? ''));
  if (!s) throw new Error(`bad sector ${String(a.sector)}`);
  return { ...s, z: num(a.z) };
}

function courseRow(c: DrugCourse): number[] {
  return [c.future, c.rate, c.effect, c.sideEffectRate, c.sideEffect];
}

function rowKey(r: Row): string {
  return r.join(',');
}

function withoutRows(rows: readonly Row[], removed: readonly Row[]): Row[] {
  const left = new Map<string, number>();
  for (const r of removed) left.set(rowKey(r), (left.get(rowKey(r)) ?? 0) + 1);
  return rows.filter((r) => {
    const n = left.get(rowKey(r)) ?? 0;
    if (n === 0) return true;
    left.set(rowKey(r), n - 1);
    return false;
  });
}

function sortedRows(rows: readonly Row[]): Row[] {
  return [...rows].sort((x, y) => rowKey(x).localeCompare(rowKey(y)));
}

interface Records {
  readonly items: Row[];
  readonly corpses: Row[];
}

interface Baseline {
  readonly native: Records;
  readonly ours: Records;
  readonly watched: Set<number>;
}

interface Run {
  readonly problems: string[];
  readonly result: unknown;
  readonly turnsRun: number;
  readonly nativeResult?: unknown;
}

export class AbsentComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  #bytes: Uint8Array | null = null;
  #session: CampaignSession | null = null;
  #historyBase = 0;
  #mapScreen = false;
  #ja2Clock = 0;
  #screenSet = false;
  #compressionSet = false;
  #lightEvent = false;
  #unloaded = false;
  readonly #baselines = new Map<string, Baseline>();

  constructor(read: ReadFile, exists: FileExists) {
    this.#read = read;
    this.#exists = exists;
  }

  loadSave(bytes: Uint8Array): void {
    this.#bytes = bytes;
    this.#session = null;
    this.#historyBase = 0;
    this.#screenSet = false;
    this.#compressionSet = false;
    this.#lightEvent = false;
    this.#unloaded = false;
    this.#baselines.clear();
  }

  async #campaign(): Promise<CampaignSim> {
    if (!this.#session) {
      if (!this.#bytes) throw new Error('absent probes need a save');
      this.#session = (await createTacticalSaveSession(this.#read, this.#bytes, SEED, this.#exists)).session;
      this.#mapScreen = this.#session.campaign.state.flow === 'strategic';
    }
    return this.#session.campaign;
  }

  async compare(p: Json): Promise<number> {
    const label = `${String(p.probe)} line ${String(p.line ?? '')}`;
    try {
      const c = await this.#campaign();
      const a = (p.args as Json | undefined) ?? {};
      const queued = this.#queue(c).length;
      const run = this.#run(c, p, a);
      const problems = [...run.problems];
      const lines = this.#queue(c)
        .slice(queued)
        .flatMap((e) => (e.kind === 'quote' ? [[e.speaker, e.quote]] : []));
      const ours = { result: run.result, turnsRun: run.turnsRun, lines, state: this.#state(c, p) };
      const theirs = {
        result: run.nativeResult === undefined ? (p.result ?? null) : run.nativeResult,
        turnsRun: p.turnsRun,
        lines: p.lines,
        state: this.#nativeState(p),
      };
      differences(ours, theirs, '', problems);
      return report(label, problems.length === 0, problems.join('; '));
    } catch (e) {
      return report(label, false, `threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    }
  }

  #queue(c: CampaignSim): readonly DialogueEvent[] {
    return c.talk?.talk.queue ?? [];
  }

  #clock(c: CampaignSim): RealtimeClock {
    return c.state.sectorFlow.realtimeClock;
  }

  #loaded(c: CampaignSim): TacticalState | null {
    return c.tactical?.state ?? null;
  }

  #world(c: CampaignSim): TacticalSim {
    const w = c.turnWorld();
    if (!w) throw new Error('no turn world');
    return w;
  }

  #merc(c: CampaignSim, id: number): RosterMerc | null {
    return c.battle?.roster.get(id) ?? null;
  }

  #soldier(c: CampaignSim, id: unknown): Soldier {
    const s = this.#merc(c, num(id))?.soldier ?? this.#loaded(c)?.soldiers[num(id)];
    if (!s) throw new Error(`no soldier ${String(id)}`);
    return s;
  }

  #replay(c: CampaignSim, p: Json, action: () => unknown): { problems: string[]; result: unknown } {
    const draws = withoutDroppedDraws((p.draws as Draw[] | undefined) ?? []);
    const main = new StrictReplay(
      draws.filter((d) => d[0] === MAIN_STREAM),
      'Random',
    );
    const pre = new StrictReplay(
      draws.filter((d) => d[0] === PRE_STREAM),
      'PreRandom',
    );
    const rng = c.state.rng as unknown as Record<string, unknown>;
    const preRng = c.state.pre as unknown as Record<string, unknown>;
    Object.assign(rng, { int: (n: number) => main.int(n), chance: (x: number) => main.int(100) < x });
    Object.assign(preRng, { int: (n: number) => pre.int(n), chance: (x: number) => pre.int(100) < x });
    const problems: string[] = [];
    let result: unknown = null;
    try {
      result = action();
      if (main.left || pre.left) problems.push(`${main.left} Random and ${pre.left} PreRandom draws left over`);
    } catch (e) {
      if (e instanceof ReplayMismatch) problems.push(e.message);
      else throw e;
    } finally {
      delete rng.int;
      delete rng.chance;
      delete preRng.int;
      delete preRng.chance;
    }
    return { problems, result };
  }

  #counted(c: CampaignSim, action: () => unknown): { turns: number; result: unknown } {
    const worlds = [this.#loaded(c), c.turnWorld()?.state ?? null].filter((t): t is TacticalState => t !== null);
    const unique = [...new Set(worlds)];
    let turns = 0;
    const saved = unique.map((t) => t.sectorHooks);
    for (const t of unique) {
      const hooks = t.sectorHooks;
      t.sectorHooks = {
        ...hooks,
        tacticalTurnEnded: (x) => {
          turns++;
          hooks.tacticalTurnEnded(x);
        },
      };
    }
    try {
      const result = action();
      return { turns, result };
    } finally {
      unique.forEach((t, i) => {
        const hooks = saved[i];
        if (hooks) t.sectorHooks = hooks;
      });
    }
  }

  #run(c: CampaignSim, p: Json, a: Json): Run {
    const plain = (result: unknown = null): Run => ({ problems: [], result, turnsRun: 0 });
    switch (p.probe) {
      case 'abclock':
        this.#setClock(c, a);
        return plain();
      case 'abscreen':
        this.#setScreen(c, String(a.screen ?? a._0 ?? 'game') === 'map');
        return plain();
      case 'abcompress': {
        const clock = c.state.clock;
        clock.mode = num(a.mode);
        clock.compressionOn = num(a.on) !== 0;
        clock.paused = num(a.paused) !== 0;
        this.#compressionSet = true;
        return plain();
      }
      case 'abaway':
        this.#away(c, a);
        return plain();
      case 'abset':
        this.#set(c, a);
        return plain();
      case 'abturn':
        return this.#turns(c, p, () => {
          const world = this.#world(c);
          for (let i = 0; i < (has(a, 'count') ? num(a.count) : 1); i++) handleTacticalEndTurn(world.state, this.#clock(c));
          return null;
        });
      case 'abpoll':
        return this.#poll(c, p, a);
      case 'abteamturn':
        return this.#turns(c, p, () => {
          const t = this.#loaded(c);
          if (!t) throw new Error('no loaded sector');
          beginTeamTurn(t, Team.OUR);
          this.#realtimeTurnOnCombatExit(c, t);
          return null;
        });
      case 'abdamage':
        return this.#turns(c, p, () => {
          const s = this.#soldier(c, a.who);
          const damage = num(a.damage);
          const breath = has(a, 'breath') ? num(a.breath) : damage;
          const reason = DAMAGE_REASONS[String(a.reason ?? 'bloodloss')] ?? DamageReason.BLOODLOSS;
          return { combined: soldierTakeDamage(this.#world(c).state, s, damage, breath, reason, null) };
        });
      case 'absmoke':
        return this.#turns(c, p, () => {
          const t = this.#world(c).state;
          const level = num(a.level);
          newSmokeEffect(t, num(a.grid), this.#item(t, String(a.item ?? 'SMOKE_GRENADE')), level, null);
          return { smoke: smokeEffectOnTile(t, num(a.grid), level) };
        });
      case 'abhide':
        this.#hide(c, a);
        return plain();
      case 'ablight':
        this.#lightEvent = true;
        return this.#turns(c, p, () => {
          c.dispatchTable.execute(c, { stamp: 0, kind: EventKind.CHANGELIGHTVAL, frequency: 0, param: num(a.value), offset: 0, seq: 0 });
          return null;
        });
      case 'abrecords':
        return { ...plain(), ...this.#records(c, p, a) };
      case 'abunload':
        return this.#turns(c, p, () => {
          const flow = c.sectors;
          if (!flow) throw new Error('no sector flow');
          flow.handleDefiniteUnloadingOfWorld(UnloadCode.ABOUT_TO_TRASH_WORLD);
          flow.trashWorld();
          this.#unloaded = true;
          return null;
        });
      default:
        throw new Error('unknown absent probe');
    }
  }

  #turns(c: CampaignSim, p: Json, action: () => unknown): Run {
    let turns = 0;
    const replayed = this.#replay(c, p, () => {
      const counted = this.#counted(c, action);
      turns = counted.turns;
      return counted.result;
    });
    return { problems: replayed.problems, result: replayed.result, turnsRun: turns };
  }

  #realtimeTurnOnCombatExit(c: CampaignSim, t: TacticalState): void {
    if (t.inCombat || !t.turn.forceRealtimeTurn) return;
    t.clockMs = this.#ja2Clock;
    handleRealtimeTurns(t, this.#clock(c));
  }

  #setClock(c: CampaignSim, a: Json): void {
    const rc = this.#clock(c);
    if (has(a, 'ja2clock')) this.#ja2Clock = num(a.ja2clock);
    if (has(a, 'last')) rc.lastTurnMs = num(a.last);
    if (has(a, 'rotting')) rc.lastRottingCorpsesSeconds = num(a.rotting);
    if (has(a, 'seconds')) c.state.clock.seconds = num(a.seconds);
    const t = this.#loaded(c);
    if (has(a, 'decay') && t) t.smell.lastDecaySeconds = num(a.decay);
    if (has(a, 'z') && t?.sector) t.sector = { ...t.sector, z: num(a.z) };
    if (num(a.base) !== 0) this.#historyBase = c.state.laptop.history.length;
  }

  #setScreen(c: CampaignSim, map: boolean): void {
    this.#mapScreen = map;
    this.#screenSet = true;
    if (map) c.state.flow = 'strategic';
    else if (c.tactical) c.state.flow = 'tactical';
  }

  #away(c: CampaignSim, a: Json): void {
    const m = this.#merc(c, num(a.who));
    if (!m) throw new Error(`no merc ${String(a.who)}`);
    c.sectors?.removeMercFromTacticalSector(m);
    m.sector = sectorArgument(a);
    m.betweenSectors = num(a.between) !== 0;
  }

  #item(t: TacticalState, name: string): number {
    if (/^\d+$/.test(name)) return Number(name);
    const item = t.content.items.byName.get(name)?.index;
    if (item === undefined) throw new Error(`unknown item ${name}`);
    return item;
  }

  #set(c: CampaignSim, a: Json): void {
    const s = this.#soldier(c, a.who);
    const m = this.#merc(c, num(a.who));
    if (has(a, 'life')) s.life = num(a.life);
    if (has(a, 'lifeMax')) s.lifeMax = num(a.lifeMax);
    if (has(a, 'bleeding')) s.bleeding = num(a.bleeding);
    if (has(a, 'breath')) s.breath = num(a.breath);
    if (has(a, 'breathMax')) s.breathMax = num(a.breathMax);
    if (has(a, 'breathRed')) s.breathRed = num(a.breathRed);
    if (has(a, 'ap')) s.actionPoints = num(a.ap);
    if (has(a, 'shock')) s.shock = num(a.shock);
    if (has(a, 'blinded')) s.blindedCounter = num(a.blinded);
    if (has(a, 'morale')) s.morale = num(a.morale);
    if (has(a, 'terrain')) s.overTerrain = num(a.terrain);
    if (has(a, 'regen')) s.regenerationCounter = num(a.regen);
    if (has(a, 'collapsed')) s.collapsed = num(a.collapsed) !== 0;
    if (has(a, 'nextBleed')) s.nextBleed = Math.fround(num(a.nextBleed));
    if (has(a, 'gassed')) s.gassed = num(a.gassed) !== 0;
    const world = this.#world(c).state;
    if (has(a, 'anim')) s.state = anim(world.content, String(a.anim));
    for (const course of String(a.drug ?? '')
      .split(',')
      .filter((x) => x !== '')) {
      const [kind = 0, future = 0, rate = 0, effect = 0, sideEffectRate = 0, sideEffect = 0] = course.split(':').map(Number);
      Object.assign(kind === 0 ? s.drugs.adrenaline : s.drugs.alcohol, { future, rate, effect, sideEffectRate, sideEffect });
    }
    if (has(a, 'key')) {
      const [pos = 0, keyId = 0, count = 0] = String(a.key).split(':').map(Number);
      if (!s.keyRing) throw new Error('no key ring');
      s.keyRing[pos] = { keyId, count };
    }
    if (has(a, 'insurance') && m) {
      m.contract.lifeInsurance = num(a.insurance);
      m.contract.startTimeOfInsuranceContract = num(a.insuredAt);
    }
    const profile = c.contracts?.profile(s.profile) ?? null;
    if (has(a, 'buddy') && profile) profile.buddies[0] = num(a.buddy);
    if (has(a, 'personality')) s.personalityTrait = PERSONALITIES[String(a.personality)] ?? Personality.NONE;
    if (has(a, 'grid')) {
      const t = this.#loaded(c);
      if (!t) throw new Error('no loaded sector');
      setSoldierPosition(t, s, num(a.grid));
    }
  }

  #hide(c: CampaignSim, a: Json): void {
    const t = this.#loaded(c);
    if (!t) throw new Error('no loaded sector');
    const room = num(a.room);
    const roomHidden = Uint8Array.from(t.fog.roomHidden, (hidden, r) => (r === room ? 1 : hidden));
    restoreFogOfWar(t, Uint8Array.from(t.fog.revealed), roomHidden);
    if (!has(a, 'item')) return;
    const o = createItem(t.content.items, this.#item(t, String(a.item)), has(a, 'status') ? num(a.status) : DEFAULT_ITEM_STATUS);
    addItemToPool(t, num(a.at), o, Visibility.INVISIBLE, 0, 0, NOT_RAISED);
  }

  #poll(c: CampaignSim, p: Json, a: Json): Run {
    const rc = this.#clock(c);
    const count = has(a, 'count') ? num(a.count) : 1;
    const step = has(a, 'step') ? num(a.step) : DEFAULT_POLL_STEP_MS;
    const polls: number[][] = [];
    const run = this.#turns(c, p, () => {
      let turns = 0;
      for (let i = 0; i < count; i++) {
        const now = num(a.now) + i * step;
        this.#ja2Clock = now;
        rc.lastOverheadMs = now - STRATEGIC_OVERHEAD_MS;
        const counted = this.#counted(c, () => this.#pollOnce(c, now));
        turns += counted.turns;
        polls.push([now, rc.lastTurnMs, turns]);
      }
      return null;
    });
    return { ...run, result: { polls }, turnsRun: polls[polls.length - 1]?.[2] ?? 0 };
  }

  #pollOnce(c: CampaignSim, now: number): void {
    const t = this.#loaded(c);
    if (this.#mapScreen || !t) {
      c.state.realMs = now;
      handleMapScreenRealtimeTurns(c);
      return;
    }
    t.clockMs = now;
    handleRealtimeTurns(t, this.#clock(c));
  }

  #ourRecords(c: CampaignSim, sector: Sector): Records {
    const diff = c.state.sectorDiffs.get(sectorKey(sector));
    const items = (diff?.items ?? [])
      .filter((wi) => wi.exists)
      .map((wi) => [wi.gridNo, wi.level, wi.flags, wi.visible, wi.object.item, wi.object.count, wi.object.status[0] ?? 0]);
    const corpses = (diff?.corpses ?? []).map((k) => [
      k.type,
      k.bodyType,
      k.gridNo,
      k.level,
      k.findSweetSpot ? CORPSE_FIND_SWEETSPOT : 0,
      k.profile,
      k.direction,
      k.timeOfDeath,
      k.heightAdjustment,
    ]);
    return { items, corpses };
  }

  #nativeRecords(p: Json): Records {
    const r = (p.result as Json | undefined) ?? {};
    const items = (r.items as number[][] | undefined) ?? [];
    const corpses = ((r.corpses as number[][] | undefined) ?? []).map((row) => row.slice(0, 9));
    return { items, corpses };
  }

  #records(c: CampaignSim, p: Json, a: Json): { result: Records; nativeResult: Records } {
    const sector = sectorArgument(a);
    const key = sectorKey(sector);
    const native = this.#nativeRecords(p);
    const ours = this.#ourRecords(c, sector);
    const base = this.#baselines.get(key);
    if (!base) {
      this.#baselines.set(key, { native, ours, watched: new Set() });
      return { result: { items: [], corpses: [] }, nativeResult: { items: [], corpses: [] } };
    }
    if (this.#unloaded) {
      const watched = (r: Records): Records => ({
        items: sortedRows(r.items.filter((row) => base.watched.has(row[0] ?? 0))),
        corpses: sortedRows(r.corpses.filter((row) => base.watched.has(row[2] ?? 0))),
      });
      return { result: watched(ours), nativeResult: watched(native) };
    }
    const added = (now: Records, before: Records): Records => ({
      items: sortedRows(withoutRows(now.items, before.items)),
      corpses: sortedRows(withoutRows(now.corpses, before.corpses)),
    });
    const nativeAdded = added(native, base.native);
    for (const r of nativeAdded.items) base.watched.add(r[0] ?? 0);
    for (const r of nativeAdded.corpses) base.watched.add(r[2] ?? 0);
    return { result: added(ours, base.ours), nativeResult: nativeAdded };
  }

  #nativeMercRow(m: Json): Json {
    const alive = (((m.life as number[] | undefined) ?? [])[0] ?? 0) > 0;
    return { ...m, gridNo: this.#tileCompared(alive) ? m.gridNo : null, inSector: alive ? m.inSector : null };
  }

  #tileCompared(alive: boolean): boolean {
    return alive || !this.#unloaded;
  }

  #mercRow(m: RosterMerc): Json {
    const s = m.soldier;
    return {
      id: m.id,
      life: [s.life, s.lifeMax, s.bleeding],
      nextBleed: s.nextBleed,
      breath: [s.breath, s.breathMax, s.breathRed],
      ap: s.actionPoints,
      shock: s.shock,
      gassed: s.gassed,
      dead: s.dead,
      collapsed: s.collapsed,
      animState: s.state,
      gridNo: this.#tileCompared(s.life > 0) ? grid(s.gridNo) : null,
      level: s.level,
      inSector: s.life > 0 ? s.placed : null,
      sector: [m.sector.x, m.sector.y, m.sector.z],
      between: m.betweenSectors,
      assignment: m.assignment,
      morale: s.morale,
      courses: [courseRow(s.drugs.adrenaline), courseRow(s.drugs.alcohol)],
      regen: [s.regenerationCounter, s.regenBoostersUsedToday],
      quoteFlags: [m.quoteSaidFlags, m.quoteSaidExtFlags],
      blinded: s.blindedCounter,
      keys: (s.keyRing ?? []).flatMap((k, pos) => (k.count !== 0 ? [[pos, k.keyId, k.count]] : [])),
    };
  }

  #state(c: CampaignSim, p: Json): Json {
    const clock = c.state.clock;
    const rc = this.#clock(c);
    const t = this.#loaded(c);
    const roster = [...(c.battle?.roster.all() ?? [])].sort((x, y) => x.id - y.id);
    const others = (t?.soldiers ?? [])
      .filter((s): s is Soldier => s !== null && s !== undefined && s.team !== Team.OUR && s.placed)
      .map((s) => [s.id, s.team, s.life, s.breath, s.bleeding, bit(s.dead), s.state]);
    const native = (p.state as Json | undefined) ?? {};
    const state: Json = {
      screen: this.#screenSet ? (this.#mapScreen ? 'map' : 'game') : null,
      mapMode: this.#screenSet ? this.#mapScreen : null,
      clock: [clock.seconds, rc.lastTurnMs, rc.lastRottingCorpsesSeconds],
      compression: this.#compressionSet
        ? [clock.mode, bit(clock.compressionOn), bit(clock.paused), bit(isTimeBeingCompressed(clock))]
        : null,
      worldLoaded: t !== null,
      inCombat: t?.inCombat ?? false,
      deaths: c.state.status.mercDeaths,
      history: c.state.laptop.history.slice(this.#historyBase).map((h) => [h.code, h.secondCode, h.date, h.x, h.y, h.z]),
      payouts: c.state.laptop.insurance.payouts.map((x) => [bit(x.active), x.soldier, x.profile, x.payout]),
      suspicious: roster.map((m) => [m.profile, c.state.profiles.get(m.profile)?.suspiciousDeath ?? 0]),
      team: roster.map((m) => this.#mercRow(m)),
      others,
    };
    if (t && native.worldLoaded) {
      state.bloodDecay = t.smell.lastDecaySeconds;
      state.light = [t.lighting.ambient, c.state.env.lightValue, ...(this.#lightEvent ? [bit(c.state.env.doLighting)] : [])];
    }
    return state;
  }

  #nativeState(p: Json): Json {
    const s = (p.state as Json | undefined) ?? {};
    const clock = (s.clock as number[] | undefined) ?? [];
    const state: Json = {
      screen: this.#screenSet ? s.screen : null,
      mapMode: this.#screenSet ? s.mapMode : null,
      clock: [clock[0], clock[2], clock[3]],
      compression: this.#compressionSet ? s.compression : null,
      worldLoaded: s.worldLoaded,
      inCombat: s.inCombat,
      deaths: s.deaths,
      history: s.history,
      payouts: s.payouts,
      suspicious: s.suspicious,
      team: ((s.team as Json[] | undefined) ?? []).map((m) => this.#nativeMercRow(m)),
      others: s.others,
    };
    if (s.worldLoaded) {
      state.bloodDecay = s.bloodDecay;
      const light = (s.light as number[] | undefined) ?? [];
      state.light = this.#lightEvent ? light : light.slice(0, 2);
    }
    return state;
  }
}
