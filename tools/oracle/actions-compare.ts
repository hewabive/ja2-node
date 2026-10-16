import { parseSectorString } from '../../src/content/strategic/sector-ids.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import { createSaveSession } from '../../src/server/save-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import {
  countHospitalSupplies,
  hospitalSuppliesCheck,
  kingpinMoneyCheck,
  medicalCostAt,
  npcSystemEvent,
} from '../../src/sim/campaign/narrative/quest-world.ts';
import type { NarrativeHost } from '../../src/sim/narrative/host.ts';
import type { DialogueEvent } from '../../src/sim/narrative/talk-state.ts';
import { PromptKind } from '../../src/sim/strategic/forces/battle-state.ts';
import { calcPatientMedicalCost } from '../../src/sim/strategic/narrative/hospital.ts';
import { handleNpcDoAction } from '../../src/sim/tactical/narrative/npc-actions/catalog.ts';
import { NpcActionCode } from '../../src/sim/tactical/narrative/npc-actions/codes.ts';
import type { NpcActionEnv } from '../../src/sim/tactical/narrative/npc-actions/env.ts';
import { answerNpcRequest, type NpcRequestChoice, npcRequestDetails } from '../../src/sim/tactical/narrative/npc-actions/requestors.ts';
import type { ProfileProgress } from '../../src/sim/tactical/profiles.ts';
import { NO_PROFILE, NOWHERE, type Soldier, Team } from '../../src/sim/tactical/soldier.ts';

type Json = Record<string, unknown>;
type Draw = readonly [string, number, number, number];
type FactEntry = readonly [number, number, number];

export const ACTION_PROBES: ReadonlySet<string> = new Set([
  'npcaction',
  'npcbox',
  'npcevent',
  'kingpinmoney',
  'hospitalsupplies',
  'medicalcost',
  'npcset',
]);

const SEED = 1;
const MAIN_STREAM = 'm';
const PRE_STREAM = 'p';
const ORACLE_NOWHERE = 25601;
const DELIVERY_EXTRA_GRIDNOS: ReadonlySet<number> = new Set([1, 2]);
const num = (v: unknown) => Number(v ?? 0);

const FACE_DRAWS: readonly number[] = [30, 2, 2000];

function withoutFaceDraws(draws: readonly Draw[]): Draw[] {
  const out: Draw[] = [];
  for (let i = 0; i < draws.length; i++) {
    const face = FACE_DRAWS.every((range, k) => draws[i + k]?.[0] === MAIN_STREAM && draws[i + k]?.[1] === range);
    if (face) i += FACE_DRAWS.length - 1;
    else out.push(draws[i] as Draw);
  }
  return out;
}

function report(label: string, same: boolean, detail: string): number {
  console.log(`${label}: ${same ? 'ok' : 'MISMATCH'} ${detail}`);
  return same ? 0 : 1;
}

class ReplayMismatch extends Error {}

class StrictReplay {
  readonly #draws: readonly Draw[];
  readonly #name: string;
  #at = 0;

  constructor(draws: readonly Draw[], name: string) {
    this.#draws = draws;
    this.#name = name;
  }

  get left(): number {
    return this.#draws.length - this.#at;
  }

  int(n: number): number {
    if (n === 0) return 0;
    const d = this.#draws[this.#at];
    if (!d) throw new ReplayMismatch(`${this.#name} #${this.#at}: native log exhausted, ja2-node wants range ${n}`);
    if (d[1] !== n) throw new ReplayMismatch(`${this.#name} #${this.#at}: ja2-node wants range ${n}, native drew ${JSON.stringify(d)}`);
    this.#at++;
    return d[2];
  }
}

class FactReplay {
  readonly #entries: readonly FactEntry[];
  readonly #store: (fact: number, value: number) => void;
  #at = 0;
  readonly problems: string[] = [];

  constructor(entries: readonly FactEntry[], store: (fact: number, value: number) => void) {
    this.#entries = entries;
    this.#store = store;
  }

  checkFact(fact: number, npc: number): boolean {
    const e = this.#entries[this.#at++];
    if (!e) {
      this.problems.push(`extra CheckFact(${fact}, ${npc})`);
      return false;
    }
    if (e[0] !== fact || e[1] !== npc)
      this.problems.push(`CheckFact #${this.#at - 1}: ours (${fact}, ${npc}) vs native (${e[0]}, ${e[1]})`);
    this.#store(e[0], e[2]);
    return e[2] !== 0;
  }

  finish(): string[] {
    if (this.#at < this.#entries.length) this.problems.push(`${this.#entries.length - this.#at} native CheckFact calls left`);
    return this.problems;
  }
}

function queueEntry(e: DialogueEvent): Json {
  switch (e.kind) {
    case 'quote':
      return e.npcUi ? { kind: 'quote', args: [e.speaker, e.quote, 0, 0] } : { kind: 'merc', args: [e.speaker, e.quote, 0, 0] };
    case 'doAction':
      return { kind: 'action', args: [e.npc, e.code, e.record, 0] };
    case 'goto':
      return { kind: 'goto', args: [e.npc, e.gridNo, e.record, 0] };
    case 'triggerNpc':
      return { kind: 'trigger', args: [e.npc, e.record, e.approach, e.show ? 1 : 0] };
    case 'closePanel':
      return { kind: 'close', args: [0, 0, 0, 0] };
    case 'giveItem':
      return { kind: 'give', args: [e.npc, e.slot, 0, 0] };
    case 'pcTriggerNpc':
      return { kind: 'pctrigger', args: [e.speaker, e.quote, e.npc, e.record] };
  }
}

function profileDump(id: number, p: ProfileProgress | null): Json {
  if (!p) return { id, missing: true };
  return {
    id,
    sector: [p.sectorX, p.sectorY, p.sectorZ],
    flags: [p.miscFlags, p.miscFlags2, p.miscFlags3],
    npcData: [p.npcData, p.npcData2],
    money: p.money,
    balance: p.balance,
    life: p.life,
    lifeMax: p.stats.lifeMax,
    status: p.mercStatus,
    town: p.town,
    spokenTo: p.lastDateSpokenTo,
    insertion: [p.useProfileInsertion ? 1 : 0, p.insertionCode, p.insertionData],
    quote: [p.quoteRecord, p.quoteActionId],
    inventory: [...p.inventory],
    invCount: [...p.inventoryCount],
  };
}

function firstDifference(ours: unknown, theirs: unknown, path = ''): string | null {
  if (Array.isArray(ours) && Array.isArray(theirs)) {
    if (ours.length !== theirs.length) return `${path}: ours ${JSON.stringify(ours)} oracle ${JSON.stringify(theirs)}`;
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

function nativeHistory(rows: readonly number[][]): number[][] {
  return rows.map(([code, second, date, x, y, z]) =>
    x === -1 && y === -1 ? [code ?? 0, second ?? 0, date ?? 0, -1, -1, 0] : [code ?? 0, second ?? 0, date ?? 0, x ?? 0, y ?? 0, z ?? 0],
  );
}

function sortedRows(rows: readonly number[][]): number[][] {
  return [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

interface Snapshot {
  readonly facts: Uint8Array;
  readonly quests: Uint8Array;
  readonly eventSeq: number;
  readonly history: number;
  readonly mails: number;
}

export class ActionComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  #bytes: Uint8Array | null = null;
  #session: CampaignSession | null = null;

  constructor(read: ReadFile, exists: FileExists) {
    this.#read = read;
    this.#exists = exists;
  }

  loadSave(bytes: Uint8Array): void {
    this.#bytes = bytes;
    this.#session = null;
  }

  async #campaign(): Promise<CampaignSim> {
    if (!this.#session) {
      if (!this.#bytes) throw new Error('NPC action probes need a save');
      this.#session = (await createSaveSession(this.#read, this.#bytes, SEED, this.#exists)).session;
    }
    return this.#session.campaign;
  }

  async compare(p: Json): Promise<number> {
    const label = `${String(p.probe)} line ${String(p.line ?? '')}`;
    try {
      const c = await this.#campaign();
      const a = (p.args as Json | undefined) ?? {};
      switch (p.probe) {
        case 'npcset':
          this.#set(c, a);
          return report(label, true, 'state set');
        case 'medicalcost':
          return this.#medicalCost(label, c, p);
        default:
          return this.#probe(label, c, p, a);
      }
    } catch (e) {
      return report(label, false, `threw: ${(e as Error).message}`);
    }
  }

  #host(c: CampaignSim): NarrativeHost {
    const host = c.talk?.host;
    if (!host) throw new Error('the session has no narrative');
    return host;
  }

  #setContext(c: CampaignSim, npc: number, a: Json): void {
    const host = this.#host(c);
    const t = c.tactical?.state;
    host.talk.queue.length = 0;
    host.talk.waitingForTrigger = false;
    host.talk.inPanel = num(a.panel) !== 0;
    host.talk.referenceCount = 0;
    host.talk.charNum = npc;
    if (t) t.engagedInConv = false;
    const npcSoldier = npc === NO_PROFILE ? null : (t?.soldiers.find((s) => s?.placed && s.profile === npc) ?? null);
    const soldierArg = (key: string): Soldier | null => {
      if (a[key] === undefined) return null;
      const id = num(a[key]);
      return id < 0 ? null : (t?.soldiers[id] ?? null);
    };
    const dest = a.dest !== undefined ? soldierArg('dest') : npcSoldier;
    const src = soldierArg('src');
    host.context.dest = dest?.id ?? null;
    host.context.src = src?.id ?? null;
    host.context.srcProfile = src ? src.profile : NO_PROFILE;
  }

  #snapshot(c: CampaignSim): Snapshot {
    const s = c.state;
    return {
      facts: Uint8Array.from(s.narrative.facts),
      quests: Uint8Array.from(s.narrative.quests),
      eventSeq: s.queue.nextSeq,
      history: s.laptop.history.length,
      mails: s.laptop.emails.length,
    };
  }

  #run(c: CampaignSim, p: Json, action: (env: NpcActionEnv) => void): string[] {
    const s = c.state;
    const draws = withoutFaceDraws((p.draws as Draw[] | undefined) ?? []);
    const main = new StrictReplay(
      draws.filter((d) => d[0] === MAIN_STREAM),
      'Random',
    );
    const pre = new StrictReplay(
      draws.filter((d) => d[0] === PRE_STREAM),
      'PreRandom',
    );
    const facts = new FactReplay((p.facts as FactEntry[] | undefined) ?? [], (fact, value) => {
      s.narrative.facts[fact] = value;
    });
    const rng = s.rng as unknown as Record<string, unknown>;
    const preRng = s.pre as unknown as Record<string, unknown>;
    const narrative = c.narrative as unknown as Record<string, unknown>;
    Object.assign(rng, { int: (n: number) => main.int(n), chance: (x: number) => main.int(100) < x });
    Object.assign(preRng, { int: (n: number) => pre.int(n), chance: (x: number) => pre.int(100) < x });
    Object.assign(narrative, { checkFact: (id: number, npc = 0) => facts.checkFact(id, npc) });
    const problems: string[] = [];
    try {
      const env = c.talk?.npcActions.env;
      if (!env) throw new Error('the session has no NPC actions');
      action(env);
      if (main.left || pre.left) problems.push(`${main.left} Random and ${pre.left} PreRandom draws left over`);
    } catch (e) {
      if (e instanceof ReplayMismatch) problems.push(e.message);
      else throw e;
    } finally {
      delete rng.int;
      delete rng.chance;
      delete preRng.int;
      delete preRng.chance;
      delete narrative.checkFact;
    }
    return [...problems, ...facts.finish()];
  }

  #probe(label: string, c: CampaignSim, p: Json, a: Json): number {
    const npc = num(p.npc);
    this.#setContext(c, npc, a);
    const before = this.#snapshot(c);
    const extra = this.#act(c, p, a, npc);
    const problems = extra.problems;
    const ours = this.#state(c, p, npc, before, extra.box, extra.extra);
    const theirs = this.#theirState(p);
    const diff = firstDifference(ours, theirs);
    if (diff) problems.push(diff);
    c.state.battle.prompt = null;
    this.#host(c).talk.queue.length = 0;
    return report(label, problems.length === 0, problems.join('; ') || `${(ours.queue as unknown[]).length} queued`);
  }

  #act(c: CampaignSim, p: Json, a: Json, npc: number): { problems: string[]; box: number[] | null; extra: Json | null } {
    switch (p.probe) {
      case 'npcaction': {
        const code = num(a.code);
        const record = num(a.record);
        const problems = this.#run(c, p, (env) => handleNpcDoAction(env, npc, code, record));
        const prompt = c.state.battle.prompt;
        const box =
          prompt?.kind === PromptKind.NPC_REQUEST
            ? [prompt.code, prompt.code === NpcActionCode.PROMPT_PLAYER_TO_LIE ? prompt.record : 0]
            : [0, 0];
        return { problems, box, extra: null };
      }
      case 'npcbox': {
        const code = num(a.code);
        const record = num(a.record);
        const host = this.#host(c);
        const dest = host.context.dest === null ? null : (c.tactical?.state.soldiers[host.context.dest] ?? null);
        let amount = -1;
        const problems = this.#run(c, p, (env) => {
          const details = npcRequestDetails(env, code, dest?.profile ?? npc, record);
          amount = details.amount ?? -1;
          answerNpcRequest(env, details, String(a.answer ?? 'yes') as NpcRequestChoice);
        });
        return { problems, box: null, extra: { amount } };
      }
      case 'npcevent':
        return { problems: this.#run(c, p, () => npcSystemEvent(c, num(a.param))), box: null, extra: null };
      case 'kingpinmoney':
        return { problems: this.#run(c, p, () => kingpinMoneyCheck(c, num(a.first ?? 1) !== 0)), box: null, extra: null };
      case 'hospitalsupplies': {
        const t = c.tactical?.state;
        const count = t ? countHospitalSupplies(t) : 0;
        return { problems: this.#run(c, p, () => hospitalSuppliesCheck(c)), box: null, extra: { count } };
      }
      default:
        throw new Error(`unknown probe ${String(p.probe)}`);
    }
  }

  #changes(now: Uint8Array, before: Uint8Array): number[][] {
    const out: number[][] = [];
    now.forEach((v, i) => {
      if (v !== before[i]) out.push([i, before[i] ?? 0, v]);
    });
    return out;
  }

  #soldiers(c: CampaignSim, p: Json, npc: number): number[][] {
    const t = c.tactical?.state;
    if (!t) return [];
    const all = String((p.args as Json | undefined)?.soldiers ?? '') === 'all';
    const roster = c.battle?.roster;
    return t.soldiers
      .filter((s): s is Soldier => s?.placed === true && (s.profile === npc || s.team === Team.OUR || all))
      .sort((x, y) => x.id - y.id)
      .map((s) => this.#soldierRow(s, s.team === Team.OUR ? roster?.get(s.id) : undefined));
  }

  #soldierRow(s: Soldier, merc: { readonly assignment: number; readonly hospitalPriceModifier: number } | undefined): number[] {
    const row = [
      s.id,
      s.profile,
      s.team,
      s.neutral ? 1 : 0,
      s.life,
      s.bleeding,
      s.quoteRecord,
      s.quoteActionId,
      s.ai.orders,
      s.uiMovementFast ? 1 : 0,
      s.bodyType,
    ];
    if (merc)
      row.push(merc.assignment, merc.hospitalPriceModifier, s.absoluteFinalDestination === NOWHERE ? NOWHERE : s.absoluteFinalDestination);
    return row;
  }

  #nativeSoldiers(p: Json): number[][] {
    return ((p.soldiers as number[][] | undefined) ?? []).map((r) => {
      const row = r.slice(0, 11) as number[];
      row[3] = row[3] ? 1 : 0;
      row[9] = row[9] ? 1 : 0;
      if (r[2] === Team.OUR) {
        const dest = r[14] ?? ORACLE_NOWHERE;
        row.push(r[12] ?? 0, r[13] ?? 0, dest === ORACLE_NOWHERE || dest === NOWHERE ? NOWHERE : dest);
      }
      return row;
    });
  }

  #pool(c: CampaignSim): number[][] {
    const t = c.tactical?.state;
    const primary = c.laptop?.content.destinations.find((d) => d.isPrimary);
    const world = c.state.worldSector;
    if (!t || !primary || primary.deliverySector === null || !world) return [];
    const x = (primary.deliverySector % 16) + 1;
    const y = Math.trunc(primary.deliverySector / 16) + 1;
    if (world.x !== x || world.y !== y || world.z !== primary.deliverySectorZ) return [];
    return sortedRows(
      t.worldItems
        .filter((w) => w.gridNo === primary.gridNo || DELIVERY_EXTRA_GRIDNOS.has(w.gridNo))
        .map((w) => [w.gridNo, w.object.item, w.object.count, w.object.status[0] ?? 0, w.visible, w.level]),
    );
  }

  #money(c: CampaignSim): number[] {
    const t = c.tactical?.state;
    const money = t?.content.items.byName.get('MONEY')?.index;
    if (!t || money === undefined) return [0, 0];
    const piles = t.worldItems.filter((w) => w.object.item === money);
    return [piles.reduce((sum, w) => sum + w.object.money, 0), piles.length];
  }

  #state(c: CampaignSim, p: Json, npc: number, before: Snapshot, box: number[] | null, extra: Json | null): Json {
    const s = c.state;
    const host = this.#host(c);
    const t = c.tactical?.state;
    const hospital = s.narrative.hospital;
    return {
      queue: host.talk.queue.map(queueEntry),
      factChanges: this.#changes(s.narrative.facts, before.facts),
      questChanges: this.#changes(s.narrative.quests, before.quests),
      events: s.queue.events.filter((e) => e.seq >= before.eventSeq).map((e) => [e.stamp, e.kind, e.param]),
      history: s.laptop.history.slice(before.history).map((h) => [h.code, h.secondCode, h.date, h.x, h.y, h.z]),
      mails: s.laptop.emails.slice(before.mails).map((m) => [m.offset, m.length, m.sender, m.date]),
      hospital: [hospital.priceModifier, hospital.tempBalance, hospital.refund, s.narrative.cambriaMedicalObjects],
      ...(box ? { box } : {}),
      combat: [t?.inCombat ? 1 : 0, t?.turn.enemyInSector ? 1 : 0],
      soldiers: this.#soldiers(c, p, npc),
      profiles: ((p.profiles as Json[] | undefined) ?? []).map((n) => profileDump(num(n.id), c.narrative.profile(num(n.id)))),
      extra: extra ?? this.#nativeExtra(p),
      pool: this.#pool(c),
      money: this.#money(c),
    };
  }

  #nativeExtra(p: Json): Json | null {
    const extra = p.extra as Json | null;
    if (!extra) return null;
    const { poolBefore: _pool, moneyBefore: _money, ...rest } = extra;
    return Object.keys(rest).length ? rest : null;
  }

  #theirState(p: Json): Json {
    const extra = p.extra as Json | null;
    const rest = extra ? this.#nativeExtra(p) : null;
    return {
      queue: p.queue,
      factChanges: p.factChanges,
      questChanges: p.questChanges,
      events: p.events,
      history: nativeHistory((p.history as number[][]) ?? []),
      mails: p.mails,
      hospital: p.hospital,
      ...(p.probe === 'npcaction' ? { box: p.box } : {}),
      combat: ((p.combat as number[]) ?? []).map((v) => (v ? 1 : 0)),
      soldiers: this.#nativeSoldiers(p),
      profiles: p.profiles,
      extra: rest,
      pool: sortedRows((p.pool as number[][]) ?? []),
      money: p.money,
    };
  }

  #medicalCost(label: string, c: CampaignSim, p: Json): number {
    const t = c.tactical?.state;
    const roster = c.battle?.roster;
    const global = c.state.narrative.hospital.priceModifier;
    const patients = (t?.soldiers ?? [])
      .filter((s): s is Soldier => s?.placed === true && s.team === Team.OUR)
      .sort((x, y) => x.id - y.id)
      .map((s) => {
        const merc = roster?.get(s.id);
        const modifier = merc?.hospitalPriceModifier ?? 0;
        const cost = calcPatientMedicalCost(
          { life: s.life, lifeMax: s.lifeMax, bleeding: s.bleeding, hospitalPriceModifier: modifier },
          global,
        );
        return [s.id, s.life, s.lifeMax, s.bleeding, modifier, merc?.assignment ?? 0, cost];
      });
    const ours = { cost: medicalCostAt(c, num(p.npc)), patients };
    const theirs = { cost: p.cost, patients: p.patients };
    const diff = firstDifference(ours, theirs);
    return report(label, diff === null, diff ?? `cost ${ours.cost}`);
  }

  #set(c: CampaignSim, a: Json): void {
    const s = c.state;
    const pairs = (key: string, apply: (id: number, value: number) => void) => {
      if (a[key] === undefined) return;
      for (const kv of String(a[key]).split(',')) {
        const [id, value] = kv.split(':').map(Number);
        apply(id ?? 0, value ?? 0);
      }
    };
    pairs('facts', (id, value) => {
      s.narrative.facts[id] = value;
    });
    pairs('quests', (id, value) => {
      s.narrative.quests[id] = value;
    });
    const h = s.narrative.hospital;
    if (a.modifier !== undefined) h.priceModifier = num(a.modifier);
    if (a.temp !== undefined) h.tempBalance = num(a.temp);
    if (a.refund !== undefined) h.refund = num(a.refund);
    if (a.objects !== undefined) s.narrative.cambriaMedicalObjects = num(a.objects);
    if (a.who !== undefined) {
      const soldier = c.tactical?.state.soldiers[num(a.who)];
      if (!soldier) throw new Error(`no soldier ${String(a.who)}`);
      if (a.life !== undefined) soldier.life = num(a.life);
      if (a.bleeding !== undefined) soldier.bleeding = num(a.bleeding);
      if (a.neutral !== undefined) soldier.neutral = num(a.neutral) !== 0;
      const merc = c.battle?.roster.get(soldier.id);
      if (merc && a.patientmod !== undefined) merc.hospitalPriceModifier = num(a.patientmod);
    }
    if (a.profile !== undefined) {
      const profile = c.narrative.profile(num(a.profile));
      if (!profile) throw new Error(`no profile ${String(a.profile)}`);
      if (a.balance !== undefined) profile.balance = num(a.balance);
      if (a.npcdata !== undefined) profile.npcData = num(a.npcdata);
      if (a.npcdata2 !== undefined) profile.npcData2 = num(a.npcdata2);
      if (a.salary !== undefined) profile.salary = num(a.salary);
      if (a.status !== undefined) profile.mercStatus = num(a.status);
      if (a.money !== undefined) profile.money = num(a.money);
      if (a.sector !== undefined) {
        const sector = parseSectorString(String(a.sector));
        profile.sectorX = sector.x;
        profile.sectorY = sector.y;
        profile.sectorZ = num(a.z);
      }
    }
  }
}
