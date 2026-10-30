import type { NpcRecord } from '../../src/content/formats/npc.ts';
import type { LayerCount } from '../../src/content/narrative/npc-records.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import { converseFull, selectEnv } from '../../src/sim/narrative/converse.ts';
import type { FactSource, NarrativeHost } from '../../src/sim/narrative/host.ts';
import { ensureQuoteFileLoaded } from '../../src/sim/narrative/records.ts';
import { calcDesireToTalk, npcConsiderQuote, npcConsiderTalking } from '../../src/sim/narrative/select.ts';
import type { DialogueEvent } from '../../src/sim/narrative/talk-state.ts';
import type { ProfileProgress } from '../../src/sim/tactical/profiles.ts';
import { createTacticalSaveSession } from './tactical-import.ts';

type Json = Record<string, unknown>;
type Draw = readonly [string, number, number, number];
type FactEntry = readonly [number, number, number];

export const TALK_PROBES: ReadonlySet<string> = new Set(['npcrecords', 'npcprofile', 'desire', 'consider', 'talk', 'questdecode']);

const SEED = 1;
const NO_PROFILE = 200;
const MAIN_STREAM = 'm';
const CIV_QUOTE_FILES = 20;
const QUEST_DECODE_FACT = 70;
const NO_ARRAY = -2;
const NOT_FOUND = -1;
const TRIGGER_NPC = 10;

export function report(label: string, same: boolean, detail: string): number {
  console.log(`${label}: ${same ? 'ok' : 'MISMATCH'} ${detail}`);
  return same ? 0 : 1;
}

function recordFields(q: NpcRecord): number[] {
  return [
    q.flags,
    q.requirement,
    q.factMustBeTrue,
    q.factMustBeFalse,
    q.quest,
    q.firstDay,
    q.lastDay,
    q.approachRequired,
    q.opinionRequired,
    q.quoteNum,
    q.numQuotes,
    q.startQuest,
    q.endQuest,
    q.triggerNpc,
    q.triggerNpcRecord,
    q.setFactTrue,
    q.giftItem,
    q.goToGridNo,
    q.actionData,
  ];
}

function arrayFields(records: readonly NpcRecord[] | null): number[][] | null {
  return records ? records.map(recordFields) : null;
}

export function profileFields(id: number, p: ProfileProgress | null): Json {
  if (!p) return { profile: id };
  return {
    profile: id,
    approachFactor: [...p.approachFactor],
    approachVal: [...p.approachVal],
    approachMod: p.approachMod.flat(),
    approached: p.approached,
    lastDateSpokenTo: p.lastDateSpokenTo,
    lastQuoteSaid: p.lastQuoteSaid,
    lastQuoteSaidWasSpecial: p.lastQuoteSaidWasSpecial ? 1 : 0,
    friendlyOrDirect: p.friendlyOrDirectDefaultResponseUsedRecently,
    recruit: p.recruitDefaultResponseUsedRecently,
    threaten: p.threatenDefaultResponseUsedRecently,
    quoteRecord: p.quoteRecord,
    quoteActionId: p.quoteActionId,
    npcData: p.npcData,
    npcData2: p.npcData2,
    miscFlags: p.miscFlags,
    miscFlags2: p.miscFlags2,
    miscFlags3: p.miscFlags3,
    balance: p.balance,
    town: p.town,
    townAttachment: p.townAttachment,
    money: p.money,
    sector: [p.sectorX, p.sectorY, p.sectorZ],
  };
}

export function diffJson(ours: Json, native: Json): string[] {
  const out: string[] = [];
  for (const key of Object.keys(native)) {
    const a = JSON.stringify(ours[key]);
    const b = JSON.stringify(native[key]);
    if (a !== b) out.push(`${key}: ${a} vs ${b}`);
  }
  return out;
}

export class FactReplay implements FactSource {
  readonly #entries: readonly FactEntry[];
  readonly #store: (fact: number, value: boolean) => void;
  #at = 0;
  readonly problems: string[] = [];

  constructor(entries: readonly FactEntry[], store: (fact: number, value: boolean) => void) {
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
    this.#store(e[0], e[2] !== 0);
    return e[2] !== 0;
  }

  finish(): string[] {
    if (this.#at < this.#entries.length) this.problems.push(`${this.#entries.length - this.#at} native CheckFact calls left`);
    return this.problems;
  }
}

export class DrawReplay {
  readonly #draws: readonly Draw[];
  #at = 0;
  readonly problems: string[] = [];

  constructor(draws: readonly Draw[]) {
    this.#draws = draws.filter((d) => d[0] === MAIN_STREAM);
  }

  int(n: number): number {
    const d = this.#draws[this.#at++];
    if (!d || d[1] !== n) {
      this.problems.push(`Random(${n}) vs native ${JSON.stringify(d ?? null)}`);
      return 0;
    }
    return d[2];
  }

  finish(): string[] {
    if (this.#at < this.#draws.length) this.problems.push(`${this.#draws.length - this.#at} native draws left`);
    return this.problems;
  }
}

export function queueEntry(e: DialogueEvent): Json {
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
    case 'removeEpc':
      return { kind: 'removeepc', args: [e.npc, 0, 0, 0] };
    case 'callback':
      return { kind: 'callback', args: [0, 0, 0, 0] };
  }
}

export class TalkComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  readonly #layers: LayerCount | undefined;
  #campaign: CampaignSim | null = null;
  #bytes: Uint8Array | null = null;

  constructor(read: ReadFile, exists: FileExists, layers?: LayerCount) {
    this.#read = read;
    this.#exists = exists;
    this.#layers = layers;
  }

  loadSave(bytes: Uint8Array): void {
    this.#bytes = bytes;
    this.#campaign = null;
  }

  async #ensure(): Promise<CampaignSim> {
    if (this.#campaign) return this.#campaign;
    if (!this.#bytes) throw new Error('talk probes need a save');
    const { session } = await createTacticalSaveSession(this.#read, this.#bytes, SEED, this.#exists, this.#layers);
    this.#campaign = session.campaign;
    return session.campaign;
  }

  #host(c: CampaignSim): NarrativeHost {
    const host = c.talk?.host;
    if (!host) throw new Error('the session has no narrative');
    return host;
  }

  async compare(p: Json): Promise<number> {
    const label = `${String(p.probe)} line ${p.line}`;
    try {
      const c = await this.#ensure();
      switch (p.probe) {
        case 'questdecode':
          return this.#questDecode(label, c, p);
        case 'npcrecords':
          return this.#records(label, c, p);
        case 'npcprofile':
          return this.#profile(label, c, p);
        case 'desire':
          return this.#desire(label, c, p);
        case 'consider':
          return this.#consider(label, c, p);
        default:
          return this.#talk(label, c, p);
      }
    } catch (e) {
      return report(label, false, `threw: ${(e as Error).message}`);
    }
  }

  #questDecode(label: string, c: CampaignSim, p: Json): number {
    const host = this.#host(c);
    const results = p.results as number[][];
    const problems: string[] = [];
    const saved = c.state.narrative.facts[QUEST_DECODE_FACT] ?? 0;
    for (const [quest, fact70, native] of results) {
      c.state.narrative.facts[QUEST_DECODE_FACT] = fact70 ?? 0;
      const records = Array.from({ length: 50 }, () => ({ ...blankRecord(), quest: quest ?? 0 }));
      const ours = npcConsiderQuote(selectEnv(host), NO_PROFILE, TRIGGER_NPC, 0, 0, records) ? 1 : 0;
      if (ours !== native) problems.push(`quest ${quest} with fact ${QUEST_DECODE_FACT} = ${fact70}: ours ${ours} vs native ${native}`);
    }
    c.state.narrative.facts[QUEST_DECODE_FACT] = saved;
    return report(label, problems.length === 0, problems.length ? problems.join('; ') : `${results.length} cases, offset ${p.offset}`);
  }

  #records(label: string, c: CampaignSim, p: Json): number {
    const native = p.arrays as { profile: number; records: number[][] | null; backup: number[][] | null }[];
    const state = c.state.npcRecords;
    const problems: string[] = [];
    const listed = new Set(native.map((a) => a.profile));
    for (const a of native) {
      if (JSON.stringify(arrayFields(state.arrays[a.profile] ?? null)) !== JSON.stringify(a.records))
        problems.push(`profile ${a.profile} records differ`);
      if (JSON.stringify(arrayFields(state.backups[a.profile] ?? null)) !== JSON.stringify(a.backup))
        problems.push(`profile ${a.profile} backup differs`);
    }
    const all = Number(p.only ?? -1) < 0;
    if (all)
      state.arrays.forEach((a, id) => {
        if ((a || state.backups[id]) && !listed.has(id)) problems.push(`profile ${id} present only in ja2-node`);
      });
    if (all) {
      const civ = p.civilian as (number[][] | null)[];
      for (let i = 0; i < CIV_QUOTE_FILES; i++)
        if (JSON.stringify(arrayFields(state.civilian[i] ?? null)) !== JSON.stringify(civ[i] ?? null))
          problems.push(`civilian file ${i} differs`);
    }
    return report(label, problems.length === 0, problems.length ? problems.join('; ') : `${native.length} arrays`);
  }

  #profile(label: string, c: CampaignSim, p: Json): number {
    const native = p.profile as Json;
    const id = Number(native.profile);
    const problems = diffJson(profileFields(id, this.#host(c).profile(id)), native);
    return report(label, problems.length === 0, problems.join('; ') || `profile ${id}`);
  }

  #desire(label: string, c: CampaignSim, p: Json): number {
    const host = this.#host(c);
    const npc = Number(p.npc);
    const merc = Number(p.merc);
    const desire = calcDesireToTalk(selectEnv(host), npc, merc, Number(p.approach));
    const threat = host.threat(merc);
    const same = desire === Number(p.desire) && threat === Number(p.threat);
    return report(label, same, `desire ${desire}/${p.desire}, threat ${threat}/${p.threat}`);
  }

  #consider(label: string, c: CampaignSim, p: Json): number {
    const host = this.#host(c);
    const npc = Number(p.npc);
    const replay = new FactReplay(p.facts as FactEntry[], (fact, value) => host.setFact(fact, value));
    const env = { ...selectEnv(host), checkFact: (fact: number, who: number) => replay.checkFact(fact, who) };
    const records = ensureQuoteFileLoaded(host, npc);
    const result = records ? npcConsiderTalking(env, npc, Number(p.merc), Number(p.approach), Number(p.record), records) : null;
    const index = !records ? NO_ARRAY : result?.record ? result.index : NOT_FOUND;
    const opinion = result?.opinion ?? 0;
    const problems = [...replay.finish(), ...diffJson(profileFields(npc, host.profile(npc)), p.after as Json)];
    if (index !== Number(p.index)) problems.push(`index ${index} vs ${p.index}`);
    if (opinion !== Number(p.opinion)) problems.push(`opinion ${opinion} vs ${p.opinion}`);
    return report(label, problems.length === 0, problems.join('; ') || `index ${index}, opinion ${opinion}`);
  }

  #talk(label: string, c: CampaignSim, p: Json): number {
    const base = this.#host(c);
    const t = c.tactical?.state;
    if (!t) throw new Error('no sector loaded');
    const npc = Number(p.npc);
    const mercId = Number(p.merc);
    const merc = mercId >= 0 ? (t.soldiers[mercId] ?? null) : null;
    const npcSoldier = t.soldiers.find((s) => s?.placed && s.profile === npc) ?? null;
    const facts = new FactReplay(p.facts as FactEntry[], (fact, value) => base.setFact(fact, value));
    const draws = new DrawReplay(p.draws as Draw[]);
    const host: NarrativeHost = { ...base, facts, random: (n) => draws.int(n) };
    const factsBefore = Uint8Array.from(c.state.narrative.facts);
    const questsBefore = Uint8Array.from(c.state.narrative.quests);
    this.#resetTalk(c);
    host.talk.inPanel = Number((p.args as Json | undefined)?.panel ?? 1) !== 0;
    host.talk.charNum = npc;
    host.context.src = merc?.id ?? null;
    host.context.dest = npcSoldier?.id ?? null;
    host.context.srcProfile = merc ? merc.profile : NO_PROFILE;
    converseFull(host, npc, host.context.srcProfile, Number(p.approach), Number(p.record), null);
    const queue = host.talk.queue.map(queueEntry);
    const factChanges: number[][] = [];
    c.state.narrative.facts.forEach((v, f) => {
      if (v !== factsBefore[f]) factChanges.push([f, factsBefore[f] ?? 0, v]);
    });
    const questChanges: number[][] = [];
    c.state.narrative.quests.forEach((v, q) => {
      if (v !== questsBefore[q]) questChanges.push([q, questsBefore[q] ?? 0, v]);
    });
    const flags = (c.state.npcRecords.arrays[npc] ?? []).map((q) => q.flags);
    const problems = [...facts.finish(), ...draws.finish()];
    const compare = (key: string, ours: unknown) => {
      if (JSON.stringify(ours) !== JSON.stringify(p[key])) problems.push(`${key}: ${JSON.stringify(ours)} vs ${JSON.stringify(p[key])}`);
    };
    compare('queue', queue);
    compare('factChanges', factChanges);
    compare('questChanges', questChanges);
    compare('flags', flags);
    compare('engaged', t.engagedInConv);
    compare('references', host.talk.referenceCount);
    problems.push(...diffJson(profileFields(npc, host.profile(npc)), p.after as Json));
    this.#resetTalk(c);
    return report(label, problems.length === 0, problems.join('; ') || `${queue.length} events`);
  }

  #resetTalk(c: CampaignSim): void {
    const talk = c.talk?.talk;
    const t = c.tactical?.state;
    if (!talk) return;
    talk.queue.length = 0;
    talk.waitingForTrigger = false;
    talk.inPanel = false;
    talk.referenceCount = 0;
    talk.face = null;
    if (t) t.engagedInConv = false;
  }
}

function blankRecord(): NpcRecord {
  return {
    identifier: 0,
    flags: 0,
    requirement: 0,
    factMustBeTrue: 65535,
    factMustBeFalse: 65535,
    quest: 0,
    firstDay: 0,
    lastDay: 255,
    approachRequired: 0,
    opinionRequired: 255,
    quoteNum: 0,
    numQuotes: 0,
    startQuest: 0,
    endQuest: 0,
    triggerNpc: 0,
    triggerNpcRecord: 0,
    setFactTrue: 0,
    giftItem: 0,
    goToGridNo: 0,
    actionData: 0,
  };
}
