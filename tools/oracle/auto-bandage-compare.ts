import type { BasicPlacement } from '../../src/content/formats/map.ts';
import { NOTHING } from '../../src/content/items/items.ts';
import { parseSectorString } from '../../src/content/strategic/sector-ids.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import type { RosterMerc } from '../../src/sim/campaign/roster.ts';
import { TICK_MS } from '../../src/sim/clock.ts';
import { createItem, deleteObject } from '../../src/sim/items/object.ts';
import { characterDialogue, emptyDialogueQueue } from '../../src/sim/narrative/dialogue-queue.ts';
import { AiAction } from '../../src/sim/tactical/ai/actions.ts';
import { executeAction, handleSoldierAI, npcDoesAct, rtHandleAI } from '../../src/sim/tactical/ai/control.ts';
import { canAutoBandage, decideAutoBandage, findBestPatient } from '../../src/sim/tactical/ai/medical.ts';
import { anim } from '../../src/sim/tactical/anim-states.ts';
import { endHeight, height, initNewSoldierAnim } from '../../src/sim/tactical/animation.ts';
import {
  beginAutoBandage,
  endAutoBandage,
  handleAutoBandagePending,
  requestEndAutoBandage,
  shouldBeginAutoBandage,
  startAutoBandage,
} from '../../src/sim/tactical/auto-bandage.ts';
import { soldierTakeDamage } from '../../src/sim/tactical/combat/hit.ts';
import { DamageReason } from '../../src/sim/tactical/combat/types.ts';
import { createFromPlacementParts } from '../../src/sim/tactical/creation.ts';
import { handleTeamServices } from '../../src/sim/tactical/first-aid.ts';
import { drawStandingFrame, NEUTRAL_POPULATION, soldierSlotTaken } from '../../src/sim/tactical/init-list.ts';
import { addSoldierToSector, Insertion } from '../../src/sim/tactical/insertion.ts';
import { InvSlot } from '../../src/sim/tactical/inventory.ts';
import { setSoldierPosition } from '../../src/sim/tactical/movement.ts';
import { MercQuote } from '../../src/sim/tactical/narrative/merc-quotes.ts';
import { okToAddMercToWorld } from '../../src/sim/tactical/person-structure.ts';
import { SECOND_LEVEL_Z_OFFSET, setSoldierHeight } from '../../src/sim/tactical/roofs.ts';
import {
  Attitude,
  createSoldier,
  firstFreeSoldierId,
  NOBODY,
  NOWHERE,
  Orders,
  type Soldier,
  SoldierClass,
  TEAM_FIRST_ID,
  Team,
} from '../../src/sim/tactical/soldier.ts';
import { registerSoldier, removeOccupant, type TacticalEvent, type TacticalState, whoIsThere } from '../../src/sim/tactical/state.ts';
import type { TacticalSim } from '../../src/sim/tactical/tactical-sim.ts';
import { numEnemyInSector, STRATEGIC_OVERHEAD_MS } from '../../src/sim/tactical/turns/turns.ts';
import { validVehicle } from '../../src/sim/vehicles/vehicle-list.ts';
import { type Draw, firstDifference, ReplayMismatch, report, StrictReplay } from './actions-compare.ts';
import { createTacticalSaveSession } from './tactical-import.ts';

type Json = Record<string, unknown>;
type Row = readonly unknown[];

export const AUTO_BANDAGE_PROBES: ReadonlySet<string> = new Set([
  'abtimer',
  'abstate',
  'abmap',
  'abmerc',
  'abkit',
  'abhostile',
  'abvehicle',
  'abhurt',
  'abtactical',
  'abbegin',
  'abshould',
  'abpending',
  'abstart',
  'abend',
  'abcan',
  'abpatient',
  'abdecide',
  'abexecute',
  'abservices',
  'abframes',
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
const NATIVE_NOBODY = -1;
const NO_PENDING_ACTION = 255;
const MERC_GIVEAID = 5;
const DEFAULT_ITEM_STATUS = 100;
const REPORTED_DIFFERENCES = 6;
const TEAMS: Readonly<Record<string, number>> = { enemy: Team.ENEMY, civ: Team.CIV, militia: Team.MILITIA, creature: Team.CREATURE };
const DAMAGE_REASONS: Readonly<Record<string, number>> = { bloodloss: DamageReason.BLOODLOSS, gunfire: DamageReason.GUNFIRE };
const REFUSAL_BOXES: Readonly<Record<string, string>> = {
  sectorNotCleared: 'sectorNotCleared',
  nobodyToBandage: 'notNeeded',
  noMedKit: 'noMedKit',
  cannotAutoBandage: 'cantAutoBandage',
};
const BEGIN_AUTO_BANDAGE = 'beginAutoBandage';
const MAP_SCREEN = 'map';
const FRAME_GLOBALS = 5;
const FIRST_OTHER_ID = TEAM_FIRST_ID[Team.ENEMY];
const HUMMER = 22;
const AVERAGE_RELATIVE_LEVEL = 2;
const OUTCOME_ONLY: ReadonlySet<string> = new Set(['abhostile', 'abvehicle']);
const NOTHING_TO_UNDO = (): void => {};
const CREATED_ACTION_DATA = 0;
const NOT_MEASURED = -1;
const DOCTOR_WARNING = 'doctorWarning';

const num = (v: unknown) => Number(v ?? 0);
const has = (a: Json, key: string) => a[key] !== undefined;
const grid = (g: number) => (g === NOWHERE ? NATIVE_NOWHERE : g);
const id = (n: number) => (n === NOBODY ? NATIVE_NOBODY : n);

function setStanceImmediately(t: TacticalState, s: Soldier, name: string): void {
  const state = anim(t.content, name);
  s.state = state;
  initNewSoldierAnim(t, s, state, 0, true);
}

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

class InOrderReplay {
  readonly #draws: readonly Draw[];
  readonly #own: (n: number) => number;
  #at = 0;

  constructor(draws: readonly Draw[], own: (n: number) => number) {
    this.#draws = draws;
    this.#own = own;
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

function inOrder(t: TacticalState, trace: readonly Draw[], action: () => void): void {
  const draws = withoutDroppedDraws(trace);
  const main = new InOrderReplay(
    draws.filter((d) => d[0] === MAIN_STREAM),
    ownDraw(t.rng),
  );
  const pre = new InOrderReplay(
    draws.filter((d) => d[0] === PRE_STREAM),
    ownDraw(t.pre),
  );
  const rng = t.rng as unknown as Record<string, unknown>;
  const preRng = t.pre as unknown as Record<string, unknown>;
  Object.assign(rng, { int: (n: number) => main.int(n), chance: (x: number) => main.int(100) < x });
  Object.assign(preRng, { int: (n: number) => pre.int(n), chance: (x: number) => pre.int(100) < x });
  try {
    action();
  } finally {
    delete rng.int;
    delete rng.chance;
    delete preRng.int;
    delete preRng.chance;
  }
}

interface Replayed {
  readonly problems: string[];
  readonly result: unknown;
}

function ownDraws(_t: TacticalState, _trace: readonly Draw[], action: () => unknown): Replayed {
  return { problems: [], result: action() };
}

function replay(t: TacticalState, trace: readonly Draw[], action: () => unknown): Replayed {
  const draws = withoutDroppedDraws(trace);
  const main = new StrictReplay(
    draws.filter((d) => d[0] === MAIN_STREAM),
    'Random',
  );
  const pre = new StrictReplay(
    draws.filter((d) => d[0] === PRE_STREAM),
    'PreRandom',
  );
  const rng = t.rng as unknown as Record<string, unknown>;
  const preRng = t.pre as unknown as Record<string, unknown>;
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

interface NativeStatics {
  readonly medics: number[];
  readonly patients: number[];
  readonly complete: boolean;
  readonly fullCheck: number;
}

export class AutoBandageComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  #bytes: Uint8Array | null = null;
  #session: CampaignSession | null = null;
  #statics: NativeStatics | null = null;
  #started = false;
  #refused: string | null = null;
  #lastNative: Json | null = null;
  #civiliansOwnWay = false;
  readonly #frames: Json[] = [];

  constructor(read: ReadFile, exists: FileExists) {
    this.#read = read;
    this.#exists = exists;
  }

  loadSave(bytes: Uint8Array): void {
    this.#bytes = bytes;
    this.#session = null;
    this.#started = false;
    this.#civiliansOwnWay = false;
    this.#frames.length = 0;
  }

  async #campaign(): Promise<CampaignSim> {
    if (!this.#session) {
      if (!this.#bytes) throw new Error('auto-bandage probes need a save');
      this.#session = (await createTacticalSaveSession(this.#read, this.#bytes, SEED, this.#exists)).session;
      this.#carryStatics(this.#sim(this.#session.campaign).state);
    }
    return this.#session.campaign;
  }

  #carryStatics(t: TacticalState): void {
    const native = this.#statics;
    if (!native) return;
    const state = t.autoBandage;
    state.medics.splice(0, state.medics.length, ...native.medics);
    state.patients.splice(0, state.patients.length, ...native.patients);
    state.complete = native.complete;
    state.fullCheckSoldier = native.fullCheck === NATIVE_NOBODY ? NOBODY : native.fullCheck;
  }

  #rememberStatics(p: Json): void {
    const s = p.state as Json | undefined;
    if (!s) return;
    this.#lastNative = s;
    this.#statics = {
      medics: [...((s.doctors as number[] | undefined) ?? [])],
      patients: [...((s.patients as number[] | undefined) ?? [])],
      complete: s.complete === true,
      fullCheck: num(s.fullCheck),
    };
  }

  async compare(p: Json): Promise<number> {
    if (p.probe === 'abframes' && p.frame !== undefined) {
      this.#frames.push(p);
      return 0;
    }
    const label = `${String(p.probe)} line ${String(p.line ?? '')}`;
    if (!this.#bytes && p.probe === 'abtimer') return report(label, true, 'the virtual clock only');
    try {
      const c = await this.#campaign();
      const a = (p.args as Json | undefined) ?? {};
      const problems = this.#run(c, p, a);
      this.#rememberStatics(p);
      return report(label, problems.length === 0, problems.join('; '));
    } catch (e) {
      this.#frames.length = 0;
      this.#rememberStatics(p);
      return report(label, false, `threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    }
  }

  #sim(c: CampaignSim): TacticalSim {
    const sim = c.tactical;
    if (!sim) throw new Error('no loaded sector');
    return sim;
  }

  #soldier(c: CampaignSim, who: unknown): Soldier {
    const s = this.#sim(c).state.soldiers[num(who)] ?? this.#merc(c, num(who))?.soldier;
    if (!s) throw new Error(`no soldier ${String(who)} in ja2-node`);
    return s;
  }

  #merc(c: CampaignSim, n: number): RosterMerc | null {
    return c.battle?.roster.get(n) ?? null;
  }

  #run(c: CampaignSim, p: Json, a: Json): string[] {
    const sim = this.#sim(c);
    const t = sim.state;
    if (p.probe === 'abframes') return this.#runFrames(c, sim, p, a);
    const teardown = this.#setUp(c, t, p, a);
    try {
      return this.#compareCommand(c, sim, p, a);
    } finally {
      teardown();
    }
  }

  #compareCommand(c: CampaignSim, sim: TacticalSim, p: Json, a: Json): string[] {
    const t = sim.state;
    const trace = (p.draws as Draw[] | undefined) ?? [];
    const run = OUTCOME_ONLY.has(String(p.probe)) ? ownDraws : replay;
    const queued = this.#queue(c).length;
    const promptBefore = t.prompt?.id ?? null;
    let boxes: Json[] = [];
    const replayed = this.#withCommandScope(c, t, a, () =>
      run(t, trace, () => {
        const before = t.events.length;
        const result = this.#command(c, sim, p, a);
        boxes = this.#boxes(sim, a, t.events.slice(before), promptBefore);
        return result;
      }),
    );
    const lines = this.#queue(c).slice(queued);
    const problems = [...replayed.problems];
    const ours = { result: replayed.result ?? null, boxes, lines, state: this.#state(c, p) };
    const theirs = { result: this.#nativeResult(p), boxes: p.boxes, lines: p.lines, state: this.#nativeState(p) };
    differences(ours, theirs, '', problems);
    return problems;
  }

  #setUp(c: CampaignSim, t: TacticalState, p: Json, a: Json): () => void {
    switch (p.probe) {
      case 'abtimer':
        this.#timer(t, a);
        return NOTHING_TO_UNDO;
      case 'abmerc':
        this.#setMerc(c, t, a);
        return NOTHING_TO_UNDO;
      case 'abkit':
        this.#kit(c, t, a);
        return NOTHING_TO_UNDO;
      case 'abtactical':
        this.#tactical(c, t, a);
        return NOTHING_TO_UNDO;
      case 'abshould':
        return this.#endgame(c, a);
      case 'abpending':
        return this.#pendingScene(c, t, a);
      case 'abcan':
        if (has(a, 'check')) t.autoBandage.fullCheckSoldier = num(a.check) === NATIVE_NOBODY ? NOBODY : num(a.check);
        return NOTHING_TO_UNDO;
      default:
        return NOTHING_TO_UNDO;
    }
  }

  #withCommandScope<T>(c: CampaignSim, t: TacticalState, a: Json, action: () => T): T {
    const inCombat = t.inCombat;
    const flow = c.state.flow;
    if (has(a, 'combat')) t.inCombat = num(a.combat) !== 0;
    if (String(a.screen ?? '') === MAP_SCREEN) c.state.flow = 'strategic';
    try {
      return action();
    } finally {
      if (has(a, 'combat')) t.inCombat = inCombat;
      c.state.flow = flow;
    }
  }

  #queue(c: CampaignSim): unknown[] {
    return (c.talk?.talk.queue ?? []).flatMap((e) => (e.kind === 'quote' ? [[e.speaker, e.quote]] : []));
  }

  #boxes(sim: TacticalSim, a: Json, events: readonly TacticalEvent[], promptBefore: string | null): Json[] {
    const shown: Json[] = [];
    const refused = this.#refused;
    this.#refused = null;
    if (refused) shown.push({ kind: REFUSAL_BOXES[refused] ?? refused, question: false, answer: '' });
    for (const e of events) {
      if (e.type === 'autoBandageRefused') shown.push({ kind: REFUSAL_BOXES[e.refusal] ?? e.refusal, question: false, answer: '' });
      if (e.type === 'autoBandageEnded' && e.failed) shown.push({ kind: DOCTOR_WARNING, question: false, answer: '' });
    }
    const prompt = sim.state.prompt;
    if (prompt?.kind === BEGIN_AUTO_BANDAGE && prompt.id !== promptBefore) {
      const answer = String(a.answer ?? '');
      if (answer) {
        const answered = sim.dispatch({ type: 'answer', choice: answer });
        if (!answered.ok) throw new Error(`answer refused: ${answered.reason}`);
        if (answer === 'yes') this.#started = true;
      }
      shown.push({ kind: BEGIN_AUTO_BANDAGE, question: true, answer });
    }
    return shown;
  }

  #command(c: CampaignSim, sim: TacticalSim, p: Json, a: Json): unknown {
    const t = sim.state;
    switch (p.probe) {
      case 'abtimer':
      case 'abstate':
      case 'abkit':
      case 'abtactical':
        return null;
      case 'abmap':
        return this.#map(t, p);
      case 'abmerc':
        if (has(a, 'away')) this.#away(c, this.#soldier(c, a.who), a);
        return null;
      case 'abhostile':
        return { who: this.#hostile(t, a, p).id };
      case 'abvehicle':
        return this.#vehicle(c, t, a, p);
      case 'abhurt': {
        const s = this.#soldier(c, a.who);
        const damage = num(a.damage);
        const breath = has(a, 'breath') ? num(a.breath) : damage;
        const reason = DAMAGE_REASONS[String(a.reason ?? 'bloodloss')] ?? DamageReason.BLOODLOSS;
        return { combined: soldierTakeDamage(t, s, damage, breath, reason, null) };
      }
      case 'abbegin': {
        const begun = beginAutoBandage(t);
        if (!begun.ok) this.#refused = String(begun.data.refusal);
        return null;
      }
      case 'abshould':
        shouldBeginAutoBandage(t);
        return null;
      case 'abpending':
        handleAutoBandagePending(t);
        return null;
      case 'abstart':
        startAutoBandage(t);
        this.#started = true;
        return null;
      case 'abend':
        endAutoBandage(t);
        return null;
      case 'abcan':
        return this.#can(t, a);
      case 'abpatient':
        return this.#patient(t, this.#soldier(c, a.who));
      case 'abdecide':
        return this.#decide(sim, this.#soldier(c, a.who), String(a.mode ?? 'decide'));
      case 'abexecute':
        return this.#execute(t, this.#soldier(c, a.who));
      case 'abservices':
        return this.#services(t, num(a.count ?? 1));
      default:
        throw new Error('unknown auto-bandage probe');
    }
  }

  #timer(t: TacticalState, a: Json): void {
    if (has(a, 'aislot')) t.aiPass.cursor = num(a.aislot);
    if (has(a, 'awayslot')) t.aiPass.awayCursor = num(a.awayslot);
    if (has(a, 'last')) t.realtimeClock.lastTurnMs = num(a.last);
  }

  #map(t: TacticalState, p: Json): unknown {
    const native = (p.result as Json | undefined) ?? {};
    const buildings = (native.buildings as [number[], number[][]][] | undefined) ?? [];
    for (const [head, spots] of buildings) {
      const building = t.buildings.list[(head[0] ?? 0) - 1];
      if (!building) continue;
      building.upClimbSpots.splice(0, building.upClimbSpots.length, ...spots.map((s) => s[0] ?? 0));
      building.downClimbSpots.splice(0, building.downClimbSpots.length, ...spots.map((s) => s[1] ?? 0));
    }
    return { buildings: buildings.map(([head]) => this.#buildingRow(t, head[0] ?? 0)) };
  }

  #buildingRow(t: TacticalState, b: number): unknown[] {
    const building = t.buildings.list[b - 1];
    const up = building?.upClimbSpots ?? [];
    const down = building?.downClimbSpots ?? [];
    const who = (g: number, level: number) => whoIsThere(t, g, level)?.id ?? NATIVE_NOBODY;
    const spots = up.map((u, k) => {
      const d = down[k] ?? 0;
      return [u, d, who(u, 0), who(u, 1), who(d, 0), who(d, 1)];
    });
    return [[b, t.buildings.info.indexOf(b), up.length], spots];
  }

  #setMerc(c: CampaignSim, t: TacticalState, a: Json): void {
    const s = this.#soldier(c, a.who);
    if (has(a, 'life')) s.life = num(a.life);
    if (has(a, 'lifeMax')) s.lifeMax = num(a.lifeMax);
    if (has(a, 'bleeding')) s.bleeding = num(a.bleeding);
    if (has(a, 'breath')) s.breath = num(a.breath);
    if (has(a, 'breathMax')) s.breathMax = num(a.breathMax);
    if (has(a, 'medical')) s.stats.medical = num(a.medical);
    if (has(a, 'collapsed')) s.collapsed = num(a.collapsed) !== 0;
    if (has(a, 'alert')) s.ai.alertStatus = num(a.alert);
    if (has(a, 'grid') || has(a, 'level')) {
      const level = has(a, 'level') ? num(a.level) : s.level;
      setSoldierHeight(t, s, level > 0 ? SECOND_LEVEL_Z_OFFSET : 0);
      setSoldierPosition(t, s, has(a, 'grid') ? num(a.grid) : s.gridNo);
      if (!okToAddMercToWorld(t, s, s.direction)) removeOccupant(t, s);
    }
    if (has(a, 'anim')) setStanceImmediately(t, s, String(a.anim));
  }

  #away(c: CampaignSim, s: Soldier, a: Json): void {
    const m = this.#merc(c, s.id);
    if (!m) throw new Error(`no merc ${s.id}`);
    const sector = parseSectorString(String(a.away));
    if (!sector) throw new Error(`bad sector ${String(a.away)}`);
    c.sectors?.removeMercFromTacticalSector(m);
    m.sector = { ...sector, z: num(a.z) };
    m.betweenSectors = num(a.between) !== 0;
  }

  #itemIndex(t: TacticalState, name: string): number {
    if (/^\d+$/.test(name)) return Number(name);
    const item = t.content.items.byName.get(name)?.index;
    if (item === undefined) throw new Error(`unknown item ${name}`);
    return item;
  }

  #kit(c: CampaignSim, t: TacticalState, a: Json): void {
    const s = this.#soldier(c, a.who);
    const slot = num(a.slot);
    const name = String(a.item ?? 'FIRSTAIDKIT');
    if (name === 'none') {
      const o = s.inv[slot];
      if (o) deleteObject(o);
      return;
    }
    s.inv[slot] = createItem(t.content.items, this.#itemIndex(t, name), has(a, 'status') ? num(a.status) : DEFAULT_ITEM_STATUS);
  }

  #hostile(t: TacticalState, a: Json, p: Json): Soldier {
    const nativeId = num((p.result as Json | undefined)?.who);
    const gridNo = num(a.grid);
    const team = TEAMS[String(a.team ?? 'enemy')] ?? Team.ENEMY;
    const standing = anim(t.content, 'STANDING');
    const s = createSoldier({
      id: nativeId,
      team,
      name: `probe${nativeId}`,
      bodyType: 0,
      palettes: { hair: 'BLACKHEAD', skin: 'PINKSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' },
      stats: {
        agility: 50,
        dexterity: 50,
        strength: 50,
        wisdom: 50,
        leadership: 50,
        marksmanship: 50,
        mechanical: 50,
        explosives: 50,
        medical: 50,
        experience: 1,
      },
      life: 50,
      gridNo,
      direction: num(a.dir ?? 4),
      state: standing,
    });
    registerSoldier(t, s);
    setSoldierPosition(t, s, gridNo);
    initNewSoldierAnim(t, s, standing, 0, true);
    if (has(a, 'neutral')) s.neutral = num(a.neutral) !== 0;
    if (has(a, 'life')) s.life = num(a.life);
    if (has(a, 'collapsed')) s.collapsed = num(a.collapsed) !== 0;
    if (has(a, 'anim')) setStanceImmediately(t, s, String(a.anim));
    s.ai.actionData = CREATED_ACTION_DATA;
    const created = ((p.state as Json | undefined)?.others as Json[] | undefined)?.find((o) => num(o.id) === nativeId);
    const life = (created?.life as number[] | undefined) ?? [];
    if (!has(a, 'life') && life[0] !== undefined) s.life = life[0];
    return s;
  }

  #takeNativeCreation(s: Soldier, p: Json): void {
    s.ai.actionData = CREATED_ACTION_DATA;
    const state = (p.state as Json | undefined) ?? {};
    const rows = [...((state.team as Json[] | undefined) ?? []), ...((state.others as Json[] | undefined) ?? [])];
    const row = rows.find((r) => num(r.id) === s.id);
    if (row?.medical !== undefined) s.stats.medical = num(row.medical);
  }

  #vehicle(c: CampaignSim, t: TacticalState, a: Json, p: Json): unknown {
    const gridNo = num(a.grid);
    const direction = num(a.dir);
    const placement: BasicPlacement = {
      detailed: false,
      startingGridNo: gridNo,
      team: Team.CIV,
      relativeAttributeLevel: AVERAGE_RELATIVE_LEVEL,
      relativeEquipmentLevel: AVERAGE_RELATIVE_LEVEL,
      direction,
      orders: Orders.STATIONARY,
      attitude: Attitude.DEFENSIVE,
      bodyType: HUMMER,
      patrolGrid: [gridNo],
      patrolCount: 0,
      onRoof: false,
      soldierClass: SoldierClass.NONE,
      civilianGroup: 0,
      priorityExistence: true,
      hasKeys: 0,
    };
    const vehicleId = firstFreeSoldierId((n) => soldierSlotTaken(t, n), Team.CIV, HUMMER);
    const env = c.sectors?.populationEnv() ?? NEUTRAL_POPULATION;
    const v = vehicleId < 0 ? null : createFromPlacementParts(t, vehicleId, placement, null, env);
    if (!v) throw new Error('no vehicle created');
    drawStandingFrame(t);
    v.insertionGridNo = gridNo;
    addSoldierToSector(t, v, { code: Insertion.GRIDNO, data: gridNo, direction }, {}, false);
    const boarding = t.vehicleHooks.boarding;
    if (!boarding) throw new Error('no vehicle boarding outside a campaign');
    const boarded = String(a.board ?? '')
      .split(',')
      .filter((w) => w !== '')
      .map((w) => (boarding.putSoldierInVehicle(this.#soldier(c, w), v) === null ? 1 : 0));
    const vehicle = t.soldiers[validVehicle(t.vehicles, v.vehicleId)?.soldierId ?? v.id] ?? v;
    this.#takeNativeCreation(vehicle, p);
    return { vehicle: v.vehicleId, who: vehicle.id, boarded };
  }

  #tactical(c: CampaignSim, t: TacticalState, a: Json): void {
    if (has(a, 'enemyInSector')) t.turn.enemyInSector = num(a.enemyInSector) !== 0;
    if (has(a, 'fought')) t.turn.numFoughtInBattle[Team.ENEMY] = num(a.fought);
    if (has(a, 'aware')) t.perception.awareOfOpposition[Team.OUR] = num(a.aware) !== 0;
    if (has(a, 'blood')) t.options.bloodAndGore = num(a.blood) !== 0;
    if (String(a.queue ?? '') === 'empty' && c.talk) emptyDialogueQueue(c.talk.host);
  }

  #endgame(c: CampaignSim, a: Json): () => void {
    const ending = c.state.ending;
    const endgame = ending.inDeidrannaEndgame;
    if (num(a.endgame) !== 0) ending.inDeidrannaEndgame = true;
    return () => {
      ending.inDeidrannaEndgame = endgame;
    };
  }

  #pendingScene(c: CampaignSim, t: TacticalState, a: Json): () => void {
    if (has(a, 'pending')) t.autoBandage.pending = num(a.pending) !== 0;
    const locked = t.boxing.uiLocked;
    if (num(a.lock) !== 0) t.boxing.uiLocked = true;
    const holder = has(a, 'hold') ? this.#soldier(c, a.hold) : null;
    const held = holder?.pendingAid ?? null;
    if (holder) holder.pendingAid = { targetGridNo: holder.gridNo, direction: holder.direction };
    const talker = has(a, 'talk') ? this.#soldier(c, a.talk) : null;
    const host = c.talk?.host;
    if (talker && host) characterDialogue(host, talker.profile, MercQuote.SECTOR_SAFE, false, true);
    return () => {
      if (talker && host) emptyDialogueQueue(host);
      if (holder) holder.pendingAid = held;
      t.boxing.uiLocked = locked;
    };
  }

  #can(t: TacticalState, a: Json): unknown {
    const full = num(a.full) !== 0;
    const calls: number[][] = [];
    for (let i = 0; i < num(a.count ?? 1); i++) {
      const can = canAutoBandage(t, full);
      calls.push([can ? 1 : 0, id(t.autoBandage.fullCheckSoldier), t.autoBandage.failed ? 1 : 0]);
    }
    return { calls };
  }

  #medics(t: TacticalState): number[][] {
    return this.#team(t).map((s) => [s.id, id(s.autoBandagingMedic)]);
  }

  #patient(t: TacticalState, s: Soldier): unknown {
    const action = findBestPatient(t, s);
    return { action, actionData: grid(s.ai.actionData), climb: action === AiAction.MOVE_TO_CLIMB, medics: this.#medics(t) };
  }

  #actionFields(s: Soldier): number[] {
    return [s.ai.action, grid(s.ai.actionData), s.ai.nextAction, grid(s.ai.nextActionData), s.ai.actionInProgress ? 1 : 0];
  }

  #decide(sim: TacticalSim, s: Soldier, mode: string): unknown {
    const t = sim.state;
    if (mode === 'ai') handleSoldierAI(t, s, sim.ai);
    else if (mode === 'rt') rtHandleAI(t, s, sim.ai);
    else s.ai.action = decideAutoBandage(t, s);
    return { action: this.#actionFields(s), moveMode: s.uiMovementMode, medics: this.#medics(t) };
  }

  #execute(t: TacticalState, s: Soldier): unknown {
    npcDoesAct(t, s);
    s.ai.actionInProgress = executeAction(t, s);
    return { action: this.#actionFields(s) };
  }

  #services(t: TacticalState, count: number): unknown {
    const calls: number[][][] = [];
    for (let i = 0; i < count; i++) {
      handleTeamServices(t, Team.OUR);
      calls.push(
        this.#team(t)
          .filter((s) => s.placed)
          .map((s) => [s.id, s.life, s.bleeding, s.state, id(s.servicePartner), s.serviceCount]),
      );
    }
    return { calls };
  }

  #team(t: TacticalState): Soldier[] {
    const seen = new Map<number, Soldier>();
    for (const s of t.sectorHooks.ourWholeTeam(t)) seen.set(s.id, s);
    for (const s of t.soldiers) if (s && s.team === Team.OUR && (s.placed || s.offMap)) seen.set(s.id, s);
    return [...seen.values()].sort((x, y) => x.id - y.id);
  }

  #nativeResult(p: Json): unknown {
    const r = (p.result as Json | null | undefined) ?? null;
    if (!r) return null;
    if (p.probe === 'abmap') return { buildings: r.buildings };
    if (p.probe === 'abexecute') return { action: r.action };
    if (p.probe === 'abhostile') return { who: r.who };
    if (p.probe === 'abvehicle') return { vehicle: r.vehicle, who: r.who, boarded: r.boarded };
    return r;
  }

  #pendingCode(s: Soldier): number {
    return s.pendingAid ? MERC_GIVEAID : NO_PENDING_ACTION;
  }

  #mercRow(t: TacticalState, s: Soldier): Json {
    const c = t.content;
    return {
      id: s.id,
      life: [s.life, s.lifeMax, s.bleeding],
      breath: [s.breath, s.breathMax],
      medical: s.stats.medical,
      collapsed: s.collapsed,
      inSector: s.placed,
      gridNo: grid(s.gridNo),
      level: s.level,
      direction: s.direction,
      anim: [s.state, height(c, s.state), endHeight(c, s.state)],
      alert: s.ai.alertStatus,
      moveMode: s.uiMovementMode,
      action: this.#actionFields(s),
      pending: this.#pendingCode(s),
      hand: s.inv[InvSlot.HAND]?.item ?? NOTHING,
      inv: s.inv.flatMap((o, slot) => (o.item === NOTHING ? [] : [[slot, o.item, o.count, ...o.status.slice(0, o.count)]])),
      ...(this.#started ? { slotTaken: s.slotItemTakenFrom, medic: id(s.autoBandagingMedic) } : {}),
      partner: id(s.servicePartner),
      serviceCount: s.serviceCount,
      warnedBleeding: s.warnedAboutBleeding,
    };
  }

  #nativeMercRow(m: Json): Json {
    const animFields = (m.anim as number[] | undefined) ?? [];
    return {
      id: m.id,
      life: m.life,
      breath: m.breath,
      medical: m.medical,
      collapsed: m.collapsed,
      inSector: m.inSector,
      gridNo: m.gridNo,
      level: m.level,
      direction: m.direction,
      anim: [animFields[0], animFields[3], animFields[4]],
      alert: m.alert,
      moveMode: m.moveMode,
      action: m.action,
      pending: ((m.pending as number[] | undefined) ?? [])[0],
      hand: m.hand,
      inv: m.inv,
      ...(this.#started ? { slotTaken: m.slotTaken, medic: m.medic } : {}),
      partner: m.partner,
      serviceCount: m.serviceCount,
      warnedBleeding: m.warnedBleeding,
    };
  }

  #otherRow(s: Soldier): Row {
    return [s.id, s.team, grid(s.gridNo), s.level, s.state, s.life, s.bleeding, s.collapsed, s.ai.alertStatus, ...this.#actionFields(s)];
  }

  #nativeOtherRow(o: Json): Row {
    const life = (o.life as number[] | undefined) ?? [];
    const animFields = (o.anim as number[] | undefined) ?? [];
    return [
      o.id,
      o.team,
      o.gridNo,
      o.level,
      animFields[0],
      life[0],
      life[1],
      o.collapsed,
      o.alert,
      ...((o.action as number[] | undefined) ?? []),
    ];
  }

  #state(c: CampaignSim, p: Json): Json {
    const t = this.#sim(c).state;
    const state = t.autoBandage;
    const native = (p.state as Json | undefined) ?? {};
    const nativeOthers = new Set(((native.others as Json[] | undefined) ?? []).map((o) => num(o.id)));
    return {
      mode: t.pathEnv.autoBandage,
      pending: state.pending,
      complete: state.complete,
      failed: state.failed,
      seconds: state.seconds,
      endRequested: state.endRequested,
      doctors: [...state.medics],
      patients: [...state.patients],
      fullCheck: id(state.fullCheckSoldier),
      inCombat: t.inCombat,
      enemies: numEnemyInSector(t),
      worldSeconds: c.state.clock.seconds,
      team: this.#team(t).map((s) => this.#mercRow(t, s)),
      others: t.soldiers
        .filter((s): s is Soldier => !!s && s.team !== Team.OUR && s.placed && nativeOthers.has(s.id) && this.#comparedOther(s.team))
        .map((s) => this.#otherRow(s)),
    };
  }

  #comparedOther(team: number): boolean {
    return !this.#civiliansOwnWay || team !== Team.CIV;
  }

  #nativeState(p: Json): Json {
    const s = (p.state as Json | undefined) ?? {};
    return {
      mode: s.mode,
      pending: s.pending,
      complete: s.complete,
      failed: s.failed,
      seconds: s.seconds,
      endRequested: s.endRequested,
      doctors: s.doctors,
      patients: s.patients,
      fullCheck: s.fullCheck,
      inCombat: s.inCombat,
      enemies: s.enemies,
      worldSeconds: ((s.clock as number[] | undefined) ?? [])[0],
      team: ((s.team as Json[] | undefined) ?? []).map((m) => this.#nativeMercRow(m)),
      others: ((s.others as Json[] | undefined) ?? []).filter((o) => this.#comparedOther(num(o.team))).map((o) => this.#nativeOtherRow(o)),
    };
  }

  #frameRow(t: TacticalState, s: Soldier): Row {
    return [
      s.id,
      grid(s.gridNo),
      s.level,
      s.state,
      s.direction,
      s.life,
      s.bleeding,
      s.breath,
      s.ai.action,
      grid(s.ai.actionData),
      s.ai.actionInProgress ? 1 : 0,
      id(s.servicePartner),
      s.serviceCount,
      s.inv[InvSlot.HAND]?.item ?? NOTHING,
      s.aniDelay,
      s.ai.alertStatus,
      s.uiMovementMode,
      grid(s.finalDestination),
      Math.max(0, s.ai.counter - (t.clockMs - TICK_MS)),
      Math.fround(s.x),
      Math.fround(s.y),
    ];
  }

  #nativeFrameRow(r: readonly unknown[]): Row | null {
    const [who, fields, position] = r as [number, number[] | null, number[] | undefined];
    if (!fields) return null;
    const [gridNo, level, animState, , direction, ...rest] = fields;
    return [who, gridNo, level, animState, direction, ...rest, ...(position ?? []).map((v) => Math.fround(v))];
  }

  #frameGlobals(t: TacticalState): number[] {
    const state = t.autoBandage;
    return [state.seconds, state.complete ? 1 : 0, t.pathEnv.autoBandage ? 1 : 0, id(state.fullCheckSoldier), state.failed ? 1 : 0];
  }

  #runFrames(c: CampaignSim, sim: TacticalSim, p: Json, a: Json): string[] {
    const t = sim.state;
    const native = this.#frames.splice(0);
    const byFrame = new Map(native.map((f) => [num(f.frame), f]));
    const count = num(p.frames);
    const problems: string[] = [];
    this.#syncTimers(c, t);
    if (num(a.plain) !== 0) this.#alignStrategicPoll(t, p);
    if (num(a.end) !== 0) requestEndAutoBandage(t);
    const promptBefore = t.prompt?.id ?? null;
    const events: TacticalEvent[] = [];
    let last = this.#frameRows(t);
    for (let frame = 1; frame <= count && problems.length === 0; frame++) {
      const f = byFrame.get(frame);
      const before = t.events.length;
      inOrder(t, (f?.draws as Draw[] | undefined) ?? [], () => sim.step());
      events.push(...t.events.slice(before));
      const rows = this.#frameRows(t);
      problems.push(...this.#frameDifferences(t, frame, f, last, rows));
      last = rows;
    }
    this.#civiliansOwnWay = true;
    if (problems.length > 0) return problems;
    let boxes: Json[] = [];
    const answered = replay(t, (p.draws as Draw[] | undefined) ?? [], () => {
      boxes = this.#boxes(sim, a, events, promptBefore);
    });
    problems.push(...answered.problems);
    differences({ boxes, state: this.#state(c, p) }, { boxes: p.boxes, state: this.#nativeState(p) }, '', problems);
    return problems;
  }

  #frameDifferences(t: TacticalState, frame: number, f: Json | undefined, last: Map<number, Row>, rows: Map<number, Row>): string[] {
    const out: string[] = [];
    const globals = ((f?.globals as number[] | undefined) ?? null)?.slice(0, FRAME_GLOBALS) ?? null;
    if (globals) differences(this.#frameGlobals(t), globals, `frame ${frame} globals`, out);
    const nativeChanged = new Map<number, Row | null>();
    for (const r of (f?.changed as unknown[][] | undefined) ?? []) nativeChanged.set(num(r[0]), this.#nativeFrameRow(r));
    for (const [who, row] of nativeChanged) {
      if (who >= FIRST_OTHER_ID) continue;
      differences(rows.get(who) ?? null, row, `frame ${frame} soldier ${who}`, out);
    }
    for (const [who, row] of rows) {
      if (who >= FIRST_OTHER_ID) continue;
      if (nativeChanged.has(who) || JSON.stringify(row) === JSON.stringify(last.get(who))) continue;
      differences(row, last.get(who) ?? null, `frame ${frame} soldier ${who} (unchanged natively)`, out);
    }
    return out;
  }

  #syncTimers(c: CampaignSim, t: TacticalState): void {
    const native = this.#lastNative;
    if (!native) return;
    const [, ja2Clock = t.clockMs, , lastTurn = 0] = (native.clock as number[] | undefined) ?? [];
    const [cursor = 0, awayCursor = 0, lastPass = 0] = (native.aiSlots as number[] | undefined) ?? [];
    t.clockMs = ja2Clock + TICK_MS;
    t.realtimeClock.lastTurnMs = lastTurn;
    t.aiPass.cursor = cursor;
    t.aiPass.awayCursor = awayCursor;
    t.aiPass.lastTickMs = lastPass;
    c.state.clock.paused = (((native.pause as number[] | undefined) ?? [])[0] ?? 0) !== 0;
    const rows = [...((native.team as Json[] | undefined) ?? []), ...((native.others as Json[] | undefined) ?? [])];
    for (const row of rows) {
      const s = t.soldiers[num(row.id)];
      if (s) this.#syncSoldierTimers(s, row, ja2Clock);
    }
  }

  #alignStrategicPoll(t: TacticalState, p: Json): void {
    const before = (this.#lastNative?.clock as number[] | undefined) ?? [];
    const after = ((p.state as Json | undefined)?.clock as number[] | undefined) ?? [];
    const [, startClock = 0, , lastTurnBefore = 0] = before;
    const lastTurnAfter = after[3] ?? lastTurnBefore;
    if (lastTurnAfter === lastTurnBefore) return;
    const turnFrame = (lastTurnAfter - startClock) / TICK_MS;
    t.realtimeClock.lastOverheadMs = startClock + turnFrame * TICK_MS - STRATEGIC_OVERHEAD_MS;
  }

  #syncSoldierTimers(s: Soldier, row: Json, now: number): void {
    const [, code, , , , delay] = (row.anim as number[] | undefined) ?? [];
    const [ai = NOT_MEASURED, update = NOT_MEASURED] = (row.counters as number[] | undefined) ?? [];
    if (code !== undefined) s.pc = code;
    if (delay !== undefined) s.aniDelay = delay;
    if (update !== NOT_MEASURED) s.nextFrameAt = now + update;
    if (ai !== NOT_MEASURED) s.ai.counter = now + ai;
  }

  #frameRows(t: TacticalState): Map<number, Row> {
    const rows = new Map<number, Row>();
    for (const s of t.soldiers) if (s?.placed) rows.set(s.id, this.#frameRow(t, s));
    return rows;
  }
}
