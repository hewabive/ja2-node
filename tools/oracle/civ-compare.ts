import type { LayerCount } from '../../src/content/narrative/npc-records.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import { Rng } from '../../src/core/rng.ts';
import { createSaveSession } from '../../src/server/save-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import { startCivQuote } from '../../src/sim/narrative/civ-quotes.ts';
import { npcConsiderInitiatingConv, pcDoesFirstAidOnNpc, pcsNearNpc } from '../../src/sim/narrative/converse.ts';
import type { FactSource, NarrativeHost } from '../../src/sim/narrative/host.ts';
import { EventKind } from '../../src/sim/strategic/time/constants.ts';
import { AiAction } from '../../src/sim/tactical/ai/actions.ts';
import { offersSurrender } from '../../src/sim/tactical/ai/combat-decide.ts';
import { decideActionNamedNPC } from '../../src/sim/tactical/ai/decide-named-npc.ts';
import { pauseAiUntilManuallyUnpaused, unPauseAi } from '../../src/sim/tactical/ai/pause.ts';
import { menInSector } from '../../src/sim/tactical/ai/utils.ts';
import { setSoldierPosition } from '../../src/sim/tactical/movement.ts';
import { addToShouldBecomeHostileOrSayQuoteList, checkHostileOrSayQuoteList } from '../../src/sim/tactical/narrative/civ-hostility.ts';
import { triggerFriendWithHostileQuote } from '../../src/sim/tactical/narrative/npc-actions/generic.ts';
import { Opp } from '../../src/sim/tactical/perception/opp.ts';
import { NOWHERE, type Soldier, Team } from '../../src/sim/tactical/soldier.ts';
import type { TacticalState } from '../../src/sim/tactical/state.ts';
import { DrawReplay, FactReplay, queueEntry, report } from './talk-compare.ts';

type Json = Record<string, unknown>;
type Draw = readonly [string, number, number, number];
type FactEntry = readonly [number, number, number];
type Random = { int(n: number): number };

export const CIV_PROBES: ReadonlySet<string> = new Set([
  'civset',
  'civquote',
  'namednpc',
  'initiating',
  'pcsnear',
  'firstaid',
  'friendhostile',
  'hostilecheck',
  'surrender',
  'surrenderanswer',
]);

const SEED = 1;
const NO_PROFILE = 200;
const NATIVE_NOWHERE = 25601;
const ENEMY_OFFERED_SURRENDER = 0x01;
const MAIN_STREAM = 'm';
const FALLBACK_SEED = 0x5eed;

const num = (v: unknown): number => Number(v ?? 0);

class LenientReplay implements Random {
  readonly #draws: Draw[];
  readonly #fallback = Rng.fromSeed(FALLBACK_SEED);
  readonly problems: string[] = [];

  constructor(draws: readonly Draw[]) {
    this.#draws = draws.filter((d) => d[0] === MAIN_STREAM);
  }

  int(n: number): number {
    const d = this.#draws.shift();
    if (!d) return this.#fallback.int(n);
    if (d[1] !== n) this.problems.push(`Random(${n}) vs native ${JSON.stringify(d)}`);
    return d[1] === n ? d[2] : 0;
  }

  finish(): string[] {
    if (this.#draws.length > 0) this.problems.push(`${this.#draws.length} native draws left`);
    return this.problems;
  }
}

class HintFactReplay implements FactSource {
  readonly #replay: FactReplay;
  readonly #real: FactSource;

  constructor(replay: FactReplay, real: FactSource) {
    this.#replay = replay;
    this.#real = real;
  }

  checkFact(fact: number, npc: number): boolean {
    return npc === NO_PROFILE ? this.#replay.checkFact(fact, npc) : this.#real.checkFact(fact, npc);
  }
}

function civSoldier(s: Soldier): Json {
  return {
    id: s.id,
    currentCivQuote: s.currentCivQuote,
    delta: s.currentCivQuoteDelta,
    action: s.ai.action,
    actionData: s.ai.actionData === NOWHERE ? NATIVE_NOWHERE : s.ai.actionData,
    quoteRecord: s.quoteRecord,
    quoteActionId: s.quoteActionId,
    handleEveryFrame: s.ai.handleEveryFrame ? 1 : 0,
    neutral: s.neutral ? 1 : 0,
  };
}

function civFacts(campaign: CampaignSim, t: TacticalState): Json {
  const people = t.soldiers
    .filter((s): s is Soldier => s?.placed === true && (s.team === Team.CIV || s.team === Team.MILITIA || s.team === Team.OUR))
    .map((s) => [s.id, s.team, s.side, s.neutral ? 1 : 0, s.civilianGroup, s.ai.oppCount, s.profile]);
  const events = campaign.state.queue.events
    .filter((e) => e.kind === EventKind.MAKE_CIV_GROUP_HOSTILE_ON_NEXT_SECTOR_ENTRANCE)
    .map((e) => [e.stamp, e.param]);
  return { groups: [...t.civGroups.hostility], people, hostileList: t.hostileQuoteList.map((s) => s.id), civGroupEvents: events };
}

function nativeCivFacts(state: Json): Json {
  return {
    groups: state.groups,
    people: state.people,
    hostileList: state.hostileList,
    civGroupEvents: (state.civGroupEvents as number[][]).map(([stamp, param]) => [num(stamp), num(param)]),
  };
}

function pair(spec: string): [number, number] {
  const [a, b] = spec.split(':').map(Number);
  return [a ?? 0, b ?? 0];
}

function changes(before: Uint8Array, after: ArrayLike<number>): number[][] {
  const out: number[][] = [];
  for (let k = 0; k < before.length; k++) if (before[k] !== after[k]) out.push([k, before[k] ?? 0, after[k] ?? 0]);
  return out;
}

export class CivComparer {
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
    if (!this.#bytes) throw new Error('civilian probes need a save');
    const { session } = await createSaveSession(this.#read, this.#bytes, SEED, this.#exists, this.#layers);
    this.#campaign = session.campaign;
    return session.campaign;
  }

  async compare(p: Json): Promise<number> {
    const label = `${String(p.probe)} line ${p.line}`;
    try {
      const c = await this.#ensure();
      const t = c.tactical?.state;
      const host = c.talk?.host;
      if (!t || !host) throw new Error('the session has no loaded sector or narrative');
      switch (p.probe) {
        case 'civset':
          return this.#civset(label, c, t, p);
        case 'civquote':
          return this.#civquote(label, c, t, host, p);
        case 'initiating':
          return this.#initiating(label, t, host, p);
        case 'surrender':
          return this.#surrender(label, t, p);
        case 'surrenderanswer':
          return this.#surrenderAnswer(label, c, t, p);
        default:
          return this.#dialogueProbe(label, c, t, host, p);
      }
    } catch (e) {
      return report(label, false, `threw: ${(e as Error).message}`);
    }
  }

  #soldier(t: TacticalState, id: unknown): Soldier {
    const s = t.soldiers[num(id)];
    if (!s?.placed) throw new Error(`no soldier ${String(id)} in the sector`);
    return s;
  }

  #applySoldier(t: TacticalState, s: Soldier, args: Record<string, string>): void {
    const n = (k: string) => Number(args[k]);
    if (args.quote !== undefined) s.currentCivQuote = n('quote');
    if (args.delta !== undefined) s.currentCivQuoteDelta = n('delta');
    if (args.action !== undefined) s.ai.action = n('action');
    if (args.life !== undefined) s.life = n('life');
    if (args.class !== undefined) Object.assign(s, { soldierClass: n('class') });
    if (args.visible !== undefined) s.visible = n('visible');
    if (args.quoteRecord !== undefined) s.quoteRecord = n('quoteRecord');
    if (args.quoteAction !== undefined) s.quoteActionId = n('quoteAction');
    if (args.neutral !== undefined) s.neutral = n('neutral') !== 0;
    if (args.group !== undefined) s.civilianGroup = n('group');
    if (args.cower !== undefined) s.cowering = n('cower') !== 0;
    if (args.dir !== undefined) {
      s.direction = n('dir');
      s.desiredDirection = n('dir');
    }
    if (args.grid !== undefined) setSoldierPosition(t, s, n('grid'));
    for (const id of (args.sees ?? '').split(',').filter(Boolean)) {
      if (s.oppList[Number(id)] !== Opp.SEEN_CURRENTLY) s.ai.oppCount++;
      s.oppList[Number(id)] = Opp.SEEN_CURRENTLY;
    }
    for (const id of (args.unseen ?? '').split(',').filter(Boolean)) {
      if (s.oppList[Number(id)] === Opp.SEEN_CURRENTLY) s.ai.oppCount--;
      s.oppList[Number(id)] = Opp.NOT_HEARD_OR_SEEN;
    }
  }

  #civset(label: string, c: CampaignSim, t: TacticalState, p: Json): number {
    const args = (p.args ?? {}) as Record<string, string>;
    const s = args.who !== undefined ? this.#soldier(t, args.who) : null;
    if (s) this.#applySoldier(t, s, args);
    if (args.rating !== undefined) {
      const [town, rating] = pair(args.rating);
      const loyalty = c.state.economy.towns[town];
      if (loyalty) loyalty.rating = rating;
    }
    if (args.combat !== undefined) t.inCombat = Number(args.combat) !== 0;
    for (const spec of (args.fact ?? '').split(',').filter(Boolean)) {
      const [fact, value] = pair(spec);
      c.state.narrative.facts[fact] = value;
    }
    for (const spec of (args.quest ?? '').split(',').filter(Boolean)) {
      const [quest, value] = pair(spec);
      c.state.narrative.quests[quest] = value;
    }
    for (const id of (args.listadd ?? '').split(',').filter(Boolean)) addToShouldBecomeHostileOrSayQuoteList(t, this.#soldier(t, id));
    if (args.enemyFlags !== undefined) t.turn.enemyOfferedSurrender = (Number(args.enemyFlags) & ENEMY_OFFERED_SURRENDER) !== 0;
    if (args.pause !== undefined) {
      if (Number(args.pause) !== 0) pauseAiUntilManuallyUnpaused(t);
      else unPauseAi(t);
    }
    const problems = s && p.soldier ? this.#diff(civSoldier(s), p.soldier as Json) : [];
    return report(label, problems.length === 0, problems.join('; ') || 'set');
  }

  #diff(ours: Json, native: Json): string[] {
    return Object.keys(native)
      .filter((k) => JSON.stringify(ours[k]) !== JSON.stringify(native[k]))
      .map((k) => `${k}: ${JSON.stringify(ours[k])} vs ${JSON.stringify(native[k])}`);
  }

  #withStreams<T>(c: CampaignSim, t: TacticalState, host: NarrativeHost, random: Random, facts: FactSource | null, run: () => T): T {
    const saved = { state: c.state.rng, tactical: t.rng, facts: host.facts, fx: host.talk.fx };
    Object.assign(c.state, { rng: random });
    Object.assign(t, { rng: random });
    Object.assign(host.talk, { fx: random });
    if (facts) Object.assign(host, { facts });
    try {
      return run();
    } finally {
      Object.assign(c.state, { rng: saved.state });
      Object.assign(t, { rng: saved.tactical });
      Object.assign(host.talk, { fx: saved.fx });
      Object.assign(host, { facts: saved.facts });
    }
  }

  #civquote(label: string, c: CampaignSim, t: TacticalState, host: NarrativeHost, p: Json): number {
    const s = this.#soldier(t, p.who);
    const draws = new DrawReplay(p.draws as Draw[]);
    const replay = new FactReplay(p.facts as FactEntry[], (fact, value) => host.setFact(fact, value));
    const facts = new HintFactReplay(replay, host.facts);
    const questsBefore = Uint8Array.from(c.state.narrative.quests);
    const said = this.#withStreams(c, t, host, draws, facts, () => startCivQuote(host, s));
    const problems = [...replay.finish(), ...draws.finish()];
    const compare = (key: string, ours: unknown) => {
      if (JSON.stringify(ours) !== JSON.stringify(p[key])) problems.push(`${key}: ${JSON.stringify(ours)} vs ${JSON.stringify(p[key])}`);
    };
    compare('said', said ? [[said.soldier, said.quote, said.entry, said.chars]] : []);
    compare('questChanges', changes(questsBefore, c.state.narrative.quests));
    compare(
      'civFlags',
      c.state.npcRecords.civilian.map((records) => (records ? records.map((q) => q.flags) : null)),
    );
    problems.push(...this.#diff(civSoldier(s), p.after as Json));
    return report(label, problems.length === 0, problems.join('; ') || `quote ${said?.quote ?? 'none'} entry ${said?.entry ?? '-'}`);
  }

  #initiating(label: string, t: TacticalState, host: NarrativeHost, p: Json): number {
    const s = this.#soldier(t, p.who);
    const replay = new FactReplay(p.facts as FactEntry[], (fact, value) => host.setFact(fact, value));
    const saved = host.facts;
    Object.assign(host, { facts: replay });
    let grid: number;
    try {
      grid = npcConsiderInitiatingConv(host, s);
    } finally {
      Object.assign(host, { facts: saved });
    }
    const problems = replay.finish();
    if (grid !== num(p.grid)) problems.push(`grid ${grid} vs ${p.grid}`);
    return report(label, problems.length === 0, problems.join('; ') || `grid ${grid}`);
  }

  #resetTalk(c: CampaignSim, t: TacticalState): void {
    const talk = c.talk?.talk;
    if (!talk) return;
    talk.queue.length = 0;
    talk.waitingForTrigger = false;
    talk.trigger = null;
    talk.inPanel = false;
    talk.referenceCount = 0;
    talk.face = null;
    t.engagedInConv = false;
  }

  #dialogueProbe(label: string, c: CampaignSim, t: TacticalState, host: NarrativeHost, p: Json): number {
    const facts = new FactReplay(p.facts as FactEntry[], (fact, value) => host.setFact(fact, value));
    const draws = new DrawReplay(p.draws as Draw[]);
    const factsBefore = Uint8Array.from(c.state.narrative.facts);
    const questsBefore = Uint8Array.from(c.state.narrative.quests);
    this.#resetTalk(c, t);
    const ours: Json = {};
    this.#withStreams(c, t, host, draws, facts, () => {
      switch (p.probe) {
        case 'namednpc': {
          const s = this.#soldier(t, p.who);
          ours.action = decideActionNamedNPC(t, s);
          ours.after = civSoldier(s);
          break;
        }
        case 'pcsnear': {
          pcsNearNpc(host, num(p.npc));
          const s = t.soldiers.find((x) => x?.placed && x.profile === num(p.npc));
          ours.soldier = s ? civSoldier(s) : null;
          break;
        }
        case 'firstaid':
          ours.refused = pcDoesFirstAidOnNpc(host, num(p.npc));
          ours.profileFlags2 = host.profile(num(p.npc))?.miscFlags2 ?? 0;
          break;
        case 'friendhostile': {
          const env = c.talk?.npcActions.env;
          if (!env) throw new Error('no action environment');
          triggerFriendWithHostileQuote(env, num(p.npc));
          break;
        }
        case 'hostilecheck':
          checkHostileOrSayQuoteList(t);
          ours.listedAfter = (p.listedAfter as number[][]).map(([id]) => {
            const s = t.soldiers[id ?? 0];
            return [id, s?.visible ?? 0, t.perception.publicOpp[Team.OUR]?.[id ?? 0] ?? 0];
          });
          break;
      }
    });
    const problems = [...facts.finish(), ...draws.finish()];
    const compare = (key: string, value: unknown, native: unknown = p[key]) => {
      if (JSON.stringify(value) !== JSON.stringify(native)) problems.push(`${key}: ${JSON.stringify(value)} vs ${JSON.stringify(native)}`);
    };
    const talk = c.talk?.talk;
    compare('queue', talk?.queue.map(queueEntry) ?? []);
    compare('waitingForTrigger', talk?.waitingForTrigger ?? false);
    compare('factChanges', changes(factsBefore, c.state.narrative.facts));
    compare('questChanges', changes(questsBefore, c.state.narrative.quests));
    compare(
      'hostileList',
      t.hostileQuoteList.map((s) => s.id),
    );
    if (p.probe === 'friendhostile' || p.probe === 'hostilecheck') {
      const pause = p.aiPause as Json;
      compare('aiPause', { paused: t.turn.pauseAllAi, timed: t.turn.pauseAllAiSinceMs !== null }, pause);
      compare('civ', civFacts(c, t), nativeCivFacts(p.civ as Json));
    }
    if (p.probe === 'namednpc') {
      compare('action', ours.action);
      problems.push(...this.#diff(ours.after as Json, p.after as Json));
    }
    if (p.probe === 'pcsnear' && p.soldier) problems.push(...this.#diff(ours.soldier as Json, p.soldier as Json));
    if (p.probe === 'firstaid') {
      compare('refused', ours.refused);
      compare('profileFlags2', ours.profileFlags2, (p.profile as Json).miscFlags2);
    }
    if (p.probe === 'hostilecheck') compare('listedAfter', ours.listedAfter);
    const queued = talk?.queue.length ?? 0;
    const action = ours.action !== undefined ? `, action ${String(ours.action)}` : '';
    this.#resetTalk(c, t);
    return report(label, problems.length === 0, problems.join('; ') || `${queued} queued${action}`);
  }

  #surrender(label: string, t: TacticalState, p: Json): number {
    const s = this.#soldier(t, p.who);
    const offered = offersSurrender(t, s);
    if (offered) t.turn.enemyOfferedSurrender = true;
    const pcs = t.mercSlots.filter((x) => x?.placed && x.team === Team.OUR && x.life > 0).length;
    const ours = {
      offered,
      enemyFlags: t.turn.enemyOfferedSurrender ? ENEMY_OFFERED_SURRENDER : 0,
      pcs,
      enemies: menInSector(t, Team.ENEMY),
      militia: menInSector(t, Team.MILITIA) > 0,
    };
    const native = { offered: p.offered, enemyFlags: p.enemyFlags, pcs: p.pcs, enemies: p.enemies, militia: p.militia };
    const problems = this.#diff(ours, native);
    return report(label, problems.length === 0, problems.join('; ') || `offered ${offered}`);
  }

  #surrenderAnswer(label: string, c: CampaignSim, t: TacticalState, p: Json): number {
    const offering = p.offering ? this.#soldier(t, (p.offering as Json).id) : null;
    const host = c.talk?.host;
    if (!offering || !host || !c.battle) throw new Error('surrenderanswer needs the offering soldier and a battle flow');
    offering.ai.action = AiAction.OFFER_SURRENDER;
    if (!c.battle.offerTacticalSurrender(offering.id)) throw new Error('a prompt is already open');
    c.drainEvents();
    const replay = new LenientReplay(p.draws as Draw[]);
    const questsBefore = Uint8Array.from(c.state.narrative.quests);
    const choice = p.yes === true ? 'accept' : 'reject';
    const answered = this.#withStreams(c, t, host, replay, null, () => c.dispatch({ type: 'answer', choice }));
    const problems = [...replay.finish()];
    if (!answered.ok) problems.push(`answer refused: ${answered.reason}`);
    const native = p.mercs as Json[];
    for (const n of native) {
      const m = c.battle.roster.get(num(n.id));
      if (!m) {
        problems.push(`no merc ${String(n.id)}`);
        continue;
      }
      const ours: Json = {
        id: m.id,
        inSector: m.soldier.placed,
        life: m.soldier.life,
        breath: m.soldier.breath,
        assignment: m.assignment,
        sector: [m.sector.x, m.sector.y, m.sector.z],
        insertionCode: m.insertionCode,
        insertionData: m.soldier.insertionData,
        neutral: m.soldier.neutral ? 1 : 0,
      };
      problems.push(...this.#diff(ours, n).map((d) => `merc ${String(n.id)} ${d}`));
    }
    if (JSON.stringify(changes(questsBefore, c.state.narrative.quests)) !== JSON.stringify(p.questChanges))
      problems.push(`questChanges ${JSON.stringify(changes(questsBefore, c.state.narrative.quests))} vs ${JSON.stringify(p.questChanges)}`);
    if (num(c.state.status.numCapturedForRescue) !== num(p.captured))
      problems.push(`captured ${c.state.status.numCapturedForRescue} vs ${p.captured}`);
    problems.push(...this.#diff({ action: offering.ai.action }, { action: (p.offering as Json).action }));
    return report(label, problems.length === 0, problems.join('; ') || `${choice}ed`);
  }
}
