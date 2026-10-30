import { WEAPON_CLASSES } from '../../src/content/items/items.ts';
import { parseSectorString } from '../../src/content/strategic/sector-ids.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import { createItem, emptyObject } from '../../src/sim/items/object.ts';
import type { NarrativeHost } from '../../src/sim/narrative/host.ts';
import { getGroup, setGroupSectorValue } from '../../src/sim/strategic/forces/groups.ts';
import { Npc } from '../../src/sim/strategic/narrative/npc-ids.ts';
import { AiAction } from '../../src/sim/tactical/ai/actions.ts';
import { decideNpcAction } from '../../src/sim/tactical/ai/control.ts';
import { decideAlertStatus } from '../../src/sim/tactical/ai/decide.ts';
import { beginSoldierGetup } from '../../src/sim/tactical/combat/death.ts';
import { findObjClass } from '../../src/sim/tactical/combat/reload.ts';
import { Insertion } from '../../src/sim/tactical/insertion.ts';
import { NO_SLOT } from '../../src/sim/tactical/inventory.ts';
import { setSoldierPosition } from '../../src/sim/tactical/movement.ts';
import {
  boxingMovementCheckWhileTracked,
  endBoxingMatch,
  exitBoxing,
  triggerEndOfBoxingRecord,
} from '../../src/sim/tactical/narrative/boxing.ts';
import { BOXER_GRIDNOS, boxingHalvesPoints } from '../../src/sim/tactical/narrative/boxing-state.ts';
import { processImplicationsOfPCAttack } from '../../src/sim/tactical/narrative/civ-hostility.ts';
import { handleNpcDoAction } from '../../src/sim/tactical/narrative/npc-actions/catalog.ts';
import { NpcActionCode } from '../../src/sim/tactical/narrative/npc-actions/codes.ts';
import { calcActionPoints, calcNewActionPoints } from '../../src/sim/tactical/points.ts';
import { NO_PROFILE, NOWHERE, type Soldier, Team } from '../../src/sim/tactical/soldier.ts';
import type { TacticalState } from '../../src/sim/tactical/state.ts';
import { handleRealtimeTurns } from '../../src/sim/tactical/turns/turns.ts';
import {
  type Draw,
  type FactEntry,
  FactReplay,
  firstDifference,
  nativeHistory,
  queueEntry,
  ReplayMismatch,
  report,
  StrictReplay,
} from './actions-compare.ts';
import { createTacticalSaveSession } from './tactical-import.ts';

type Json = Record<string, unknown>;

export const BOXING_PROBES: ReadonlySet<string> = new Set([
  'boxingsquad',
  'boxing',
  'boxingset',
  'boxingfacts',
  'boxingstart',
  'boxingstep',
  'boxingattack',
  'boxingend',
  'boxinggetup',
  'boxingexit',
  'boxingrecord',
  'boxingdecide',
  'boxingpoints',
]);

const SEED = 1;
const MAIN_STREAM = 'm';
const PRE_STREAM = 'p';
const MARK_STREAM = 'k';
const MARK_PATH_BEGIN = 301;
const MARK_PATH_END = 302;
const MARK_MUSIC_BEGIN = 3001;
const MARK_MUSIC_END = 3000;
const OPENING_MARKS: ReadonlySet<number> = new Set([MARK_PATH_BEGIN, MARK_MUSIC_BEGIN]);
const CLOSING_MARKS: ReadonlySet<number> = new Set([MARK_PATH_END, MARK_MUSIC_END]);
const ORACLE_NOWHERE = 25601;
const FULL_STATUS = 100;
const STALE = -2;
const BOXING_FACTS: readonly number[] = [210, 230, 231, 368];
const num = (v: unknown) => Number(v ?? 0);
const flag = (v: unknown) => (v ? 1 : 0);
const list = (v: unknown) => (v === undefined ? [] : String(v).split(',').map(Number));
const oracleGrid = (g: number) => (g === NOWHERE ? ORACLE_NOWHERE : g);

function withoutPathfinderAndMusicDraws(draws: readonly Draw[]): Draw[] {
  const out: Draw[] = [];
  let depth = 0;
  for (const d of draws) {
    if (d[0] === MARK_STREAM) {
      if (OPENING_MARKS.has(d[1])) depth++;
      else if (CLOSING_MARKS.has(d[1])) depth--;
      continue;
    }
    if (depth === 0) out.push(d);
  }
  return out;
}

function withoutStaleDecisionData(decision: readonly number[]): number[] {
  const [action, ...rest] = decision;
  if (action !== AiAction.NONE && action !== AiAction.ABSOLUTELY_NONE) return [...decision];
  const [, nextAction, nextData, finalDestination, orders, alert] = rest;
  return [action ?? 0, STALE, nextAction ?? 0, nextData ?? 0, finalDestination ?? 0, orders ?? 0, alert ?? 0];
}

function squadRow(row: readonly number[]): number[] {
  const [id, profile, team, gridNo, ...rest] = row as number[];
  const shown = team === Team.OUR || BOXER_GRIDNOS.includes(gridNo ?? NOWHERE) ? (gridNo ?? NOWHERE) : NOWHERE;
  return [id ?? 0, profile ?? 0, team ?? 0, shown, ...rest];
}

function soldierRow(s: Soldier): number[] {
  const st = s.stats;
  return [
    s.id,
    s.team,
    s.gridNo,
    flag(s.neutral),
    s.life,
    s.lifeMax,
    s.breath,
    s.actionPoints,
    s.ai.alertStatus,
    st.strength,
    st.dexterity,
    st.agility,
    s.skillTrait1,
    flag(s.collapsed),
    s.collapsedTurns,
    s.ai.underFire,
    flag(s.boxer),
    flag(s.underAiControl),
  ];
}

export class BoxingComparer {
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

  async #campaignSession(): Promise<CampaignSession> {
    if (!this.#session) {
      if (!this.#bytes) throw new Error('boxing probes need a save');
      this.#session = (await createTacticalSaveSession(this.#read, this.#bytes, SEED, this.#exists)).session;
    }
    return this.#session;
  }

  async compare(p: Json): Promise<number> {
    const label = `${String(p.probe)} line ${String(p.line ?? '')}`;
    try {
      const session = await this.#campaignSession();
      const c = session.campaign;
      const a = (p.args as Json | undefined) ?? {};
      switch (p.probe) {
        case 'boxingsquad':
          return await this.#squad(label, session, p, a);
        case 'boxing':
          return this.#dumpOnly(label, c, p);
        case 'boxingset':
          this.#set(c, a);
          return this.#dumpOnly(label, c, p);
        default:
          return this.#probe(label, c, p, a);
      }
    } catch (e) {
      return report(label, false, `threw: ${(e as Error).message}`);
    }
  }

  #t(c: CampaignSim): TacticalState {
    const t = c.tactical?.state;
    if (!t) throw new Error('no loaded sector');
    return t;
  }

  #host(c: CampaignSim): NarrativeHost {
    const host = c.talk?.host;
    if (!host) throw new Error('the session has no narrative');
    return host;
  }

  #soldier(c: CampaignSim, id: unknown): Soldier {
    const s = this.#t(c).soldiers[num(id)];
    if (!s?.placed) throw new Error(`soldier ${String(id)} is not in the loaded sector`);
    return s;
  }

  #dump(c: CampaignSim): Json {
    const t = this.#t(c);
    const b = t.boxing;
    const soldiers = t.soldiers
      .filter((s): s is Soldier => s?.placed === true && (s.team === Team.OUR || b.boxers.includes(s.id) || s.boxer))
      .sort((x, y) => x.id - y.id)
      .map(soldierRow);
    return {
      state: b.state,
      boxers: [...b.boxers],
      fought: b.fought.map(flag),
      won: b.matchesWon,
      rests: b.rests,
      resting: b.resting,
      lastWon: b.lastMatchWonByPlayer,
      paused: c.state.clock.paused,
      combat: [flag(t.inCombat), t.turn.currentTeam],
      soldiers,
    };
  }

  #dumpOnly(label: string, c: CampaignSim, p: Json): number {
    const diff = firstDifference(this.#dump(c), p.boxing);
    return report(label, diff === null, diff ?? `state ${String((p.boxing as Json | undefined)?.state)}`);
  }

  async #squad(label: string, session: CampaignSession, p: Json, a: Json): Promise<number> {
    const c = session.campaign;
    const ctx = c.strategic;
    const roster = c.battle?.roster;
    const flow = c.sectors;
    if (!ctx || !roster || !flow) throw new Error('the session has no strategic layer');
    const sector = parseSectorString(String(a.sector));
    const who = list(a.who);
    const grids = list(a.grids);
    for (const id of who) {
      const m = roster.get(id);
      if (!m) throw new Error(`no merc ${id}`);
      const group = getGroup(ctx, m.groupId);
      if (group) setGroupSectorValue(ctx, sector, group);
      else m.sector = sector;
    }
    who.forEach((id, i) => {
      const m = roster.get(id);
      if (!m) return;
      m.insertionCode = Insertion.GRIDNO;
      m.soldier.insertionData = grids[i] ?? NOWHERE;
    });
    await session.prepare({ type: 'enterSector', sector: String(a.sector) });
    if (!flow.setCurrentWorldSector(sector)) return report(label, false, 'sector map not loaded');
    c.state.clock.pauseLocked = false;
    c.state.clock.paused = false;
    const t = this.#t(c);
    const items = t.content.items;
    const soldiers = t.soldiers
      .filter((s): s is Soldier => s?.placed === true)
      .sort((x, y) => x.id - y.id)
      .map((s) =>
        squadRow([
          s.id,
          s.profile,
          s.team,
          s.gridNo,
          flag(s.neutral),
          s.civilianGroup,
          flag(findObjClass(items, s, WEAPON_CLASSES) !== NO_SLOT),
        ]),
      );
    const theirs = ((p.soldiers as number[][] | undefined) ?? []).map(squadRow);
    const diff = firstDifference({ soldiers, boxing: this.#dump(c) }, { soldiers: theirs, boxing: p.boxing });
    return report(label, diff === null, diff ?? `${soldiers.length} soldiers`);
  }

  #set(c: CampaignSim, a: Json): void {
    const t = this.#t(c);
    const b = t.boxing;
    if (a.state !== undefined) b.state = num(a.state);
    list(a.fought).forEach((v, i) => {
      if (i < b.fought.length) b.fought[i] = v !== 0;
    });
    list(a.boxers).forEach((v, i) => {
      if (i < b.boxers.length) b.boxers[i] = v;
    });
    if (a.rests !== undefined) b.rests = num(a.rests);
    if (a.resting !== undefined) b.resting = num(a.resting) !== 0;
    if (a.won !== undefined) b.matchesWon = num(a.won);
    if (a.last !== undefined) b.lastMatchWonByPlayer = num(a.last) !== 0;
    if (a.who === undefined) return;
    const s = this.#soldier(c, a.who);
    if (a.life !== undefined) s.life = num(a.life);
    if (a.breath !== undefined) s.breath = num(a.breath);
    if (a.collapsed !== undefined) s.collapsed = num(a.collapsed) !== 0;
    if (a.turns !== undefined) s.collapsedTurns = num(a.turns);
    if (a.ap !== undefined) s.actionPoints = num(a.ap);
    if (a.boxer !== undefined) s.boxer = num(a.boxer) !== 0;
    if (a.slot !== undefined) {
      const item = num(a.item);
      s.inv[num(a.slot)] = item === 0 ? emptyObject() : createItem(t.content.items, item, FULL_STATUS);
    }
  }

  #setActionContext(c: CampaignSim, npc: number): void {
    const host = this.#host(c);
    const t = this.#t(c);
    host.talk.waitingForTrigger = false;
    host.talk.inPanel = false;
    host.talk.referenceCount = 0;
    host.talk.charNum = npc;
    t.engagedInConv = false;
    const dest = t.soldiers.find((s) => s?.placed && s.profile === npc) ?? null;
    host.context.dest = dest?.id ?? null;
    host.context.src = null;
    host.context.srcProfile = NO_PROFILE;
  }

  #replay(c: CampaignSim, p: Json, action: () => void): string[] {
    const s = c.state;
    const draws = withoutPathfinderAndMusicDraws((p.draws as Draw[] | undefined) ?? []);
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
    const replayFacts = p.probe !== 'boxingfacts';
    if (replayFacts) Object.assign(narrative, { checkFact: (id: number, npc = 0) => facts.checkFact(id, npc) });
    const problems: string[] = [];
    try {
      action();
      if (main.left || pre.left) problems.push(`${main.left} Random and ${pre.left} PreRandom draws left over`);
    } catch (e) {
      if (e instanceof ReplayMismatch) problems.push(e.message);
      else throw e;
    } finally {
      delete rng.int;
      delete rng.chance;
      delete preRng.int;
      delete preRng.chance;
      if (replayFacts) delete narrative.checkFact;
    }
    return replayFacts ? [...problems, ...facts.finish()] : problems;
  }

  #run(c: CampaignSim, p: Json, a: Json): unknown {
    const t = this.#t(c);
    const sim = c.tactical;
    if (!sim) throw new Error('no tactical sim');
    switch (p.probe) {
      case 'boxingfacts':
        return BOXING_FACTS.map((id) => flag(c.narrative.checkFact(id, 0)));
      case 'boxingstart': {
        const env = c.talk?.npcActions.env;
        if (!env) throw new Error('no NPC actions');
        handleNpcDoAction(env, Npc.DARREN, NpcActionCode.START_BOXING_MATCH, 0);
        return null;
      }
      case 'boxingstep': {
        const s = this.#soldier(c, a.who);
        setSoldierPosition(t, s, num(a.to));
        boxingMovementCheckWhileTracked(t, s);
        return null;
      }
      case 'boxingattack': {
        const attacker = this.#soldier(c, a.who);
        const target = this.#soldier(c, a.target);
        attacker.attackingWeapon = num(a.item);
        target.attacker = attacker;
        const combat = processImplicationsOfPCAttack(t, attacker, target);
        return [flag(combat), flag(target.neutral)];
      }
      case 'boxingend':
        endBoxingMatch(t, this.#soldier(c, a.loser));
        return null;
      case 'boxinggetup':
        beginSoldierGetup(t, this.#soldier(c, a.who));
        return null;
      case 'boxingexit':
        exitBoxing(t);
        return null;
      case 'boxingrecord':
        triggerEndOfBoxingRecord(t, num(a.who ?? -1) < 0 ? null : this.#soldier(c, a.who));
        return null;
      case 'boxingdecide': {
        const s = this.#soldier(c, a.who);
        if (num(a.status) !== 0) decideAlertStatus(t, s, sim.ai.hooks);
        const action = decideNpcAction(t, s, sim.ai);
        const ai = s.ai;
        return [
          action,
          oracleGrid(ai.actionData),
          ai.nextAction,
          oracleGrid(ai.nextActionData),
          oracleGrid(s.finalDestination),
          ai.orders,
          ai.alertStatus,
        ];
      }
      case 'boxingpoints': {
        const s = this.#soldier(c, a.who);
        if (a.ap !== undefined) s.actionPoints = num(a.ap);
        const halves = boxingHalvesPoints(t);
        const full = calcActionPoints(s, halves);
        calcNewActionPoints(s, halves);
        return [full, s.actionPoints, s.initialActionPoints];
      }
      default:
        throw new Error(`unknown boxing probe ${String(p.probe)}`);
    }
  }

  #realtimeTurnOnCombatExit(c: CampaignSim): void {
    const t = this.#t(c);
    const clock = c.sectors?.realtimeClock;
    if (clock && !t.inCombat && t.turn.forceRealtimeTurn) handleRealtimeTurns(t, clock);
  }

  #probe(label: string, c: CampaignSim, p: Json, a: Json): number {
    const host = this.#host(c);
    host.talk.queue.length = 0;
    if (p.probe === 'boxingstart') this.#setActionContext(c, Npc.DARREN);
    const history = c.state.laptop.history.length;
    let extra: unknown = null;
    const problems = this.#replay(c, p, () => {
      extra = this.#run(c, p, a);
      this.#realtimeTurnOnCombatExit(c);
    });
    if (p.probe === 'boxingdecide') extra = withoutStaleDecisionData(extra as number[]);
    const ours = {
      queue: host.talk.queue.map(queueEntry),
      history: c.state.laptop.history.slice(history).map((h) => [h.code, h.secondCode, h.date, h.x, h.y, h.z]),
      extra,
      boxing: this.#dump(c),
    };
    const theirs = {
      queue: p.queue,
      history: nativeHistory((p.history as number[][]) ?? []),
      extra: p.probe === 'boxingdecide' ? withoutStaleDecisionData(p.extra as number[]) : p.extra,
      boxing: p.boxing,
    };
    const diff = firstDifference(ours, theirs);
    if (diff) problems.push(diff);
    host.talk.queue.length = 0;
    return report(label, problems.length === 0, problems.join('; ') || `state ${String((p.boxing as Json | undefined)?.state)}`);
  }
}
