import { parseSaveGame } from '../../src/content/formats/savegame.ts';
import { parseSaveEncryptionTable, SAVE_ENCRYPTION_PATH } from '../../src/content/formats/savegame-header.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import { createSaveSession } from '../../src/server/save-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import { NO_PERSONNEL_ENTRY } from '../../src/sim/campaign/laptop/laptop-state.ts';
import type { RecruitFlow } from '../../src/sim/campaign/narrative/recruit-flow.ts';
import type { RosterMerc } from '../../src/sim/campaign/roster.ts';
import { createItem, emptyObject } from '../../src/sim/items/object.ts';
import type { NarrativeHost } from '../../src/sim/narrative/host.ts';
import { tacticalCreateSoldier } from '../../src/sim/tactical/creation.ts';
import { drawStandingFrame, NEUTRAL_POPULATION, soldierSlotTaken } from '../../src/sim/tactical/init-list.ts';
import { addSoldierToSector, Insertion } from '../../src/sim/tactical/insertion.ts';
import { placeObject } from '../../src/sim/tactical/inventory.ts';
import { setSoldierPosition } from '../../src/sim/tactical/movement.ts';
import { handleNpcDoAction } from '../../src/sim/tactical/narrative/npc-actions/catalog.ts';
import { NpcActionCode } from '../../src/sim/tactical/narrative/npc-actions/codes.ts';
import type { NpcActionEnv } from '../../src/sim/tactical/narrative/npc-actions/env.ts';
import { answerNpcRequest, npcRequestDetails } from '../../src/sim/tactical/narrative/npc-actions/requestors.ts';
import { profileSoldierCreate } from '../../src/sim/tactical/narrative/profile-insertion.ts';
import { calcInterruptDuelPts } from '../../src/sim/tactical/perception/duel.ts';
import { inLoadedSector } from '../../src/sim/tactical/save-import.ts';
import { firstFreeSoldierId, NO_PROFILE, NOWHERE, type Soldier, Team } from '../../src/sim/tactical/soldier.ts';
import { soldierInventoryContext } from '../../src/sim/tactical/soldier-inventory.ts';
import type { TacticalState } from '../../src/sim/tactical/state.ts';
import {
  type Draw,
  type FactEntry,
  FactReplay,
  firstDifference,
  nativeHistory,
  profileDump,
  queueEntry,
  ReplayMismatch,
  report,
  StrictReplay,
  withoutFaceDraws,
} from './actions-compare.ts';

type Json = Record<string, unknown>;

export const RECRUIT_PROBES: ReadonlySet<string> = new Set(['addnpc', 'recruitset', 'recruit', 'unescort', 'robotcontrol']);

const SEED = 1;
const MAIN_STREAM = 'm';
const PRE_STREAM = 'p';
const ORACLE_NOWHERE = 25601;
const SOUTH = 4;
const FIRST_TOWN = 1;
const ROBOT = 62;
const RECRUIT_ACTIONS: Readonly<Record<string, number>> = {
  rpc: NpcActionCode.RECRUIT_WITH_SALARY,
  free: NpcActionCode.RECRUIT,
  unrecruit: NpcActionCode.UN_RECRUIT_EPC,
  settonpc: NpcActionCode.SET_EPC_TO_NPC,
  marry: NpcActionCode.REMOVE_MERC_FOR_MARRIAGE,
  enemy: NpcActionCode.BECOME_ENEMY,
};
const MARK_STREAM = 'k';
const MARK_PATH_BEGIN = 301;
const MARK_PATH_END = 302;
const num = (v: unknown) => Number(v ?? 0);

function withoutPathfinderDraws(draws: readonly Draw[]): Draw[] {
  const out: Draw[] = [];
  let depth = 0;
  for (const d of draws) {
    if (d[0] === MARK_STREAM) {
      if (d[1] === MARK_PATH_BEGIN) depth++;
      else if (d[1] === MARK_PATH_END) depth--;
      continue;
    }
    if (depth === 0) out.push(d);
  }
  return out;
}
const flag = (v: unknown) => (v ? 1 : 0);

interface Snapshot {
  readonly facts: Uint8Array;
  readonly quests: Uint8Array;
  readonly eventSeq: number;
  readonly history: number;
}

function changes(now: Uint8Array, before: Uint8Array): number[][] {
  const out: number[][] = [];
  now.forEach((v, i) => {
    if (v !== before[i]) out.push([i, before[i] ?? 0, v]);
  });
  return out;
}

function items(s: Soldier): number[] {
  return s.inv.map((o) => o.item);
}

function teamRow(m: RosterMerc): number[] {
  const s = m.soldier;
  const here = s.placed;
  const st = s.stats;
  return [
    m.id,
    m.profile,
    m.kind,
    m.assignment,
    m.sector.x,
    m.sector.y,
    m.sector.z,
    flag(m.betweenSectors),
    m.groupId,
    flag(here),
    here ? s.gridNo : -1,
    here ? s.direction : -1,
    here ? s.level : -1,
    s.life,
    s.lifeMax,
    st.agility,
    st.dexterity,
    st.strength,
    st.wisdom,
    st.leadership,
    st.marksmanship,
    st.mechanical,
    st.explosives,
    st.medical,
    st.experience,
    s.bleeding,
    s.breath,
    s.morale,
    s.camo,
    s.visible,
    s.bodyType,
    m.contract.contractEnd,
    m.remoteHolder ?? -1,
    here ? -1 : m.insertionCode,
    m.insertionDirection,
    ...items(s),
  ];
}

function civilianRow(s: Soldier): number[] {
  const st = s.stats;
  return [
    s.id,
    s.profile,
    s.team,
    flag(s.neutral),
    s.life,
    s.lifeMax,
    s.gridNo,
    s.direction,
    s.level,
    s.civilianGroup,
    s.bodyType,
    st.agility,
    st.dexterity,
    st.strength,
    st.wisdom,
    st.leadership,
    st.marksmanship,
    st.mechanical,
    st.explosives,
    st.medical,
    st.experience,
    s.camo,
    ...items(s),
  ];
}

function nativeProfiles(rows: readonly Json[]): Json[] {
  return rows.map((r) => {
    const insertion = (r.insertion as number[] | undefined) ?? [0, 0, 0];
    const data = insertion[2] === ORACLE_NOWHERE ? NOWHERE : insertion[2];
    return { ...r, insertion: [insertion[0], insertion[1], data] };
  });
}

export class RecruitComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  #bytes: Uint8Array | null = null;
  #session: CampaignSession | null = null;
  #reserved = new Set<number>();

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
      if (!this.#bytes) throw new Error('recruiting probes need a save');
      this.#session = (await createSaveSession(this.#read, this.#bytes, SEED, this.#exists)).session;
      this.#reserved = await this.#awaySoldiers(this.#bytes);
      const flow = this.#session.campaign.talk?.npcActions.recruitFlow;
      if (flow) flow.reservedSoldierSlot = (id) => this.#reserved.has(id);
    }
    return this.#session.campaign;
  }

  async #awaySoldiers(bytes: Uint8Array): Promise<Set<number>> {
    const table = await this.#read(SAVE_ENCRYPTION_PATH);
    if (!table) return new Set();
    const save = parseSaveGame(bytes, parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode(table))));
    return new Set(save.soldiers.filter((e) => e.soldier.active !== 0 && !inLoadedSector(save, e.soldier)).map((e) => e.soldier.id));
  }

  async compare(p: Json): Promise<number> {
    const label = `${String(p.probe)} line ${String(p.line ?? '')}`;
    try {
      const c = await this.#campaign();
      const a = (p.args as Json | undefined) ?? {};
      switch (p.probe) {
        case 'addnpc':
          return this.#addNpc(label, c, p, a);
        case 'recruitset':
          return this.#set(label, c, p, a);
        case 'robotcontrol':
          return this.#robot(label, c, p, a);
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

  #recruit(c: CampaignSim): RecruitFlow {
    const flow = c.talk?.npcActions.recruitFlow;
    if (!flow) throw new Error('the session has no recruiting');
    return flow;
  }

  #replay(c: CampaignSim, p: Json, action: () => void): string[] {
    const s = c.state;
    const draws = withoutFaceDraws(withoutPathfinderDraws((p.draws as Draw[] | undefined) ?? []));
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
      delete narrative.checkFact;
    }
    return [...problems, ...facts.finish()];
  }

  #addNpc(label: string, c: CampaignSim, p: Json, a: Json): number {
    const t = this.#t(c);
    const at = num(a.at);
    const direction = a.dir === undefined ? SOUTH : num(a.dir);
    let created: Soldier | null = null;
    const problems = this.#replay(c, p, () => {
      const id = firstFreeSoldierId((n) => soldierSlotTaken(t, n) || this.#reserved.has(n), Team.CIV);
      created = tacticalCreateSoldier(t, profileSoldierCreate(num(a.profile), Team.CIV, direction), id, NEUTRAL_POPULATION);
      if (!created) return;
      drawStandingFrame(t);
      created.insertionGridNo = at;
      addSoldierToSector(t, created, { code: Insertion.GRIDNO, data: at, direction }, {}, false);
      if (created.gridNo !== at) setSoldierPosition(t, created, at);
    });
    const ours = { id: (created as Soldier | null)?.id ?? -1, civilians: this.#civilians(c, false) };
    const diff = firstDifference(ours, { id: p.id, civilians: p.civilians });
    if (diff) problems.push(diff);
    return report(label, problems.length === 0, problems.join('; ') || `soldier ${ours.id}`);
  }

  #set(label: string, c: CampaignSim, p: Json, a: Json): number {
    const t = this.#t(c);
    if (a.who !== undefined) {
      const s = t.soldiers[num(a.who)];
      if (!s) throw new Error(`no soldier ${String(a.who)}`);
      const slot = num(a.slot);
      const item = num(a.item);
      const status = a.status === undefined ? 100 : num(a.status);
      if (num(a.place) !== 0) {
        const o = createItem(t.content.items, item, status);
        if (!placeObject(soldierInventoryContext(t, s), s, slot, o)) throw new Error('placeObject refused');
      } else s.inv[slot] = item === 0 ? emptyObject() : createItem(t.content.items, item, status);
    }
    if (a.profile !== undefined) {
      const profile = c.narrative.profile(num(a.profile));
      if (!profile) throw new Error(`no profile ${String(a.profile)}`);
      if (a.town !== undefined) profile.town = num(a.town);
      if (a.attachment !== undefined) profile.townAttachment = num(a.attachment);
      if (a.salary !== undefined) profile.salary = num(a.salary);
      if (a.flags !== undefined) profile.miscFlags = num(a.flags);
      if (a.flags3 !== undefined) profile.miscFlags3 = num(a.flags3);
    }
    const pairs = (key: string, apply: (id: number, value: number) => void) => {
      if (a[key] === undefined) return;
      for (const kv of String(a[key]).split(',')) {
        const [id, value] = kv.split(':').map(Number);
        apply(id ?? 0, value ?? 0);
      }
    };
    pairs('facts', (id, value) => {
      c.state.narrative.facts[id] = value;
    });
    pairs('quests', (id, value) => {
      c.state.narrative.quests[id] = value;
    });
    if (a.squad !== undefined) c.state.forces.currentSquad = num(a.squad);
    const diff = firstDifference({ team: this.#team(c) }, { team: p.team });
    return report(label, diff === null, diff ?? 'state set');
  }

  #robot(label: string, c: CampaignSim, p: Json, a: Json): number {
    const roster = c.battle?.roster;
    const t = this.#t(c);
    if (!roster) throw new Error('no roster');
    const robot = roster.byProfile(ROBOT) ?? null;
    if (num(a.update) !== 0 && robot) roster.updateRobotControllerGivenRobot(robot.id);
    const opp = a.opp === undefined ? null : (t.soldiers[num(a.opp)] ?? null);
    const mercs = roster.all().map((m) => {
      const row = [m.id, flag(roster.controllingRobot(m.id))];
      if (opp && m.soldier.placed) row.push(calcInterruptDuelPts(t, m.soldier, opp, false));
      return row;
    });
    const ours = {
      robot: robot?.id ?? -1,
      holder: robot?.remoteHolder ?? -1,
      controlled: robot && roster.canRobotBeControlled(robot.id) ? 1 : 0,
      mercs,
    };
    const diff = firstDifference(ours, { robot: p.robot, holder: p.holder, controlled: p.controlled, mercs: p.mercs });
    return report(label, diff === null, diff ?? `holder ${ours.holder}`);
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
    };
  }

  #probe(label: string, c: CampaignSim, p: Json, a: Json): number {
    const npc = num(a.npc);
    const unescort = p.probe === 'unescort';
    this.#setContext(c, unescort ? NO_PROFILE : npc, a);
    const before = this.#snapshot(c);
    let queue: Json[] = [];
    const problems = this.#replay(c, p, () => {
      queue = unescort ? this.#unescort(c, npc, num(a.map ?? 1) !== 0) : this.#act(c, npc, a);
    });
    const ours = this.#state(c, p, before, queue);
    const theirs = this.#theirState(p);
    const diff = firstDifference(ours, theirs);
    if (diff) problems.push(diff);
    c.state.battle.prompt = null;
    this.#host(c).talk.queue.length = 0;
    return report(label, problems.length === 0, problems.join('; ') || `${queue.length} queued`);
  }

  #env(c: CampaignSim): NpcActionEnv {
    const env = c.talk?.npcActions.env;
    if (!env) throw new Error('the session has no NPC actions');
    return env;
  }

  #act(c: CampaignSim, npc: number, a: Json): Json[] {
    const env = this.#env(c);
    const action = String(a.action ?? 'rpc');
    const record = num(a.record);
    if (action === 'epc') {
      const host = this.#host(c);
      const dest = host.context.dest === null ? null : (c.tactical?.state.soldiers[host.context.dest] ?? null);
      if (!dest) throw new Error('recruit action=epc needs the NPC soldier');
      answerNpcRequest(env, npcRequestDetails(env, NpcActionCode.ASK_ABOUT_ESCORTING_EPC, dest.profile, record), 'yes');
    } else {
      const code = RECRUIT_ACTIONS[action];
      if (code === undefined) throw new Error(`unknown action ${action}`);
      handleNpcDoAction(env, npc, code, record);
    }
    return this.#host(c).talk.queue.map(queueEntry);
  }

  #unescort(c: CampaignSim, npc: number, map: boolean): Json[] {
    const flow = this.#recruit(c);
    const merc = flow.playerSoldierOf(npc);
    if (!merc) throw new Error('unescort: the profile is not on the team');
    const host = this.#host(c);
    if (!map) {
      flow.triggerWrongSectorRecord(merc);
      return host.talk.queue.map(queueEntry);
    }
    const partner = flow.partnerOf(merc);
    flow.internalUnescortEpc(merc);
    if (partner) flow.internalUnescortEpc(partner);
    const queued = [...host.talk.queue];
    host.talk.queue.length = 0;
    for (const e of queued) if (e.kind === 'removeEpc') flow.removeEpc(e.npc);
    return queued.map(queueEntry);
  }

  #team(c: CampaignSim): number[][] {
    return (c.battle?.roster.all() ?? []).map(teamRow);
  }

  #civilians(c: CampaignSim, all: boolean): number[][] {
    const t = this.#t(c);
    return t.soldiers
      .filter((s): s is Soldier => s?.placed === true && s.team !== Team.OUR && (all || s.profile !== NO_PROFILE))
      .sort((x, y) => x.id - y.id)
      .map(civilianRow);
  }

  #state(c: CampaignSim, p: Json, before: Snapshot, queue: Json[]): Json {
    const s = c.state;
    const ids = ((p.profiles as Json[] | undefined) ?? []).map((n) => num(n.id));
    const npc = num((p.args as Json | undefined)?.npc);
    return {
      queue,
      factChanges: changes(s.narrative.facts, before.facts),
      questChanges: changes(s.narrative.quests, before.quests),
      events: s.queue.events.filter((e) => e.seq >= before.eventSeq).map((e) => [e.stamp, e.kind, e.param]),
      history: s.laptop.history.slice(before.history).map((h) => [h.code, h.secondCode, h.date, h.x, h.y, h.z]),
      team: this.#team(c),
      squads: s.forces.squads.map((q) => [...q]),
      currentSquad: s.forces.currentSquad,
      civilians: this.#civilians(c, String((p.args as Json | undefined)?.soldiers ?? '') === 'all'),
      profiles: ids.map((id) => profileDump(id, c.narrative.profile(id))),
      personnel: s.laptop.personnel.other.filter((x) => x !== NO_PERSONNEL_ENTRY),
      loyalty: s.economy.towns.slice(FIRST_TOWN).map((town) => [town.rating, town.change]),
      salary: c.narrative.profile(npc)?.salary ?? 0,
    };
  }

  #theirState(p: Json): Json {
    return {
      queue: p.queue,
      factChanges: p.factChanges,
      questChanges: p.questChanges,
      events: p.events,
      history: nativeHistory((p.history as number[][]) ?? []),
      team: p.team,
      squads: p.squads,
      currentSquad: p.currentSquad,
      civilians: ((p.civilians as number[][] | undefined) ?? []).map((r) => r.map((v, i) => (i === 3 ? flag(v) : v))),
      profiles: nativeProfiles((p.profiles as Json[] | undefined) ?? []),
      personnel: p.personnel,
      loyalty: p.loyalty,
      salary: p.salary,
    };
  }
}
