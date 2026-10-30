import { NOTHING } from '../../src/content/items/items.ts';
import { StructureFlags } from '../../src/content/world/structures.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import { u8 } from '../../src/core/int.ts';
import { createSaveSession } from '../../src/server/save-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import { createItems, deleteObject } from '../../src/sim/items/object.ts';
import { setCivGroupHostility } from '../../src/sim/strategic/narrative/civ-groups.ts';
import { EventKind } from '../../src/sim/strategic/time/constants.ts';
import { handleOpenableStruct } from '../../src/sim/tactical/doors/door-actions.ts';
import { findDoorInfo, removeDoorInfo, updateDoor } from '../../src/sim/tactical/doors/door-table.ts';
import { doTrapCheckOnStartingMenu } from '../../src/sim/tactical/doors/door-traps.ts';
import { toggleDoorAt } from '../../src/sim/tactical/doors.ts';
import {
  checkHostileOrSayQuoteList,
  makeCivHostile,
  processImplicationsOfPCAttack,
} from '../../src/sim/tactical/narrative/civ-hostility.ts';
import { STAT_KEYS, StatKind } from '../../src/sim/tactical/profiles.ts';
import { NOWHERE, type Soldier, Team } from '../../src/sim/tactical/soldier.ts';
import type { TacticalState } from '../../src/sim/tactical/state.ts';

type Json = Record<string, unknown>;
type Draw = readonly [string, number, number, number];

export const DOOR_PROBES: ReadonlySet<string> = new Set([
  'locks',
  'door',
  'doormenu',
  'civgroups',
  'makecivhostile',
  'pcattack',
  'hostilelist',
]);

const SEED = 1;
const ORACLE_NOWHERE = 25601;
const MAIN_STREAM = 'm';
const PRE_STREAM = 'p';
const GAIN_ORDER = [
  StatKind.HEALTH,
  StatKind.AGILITY,
  StatKind.DEXTERITY,
  StatKind.WISDOM,
  StatKind.MEDICAL,
  StatKind.EXPLOSIVES,
  StatKind.MECHANICAL,
  StatKind.MARKSMANSHIP,
  StatKind.EXPERIENCE,
  StatKind.STRENGTH,
  StatKind.LEADERSHIP,
];
const OUT_OF_RANGE_DOOR_AP_CODES = new Set([4, 5, 6, 7, 8, 9, 10, 11]);
const TRAP_CHECK_STOP_RESULTS = new Set(['trapStopped', 'trapNoticed']);

const num = (v: unknown) => Number(v ?? 0);
const grid = (g: unknown) => (Number(g) === ORACLE_NOWHERE ? NOWHERE : Number(g));

function report(label: string, same: boolean, detail: string): number {
  console.log(`${label}: ${same ? 'ok' : 'MISMATCH'} ${detail}`);
  return same ? 0 : 1;
}

class ReplayMismatch extends Error {}

class StrictReplay {
  readonly #draws: Draw[];
  #at = 0;

  constructor(draws: Draw[]) {
    this.#draws = draws;
  }

  get left(): number {
    return this.#draws.length - this.#at;
  }

  int(n: number): number {
    if (n === 0) return 0;
    const d = this.#draws[this.#at];
    if (!d) throw new ReplayMismatch(`PreRandom draw #${this.#at}: native log exhausted, ja2-node wants range ${n}`);
    if (d[1] !== n) throw new ReplayMismatch(`PreRandom draw #${this.#at}: ja2-node wants range ${n}, native drew ${JSON.stringify(d)}`);
    this.#at++;
    return d[2];
  }

  chance(percent: number): boolean {
    return this.int(100) < percent;
  }

  coinToss(): boolean {
    throw new ReplayMismatch('PreRandom coin toss is not in the native trace');
  }
}

class CosmeticTolerantReplay {
  readonly #draws: Draw[];
  #at = 0;
  skipped = 0;

  constructor(draws: Draw[]) {
    this.#draws = draws;
  }

  int(n: number): number {
    if (n === 0) return 0;
    while (this.#at < this.#draws.length && this.#draws[this.#at]?.[1] !== n) {
      this.#at++;
      this.skipped++;
    }
    const d = this.#draws[this.#at];
    if (!d) throw new ReplayMismatch(`Random: ja2-node wants range ${n}, no matching native draw left`);
    this.#at++;
    return d[2];
  }

  chance(percent: number): boolean {
    return this.int(100) < percent;
  }

  coinToss(): boolean {
    throw new ReplayMismatch('Random coin toss is not in the native trace');
  }

  get left(): number {
    return this.#draws.length - this.#at;
  }
}

function replayed<T>(t: TacticalState, trace: readonly Draw[], run: () => T): { result: T; preLeft: number; mainSkipped: number } {
  const pre = new StrictReplay(trace.filter((d) => d[0] === PRE_STREAM));
  const main = new CosmeticTolerantReplay(trace.filter((d) => d[0] === MAIN_STREAM));
  const saved = { rng: t.rng, pre: t.pre };
  Object.assign(t, { rng: main, pre });
  try {
    const result = run();
    return { result, preLeft: pre.left, mainSkipped: main.skipped + main.left };
  } finally {
    Object.assign(t, saved);
  }
}

function args(p: Json): Record<string, string> {
  return (p.args as Record<string, string> | undefined) ?? {};
}

function has(a: Record<string, string>, key: string): boolean {
  return a[key] !== undefined;
}

function int(a: Record<string, string>, key: string): number {
  return Number(a[key]);
}

function applyDoorSettings(t: TacticalState, g: number, a: Record<string, string>): void {
  const door = t.world.structures.find(g, StructureFlags.ANYDOOR);
  if (int(a, 'close') === 1 && door && door.flags & StructureFlags.OPEN) toggleDoorAt(t, g);
  if (has(a, 'remove') && findDoorInfo(t, g)) {
    removeDoorInfo(t, g);
    return;
  }
  if (!findDoorInfo(t, g) && has(a, 'lock'))
    t.world.mapDoors.set(g, {
      gridNo: g,
      locked: false,
      trapLevel: 0,
      trapId: 0,
      lockId: 0,
      perceivedLocked: 0,
      perceivedTrapped: 0,
      lockDamage: 0,
    });
  if (!findDoorInfo(t, g)) return;
  const patch: Record<string, number | boolean> = {};
  if (has(a, 'locked')) patch.locked = int(a, 'locked') !== 0;
  for (const [key, field] of [
    ['trap', 'trapId'],
    ['level', 'trapLevel'],
    ['lock', 'lockId'],
    ['damage', 'lockDamage'],
    ['perceivedLocked', 'perceivedLocked'],
    ['perceivedTrapped', 'perceivedTrapped'],
  ] as const)
    if (has(a, key)) patch[field] = int(a, key);
  updateDoor(t, g, patch);
}

function applyItems(t: TacticalState, s: Soldier, a: Record<string, string>): void {
  for (const key of ['give1', 'give2', 'give3']) {
    if (!has(a, key)) continue;
    const [slot, item, status, count, keyId] = (a[key] ?? '').split(':').map(Number);
    const o = createItems(t.content.items, item ?? NOTHING, status ?? 100, count ?? 1);
    if (keyId !== undefined) o.keyId = keyId;
    s.inv[slot ?? 0] = o;
  }
  if (has(a, 'clear'))
    for (const slot of (a.clear ?? '').split(':').map(Number)) {
      const o = s.inv[slot];
      if (o) deleteObject(o);
    }
  if (has(a, 'ring') && s.keyRing) {
    const [keyId, count] = (a.ring ?? '').split(':').map(Number);
    const first = s.keyRing[0];
    if (first) Object.assign(first, { keyId, count });
  }
}

function applySoldier(t: TacticalState, s: Soldier, a: Record<string, string>): void {
  if (has(a, 'ap')) s.actionPoints = int(a, 'ap');
  if (has(a, 'life')) s.life = int(a, 'life');
  if (has(a, 'breath')) s.breath = int(a, 'breath');
  if (has(a, 'bleeding')) s.bleeding = int(a, 'bleeding');
  if (has(a, 'shock')) s.shock = int(a, 'shock');
  const stats: Record<string, keyof Soldier['stats']> = {
    explosives: 'explosives',
    mechanical: 'mechanical',
    strength: 'strength',
    dexterity: 'dexterity',
    wisdom: 'wisdom',
    expLevel: 'experience',
  };
  for (const [key, field] of Object.entries(stats)) if (has(a, key)) s.stats[field] = int(a, key);
  if (has(a, 'lastSkillCheck')) s.lastSkillCheck = int(a, 'lastSkillCheck');
  if (has(a, 'skillCheckGridNo')) s.skillCheckGridNo = grid(a.skillCheckGridNo);
  if (has(a, 'skillCheckAttempts')) s.skillCheckAttempts = int(a, 'skillCheckAttempts');
  applyItems(t, s, a);
}

function doorFacts(t: TacticalState, g: number): Json {
  const door = findDoorInfo(t, g);
  const st = t.world.structures.find(g, StructureFlags.ANYDOOR);
  const base: Json = { gridNo: g, present: door !== null, open: st !== null && (st.flags & StructureFlags.OPEN) !== 0 };
  if (!door) return base;
  return {
    ...base,
    locked: door.locked,
    trapId: door.trapId,
    trapLevel: door.trapLevel,
    lockId: door.lockId,
    perceivedLocked: door.perceivedLocked,
    perceivedTrapped: door.perceivedTrapped,
    lockDamage: door.lockDamage,
  };
}

function soldierFacts(t: TacticalState, s: Soldier): Json {
  const progress = t.profiles.get(s.profile);
  const facts: Json = {
    ap: s.actionPoints,
    life: s.life,
    breath: s.breath,
    breathMax: s.breathMax,
    bleeding: s.bleeding,
    lastSkillCheck: s.lastSkillCheck,
    skillCheckAttempts: s.skillCheckAttempts,
    skillCheckGridNo: s.skillCheckGridNo,
    inventory: s.inv.flatMap((o, slot) => (o.item === NOTHING ? [] : [[slot, o.item, o.status[0] ?? 0, o.count, u8(o.keyId)]])),
    keyRing: (s.keyRing ?? []).flatMap((k, slot) => (k.count === 0 ? [] : [[slot, k.keyId, k.count]])),
  };
  if (progress) facts.gains = GAIN_ORDER.map((stat) => progress.gains[STAT_KEYS[stat] ?? 'experience']);
  return facts;
}

function nativeSoldierFacts(d: Json, withGains: boolean): Json {
  const facts: Json = {
    ap: num(d.ap),
    life: num(d.life),
    breath: num(d.breath),
    breathMax: num(d.breathMax),
    bleeding: num(d.bleeding),
    lastSkillCheck: num(d.lastSkillCheck),
    skillCheckAttempts: num(d.skillCheckAttempts),
    skillCheckGridNo: grid(d.skillCheckGridNo),
    inventory: d.inventory,
    keyRing: d.keyRing,
  };
  if (withGains && d.gains) facts.gains = d.gains;
  return facts;
}

function differences(ours: Json, theirs: Json, skip: ReadonlySet<string> = new Set()): string[] {
  return Object.keys(theirs)
    .filter((k) => !skip.has(k) && JSON.stringify(ours[k]) !== JSON.stringify(theirs[k]))
    .map((k) => `${k} ${JSON.stringify(ours[k])}/${JSON.stringify(theirs[k])}`);
}

function civFacts(campaign: CampaignSim, t: TacticalState): Json {
  const people = t.soldiers
    .filter((s): s is Soldier => s?.placed === true && (s.team === Team.CIV || s.team === Team.MILITIA || s.team === Team.OUR))
    .map((s) => [s.id, s.team, s.side, s.neutral ? 1 : 0, s.civilianGroup, s.ai.oppCount, s.profile]);
  const events = campaign.state.queue.events
    .filter((e) => e.kind === EventKind.MAKE_CIV_GROUP_HOSTILE_ON_NEXT_SECTOR_ENTRANCE)
    .map((e) => [e.stamp, e.param]);
  return {
    groups: [...t.civGroups.hostility],
    people,
    hostileList: t.hostileQuoteList.map((s) => s.id),
    civGroupEvents: events,
    inCombat: t.inCombat,
  };
}

function nativeCivFacts(state: Json): Json {
  return {
    groups: state.groups,
    people: state.people,
    hostileList: state.hostileList,
    civGroupEvents: (state.civGroupEvents as number[][]).map(([stamp, param]) => [num(stamp), num(param)]),
    inCombat: state.inCombat === true,
  };
}

export class DoorComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  #bytes: Uint8Array | null = null;
  #campaign: CampaignSim | null = null;

  constructor(read: ReadFile, exists: FileExists) {
    this.#read = read;
    this.#exists = exists;
  }

  loadSave(bytes: Uint8Array): void {
    this.#bytes = bytes;
    this.#campaign = null;
  }

  async #session(): Promise<CampaignSim> {
    if (this.#campaign) return this.#campaign;
    if (!this.#bytes) throw new Error('door probes need a save');
    const { session } = await createSaveSession(this.#read, this.#bytes, SEED, this.#exists);
    this.#campaign = session.campaign;
    return this.#campaign;
  }

  async compare(p: Json): Promise<number> {
    const label = `${String(p.probe)} line ${String(p.line ?? '')}`;
    try {
      const campaign = await this.#session();
      const t = campaign.tactical?.state;
      if (!t) return report(label, false, 'no tactical sector');
      switch (p.probe) {
        case 'locks':
          return this.#locks(label, t, p);
        case 'door':
          return this.#door(label, t, p);
        case 'doormenu':
          return this.#doorMenu(label, t, p);
        case 'civgroups':
          return this.#civGroups(label, campaign, t, p);
        case 'makecivhostile':
          return this.#civAction(label, campaign, t, p, (s) => makeCivHostile(t, s));
        case 'pcattack':
          return this.#pcAttack(label, campaign, t, p);
        case 'hostilelist':
          return this.#civAction(label, campaign, t, p, () => checkHostileOrSayQuoteList(t));
        default:
          return report(label, false, 'unknown door probe');
      }
    } catch (e) {
      return report(label, false, e instanceof Error ? e.message : String(e));
    }
  }

  #locks(label: string, t: TacticalState, p: Json): number {
    const ours = t.content.locks.map((l, id) => [id, l.keyItem, l.type, l.pickDifficulty, l.smashDifficulty]);
    const same = JSON.stringify(ours) === JSON.stringify(p.locks);
    return report(label, same, same ? `${ours.length} locks` : 'lock table differs');
  }

  #soldier(t: TacticalState, p: Json): Soldier {
    const s = t.soldiers[num(p.who)];
    if (!s?.placed) throw new Error(`soldier ${String(p.who)} is not in the sector`);
    return s;
  }

  #door(label: string, t: TacticalState, p: Json): number {
    const a = args(p);
    const s = this.#soldier(t, p);
    const g = num(p.gridNo);
    applyDoorSettings(t, g, a);
    applySoldier(t, s, a);
    const before = differences(soldierFacts(t, s), nativeSoldierFacts(p.soldierBefore as Json, true));
    const structure = t.world.structures.find(g, StructureFlags.ANYDOOR);
    if (!structure) return report(label, false, `no door at ${g}`);
    s.doorHandleCode = num(p.code);
    const inCombat = t.inCombat;
    if (int(a, 'incombat') === 1) t.inCombat = true;
    const events = t.events.length;
    const { result, preLeft, mainSkipped } = replayed(t, p.draws as Draw[], () => handleOpenableStruct(t, s, g, structure));
    t.inCombat = inCombat;
    const doorResult = t.events.slice(events).find((e) => e.type === 'doorResult');
    const stoppedByTrap = doorResult?.type === 'doorResult' && TRAP_CHECK_STOP_RESULTS.has(doorResult.result);
    const skip = new Set<string>(stoppedByTrap && OUT_OF_RANGE_DOOR_AP_CODES.has(num(p.code)) ? ['ap'] : []);
    const diffs = [
      ...before.map((d) => `before ${d}`),
      ...(result !== (p.handled === true) ? [`handled ${String(result)}/${String(p.handled)}`] : []),
      ...differences(doorFacts(t, g), p.door as Json).map((d) => `door ${d}`),
      ...differences(soldierFacts(t, s), nativeSoldierFacts(p.soldier as Json, true), skip).map((d) => `soldier ${d}`),
      ...(t.turn.attackBusyCount !== num(p.attackBusy) ? [`attackBusy ${t.turn.attackBusyCount}/${String(p.attackBusy)}`] : []),
      ...(preLeft !== 0 ? [`${preLeft} native PreRandom draws not used`] : []),
    ];
    const note = `${doorResult?.type === 'doorResult' ? doorResult.result : 'no result'}${skip.size ? ', AP not compared (out-of-range doorAPs)' : ''}${mainSkipped ? `, ${mainSkipped} cosmetic Random draws skipped` : ''}`;
    return report(label, diffs.length === 0, diffs.length === 0 ? note : diffs.slice(0, 12).join('; '));
  }

  #doorMenu(label: string, t: TacticalState, p: Json): number {
    const a = args(p);
    const s = this.#soldier(t, p);
    const g = num(p.gridNo);
    applyDoorSettings(t, g, a);
    applySoldier(t, s, a);
    const before = differences(soldierFacts(t, s), nativeSoldierFacts(p.soldierBefore as Json, true));
    const { result, preLeft } = replayed(t, p.draws as Draw[], () => doTrapCheckOnStartingMenu(t, s, g));
    const diffs = [
      ...before.map((d) => `before ${d}`),
      ...(result !== (p.noticed === true) ? [`noticed ${String(result)}/${String(p.noticed)}`] : []),
      ...differences(doorFacts(t, g), p.door as Json).map((d) => `door ${d}`),
      ...(preLeft !== 0 ? [`${preLeft} native PreRandom draws not used`] : []),
    ];
    return report(label, diffs.length === 0, diffs.length === 0 ? `noticed ${String(result)}` : diffs.join('; '));
  }

  #compareCiv(label: string, campaign: CampaignSim, t: TacticalState, p: Json, extra: string[] = []): number {
    const ours = civFacts(campaign, t);
    const theirs = nativeCivFacts(p.state as Json);
    const diffs = [...extra, ...differences(ours, theirs)];
    return report(label, diffs.length === 0, diffs.length === 0 ? `groups ${JSON.stringify(ours.groups)}` : diffs.join('; '));
  }

  #civGroups(label: string, campaign: CampaignSim, t: TacticalState, p: Json): number {
    const a = args(p);
    for (const spec of (a.set ?? '').split(',').filter(Boolean)) {
      const [group, value] = spec.split(':').map(Number);
      setCivGroupHostility(t.civGroups, group ?? 0, value ?? 0);
    }
    for (const spec of (a.neutral ?? '').split(',').filter(Boolean)) {
      const [id, value] = spec.split(':').map(Number);
      const s = t.soldiers[id ?? -1];
      if (s) s.neutral = value !== 0;
    }
    for (const spec of (a.group ?? '').split(',').filter(Boolean)) {
      const [id, value] = spec.split(':').map(Number);
      const s = t.soldiers[id ?? -1];
      if (s) s.civilianGroup = value ?? 0;
    }
    return this.#compareCiv(label, campaign, t, p);
  }

  #civAction(label: string, campaign: CampaignSim, t: TacticalState, p: Json, run: (s: Soldier) => void): number {
    const s = p.who === undefined ? (t.soldiers[0] as Soldier) : this.#soldier(t, p);
    const { preLeft, mainSkipped } = replayed(t, p.draws as Draw[], () => run(s));
    const extra = preLeft !== 0 ? [`${preLeft} native PreRandom draws not used`] : [];
    if (mainSkipped !== 0) extra.push(`${mainSkipped} native Random draws not used`);
    return this.#compareCiv(label, campaign, t, p, extra);
  }

  #pcAttack(label: string, campaign: CampaignSim, t: TacticalState, p: Json): number {
    const attacker = this.#soldier(t, p);
    const target = t.soldiers[num(p.target)];
    if (!target) return report(label, false, `no target ${String(p.target)}`);
    target.attacker = attacker;
    const { result, preLeft, mainSkipped } = replayed(t, p.draws as Draw[], () => processImplicationsOfPCAttack(t, attacker, target));
    const extra = result !== (p.enterCombat === true) ? [`enterCombat ${String(result)}/${String(p.enterCombat)}`] : [];
    if (preLeft !== 0) extra.push(`${preLeft} native PreRandom draws not used`);
    if (mainSkipped !== 0) extra.push(`${mainSkipped} native Random draws not used`);
    return this.#compareCiv(label, campaign, t, p, extra);
  }
}
