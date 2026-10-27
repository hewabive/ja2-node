import { ItemClass } from '../../src/content/items/items.ts';
import type { LayerCount } from '../../src/content/narrative/npc-records.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import { createSaveSession } from '../../src/server/save-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import { cloneObject, createItem, createMoney, deleteObject, type ItemObject, removeObjectAt } from '../../src/sim/items/object.ts';
import { receiveEnv } from '../../src/sim/narrative/converse.ts';
import { soldierByProfile } from '../../src/sim/narrative/dialogue-queue.ts';
import { dealerTakesGive, giveToNpc, handleNpcItemGiven } from '../../src/sim/narrative/give.ts';
import type { NarrativeHost } from '../../src/sim/narrative/host.ts';
import { ensureQuoteFileLoaded } from '../../src/sim/narrative/records.ts';
import { npcConsiderReceivingItemFromMerc } from '../../src/sim/narrative/select.ts';
import { dealerIdFromProfile } from '../../src/sim/strategic/economy/merchants/context.ts';
import { dealerState } from '../../src/sim/strategic/economy/merchants/state.ts';
import { Npc } from '../../src/sim/strategic/narrative/npc-ids.ts';
import { giveItemOpcode } from '../../src/sim/tactical/give.ts';
import { NO_SLOT } from '../../src/sim/tactical/inventory.ts';
import { stopMerc } from '../../src/sim/tactical/movement.ts';
import { handleActionItemQueue, setOffActionItemsInGridNo } from '../../src/sim/tactical/narrative/quest-items.ts';
import type { Soldier } from '../../src/sim/tactical/soldier.ts';
import type { TacticalState } from '../../src/sim/tactical/state.ts';
import { addItemToPool, removeWorldItem, Visibility, type WorldItem, WorldItemFlags } from '../../src/sim/tactical/world-items.ts';
import { DrawReplay, diffJson, FactReplay, profileFields, queueEntry, report } from './talk-compare.ts';

type Json = Record<string, unknown>;
type Draw = readonly [string, number, number, number];
type FactEntry = readonly [number, number, number];
type ObjectRow = readonly [number, number, number, number];

export const GIVE_PROBES: ReadonlySet<string> = new Set(['receive', 'give', 'npcgive', 'actionitem']);

const SEED = 1;
const NO_PROFILE = 200;
const NO_ARRAY = -2;
const NOT_FOUND = -1;
const APPROACH_GIVINGITEM = 6;
const ARMED_BOMB_OBJECT = 0x08;
const BOMB_PRESSURE = 3;
const BOMB_REMOTE = 2;
const QUOTE_SAID = 0x01;
const MARK_STREAM = 'k';
const MARK_PATH_BEGIN = 301;
const MARK_PATH_END = 302;

class MedicalReplay {
  readonly #costs: readonly number[];
  #at = 0;
  readonly problems: string[] = [];

  constructor(costs: readonly number[]) {
    this.#costs = costs;
  }

  next(): number {
    const v = this.#costs[this.#at++];
    if (v === undefined) {
      this.problems.push('extra CalcMedicalCost');
      return 0;
    }
    return v;
  }

  finish(): string[] {
    if (this.#at < this.#costs.length) this.problems.push(`${this.#costs.length - this.#at} native CalcMedicalCost calls left`);
    return this.problems;
  }
}

interface Replay {
  readonly host: NarrativeHost;
  readonly facts: FactReplay;
  readonly draws: DrawReplay;
  readonly medical: MedicalReplay;
}

function objectRow(t: TacticalState, o: ItemObject): ObjectRow {
  const money = t.content.items.byIndex.get(o.item)?.itemClass === ItemClass.MONEY ? o.money : 0;
  return [o.item, o.count, o.status[0] ?? 0, money];
}

function inventoryRows(t: TacticalState, s: Soldier): ObjectRow[] {
  return s.inv.map((o) => objectRow(t, o));
}

function poolRows(t: TacticalState, gridNo: number, level: number): unknown[] {
  return t.worldItems.filter((wi) => wi.gridNo === gridNo && wi.level === level).map((wi) => [wi.visible, objectRow(t, wi.object)]);
}

function withoutPathDraws(trace: readonly Draw[]): Draw[] {
  let depth = 0;
  const kept: Draw[] = [];
  for (const d of trace) {
    if (d[0] === MARK_STREAM) depth += d[1] === MARK_PATH_BEGIN ? 1 : d[1] === MARK_PATH_END ? -1 : 0;
    else if (depth === 0) kept.push(d);
  }
  return kept;
}

function changedBytes(before: Uint8Array, after: Uint8Array): number[][] {
  const out: number[][] = [];
  after.forEach((v, k) => {
    if (v !== before[k]) out.push([k, before[k] ?? 0, v]);
  });
  return out;
}

export class GiveComparer {
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
    if (!this.#bytes) throw new Error('give probes need a save');
    const { session } = await createSaveSession(this.#read, this.#bytes, SEED, this.#exists, this.#layers);
    this.#campaign = session.campaign;
    return session.campaign;
  }

  async compare(p: Json): Promise<number> {
    const label = `${String(p.probe)} line ${p.line}`;
    try {
      const c = await this.#ensure();
      switch (p.probe) {
        case 'receive':
          return this.#receive(label, c, p);
        case 'give':
          return this.#give(label, c, p);
        case 'npcgive':
          return this.#npcGive(label, c, p);
        default:
          return this.#actionItem(label, c, p);
      }
    } catch (e) {
      return report(label, false, `threw: ${(e as Error).message}`);
    }
  }

  #replay(c: CampaignSim, p: Json): Replay {
    const base = c.talk?.host;
    if (!base) throw new Error('the session has no narrative');
    const facts = new FactReplay(p.facts as FactEntry[], (fact, value) => base.setFact(fact, value));
    const draws = new DrawReplay(withoutPathDraws(p.draws as Draw[]));
    const medical = new MedicalReplay(p.medical as number[]);
    const host: NarrativeHost = {
      ...base,
      facts,
      random: (n) => draws.int(n),
      receive: { ...base.receive, calcMedicalCost: () => medical.next() },
    };
    return { host, facts, draws, medical };
  }

  #tactical(c: CampaignSim): TacticalState {
    const t = c.tactical?.state;
    if (!t) throw new Error('no sector loaded');
    return t;
  }

  #applySetup(c: CampaignSim, setup: Json, npc: number, merc: number, host: NarrativeHost): void {
    const n = c.state.narrative;
    for (const [id, v] of (setup.facts as number[][] | undefined) ?? []) n.facts[id ?? 0] = v ?? 0;
    for (const [id, v] of (setup.quests as number[][] | undefined) ?? []) n.quests[id ?? 0] = v ?? 0;
    const p = host.profile(npc);
    if (setup.balance !== undefined && p) p.balance = Number(setup.balance);
    if (setup.npcData !== undefined && p) p.npcData = Number(setup.npcData);
    const hospital = setup.hospital as number[] | undefined;
    if (hospital) {
      n.hospital.tempBalance = hospital[0] ?? 0;
      n.hospital.refund = hospital[1] ?? 0;
    }
    if (setup.said !== undefined) {
      const records = ensureQuoteFileLoaded(host, npc);
      const q = records?.[Number(setup.said)];
      if (q) q.flags |= QUOTE_SAID;
    }
    const sex = setup.mercSex;
    const m = host.profile(merc) as { sex: number } | null;
    if (sex !== undefined && m) m.sex = Number(sex);
  }

  #common(c: CampaignSim, r: Replay, p: Json, factsBefore: Uint8Array, questsBefore: Uint8Array): string[] {
    const problems = [...r.facts.finish(), ...r.draws.finish(), ...r.medical.finish()];
    const n = c.state.narrative;
    const compare = (key: string, ours: unknown) => {
      if (JSON.stringify(ours) !== JSON.stringify(p[key])) problems.push(`${key}: ${JSON.stringify(ours)} vs ${JSON.stringify(p[key])}`);
    };
    compare('queue', r.host.talk.queue.map(queueEntry));
    compare('factChanges', changedBytes(factsBefore, n.facts));
    compare('questChanges', changedBytes(questsBefore, n.quests));
    compare('hospital', [n.hospital.tempBalance, n.hospital.refund]);
    return problems;
  }

  #frankCash(c: CampaignSim): number {
    const merchants = c.merchants;
    if (!merchants) return 0;
    const id = dealerIdFromProfile(merchants, Npc.FRANK);
    return id < 0 ? 0 : dealerState(merchants.state, id).status.cash;
  }

  #receive(label: string, c: CampaignSim, p: Json): number {
    const t = this.#tactical(c);
    const r = this.#replay(c, p);
    const npc = Number(p.npc);
    const mercId = Number(p.merc);
    const merc = mercId >= 0 ? (t.soldiers[mercId] ?? null) : null;
    const mercProfile = merc ? merc.profile : NO_PROFILE;
    this.#applySetup(c, (p.setup as Json) ?? {}, npc, mercProfile, r.host);
    const [item, count, status, money] = p.object as number[];
    const object = { item: item ?? 0, count: count ?? 0, status: status ?? 0, money: money ?? 0 };
    const costBefore = c.state.finances.profileCostToDate.get(npc) ?? 0;
    const frankBefore = this.#frankCash(c);
    const factsBefore = Uint8Array.from(c.state.narrative.facts);
    const questsBefore = Uint8Array.from(c.state.narrative.quests);
    this.#resetTalk(c);
    const records = ensureQuoteFileLoaded(r.host, npc);
    const result = records ? npcConsiderReceivingItemFromMerc(receiveEnv(r.host), npc, mercProfile, object, records) : null;
    const index = !records ? NO_ARRAY : result?.record ? result.index : NOT_FOUND;
    const record = !records ? NO_ARRAY : result?.record ? records.indexOf(result.record) : NOT_FOUND;
    const problems = this.#common(c, r, p, factsBefore, questsBefore);
    if (index !== Number(p.index)) problems.push(`index ${index} vs ${p.index}`);
    if (record !== Number(p.record)) problems.push(`record ${record} vs ${p.record}`);
    if ((result?.opinion ?? 0) !== Number(p.opinion)) problems.push(`opinion ${result?.opinion ?? 0} vs ${p.opinion}`);
    const cost = (c.state.finances.profileCostToDate.get(npc) ?? 0) - costBefore;
    if (cost !== Number(p.totalCost)) problems.push(`totalCost ${cost} vs ${p.totalCost}`);
    const frank = this.#frankCash(c) - frankBefore;
    if (frank !== Number(p.frankCash)) problems.push(`frankCash ${frank} vs ${p.frankCash}`);
    problems.push(...diffJson(profileFields(npc, r.host.profile(npc)), p.after as Json));
    this.#resetTalk(c);
    return report(label, problems.length === 0, problems.join('; ') || `record ${record}, index ${index}`);
  }

  #pickedObject(t: TacticalState, giver: Soldier, p: Json): { object: ItemObject; slot: number } {
    const native = p.object as number[];
    const slot = Number(p.slot);
    if (slot === NO_SLOT) {
      const amount = native[3] ?? 0;
      const money = t.content.items.byName.get('MONEY')?.index;
      const pocket = giver.inv.findIndex((o) => o.item === money && o.money >= amount);
      const o = giver.inv[pocket];
      if (!o) throw new Error('no money pocket');
      o.money -= amount;
      if (o.money === 0) deleteObject(o);
      return { object: createMoney(t.content.items, amount), slot };
    }
    const source = giver.inv[slot];
    if (!source) throw new Error(`no slot ${slot}`);
    const object = cloneObject(source);
    if ((native[1] ?? 0) === 1 && source.count > 1) {
      object.count = 1;
      object.status = [source.status[0] ?? 0];
      source.status = [...source.status.slice(1, source.count), source.status[0] ?? 0];
    }
    return { object, slot };
  }

  #give(label: string, c: CampaignSim, p: Json): number {
    const t = this.#tactical(c);
    const r = this.#replay(c, p);
    const giver = t.soldiers[Number(p.who)];
    const target = t.soldiers[Number(p.to)];
    if (!giver || !target) throw new Error('no such soldier');
    this.#applySetup(c, (p.setup as Json) ?? {}, target.profile, giver.profile, r.host);
    const cash = p.cash as number[];
    if (cash.length === 2) Object.assign(giver.inv[cash[0] ?? 0] as ItemObject, createMoney(t.content.items, cash[1] ?? 0));
    const { object, slot } = this.#pickedObject(t, giver, p);
    const factsBefore = Uint8Array.from(c.state.narrative.facts);
    const questsBefore = Uint8Array.from(c.state.narrative.quests);
    this.#resetTalk(c);
    const hooks: Json[] = [];
    const port = t.narrative;
    t.narrative = {
      ...port,
      giveToNpc: (g, tg, o) => {
        hooks.push({ kind: 'conversation', args: [tg.id, g.id, APPROACH_GIVINGITEM] });
        giveToNpc(r.host, g, tg, o);
      },
      dealerTakesGive: (g, d, o, s) =>
        dealerTakesGive(r.host, g, d, o, s, (dealer) => {
          hooks.push({ kind: 'shop', args: [dealer, 0, 0] });
        }),
      triggerDoneGivingItem: (profile) => port.triggerDoneGivingItem(profile),
    };
    giver.pendingGive = { slot, targetGridNo: target.gridNo, direction: giver.direction, target: target.id, begun: true };
    giver.tempObject = cloneObject(object);
    const apBefore = giver.actionPoints;
    try {
      giveItemOpcode(t, giver);
    } finally {
      t.narrative = port;
    }
    const problems = this.#common(c, r, p, factsBefore, questsBefore);
    const compare = (key: string, ours: unknown) => {
      if (JSON.stringify(ours) !== JSON.stringify(p[key])) problems.push(`${key}: ${JSON.stringify(ours)} vs ${JSON.stringify(p[key])}`);
    };
    const offered = (p.hooks as Json[]).some((h) => h.kind === 'offer');
    const source = slot !== NO_SLOT ? giver.inv[slot] : undefined;
    if (offered && source) removeObjectAt(source, object.count);
    compare('object', objectRow(t, object));
    compare('hooks', offered ? [...hooks, { kind: 'offer', args: [object.item, NO_SLOT, 0] }] : hooks);
    compare('flags', target.profile !== NO_PROFILE ? (c.state.npcRecords.arrays[target.profile]?.map((q) => q.flags) ?? []) : []);
    compare('engaged', t.engagedInConv);
    compare('references', r.host.talk.referenceCount);
    compare('ap', apBefore - giver.actionPoints);
    compare('giverEngaged', giver.engagedInAction);
    compare('targetEngaged', target.engagedInAction);
    compare('giverInv', inventoryRows(t, giver));
    compare('targetInv', inventoryRows(t, target));
    compare('giverPool', poolRows(t, giver.gridNo, giver.level));
    if (p.cursor !== null) problems.push(`native cursor ${JSON.stringify(p.cursor)} (ja2-node drops instead)`);
    if (target.profile !== NO_PROFILE) {
      problems.push(...diffJson(profileFields(target.profile, r.host.profile(target.profile)), p.targetProfile as Json));
      const prof = r.host.profile(target.profile);
      compare(
        'targetProfileInv',
        prof ? { inv: [...prof.inventory], status: [...prof.inventoryStatus], number: [...prof.inventoryCount], money: prof.money } : null,
      );
    }
    giver.engagedInAction = false;
    target.engagedInAction = false;
    this.#resetTalk(c);
    return report(label, problems.length === 0, problems.join('; ') || `${(p.queue as unknown[]).length} events`);
  }

  #npcGive(label: string, c: CampaignSim, p: Json): number {
    const t = this.#tactical(c);
    const r = this.#replay(c, p);
    const npc = Number(p.npc);
    const npcSoldier = soldierByProfile(r.host, npc);
    const merc = Number(p.merc) >= 0 ? (t.soldiers[Number(p.merc)] ?? null) : null;
    if (!npcSoldier) throw new Error('no NPC soldier');
    const slot = Number(p.slot);
    const factsBefore = Uint8Array.from(c.state.narrative.facts);
    const questsBefore = Uint8Array.from(c.state.narrative.quests);
    this.#resetTalk(c);
    r.host.talk.charNum = npc;
    r.host.context.src = merc?.id ?? null;
    r.host.context.dest = npcSoldier.id;
    r.host.context.srcProfile = merc ? merc.profile : NO_PROFILE;
    handleNpcItemGiven(r.host, npc, slot);
    const problems = this.#common(c, r, p, factsBefore, questsBefore);
    const compare = (key: string, ours: unknown) => {
      if (JSON.stringify(ours) !== JSON.stringify(p[key])) problems.push(`${key}: ${JSON.stringify(ours)} vs ${JSON.stringify(p[key])}`);
    };
    const pending = npcSoldier.pendingGive !== null || npcSoldier.tempObject !== null;
    compare('panel', r.host.talk.inPanel);
    compare('pending', pending);
    const g = npcSoldier.pendingGive;
    if (pending && g) compare('pendingData', [g.slot, g.targetGridNo, g.direction, g.target]);
    compare('temp', npcSoldier.tempObject ? objectRow(t, npcSoldier.tempObject) : null);
    compare('npcInv', inventoryRows(t, npcSoldier));
    compare('npcPool', poolRows(t, npcSoldier.gridNo, 0));
    if (pending) {
      stopMerc(t, npcSoldier);
      npcSoldier.pendingGive = null;
      npcSoldier.tempObject = null;
    }
    npcSoldier.engagedInAction = false;
    if (merc) merc.engagedInAction = false;
    this.#resetTalk(c);
    return report(label, problems.length === 0, problems.join('; ') || `pending ${pending}`);
  }

  #probeBomb(t: TacticalState, name: string, gridNo: number, level: number, det: number, freq: number, owner: number, action: number) {
    const item = t.content.items.byName.get(name)?.index;
    if (item === undefined) throw new Error(`no ${name}`);
    const o = createItem(t.content.items, item, 100);
    o.gunAmmoType = det;
    o.money = (freq & 0xff) | (owner << 8);
    o.keyId = action;
    if (name === 'ACTION_ITEM') o.flags |= ARMED_BOMB_OBJECT;
    const added = addItemToPool(t, gridNo, o, Visibility.BURIED, level, WorldItemFlags.ARMED_BOMB, 0);
    if (!added) throw new Error(`cannot add ${name} at ${gridNo}`);
    return added;
  }

  #actionItem(label: string, c: CampaignSim, p: Json): number {
    const t = this.#tactical(c);
    const merc = t.soldiers[Number(p.who)];
    if (!merc) throw new Error('no soldier');
    const det = Number(p.det);
    const freq = Number(p.freq);
    const owner = Number(p.owner);
    const action = Number(p.action);
    const at = Number(p.at);
    const added: WorldItem[] = [];
    if (p.viaSwitch) {
      added.push(this.#probeBomb(t, 'SWITCH', merc.gridNo, merc.level, BOMB_PRESSURE, freq, owner, 0));
      added.push(this.#probeBomb(t, 'ACTION_ITEM', at, merc.level, BOMB_REMOTE, freq, owner, action));
    } else added.push(this.#probeBomb(t, 'ACTION_ITEM', at, merc.level, det, freq, owner, action));
    const factsBefore = Uint8Array.from(c.state.narrative.facts);
    this.#resetTalk(c);
    setOffActionItemsInGridNo(t, merc);
    const queued = t.actionItems.queue.length;
    const disallowBefore = t.perception.disallowSight;
    handleActionItemQueue(t);
    const problems: string[] = [];
    const compare = (key: string, ours: unknown) => {
      if (JSON.stringify(ours) !== JSON.stringify(p[key])) problems.push(`${key}: ${JSON.stringify(ours)} vs ${JSON.stringify(p[key])}`);
    };
    compare('queued', queued);
    compare('disallowBefore', disallowBefore);
    compare('disallowAfter', t.perception.disallowSight);
    compare('active', t.actionItems.active);
    compare('groups', [...t.civGroups.hostility]);
    compare('inCombat', t.inCombat);
    if (t.inCombat) compare('team', t.turn.currentTeam);
    const known = (p.civs as number[][]).filter(([id]) => t.soldiers[id ?? -1]?.placed === true);
    const civs = known.map(([id]) => {
      const s = t.soldiers[id ?? -1] as Soldier;
      return [s.id, s.neutral ? 1 : 0, s.side];
    });
    if (JSON.stringify(civs) !== JSON.stringify(known)) problems.push(`civs: ${JSON.stringify(civs)} vs ${JSON.stringify(known)}`);
    compare('gridNo', merc.gridNo);
    compare('factChanges', changedBytes(factsBefore, c.state.narrative.facts));
    for (const wi of added) removeWorldItem(t, wi);
    this.#resetTalk(c);
    return report(label, problems.length === 0, problems.join('; ') || `${queued} queued`);
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
    talk.pending = null;
    if (t) t.engagedInConv = false;
  }
}
