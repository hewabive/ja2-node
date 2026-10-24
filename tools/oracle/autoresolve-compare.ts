import { NOTHING } from '../../src/content/items/items.ts';
import { emptyObject, type ItemObject } from '../../src/sim/items/object.ts';
import { autoBandageMercs } from '../../src/sim/strategic/forces/autoresolve/bandage.ts';
import { type AutoresolveClosePort, closeAutoresolve, type MilitiaCounts } from '../../src/sim/strategic/forces/autoresolve/close.ts';
import { orderRetreat } from '../../src/sim/strategic/forces/autoresolve/end.ts';
import { runAutoresolve } from '../../src/sim/strategic/forces/autoresolve/loop.ts';
import { endOfBattle } from '../../src/sim/strategic/forces/autoresolve/outcome.ts';
import { calculateAttackValues, determineTeamLeaders } from '../../src/sim/strategic/forces/autoresolve/ratings.ts';
import { DrawMismatch, ReplayStream, type TracedDraw } from '../../src/sim/strategic/forces/autoresolve/replay-rng.ts';
import {
  type ArCell,
  type AutoresolveEnv,
  type AutoresolveHooks,
  type AutoresolveState,
  CellFlag,
  cosmeticOnMain,
  createAutoresolveState,
  NO_CONTROLLER,
} from '../../src/sim/strategic/forces/autoresolve/state.ts';
import { anim } from '../../src/sim/tactical/anim-states.ts';
import type { TacticalContent } from '../../src/sim/tactical/content.ts';
import { NUM_INV_SLOTS } from '../../src/sim/tactical/inventory.ts';
import { noCampaignFields, noRelations, type ProfileProgress, type StatKey } from '../../src/sim/tactical/profiles.ts';
import { createSoldier, NOWHERE, type Soldier } from '../../src/sim/tactical/soldier.ts';

type Json = Record<string, unknown>;

const Mark = { SETUP: 1, RATINGS: 2, BATTLE: 3, RETREAT: 4, SURRENDER: 5, END: 6, BANDAGE: 7, CLOSE: 8, POST: 9, DONE: 10 } as const;
const SIDES = ['merc', 'militia', 'enemy'] as const;
const ORACLE_NOWHERE = 25601;
const LOGIC_FLAGS =
  CellFlag.MERC |
  CellFlag.MILITIA |
  CellFlag.ELITE |
  CellFlag.TROOP |
  CellFlag.ADMIN |
  CellFlag.AF_CREATURE |
  CellFlag.AM_CREATURE |
  CellFlag.YF_CREATURE |
  CellFlag.YM_CREATURE |
  CellFlag.TEAMLEADER |
  CellFlag.RETREATING |
  CellFlag.RETREATED |
  CellFlag.PROCESSED |
  CellFlag.ASSIGNED |
  CellFlag.EPC |
  CellFlag.ROBOT;
const STAT_KEYS: readonly StatKey[] = [
  'lifeMax',
  'agility',
  'dexterity',
  'wisdom',
  'medical',
  'explosives',
  'mechanical',
  'marksmanship',
  'experience',
  'strength',
  'leadership',
];
const PALETTES = { hair: 'BLACKHEAD', skin: 'PINKSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' } as const;

type Draw = readonly [string, number, number, number];

export interface Segment {
  readonly pre: TracedDraw[];
  readonly main: TracedDraw[];
}

const num = (v: unknown): number => Number(v ?? 0);
const obj = (v: unknown): Json => (v ?? {}) as Json;
const list = (v: unknown): Json[] => (v ?? []) as Json[];

function segment(draws: readonly Draw[], from: number, to: readonly number[]): Segment {
  const pre: TracedDraw[] = [];
  const main: TracedDraw[] = [];
  let inside = false;
  for (const [stream, n, v] of draws) {
    if (stream === 'k') {
      if (n === from) inside = true;
      else if (to.includes(n) && inside) break;
      continue;
    }
    if (!inside) continue;
    if (stream === 'p') pre.push({ n, v });
    else if (stream === 'm' || stream === 'd') main.push({ n, v });
  }
  return { pre, main };
}

function battleSegment(draws: readonly Draw[]): Segment {
  const pre: TracedDraw[] = [];
  const main: TracedDraw[] = [];
  let inside = false;
  for (const [stream, n, v] of draws) {
    if (stream === 'k') {
      if (n === Mark.RATINGS) inside = true;
      else if (n === Mark.END) break;
      continue;
    }
    if (!inside) continue;
    if (stream === 'p') pre.push({ n, v });
    else if (stream === 'm') main.push({ n, v });
  }
  return { pre, main };
}

function itemObject(o: Json): ItemObject {
  const item = emptyObject();
  item.item = num(o.item);
  item.count = num(o.count);
  item.status = (o.status as number[] | undefined)?.map(Number) ?? [];
  item.flags = num(o.flags);
  if (o.gunShotsLeft !== undefined) {
    item.gunShotsLeft = num(o.gunShotsLeft);
    item.gunAmmoType = num(o.gunAmmoType);
    item.gunAmmoItem = num(o.gunAmmoItem);
    item.gunAmmoStatus = num(o.gunAmmoStatus);
  }
  for (const a of list(o.attachments)) {
    const slot = item.attachments[num(a.index)];
    if (slot) {
      slot.item = num(a.item);
      slot.status = num(a.status);
    }
  }
  return item;
}

function soldierFrom(content: TacticalContent, s: Json): Soldier {
  const stats = obj(s.stats);
  const traits = (s.skillTraits as number[] | undefined) ?? [0, 0];
  const soldier = createSoldier({
    id: num(s.id),
    team: num(s.team),
    name: `oracle${num(s.id)}`,
    profile: num(s.profile),
    soldierClass: num(s.soldierClass),
    bodyType: num(s.body),
    palettes: PALETTES,
    stats: {
      agility: num(stats.agility),
      dexterity: num(stats.dexterity),
      strength: num(stats.strength),
      wisdom: num(stats.wisdom),
      leadership: num(stats.leadership),
      marksmanship: num(stats.marksmanship),
      mechanical: num(stats.mechanical),
      explosives: num(stats.explosive),
      medical: num(stats.medical),
      experience: num(stats.expLevel),
    },
    life: num(s.life),
    lifeMax: num(s.lifeMax),
    morale: num(s.morale),
    skillTrait1: num(traits[0]),
    skillTrait2: num(traits[1]),
    gridNo: num(s.gridNo) === ORACLE_NOWHERE ? NOWHERE : num(s.gridNo),
    direction: 0,
    state: s.animState === undefined ? anim(content, 'STANDING') : num(s.animState),
  });
  soldier.breath = num(s.breath);
  soldier.breathMax = num(s.breathMax);
  soldier.bleeding = num(s.bleeding);
  soldier.level = num(s.level);
  soldier.damageWindow = num(s.damage);
  soldier.attackingHand = num(s.attackingHand);
  soldier.attackingWeapon = num(s.attackingWeapon);
  soldier.actionPoints = num(s.actionPoints);
  soldier.collapsed = Boolean(s.collapsed);
  soldier.doBurst = num(s.doBurst);
  for (let slot = 0; slot < NUM_INV_SLOTS; slot++) soldier.inv[slot] = emptyObject();
  for (const o of list(s.inventory)) soldier.inv[num(o.slot)] = itemObject(o);
  return soldier;
}

function progressFrom(p: Json): ProfileProgress {
  const stats = obj(p.stats);
  const gains = obj(p.gains);
  const record = (src: Json) => Object.fromEntries(STAT_KEYS.map((k) => [k, num(src[k])])) as Record<StatKey, number>;
  return {
    id: num(p.id),
    evolution: num(p.evolution),
    attitude: num(p.attitude),
    buddies: [],
    hated: [],
    ...noRelations(),
    life: num(p.life),
    stats: record(stats),
    gains: record(gains),
    statChangeChances: ((p.statChangeChances as number[] | undefined) ?? []).map(Number),
    statChangeSuccesses: ((p.statChangeSuccesses as number[] | undefined) ?? []).map(Number),
    kills: num(p.kills),
    assists: num(p.assists),
    shotsFired: num(p.shotsFired),
    shotsHit: num(p.shotsHit),
    timesWounded: num(p.timesWounded),
    battlesFought: num(p.battlesFought),
    ...noCampaignFields(),
  };
}

export interface Built {
  readonly ar: AutoresolveState;
  readonly profiles: Map<number, ProfileProgress>;
}

function build(content: TacticalContent, p: Json): Built {
  const cells = list(p.setup);
  const side = (k: number) => cells.filter((c) => num(c.side) === k);
  const profiles = new Map<number, ProfileProgress>();
  const mercs = side(0).map((c) => {
    const s = obj(c.soldier);
    if (s.progress) profiles.set(num(s.profile), progressFrom(obj(s.progress)));
    const flags = num(c.flags);
    return {
      soldier: soldierFrom(content, s),
      epc: (flags & CellFlag.EPC) !== 0,
      robot: (flags & CellFlag.ROBOT) !== 0,
      groupId: num(s.groupId),
    };
  });
  const militia = side(1).map((c) => soldierFrom(content, obj(c.soldier)));
  const enemies = side(2).map((c) => ({ soldier: soldierFrom(content, obj(c.soldier)), groupId: num(obj(c.soldier).groupId) }));
  const row = String(p.sector).charCodeAt(0) - 'A'.charCodeAt(0);
  const column = Number(String(p.sector).slice(1)) - 1;
  const ar = createAutoresolveState({ sector: row * 16 + column, encounter: num(p.code), mercs, militia, enemies });
  for (const c of side(2)) {
    const cell = ar.enemies[num(c.index)];
    if (cell) cell.flags |= num(c.flags) & CellFlag.ASSIGNED;
  }
  return { ar, profiles };
}

export class Report {
  readonly label: string;
  readonly problems: string[] = [];

  constructor(label: string) {
    this.label = label;
  }

  same(what: string, ours: unknown, theirs: unknown): void {
    const a = JSON.stringify(ours);
    const b = JSON.stringify(theirs);
    if (a !== b && this.problems.length < 12) this.problems.push(`${what}: ours ${a} oracle ${b}`);
  }
}

const cellsOf = (ar: AutoresolveState): ArCell[] => [...ar.mercs, ...ar.militia, ...ar.enemies];
const sideIndex = (c: ArCell) => SIDES.indexOf(c.side);

function compareRatings(r: Report, ar: AutoresolveState, p: Json): void {
  const info = obj(p.ratingsInfo);
  r.same('leadership', [ar.playerLeadership, ar.enemyLeadership], info.leadership);
  r.same('sums', [ar.playerAttack, ar.playerDefence, ar.enemyAttack, ar.enemyDefence], info.sums);
  r.same('alive', [ar.aliveMercs, ar.aliveCivs, ar.aliveEnemies], info.alive);
  r.same('defence advantage', ar.playerDefenceAdvantage, info.defenceAdvantage);
  const theirs = list(p.ratings);
  for (const c of cellsOf(ar)) {
    const o = theirs.find((t) => num(t.side) === sideIndex(c) && num(t.index) === c.index);
    r.same(
      `${c.side} ${c.index} rating`,
      [c.attack, c.defence, c.nextAttack, c.flags & LOGIC_FLAGS],
      [o?.attack, o?.defence, o?.nextAttack, num(o?.flags) & LOGIC_FLAGS],
    );
  }
}

const objectFacts = (o: ItemObject) => [o.item, o.count, o.status.slice(0, Math.max(o.count, 1)), o.gunShotsLeft, o.flags];
function theirObjectFacts(o: Json): unknown[] {
  const item = itemObject(o);
  return objectFacts(item);
}

function compareCells(r: Report, built: Built, p: Json): void {
  const theirs = list(obj(p.result).cells);
  for (const c of cellsOf(built.ar)) {
    const o = theirs.find((t) => num(t.side) === sideIndex(c) && num(t.index) === c.index);
    if (!o) {
      r.same(`${c.side} ${c.index}`, 'cell', 'missing');
      continue;
    }
    const s = obj(o.soldier);
    const label = `${c.side} ${c.index}`;
    r.same(`${label} life/bleeding`, [c.soldier.life, c.soldier.bleeding], [s.life, s.bleeding]);
    r.same(
      `${label} cell`,
      [c.flags & LOGIC_FLAGS, c.attack, c.defence, c.nextAttack, c.nextHit, c.hitDamage],
      [num(o.flags) & LOGIC_FLAGS, o.attack, o.defence, o.nextAttack, o.nextHit, o.hitDamage],
    );
    if (c.side === 'militia') r.same(`${label} militia kills`, c.militiaKills, s.militiaKills);
    const ours = c.soldier.inv.map((item, slot) => [slot, ...objectFacts(item)]).filter((f) => f[1] !== NOTHING);
    const their = list(s.inventory).map((item) => [num(item.slot), ...theirObjectFacts(item)]);
    r.same(`${label} inventory`, ours, their);
    r.same(`${label} attacking weapon`, c.soldier.attackingWeapon, s.attackingWeapon);
    if (c.side === 'merc' && s.progress) {
      const q = built.profiles.get(c.soldier.profile);
      const t = obj(s.progress);
      r.same(
        `${label} profile counters`,
        [q?.kills, q?.assists, q?.shotsFired, q?.shotsHit, q?.timesWounded, q?.battlesFought],
        [t.kills, t.assists, t.shotsFired, t.shotsHit, t.timesWounded, t.battlesFought],
      );
      r.same(
        `${label} profile stats`,
        [q?.stats, q?.gains, q?.statChangeChances, q?.statChangeSuccesses],
        [t.stats, t.gains, t.statChangeChances, t.statChangeSuccesses],
      );
      r.same(
        `${label} soldier stats`,
        [c.soldier.stats.marksmanship, c.soldier.stats.agility, c.soldier.stats.experience],
        [obj(s.stats).marksmanship, obj(s.stats).agility, obj(s.stats).expLevel],
      );
    }
  }
}

function replayEnv(
  content: TacticalContent,
  built: Built,
  p: Json,
  seg: Segment,
  extraHooks: AutoresolveHooks = {},
): { env: AutoresolveEnv; pre: ReplayStream; main: ReplayStream } {
  const pre = new ReplayStream('pre', seg.pre);
  const main = new ReplayStream('main', seg.main);
  const commands = list(p.commands);
  const answer = commands.some((c) => c.kind === 'accept') ? 'accept' : 'reject';
  const controller = num(obj(p.setupInfo).robotController);
  const controllerId = controller >= 0 ? (built.ar.mercs[controller]?.soldier.id ?? -1) : -1;
  const env: AutoresolveEnv = {
    content,
    profiles: built.profiles,
    rng: cosmeticOnMain({ pre, main, fx: main }),
    world: { day: num(p.day), playerCapturedForRescue: Boolean(p.playerCapturedForRescue) },
    hooks: { ...extraHooks, surrender: () => answer, controlsRobot: (s) => s.id === controllerId },
  };
  return { env, pre, main };
}

function runBattle(env: AutoresolveEnv, ar: AutoresolveState, p: Json): void {
  const retreats = list(p.commands).filter((c) => c.kind === 'retreat');
  for (const order of retreats) {
    const slices = num(order.slice) - ar.slices;
    if (slices > 0) runAutoresolve(env, ar, { maxSlices: slices });
    const who = num(order.who);
    const merc = who < 0 ? null : ar.mercs.findIndex((c) => c.soldier.id === who);
    orderRetreat(ar, merc);
  }
  runAutoresolve(env, ar, { maxSlices: num(obj(obj(p.result).battle).slices) + 1 });
}

class OracleMilitia implements MilitiaCounts {
  readonly counts: number[];

  constructor(counts: readonly number[]) {
    this.counts = [...counts];
  }

  count(rank: number): number {
    return this.counts[rank] ?? 0;
  }

  remove(rank: number): void {
    if ((this.counts[rank] ?? 0) > 0) this.counts[rank] = (this.counts[rank] ?? 0) - 1;
  }

  promote(rank: number): void {
    this.counts[rank] = (this.counts[rank] ?? 0) - 1;
    this.counts[rank + 1] = (this.counts[rank + 1] ?? 0) + 1;
  }
}

function closeReplay(r: Report, content: TacticalContent, built: Built, p: Json, draws: readonly Draw[]): number {
  const seg = segment(draws, Mark.CLOSE, [Mark.POST, Mark.DONE]);
  const { env, main } = replayEnv(content, built, p, seg);
  const before = obj(p.countsBefore);
  const militia = new OracleMilitia((before.militia as number[] | undefined) ?? [0, 0, 0]);
  let killed = 0;
  const port: AutoresolveClosePort = {
    militia,
    enemiesLeftInSector: () => num(before.inSector) - killed,
    enemyKilled: () => {
      killed++;
    },
  };
  const result = closeAutoresolve(env, built.ar, port);
  const after = obj(obj(p.result).countsAfter);
  const res = obj(p.result);
  r.same('close: warp seconds', result.warpSeconds, num(res.worldSecondsAfter) - num(res.worldSecondsBefore));
  r.same('close: militia counts', militia.counts, after.militia);
  const promotions = (obj(res.militiaPromotions).promotions as number[] | undefined) ?? [];
  r.same(
    'close: promotions',
    [result.promotions.greenToRegular, result.promotions.regularToElite, result.promotions.greenToElite, result.promotions.total],
    promotions,
  );
  r.same('close: main draws left', main.remaining, 0);
  return result.warpSeconds;
}

export interface ReplayedBattle {
  readonly built: Built;
  readonly seg: Segment;
  readonly pre: ReplayStream;
  readonly main: ReplayStream;
}

export function replayBattle(
  content: TacticalContent,
  p: Json,
  onRatings?: (ar: AutoresolveState) => void,
  hooks: AutoresolveHooks = {},
): ReplayedBattle {
  const draws = (p.draws ?? []) as Draw[];
  const built = build(content, p);
  const seg = battleSegment(draws);
  const { env, pre, main } = replayEnv(content, built, p, seg, hooks);
  if (built.ar.robot >= 0)
    built.ar.robotController = num(obj(p.setupInfo).robotController) >= 0 ? num(obj(p.setupInfo).robotController) : NO_CONTROLLER;
  determineTeamLeaders(built.ar);
  calculateAttackValues(env.rng.pre, built.ar);
  onRatings?.(built.ar);
  runBattle(env, built.ar, p);
  return { built, seg, pre, main };
}

export function traceSegment(p: Json, from: number, to: readonly number[]): Segment {
  return segment((p.draws ?? []) as Draw[], from, to);
}

export function replayStreams(p: Json, from: number, to: readonly number[]): { readonly pre: ReplayStream; readonly main: ReplayStream } {
  const seg = traceSegment(p, from, to);
  return { pre: new ReplayStream('pre', seg.pre), main: new ReplayStream('main', seg.main) };
}

export const AutoresolveMark = Mark;

export function compareAutoresolve(content: TacticalContent, p: Json, aftermath?: (r: Report) => void): number {
  const r = new Report(`autoresolve line ${String(p.line)}`);
  const draws = (p.draws ?? []) as Draw[];
  try {
    const { built, seg, pre, main } = replayBattle(content, p, (ar) => compareRatings(r, ar, p));
    const battle = obj(obj(p.result).battle);
    r.same('status', built.ar.status, battle.status);
    r.same('battle ms', built.ar.elapsedMs, battle.elapsedMs);
    r.same('slices', built.ar.slices, battle.slices);
    r.same('alive', [built.ar.aliveMercs, built.ar.aliveCivs, built.ar.aliveEnemies], battle.alive);
    r.same('sums', [built.ar.playerAttack, built.ar.playerDefence, built.ar.enemyAttack, built.ar.enemyDefence], battle.sums);
    r.same('draws left', [pre.remaining, main.remaining], [0, 0]);
    endOfBattle(built.ar);
    r.same('elapsed after x3', built.ar.elapsedMs, obj(obj(p.result).ended).elapsedMs);
    if (obj(p.result).bandaged) {
      const bandage = segment(draws, Mark.BANDAGE, [Mark.CLOSE]);
      const replay = replayEnv(content, built, p, bandage);
      autoBandageMercs(replay.env, built.ar);
      r.same('elapsed after bandage', built.ar.elapsedMs, obj(obj(p.result).afterBandage).elapsedMs);
      r.same('bandage draws left', replay.pre.remaining, 0);
    }
    compareCells(r, built, p);
    r.same('player kills', built.ar.playerKills, obj(p.result).playerKills);
    closeReplay(r, content, built, p, draws);
    aftermath?.(r);
    const ok = r.problems.length === 0;
    console.log(
      `${r.label}: ${ok ? 'ok' : 'MISMATCH'} ${String(p.sector)} status ${built.ar.status} slices ${built.ar.slices} ` +
        `draws pre ${seg.pre.length} main ${seg.main.length}${ok ? '' : `\n  ${r.problems.join('\n  ')}`}`,
    );
    return ok ? 0 : 1;
  } catch (e) {
    const where = e instanceof DrawMismatch ? `${e.message}` : String(e instanceof Error ? e.stack : e);
    console.log(`${r.label}: MISMATCH replay stopped: ${where}${r.problems.length ? `\n  ${r.problems.join('\n  ')}` : ''}`);
    return 1;
  }
}
