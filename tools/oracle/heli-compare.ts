import { parseSectorString, type Sector, sectorFromId, strategicIndex } from '../../src/content/strategic/sector-ids.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import { createSaveSession } from '../../src/server/save-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import { addTransaction, FinanceCode } from '../../src/sim/campaign/finances.ts';
import type { Roster, RosterMerc } from '../../src/sim/campaign/roster.ts';
import type { EconomyContext } from '../../src/sim/strategic/economy/ports.ts';
import { addSoldierToVehicle, isVehicleAccessibleToSoldier } from '../../src/sim/strategic/economy/vehicle-assignment.ts';
import { Assignment, SectorFlag } from '../../src/sim/strategic/forces/constants.ts';
import type { Group } from '../../src/sim/strategic/forces/groups.ts';
import {
  cancelHelicopterRoute,
  canHelicopterFly,
  checkAndHandleSkyriderMonologues,
  confirmHelicopterRoute,
  helicopterGroup,
  helicopterVehicle,
  heliState,
  isHelicopterPilotAvailable,
  makeHeliReturnToBase,
  payOffSkyriderDebtIfAny,
  plotPathForHelicopter,
  requestGiveSkyriderNewDestination,
  SKYRIDER,
  setUpHelicopterForPlayer,
} from '../../src/sim/strategic/forces/helicopter.ts';
import { addCharacterToSquad, getFirstEmptySquad, removeCharacterFromSquads } from '../../src/sim/strategic/forces/squads.ts';
import {
  inHelicopter,
  isEnoughSpaceInVehicle,
  setSoldierExitHelicopterInsertionData,
  takeSoldierOutOfVehicle,
} from '../../src/sim/strategic/forces/vehicles.ts';
import { isSecretFoundAt, updateAirspaceControl } from '../../src/sim/strategic/map/control.ts';
import { sectorInfo } from '../../src/sim/strategic/map/sectors.ts';
import { factValue, setFact } from '../../src/sim/strategic/narrative/facts.ts';
import { EventKind, Warp } from '../../src/sim/strategic/time/constants.ts';
import { warpGameTime, worldTotalMinutes } from '../../src/sim/strategic/time/world-clock.ts';
import { SoldierStatusFlags } from '../../src/sim/tactical/soldier.ts';

type Json = Record<string, unknown>;
type Draw = readonly [string, number, number, number];

export const HELI_PROBES: ReadonlySet<string> = new Set([
  'heli',
  'heliset',
  'helisetup',
  'heliboard',
  'helileave',
  'heliroute',
  'helicancel',
  'heliwarp',
  'helimonologue',
  'helipaydebt',
  'helireturn',
]);

const SEED = 1;
const MAIN_STREAM = 'm';
const PRE_STREAM = 'p';
const SECONDS_PER_MINUTE = 60;
const INSERTION_GRIDNO = 4;
const SPOTTED_QUOTES = new Set([34, 35]);
const SPOTTED = 34;
const FACTS = [43, 45, 136, 277];
const HELI_EVENT_KINDS = new Set<number>([EventKind.GROUP_ARRIVAL, EventKind.GROUP_ABOUT_TO_ARRIVE]);
const HOVER_EVENT_KINDS = new Set<number>([EventKind.HELICOPTER_HOVER_TOO_LONG, EventKind.HELICOPTER_HOVER_WAY_TOO_LONG]);

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
}

class TolerantReplay {
  readonly #draws: Draw[];
  #at = 0;
  skipped = 0;

  constructor(draws: Draw[]) {
    this.#draws = draws;
  }

  get left(): number {
    return this.#draws.length - this.#at;
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
}

interface Replayed {
  readonly preLeft: number;
  readonly mainSkipped: number;
}

function replayed(campaign: CampaignSim, trace: readonly Draw[], run: () => void): Replayed {
  const pre = new StrictReplay(trace.filter((d) => d[0] === PRE_STREAM));
  const main = new TolerantReplay(trace.filter((d) => d[0] === MAIN_STREAM));
  const rng = campaign.state.rng as unknown as Record<string, unknown>;
  const preRandom = campaign.state.pre as unknown as Record<string, unknown>;
  Object.assign(rng, { int: (n: number) => main.int(n), chance: (p: number) => main.chance(p) });
  Object.assign(preRandom, { int: (n: number) => pre.int(n), chance: (p: number) => pre.chance(p) });
  try {
    run();
    return { preLeft: pre.left, mainSkipped: main.skipped + main.left };
  } finally {
    delete rng.int;
    delete rng.chance;
    delete preRandom.int;
    delete preRandom.chance;
  }
}

const sectorTriple = (s: Sector) => [s.x, s.y, s.z];
const num = (v: unknown) => Number(v ?? 0);

function groupFacts(g: Group): Json {
  return {
    id: g.id,
    size: g.size,
    sector: sectorTriple(g.sector),
    next: [g.next.x, g.next.y],
    prev: [g.prev.x, g.prev.y],
    betweenSectors: g.betweenSectors,
    arrivalTime: g.arrivalTime,
    traverseTime: g.traverseTime,
    nextWaypointId: g.nextWaypointId,
    transportMask: g.transportMask,
    waypoints: g.waypoints.map((w) => [w.x, w.y, w.z]),
    members: [...g.members],
  };
}

function heliFacts(ctx: EconomyContext): Json {
  const h = heliState(ctx);
  const facts: Json = {
    vehicleId: ctx.state.forces.helicopterVehicleId,
    setUp: h.setUp,
    airborne: ctx.state.forces.helicopterAirborne,
    returning: h.returningToBase,
    hovering: h.hovering,
    startHover: h.startHoverMinute,
    cost: h.totalCost,
    destroyed: h.destroyed,
    talk: h.talkState,
    lastMonologue: h.lastMonologueMinute,
    emptyHelp: h.emptyHelpGiven,
    hits: h.hitsTaken,
    congrats: h.saidCongratsOnTakingSam,
    progress: h.progressLastCommentedOn,
    refuel: h.refuelSiteAvailable.map((a) => (a ? 1 : 0)),
  };
  const v = helicopterVehicle(ctx);
  if (!v) return facts;
  facts.sector = sectorTriple(v.sector);
  facts.vehicleBetween = v.betweenSectors;
  facts.passengers = [...v.passengers];
  facts.path = [...v.path];
  const g = helicopterGroup(ctx);
  if (g) facts.group = groupFacts(g);
  return facts;
}

function roleOf(m: RosterMerc): number {
  if (m.statusFlags & SoldierStatusFlags.DRIVER) return 1;
  return m.statusFlags & SoldierStatusFlags.PASSENGER ? 2 : 0;
}

const SOLDIER_KEYS = [
  'id',
  'assignment',
  'vehicleId',
  'sector',
  'betweenSectors',
  'groupId',
  'inSector',
  'insertionCode',
  'insertionData',
  'role',
  'life',
];
const INSERTION_KEYS = new Set(['insertionCode', 'insertionData']);

function soldierRecord(source: Json): Json {
  const tactical = source.inSector === true;
  const withData = !tactical && num(source.insertionCode) === INSERTION_GRIDNO;
  const keys = SOLDIER_KEYS.filter((k) => !(tactical && INSERTION_KEYS.has(k)) && (withData || k !== 'insertionData'));
  return Object.fromEntries(keys.map((k) => [k, source[k]]));
}

function soldierFacts(m: RosterMerc, roster: Roster): Json {
  return soldierRecord({
    inSector: roster.inTacticalSector(m.id),
    id: m.id,
    assignment: m.assignment,
    vehicleId: m.vehicleId,
    sector: sectorTriple(m.sector),
    betweenSectors: m.betweenSectors,
    groupId: m.groupId,
    insertionCode: m.insertionCode,
    insertionData: m.soldier.insertionData,
    role: roleOf(m),
    life: m.life,
  });
}

function heliEvents(ctx: EconomyContext): number[][] {
  const heliGroup = helicopterVehicle(ctx)?.movementGroup ?? -1;
  return ctx.state.queue.events
    .filter(
      (e) => (HELI_EVENT_KINDS.has(e.kind) && e.param === heliGroup) || HOVER_EVENT_KINDS.has(e.kind) || e.kind === EventKind.MEANWHILE,
    )
    .map((e) => [e.stamp, e.kind, e.param]);
}

function normalizeQuotes(quotes: readonly number[]): number[] {
  return quotes.map((q) => (SPOTTED_QUOTES.has(q) ? SPOTTED : q));
}

function differences(ours: Json, theirs: Json): string[] {
  return Object.keys(theirs)
    .filter((k) => JSON.stringify(ours[k]) !== JSON.stringify(theirs[k]))
    .map((k) => `${k} ${JSON.stringify(ours[k])}/${JSON.stringify(theirs[k])}`);
}

function args(p: Json): Record<string, string> {
  return (p.args as Record<string, string> | undefined) ?? {};
}

function list(text: string | undefined): string[][] {
  return (text ?? '')
    .split(',')
    .filter((part) => part.length > 0)
    .map((part) => part.split(':'));
}

export class HeliComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  #bytes: Uint8Array | null = null;
  #campaign: CampaignSim | null = null;
  #quotes: number[] = [];

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
    if (!this.#bytes) throw new Error('helicopter probes need a save');
    const { session } = await createSaveSession(this.#read, this.#bytes, SEED, this.#exists);
    this.#campaign = session.campaign;
    this.#quotes = [];
    return this.#campaign;
  }

  async compare(p: Json): Promise<number> {
    const label = `${String(p.probe)} line ${String(p.line ?? '')}`;
    try {
      const campaign = await this.#session();
      const economy = campaign.economy;
      if (!economy) return report(label, false, 'no economy');
      const trace = (p.draws as Draw[] | undefined) ?? [];
      const { preLeft, mainSkipped } = replayed(campaign, trace, () => this.#act(campaign, economy, p));
      for (const e of campaign.drainEvents()) if (e.type === 'skyriderQuote') this.#quotes.push(e.quote);
      const quotes = this.#quotes.splice(0);
      const diffs = [
        ...this.#stateDifferences(campaign, economy, p),
        ...(JSON.stringify(normalizeQuotes(quotes)) !== JSON.stringify(normalizeQuotes(p.quotes as number[]))
          ? [`quotes ${JSON.stringify(quotes)}/${JSON.stringify(p.quotes)}`]
          : []),
        ...(preLeft !== 0 ? [`${preLeft} native PreRandom draws not used`] : []),
      ];
      const note = `${trace.filter((d) => d[0] === PRE_STREAM).length} PreRandom draws${mainSkipped ? `, ${mainSkipped} native Random draws skipped` : ''}`;
      return report(label, diffs.length === 0, diffs.length === 0 ? note : diffs.slice(0, 10).join('; '));
    } catch (e) {
      return report(label, false, e instanceof Error ? e.message : String(e));
    }
  }

  #act(campaign: CampaignSim, ctx: EconomyContext, p: Json): void {
    const a = args(p);
    const actions: Readonly<Record<string, () => void>> = {
      heli: () => {},
      heliset: () => this.#set(campaign, ctx, a),
      helisetup: () => setUpHelicopterForPlayer(ctx, parseSectorString(a.sector ?? 'B13')),
      heliboard: () => this.#board(ctx, num(a.who)),
      helileave: () => this.#leave(ctx, num(a.who), a.squad === undefined ? null : num(a.squad)),
      heliroute: () => this.#route(ctx, parseSectorString(a.to ?? 'B13')),
      helicancel: () => {
        if (canHelicopterFly(ctx)) cancelHelicopterRoute(ctx);
      },
      heliwarp: () => warpGameTime(campaign.clockContext, num(a.minutes) * SECONDS_PER_MINUTE, Warp.NORMAL),
      helimonologue: () => {
        if (isHelicopterPilotAvailable(ctx)) checkAndHandleSkyriderMonologues(ctx);
      },
      helipaydebt: () => payOffSkyriderDebtIfAny(ctx),
      helireturn: () => makeHeliReturnToBase(ctx),
    };
    actions[String(p.probe)]?.();
  }

  #set(campaign: CampaignSim, ctx: EconomyContext, a: Record<string, string>): void {
    const s = campaign.state;
    if (a.money !== undefined)
      addTransaction(s.finances, FinanceCode.ANONYMOUS_DEPOSIT, 0, worldTotalMinutes(s.clock), num(a.money) - s.finances.balance);
    const skyrider = s.profiles.get(SKYRIDER);
    if (a.owed !== undefined && skyrider) skyrider.balance = -num(a.owed);
    for (const [sector, enemy] of list(a.control)) {
      const e = s.map.elements[strategicIndex(parseSectorString(sector ?? 'A1'))];
      if (e) e.enemyControlled = enemy !== '0';
    }
    for (const [id, condition, enemy] of list(a.sam)) {
      const site = ctx.content.samSites[num(id)];
      const e = site ? s.map.elements[strategicIndex(sectorFromId(site.sector))] : undefined;
      if (!e) continue;
      e.samCondition = num(condition);
      e.enemyControlled = enemy !== '0';
    }
    for (const [sector, troops] of list(a.enemies)) sectorInfo(s.map, parseSectorString(sector ?? 'A1')).numTroops = num(troops);
    for (const [id, value] of list(a.fact)) setFact(s.narrative, num(id), num(value));
    for (const [town, rating] of list(a.loyalty)) {
      const t = s.economy.towns[num(town)];
      if (!t) continue;
      t.rating = num(rating);
      t.started = true;
    }
    const heli = heliState(ctx);
    if (a.talk !== undefined) heli.talkState = num(a.talk);
    if (a.lastmono !== undefined) heli.lastMonologueMinute = num(a.lastmono);
    if (a.congrats !== undefined) heli.saidCongratsOnTakingSam = num(a.congrats) !== 0;
    if (a.emptyhelp !== undefined) heli.emptyHelpGiven = num(a.emptyhelp) !== 0;
    if (a.hits !== undefined) heli.hitsTaken = num(a.hits);
    if (a.progress !== undefined) heli.progressLastCommentedOn = num(a.progress);
    if (a.cost !== undefined) heli.totalCost = num(a.cost);
    if (num(a.airspace) !== 0) updateAirspaceControl(ctx);
  }

  #board(ctx: EconomyContext, id: number): void {
    const m = ctx.crew.get(id);
    const v = helicopterVehicle(ctx);
    if (!m || !v) throw new Error(`cannot board ${id}`);
    if (isVehicleAccessibleToSoldier(ctx, m, v) && isEnoughSpaceInVehicle(ctx, v)) addSoldierToVehicle(ctx, m, v);
  }

  #leave(ctx: EconomyContext, id: number, squad: number | null): void {
    const m = ctx.crew.get(id);
    if (!m) throw new Error(`no merc ${id}`);
    const target = squad ?? getFirstEmptySquad(ctx);
    const exiting = inHelicopter(ctx, m);
    if (m.assignment === Assignment.VEHICLE) takeSoldierOutOfVehicle(ctx, id);
    removeCharacterFromSquads(ctx, id);
    addCharacterToSquad(ctx, id, target);
    if (exiting) setSoldierExitHelicopterInsertionData(ctx, m);
  }

  #route(ctx: EconomyContext, to: Sector): void {
    if (!requestGiveSkyriderNewDestination(ctx).ok) return;
    cancelHelicopterRoute(ctx);
    plotPathForHelicopter(ctx, to);
    confirmHelicopterRoute(ctx, to);
  }

  #stateDifferences(campaign: CampaignSim, ctx: EconomyContext, p: Json): string[] {
    const s = campaign.state;
    const skyrider = s.profiles.get(SKYRIDER);
    const noticed = s.map.sectors.flatMap((info, id) => (info.flags & SectorFlag.SKYRIDER_NOTICED_ENEMIES_HERE ? [id] : []));
    const ours: Json = {
      worldMinutes: worldTotalMinutes(s.clock),
      heli: heliFacts(ctx),
      skyrider: [skyrider?.balance ?? 0, skyrider?.life ?? 0],
      money: s.finances.balance,
      facts: FACTS.map((id) => factValue(s.narrative, id)),
      noticed,
      samsFound: ctx.content.samSites.map((sam) => (isSecretFoundAt(ctx, sam.sector) ? 1 : 0)),
      squads: s.forces.squads.map((q) => [...q]),
      events: heliEvents(ctx),
    };
    const roster = campaign.battle?.roster;
    const native = (p.soldiers as Json[] | undefined) ?? [];
    const soldiers = native.map((n) => {
      const m = roster?.get(num(n.id));
      return m && roster ? soldierFacts(m, roster) : { id: n.id, missing: true };
    });
    const theirs: Json = {
      worldMinutes: p.worldMinutes,
      heli: p.heli,
      skyrider: p.skyrider,
      money: p.money,
      facts: p.facts,
      noticed: p.noticed,
      samsFound: p.samsFound,
      squads: p.squads,
      events: p.events,
    };
    const theirSoldiers = native.map(soldierRecord);
    return [
      ...differences(ours, theirs),
      ...(JSON.stringify(soldiers) !== JSON.stringify(theirSoldiers)
        ? [`soldiers ${JSON.stringify(soldiers)}/${JSON.stringify(theirSoldiers)}`]
        : []),
    ];
  }
}
