import { AnimFlags } from '../../src/content/anim/tables.ts';
import type { BasicPlacement } from '../../src/content/formats/map.ts';
import { NOTHING } from '../../src/content/items/items.ts';
import { parseSectorString, type Sector } from '../../src/content/strategic/sector-ids.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import type { RosterMerc } from '../../src/sim/campaign/roster.ts';
import { flowExitWorld, okForSectorExit } from '../../src/sim/campaign/sector-exits.ts';
import type { SimEvent } from '../../src/sim/events.ts';
import { createItem, deleteObject, type ItemObject, swapObjects } from '../../src/sim/items/object.ts';
import { doesVehicleNeedAnyRepairs, repairVehicle } from '../../src/sim/strategic/economy/vehicle-repair.ts';
import { Assignment, VehicleSeat } from '../../src/sim/strategic/forces/constants.ts';
import type { Group } from '../../src/sim/strategic/forces/groups.ts';
import { canEntireMovementGroupMove, MoveRefusal } from '../../src/sim/strategic/forces/move-permission.ts';
import { confirmPathForCharacter, plotPathForCharacter } from '../../src/sim/strategic/forces/routes.ts';
import { setFact } from '../../src/sim/strategic/narrative/facts.ts';
import { Warp } from '../../src/sim/strategic/time/constants.ts';
import { warpGameTime } from '../../src/sim/strategic/time/world-clock.ts';
import { decideNpcAction } from '../../src/sim/tactical/ai/control.ts';
import { anim } from '../../src/sim/tactical/anim-states.ts';
import {
  adjustToNextAnimationFrame,
  hasAnimFlag,
  initNewSoldierAnim,
  setDesiredDirection,
  setSoldierDirection,
  turnSoldier,
} from '../../src/sim/tactical/animation.ts';
import { totalArmourProtection } from '../../src/sim/tactical/combat/armour.ts';
import { handleItem } from '../../src/sim/tactical/combat/attack.ts';
import { soldierTakeDamage } from '../../src/sim/tactical/combat/hit.ts';
import { soldierToSoldierLos } from '../../src/sim/tactical/combat/positions.ts';
import { useHandToHandSteal } from '../../src/sim/tactical/combat/steal.ts';
import { AimShot, DamageReason } from '../../src/sim/tactical/combat/types.ts';
import { createFromPlacementParts } from '../../src/sim/tactical/creation.ts';
import { clearEventQueue, dequeueAllGameEvents } from '../../src/sim/tactical/game-events.ts';
import { drawStandingFrame, NEUTRAL_POPULATION, soldierSlotTaken } from '../../src/sim/tactical/init-list.ts';
import { addSoldierToSector, Insertion } from '../../src/sim/tactical/insertion.ts';
import { InvSlot } from '../../src/sim/tactical/inventory.ts';
import { setSoldierPosition, stopMerc } from '../../src/sim/tactical/movement.ts';
import { isVehicleBody } from '../../src/sim/tactical/person-structure.ts';
import { calcActionPoints, deductPoints } from '../../src/sim/tactical/points.ts';
import {
  Attitude,
  firstFreeSoldierId,
  NOWHERE,
  Orders,
  onTheGrid,
  type Soldier,
  SoldierClass,
  SoldierStatusFlags,
  shownToPlayer,
  Team,
} from '../../src/sim/tactical/soldier.ts';
import type { TacticalState } from '../../src/sim/tactical/state.ts';
import type { TacticalSim } from '../../src/sim/tactical/tactical-sim.ts';
import { beginMercTurn } from '../../src/sim/tactical/turns/turns.ts';
import { BoardingCursor, enterVehicle, enterVehicleCheck, isBoardingRefusal } from '../../src/sim/tactical/vehicle-boarding.ts';
import { passengersAboard } from '../../src/sim/tactical/vehicle-presence.ts';
import { addFuelToVehicle, isGasCanEmpty } from '../../src/sim/vehicles/vehicle-fuel.ts';
import type { VehicleRecord } from '../../src/sim/vehicles/vehicle-list.ts';
import { type Draw, firstDifference, ReplayMismatch, report, StrictReplay } from './actions-compare.ts';
import { createTacticalSaveSession } from './tactical-import.ts';

type Json = Record<string, unknown>;

export const VEHICLE_PROBES: ReadonlySet<string> = new Set([
  'vehicles',
  'vehiclecreate',
  'vehicleset',
  'vehicleinv',
  'vehicleclick',
  'vehicleboard',
  'vehicleexit',
  'vehicledamage',
  'vehiclearmour',
  'vehicleitem',
  'vehiclerefuel',
  'vehiclerepair',
  'vehiclecanmove',
  'vehiclelos',
  'vehicleturnstart',
  'vehiclededuct',
  'tankdecide',
  'tankturn',
  'tankshoot',
  'vehiclesteal',
  'vehiclefire',
  'vehicleroute',
  'vehiclewarp',
  'vehicleleavesector',
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
const NO_SOLDIER_ID = -1;
const ROOF_LEVEL_HEIGHT = 50;
const AVERAGE_RELATIVE_LEVEL = 2;
const DEFAULT_ITEM_STATUS = 100;
const DEFAULT_ANIMATION_FRAMES = 40;
const MAX_TURN_STEPS = 64;
const DEFAULT_TILE_SIGHT_LIMIT = 255;
const SECONDS_PER_MINUTE = 60;
const VEHICLE_STATUS_FLAGS =
  SoldierStatusFlags.VEHICLE | SoldierStatusFlags.DRIVER | SoldierStatusFlags.PASSENGER | SoldierStatusFlags.PAUSEANIMOVE;
const SQUAD_PROBES: ReadonlySet<string> = new Set(['vehicleboard', 'vehicleexit']);
const STATE_AFTER_EXIT_NOT_COMPARED: ReadonlySet<string> = new Set(['vehicleleavesector']);
const VEHICLE_SECTOR_EXIT_DEVIATION = 'only OKForSectorExit compared: deviations "Vehicle sector exit"';

const PENDING_TOOL_CODES: Readonly<Record<string, number>> = { enterVehicle: 12, repair: 13, refuel: 17 };
const NO_PENDING_ACTION = 255;

const VEHICLE_BODIES: Readonly<Record<string, number>> = { hummer: 22, eldorado: 25, icecream: 26, jeep: 27, tanknw: 23, tankne: 24 };
const TEAMS: Readonly<Record<string, number>> = {
  player: Team.OUR,
  enemy: Team.ENEMY,
  creature: Team.CREATURE,
  militia: Team.MILITIA,
  civ: Team.CIV,
};
const PLACEMENT_CLASSES: Readonly<Record<string, number>> = {
  none: SoldierClass.NONE,
  admin: SoldierClass.ADMINISTRATOR,
  army: SoldierClass.ARMY,
  elite: SoldierClass.ELITE,
};
const DAMAGE_REASONS: Readonly<Record<string, number>> = {
  gunfire: DamageReason.GUNFIRE,
  blade: DamageReason.BLADE,
  hth: DamageReason.HANDTOHAND,
  fall: DamageReason.FALLROOF,
  bloodloss: DamageReason.BLOODLOSS,
  explosion: DamageReason.EXPLOSION,
  gas: DamageReason.GAS,
  structure: DamageReason.STRUCTURE_EXPLOSION,
};
const MOVE_ERRORS: Readonly<Record<string, number>> = {
  [MoveRefusal.UNDERGROUND]: 1,
  [MoveRefusal.ENEMY]: 2,
  [MoveRefusal.BUSY]: 3,
  [MoveRefusal.POW]: 5,
  [MoveRefusal.TRANSIT]: 8,
  [MoveRefusal.COMBAT]: 11,
  [MoveRefusal.VEHICLE_EMPTY]: 32,
  [MoveRefusal.MUSEUM]: 34,
  [MoveRefusal.VEHICLE_NO_GAS]: 42,
  [MoveRefusal.VEHICLE_DAMAGED]: 47,
  [MoveRefusal.ROBOT_ALONE]: 49,
};
const ME_OK = 0;
const ME_CUSTOM = -99;

const num = (v: unknown) => Number(v ?? 0);
const has = (a: Json, key: string) => a[key] !== undefined;
const grid = (g: number) => (g === NOWHERE ? NATIVE_NOWHERE : g);

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

function replay(t: TacticalState, trace: readonly Draw[], action: () => void): string[] {
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
  }
  return problems;
}

function itemIndex(t: TacticalState, name: string): number {
  if (/^\d+$/.test(name)) return Number(name);
  const item = t.content.items.byName.get(name)?.index;
  if (item === undefined) throw new Error(`unknown item ${name}`);
  return item;
}

function sectorRow(s: Sector): number[] {
  return [s.x, s.y, s.z];
}

function groupRow(g: Group): Json {
  return {
    id: g.id,
    size: g.size,
    sector: sectorRow(g.sector),
    next: [g.next.x, g.next.y],
    betweenSectors: g.betweenSectors,
    arrivalTime: g.arrivalTime,
    traverseTime: g.traverseTime,
    transportMask: g.transportMask,
    waypoints: g.waypoints.map((w) => [w.x, w.y, w.z]),
    members: [...g.members],
  };
}

function nativeGroupRow(g: Json): Json {
  return {
    id: g.id,
    size: g.size,
    sector: g.sector,
    next: g.next,
    betweenSectors: g.betweenSectors,
    arrivalTime: g.arrivalTime,
    traverseTime: g.traverseTime,
    transportMask: g.transportMask,
    waypoints: g.waypoints,
    members: g.members,
  };
}

function nativeExplosion(row: readonly number[]): number[] {
  const [owner = 0, x = 0, y = 0, z = 0, gridNo = 0, item = 0, level = 0] = row;
  return [owner, x, y, z === 0 && level > 0 ? ROOF_LEVEL_HEIGHT : z, gridNo, item, level];
}

function attachmentRow(o: ItemObject): number[] {
  return o.attachments.flatMap((a) => (a.item === NOTHING ? [] : [a.item, a.status]));
}

function inventoryRows(s: Soldier): unknown[] {
  return s.inv.flatMap((o, slot) =>
    o.item === NOTHING ? [] : [[slot, [o.item, o.count, o.status[0] ?? 0, o.trap, o.flags], attachmentRow(o)]],
  );
}

function seatFlags(s: Soldier): number {
  let flags = 0;
  if (isVehicleBody(s)) flags |= SoldierStatusFlags.VEHICLE;
  if (s.vehicleSeat === VehicleSeat.DRIVER) flags |= SoldierStatusFlags.DRIVER;
  if (s.vehicleSeat === VehicleSeat.PASSENGER) flags |= SoldierStatusFlags.PASSENGER;
  if (s.pauseAnimMove) flags |= SoldierStatusFlags.PAUSEANIMOVE;
  return flags;
}

const REPORTED_DIFFERENCES = 6;

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

function active(s: Soldier | null | undefined): s is Soldier {
  return s != null && (s.placed || s.offMap || s.away);
}

export class VehicleComparer {
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
      if (!this.#bytes) throw new Error('vehicle probes need a save');
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
      const run = this.#run(session, c, p, a);
      const problems = [...run.problems];
      const exit = STATE_AFTER_EXIT_NOT_COMPARED.has(String(p.probe));
      const theirs = { result: this.#nativeResult(p), state: exit ? null : this.#nativeState(p) };
      const ours = { result: run.result, state: exit ? null : this.#state(c, p) };
      differences(ours, theirs, '', problems);
      return report(label, problems.length === 0, problems.join('; ') || run.summary);
    } catch (e) {
      return report(label, false, `threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  #t(c: CampaignSim): TacticalState {
    const t = c.tactical?.state;
    if (!t) throw new Error('no loaded sector');
    return t;
  }

  #sim(c: CampaignSim): TacticalSim {
    const sim = c.tactical;
    if (!sim) throw new Error('no loaded sector');
    return sim;
  }

  #soldier(c: CampaignSim, id: unknown): Soldier {
    const t = this.#t(c);
    const s = t.soldiers[num(id)] ?? c.battle?.roster.get(num(id))?.soldier;
    if (!s) throw new Error(`no soldier ${String(id)} in ja2-node`);
    return s;
  }

  #merc(c: CampaignSim, id: number): RosterMerc | undefined {
    return c.battle?.roster.get(id);
  }

  #run(session: CampaignSession, c: CampaignSim, p: Json, a: Json): { problems: string[]; result: unknown; summary: string } {
    const t = this.#t(c);
    const trace = (p.draws as Draw[] | undefined) ?? [];
    const withCombat = <T>(action: () => T): T => {
      const inCombat = t.inCombat;
      if (has(a, 'combat')) t.inCombat = num(a.combat) !== 0;
      try {
        return action();
      } finally {
        t.inCombat = inCombat;
      }
    };
    const replayed = (action: () => unknown): { problems: string[]; result: unknown } => {
      let result: unknown = null;
      const problems = withCombat(() =>
        replay(t, trace, () => {
          result = action();
        }),
      );
      return { problems, result };
    };
    const done = (r: { problems: string[]; result: unknown }, summary = '') => ({ ...r, summary });
    switch (p.probe) {
      case 'vehicles':
        return done({ problems: [], result: null });
      case 'vehiclecreate':
        return done(replayed(() => this.#create(c, t, a)));
      case 'vehicleset':
        this.#set(c, t, a);
        return done({ problems: [], result: null });
      case 'vehicleinv':
        return done({ problems: [], result: this.#inventory(t, this.#soldier(c, a.who), a) });
      case 'vehicleclick':
        return done(replayed(() => this.#click(t, this.#soldier(c, a.who), this.#soldier(c, a.vehicle), a)));
      case 'vehicleboard':
        return done(replayed(() => this.#board(t, this.#soldier(c, a.who), this.#soldier(c, a.vehicle))));
      case 'vehicleexit':
        return done(replayed(() => this.#exit(t, this.#soldier(c, a.who))));
      case 'vehicledamage':
        return done(this.#damage(c, t, a, replayed));
      case 'vehiclearmour':
        return done(replayed(() => this.#armour(t, this.#soldier(c, a.who), a)));
      case 'vehicleitem':
        return done(replayed(() => this.#item(t, this.#soldier(c, a.who), a)));
      case 'vehiclerefuel':
        return done(replayed(() => this.#refuel(t, this.#soldier(c, a.who), this.#soldier(c, a.vehicle), a)));
      case 'vehiclerepair':
        return done(replayed(() => this.#repair(c, this.#soldier(c, a.who), a)));
      case 'vehiclecanmove':
        return done({ problems: [], result: { error: this.#canMove(c, num(a.who)) } });
      case 'vehiclelos':
        return done({ problems: [], result: this.#lineOfSight(t, this.#soldier(c, a.viewer), this.#soldier(c, a.target), a) });
      case 'vehicleturnstart':
        return done(replayed(() => this.#turnStart(t, this.#soldier(c, a.who), a)));
      case 'vehiclededuct':
        return done(
          replayed(() => {
            deductPoints(t, this.#soldier(c, a.who), num(a.ap), num(a.bp));
            return null;
          }),
        );
      case 'tankdecide':
        return done(this.#decide(c, t, this.#soldier(c, a.who), a, replayed));
      case 'tankturn':
        return done(this.#turn(t, this.#soldier(c, a.who), a, trace, withCombat));
      case 'tankshoot':
        return done(replayed(() => this.#shoot(t, this.#soldier(c, a.who), a)));
      case 'vehiclesteal':
        return done(replayed(() => this.#steal(t, this.#soldier(c, a.who), this.#soldier(c, a.target))));
      case 'vehiclefire':
        return done(replayed(() => this.#fire(t, this.#soldier(c, a.who), a)));
      case 'vehicleroute':
        return done({ problems: [], result: this.#route(c, num(a.who), parseSectorString(String(a.to))) });
      case 'vehiclewarp':
        return done(this.#warp(session, c, p, a));
      case 'vehicleleavesector':
        return done({ problems: [], result: this.#leaveSector(c, a, p) }, VEHICLE_SECTOR_EXIT_DEVIATION);
      default:
        throw new Error('unknown vehicle probe');
    }
  }

  #create(c: CampaignSim, t: TacticalState, a: Json): Json {
    const team = TEAMS[String(a.team ?? 'civ')] ?? Team.CIV;
    const body = VEHICLE_BODIES[String(a.body ?? 'hummer')] ?? 0;
    const gridNo = num(a.grid);
    const direction = num(a.dir);
    const placement: BasicPlacement = {
      detailed: false,
      startingGridNo: gridNo,
      team,
      relativeAttributeLevel: has(a, 'attributes') ? num(a.attributes) : AVERAGE_RELATIVE_LEVEL,
      relativeEquipmentLevel: has(a, 'equipment') ? num(a.equipment) : AVERAGE_RELATIVE_LEVEL,
      direction,
      orders: Orders.STATIONARY,
      attitude: Attitude.DEFENSIVE,
      bodyType: body,
      patrolGrid: [gridNo],
      patrolCount: 0,
      onRoof: false,
      soldierClass: PLACEMENT_CLASSES[String(a.class ?? 'none')] ?? SoldierClass.NONE,
      civilianGroup: 0,
      priorityExistence: true,
      hasKeys: 0,
    };
    const id = firstFreeSoldierId((n) => soldierSlotTaken(t, n), team, body);
    const env = c.sectors?.populationEnv() ?? NEUTRAL_POPULATION;
    const s = id < 0 ? null : createFromPlacementParts(t, id, placement, null, env);
    if (!s) throw new Error(`no vehicle created on team ${team}`);
    drawStandingFrame(t);
    s.insertionGridNo = gridNo;
    addSoldierToSector(t, s, { code: Insertion.GRIDNO, data: gridNo, direction }, {}, false);
    return { who: s.id, soldier: this.#createdSoldier(t, s) };
  }

  #createdSoldier(t: TacticalState, s: Soldier): Json {
    return {
      id: s.id,
      team: s.team,
      profile: s.profile,
      body: s.bodyType,
      soldierClass: s.soldierClass,
      gridNo: s.gridNo,
      direction: s.direction,
      life: s.life,
      lifeMax: s.lifeMax,
      breath: s.breath,
      breathRed: s.breathRed,
      ap: s.actionPoints,
      initialAp: s.initialActionPoints,
      apPerTurn: calcActionPoints(t, s),
      morale: s.morale,
      stats: {
        agility: s.stats.agility,
        dexterity: s.stats.dexterity,
        strength: s.stats.strength,
        wisdom: s.stats.wisdom,
        leadership: s.stats.leadership,
        marksmanship: s.stats.marksmanship,
        mechanical: s.stats.mechanical,
        explosive: s.stats.explosives,
        medical: s.stats.medical,
        expLevel: s.stats.experience,
      },
      inventory: s.inv.flatMap((o, slot) => (o.item === NOTHING ? [] : [[slot, o.item, o.count, o.status[0] ?? 0]])),
    };
  }

  #nativeCreatedSoldier(d: Json): Json {
    const stats = d.stats as Json;
    return {
      id: d.id,
      team: d.team,
      profile: d.profile,
      body: d.body,
      soldierClass: d.soldierClass,
      gridNo: d.gridNo,
      direction: d.direction,
      life: d.life,
      lifeMax: d.lifeMax,
      breath: d.breath,
      breathRed: d.breathRed,
      ap: d.ap,
      initialAp: d.initialAp,
      apPerTurn: d.apPerTurn,
      morale: d.morale,
      stats,
      inventory: ((d.inventory as Json[] | undefined) ?? []).map((o) => [o.slot, o.item, o.count, o.status]),
    };
  }

  #set(c: CampaignSim, t: TacticalState, a: Json): void {
    const s = this.#soldier(c, a.who);
    if (has(a, 'life')) s.life = num(a.life);
    if (has(a, 'lifeMax')) s.lifeMax = num(a.lifeMax);
    if (has(a, 'breath')) s.breath = num(a.breath);
    if (has(a, 'breathRed')) s.breathRed = num(a.breathRed);
    if (has(a, 'ap')) s.actionPoints = num(a.ap);
    if (has(a, 'initialAp')) s.initialActionPoints = num(a.initialAp);
    if (has(a, 'visible')) s.visible = num(a.visible);
    if (has(a, 'grid')) setSoldierPosition(t, s, num(a.grid));
    if (has(a, 'face')) {
      setSoldierDirection(t, s, num(a.face));
      setDesiredDirection(t, s, num(a.face));
    }
    if (num(a.stand) !== 0) initNewSoldierAnim(t, s, anim(t.content, 'STANDING'), 0, true);
    if (has(a, 'busy')) t.turn.attackBusyCount = num(a.busy);
    for (const part of String(a.fact ?? '')
      .split(',')
      .filter((x) => x !== '')) {
      const [id, value] = part.split(':').map(Number);
      setFact(c.state.narrative, id ?? 0, value ?? 0);
    }
  }

  #inventory(t: TacticalState, s: Soldier, a: Json): Json {
    const hand = s.inv[InvSlot.HAND] as ItemObject;
    if (has(a, 'swap')) swapObjects(hand, s.inv[num(a.swap)] as ItemObject);
    if (has(a, 'slot')) {
      const slot = num(a.slot);
      if (a.item === 'none') deleteObject(s.inv[slot] as ItemObject);
      else if (has(a, 'item'))
        s.inv[slot] = createItem(t.content.items, itemIndex(t, String(a.item)), has(a, 'status') ? num(a.status) : DEFAULT_ITEM_STATUS);
      const o = s.inv[slot] as ItemObject;
      String(a.attach ?? '')
        .split(',')
        .filter((x) => x !== '')
        .forEach((name, k) => {
          const attachment = o.attachments[k];
          if (attachment) Object.assign(attachment, { item: itemIndex(t, name), status: DEFAULT_ITEM_STATUS });
        });
    }
    return { inv: inventoryRows(s) };
  }

  #pendingWalk(s: Soldier): Json {
    const tool = s.pendingTileTool;
    return {
      pending: tool ? (PENDING_TOOL_CODES[tool.tool] ?? -1) : NO_PENDING_ACTION,
      destination: grid(s.finalDestination),
      pathSize: s.pathSize,
      ap: s.actionPoints,
      gridNo: grid(s.gridNo),
      ...(tool ? { pendingData2: grid(tool.gridNo) } : {}),
      ...(tool && tool.tool !== 'enterVehicle' ? { pendingData3: tool.direction } : {}),
    };
  }

  #stopWalk(t: TacticalState, s: Soldier): void {
    s.pendingTileTool = null;
    stopMerc(t, s);
  }

  #click(t: TacticalState, s: Soldier, target: Soldier, a: Json): Json {
    if (has(a, 'ap')) s.actionPoints = num(a.ap);
    const boarding = t.vehicleHooks.boarding;
    if (!boarding) throw new Error('no vehicle boarding outside a campaign');
    const cursor = num(a.move) !== 0 ? BoardingCursor.MOVE : BoardingCursor.HAND;
    const vehicle = onTheGrid(target) && shownToPlayer(target) ? target : null;
    const rules = { usable: (v: Soldier) => boarding.okUseVehicle(v), aboard: (v: Soldier) => passengersAboard(t, v).length };
    const walk = enterVehicleCheck(t, s, vehicle, cursor, rules);
    const handled = !isBoardingRefusal(walk) && enterVehicle(t, s, walk) === null;
    const pending = this.#pendingWalk(s);
    this.#stopWalk(t, s);
    return { handled, walk: pending };
  }

  #board(t: TacticalState, s: Soldier, vehicle: Soldier): Json {
    const boarding = t.vehicleHooks.boarding;
    if (!boarding) throw new Error('no vehicle boarding outside a campaign');
    return { boarded: boarding.putSoldierInVehicle(s, vehicle) === null };
  }

  #exit(t: TacticalState, s: Soldier): Json {
    const boarding = t.vehicleHooks.boarding;
    if (!boarding) throw new Error('no vehicle boarding outside a campaign');
    const aboard = s.vehicleSeat !== VehicleSeat.NONE;
    if (aboard) boarding.exitVehicle(s);
    return { left: aboard };
  }

  #damage(
    c: CampaignSim,
    t: TacticalState,
    a: Json,
    replayed: (action: () => unknown) => { problems: string[]; result: unknown },
  ): { problems: string[]; result: unknown } {
    const s = this.#soldier(c, a.who);
    const damage = num(a.damage);
    const breath = has(a, 'breath') ? num(a.breath) : damage;
    const reason = DAMAGE_REASONS[String(a.reason ?? 'gunfire')] ?? DamageReason.GUNFIRE;
    const attacker = has(a, 'att') ? this.#soldier(c, a.att) : null;
    return replayed(() => ({ combined: soldierTakeDamage(t, s, damage, breath, reason, attacker) }));
  }

  #armour(t: TacticalState, s: Soldier, a: Json): Json {
    const protection = totalArmourProtection(t, s, AimShot.TORSO, num(a.impact), num(a.ammo));
    const type = t.vehicles[s.vehicleId]?.type ?? -1;
    const armourType = t.content.vehicles[type]?.armourType;
    const armour = armourType === undefined ? NOTHING : itemIndex(t, armourType);
    return { protection, armour };
  }

  #putInHand(t: TacticalState, s: Soldier, a: Json): void {
    if (!has(a, 'item')) return;
    s.inv[InvSlot.HAND] = createItem(t.content.items, itemIndex(t, String(a.item)), has(a, 'status') ? num(a.status) : DEFAULT_ITEM_STATUS);
  }

  #item(t: TacticalState, s: Soldier, a: Json): Json {
    this.#putInHand(t, s, a);
    if (has(a, 'ap')) s.actionPoints = num(a.ap);
    const hand = s.inv[InvSlot.HAND] as ItemObject;
    const handled = handleItem(t, s, num(a.grid), 0, hand.item);
    const walk = this.#pendingWalk(s);
    this.#stopWalk(t, s);
    return { handled, walk, inv: inventoryRows(s) };
  }

  #refuel(t: TacticalState, s: Soldier, vehicle: Soldier, a: Json): Json {
    this.#putInHand(t, s, a);
    const can = s.inv[InvSlot.HAND] as ItemObject;
    if (can.item === itemIndex(t, 'GAS_CAN') && addFuelToVehicle(vehicle, can) && isGasCanEmpty(can)) deleteObject(can);
    return { inv: inventoryRows(s) };
  }

  #repair(c: CampaignSim, vs: Soldier, a: Json): Json {
    const economy = c.economy;
    const v = c.state.forces.vehicles[vs.vehicleId];
    if (!economy || !v) throw new Error('no vehicle to repair');
    const needed = doesVehicleNeedAnyRepairs(economy, v);
    const used = repairVehicle(economy, v, num(a.points));
    return { needed, used, nothingLeft: needed && !doesVehicleNeedAnyRepairs(economy, v) };
  }

  #canMove(c: CampaignSim, id: number): number {
    const ctx = c.strategic;
    if (!ctx) throw new Error('no strategic layer');
    const block = canEntireMovementGroupMove(ctx, id, { inCombat: c.tactical?.state.inCombat === true });
    return block ? (MOVE_ERRORS[block.refusal] ?? ME_CUSTOM) : ME_OK;
  }

  #lineOfSight(t: TacticalState, viewer: Soldier, target: Soldier, a: Json): Json {
    const tileLimit = has(a, 'tileLimit') ? num(a.tileLimit) : DEFAULT_TILE_SIGHT_LIMIT;
    const aware = has(a, 'aware') ? num(a.aware) !== 0 : true;
    return { soldierToSoldier: soldierToSoldierLos(t, viewer, target, tileLimit, aware) };
  }

  #turnStart(t: TacticalState, s: Soldier, a: Json): null {
    const count = has(a, 'count') ? num(a.count) : 1;
    for (let i = 0; i < count; i++) beginMercTurn(t, s);
    return null;
  }

  #applyAiSettings(t: TacticalState, s: Soldier, a: Json): void {
    if (has(a, 'alert')) s.ai.alertStatus = num(a.alert);
    if (has(a, 'ap')) s.actionPoints = num(a.ap);
    if (has(a, 'initialAp')) s.initialActionPoints = num(a.initialAp);
    if (has(a, 'lastAction')) s.ai.lastAction = num(a.lastAction);
    if (has(a, 'noise')) {
      const [g, volume, level] = String(a.noise).split(':').map(Number);
      s.ai.noiseGridNo = g ?? NOWHERE;
      s.ai.noiseVolume = volume ?? 0;
      s.ai.noiseLevel = level ?? 0;
    }
    if (has(a, 'aware')) t.perception.awareOfOpposition[s.team] = num(a.aware) !== 0;
    if (has(a, 'face')) {
      setSoldierDirection(t, s, num(a.face));
      setDesiredDirection(t, s, num(a.face));
    }
  }

  #decide(
    c: CampaignSim,
    t: TacticalState,
    s: Soldier,
    a: Json,
    replayed: (action: () => unknown) => { problems: string[]; result: unknown },
  ): { problems: string[]; result: unknown } {
    this.#applyAiSettings(t, s, a);
    const sim = this.#sim(c);
    const run = replayed(() => decideNpcAction(t, s, sim.ai));
    return {
      problems: run.problems,
      result: {
        turnBased: has(a, 'combat') ? num(a.combat) !== 0 : t.inCombat,
        decided: run.result,
        ai: {
          actionData: grid(s.ai.actionData),
          nextAction: s.ai.nextAction,
          nextActionData: grid(s.ai.nextActionData),
          lastAction: s.ai.lastAction,
        },
      },
    };
  }

  #turn(
    t: TacticalState,
    s: Soldier,
    a: Json,
    trace: readonly Draw[],
    withCombat: <T>(action: () => T) => T,
  ): { problems: string[]; result: unknown } {
    const steps: number[][] = [];
    let drawn = 0;
    const row = (): number[] => [s.hiResDirection, s.direction, s.desiredDirection, s.turnIncrement, s.pauseAnimMove ? 1 : 0, drawn];
    const problems = withCombat(() =>
      replay(t, trace, () => {
        const rng = t.rng as unknown as { int(n: number): number };
        const replayInt = rng.int;
        rng.int = (n: number) => {
          if (n !== 0) drawn++;
          return replayInt(n);
        };
        try {
          setDesiredDirection(t, s, num(a.dir));
          steps.push(row());
          for (let i = 0; i < MAX_TURN_STEPS; i++) {
            const done = s.direction === s.desiredDirection;
            turnSoldier(t, s);
            steps.push(row());
            if (done) break;
          }
        } finally {
          rng.int = replayInt;
        }
      }),
    );
    const turningAnim = hasAnimFlag(t.content, s.state, AnimFlags.TURNING);
    return { problems, result: { steps, turningAnim, aniDelay: s.aniDelay } };
  }

  #shoot(t: TacticalState, s: Soldier, a: Json): Json {
    const frames = has(a, 'frames') ? num(a.frames) : DEFAULT_ANIMATION_FRAMES;
    const state = has(a, 'state') ? num(a.state) : anim(t.content, 'TANK_SHOOT');
    if (has(a, 'target')) {
      s.targetGridNo = num(a.target);
      s.targetLevel = 0;
    }
    const steps: Json[] = [];
    const row = (): Json => ({ state: s.state, code: s.pc, x: s.x, y: s.y, gridNo: s.gridNo });
    initNewSoldierAnim(t, s, state, 0, true);
    steps.push(row());
    for (let i = 0; i < frames && s.state === state; i++) {
      adjustToNextAnimationFrame(t, s);
      steps.push(row());
    }
    clearEventQueue(t);
    return { steps };
  }

  #steal(t: TacticalState, s: Soldier, target: Soldier): Json {
    s.targetLevel = target.level;
    s.aimTime = 0;
    useHandToHandSteal(t, s, target.gridNo);
    return { inv: inventoryRows(s), targetInv: inventoryRows(target) };
  }

  #fire(t: TacticalState, s: Soldier, a: Json): Json {
    if (has(a, 'ap')) s.actionPoints = num(a.ap);
    const frames = has(a, 'frames') ? num(a.frames) : DEFAULT_ANIMATION_FRAMES;
    const hand = s.inv[InvSlot.HAND] as ItemObject;
    const handled = handleItem(t, s, num(a.target), 0, hand.item);
    const step = (): Json => ({
      state: s.state,
      direction: s.direction,
      busy: t.turn.attackBusyCount,
      ap: s.actionPoints,
      attachment: (s.inv[InvSlot.HAND] as ItemObject).attachments[0]?.item ?? NOTHING,
    });
    const standing = anim(t.content, 'STANDING');
    dequeueAllGameEvents(t);
    const states = [step()];
    for (let i = 0; i < frames && (t.turn.attackBusyCount > 0 || s.state !== standing); i++) {
      adjustToNextAnimationFrame(t, s);
      if (hasAnimFlag(t.content, s.state, AnimFlags.TURNING)) turnSoldier(t, s);
      dequeueAllGameEvents(t);
      const next = step();
      if (JSON.stringify(next) !== JSON.stringify(states[states.length - 1])) states.push(next);
    }
    return { handled, states, bullets: t.bullets.length, animState: s.state, ap: s.actionPoints, inv: inventoryRows(s) };
  }

  #route(c: CampaignSim, id: number, to: Sector | null): Json {
    const ctx = c.strategic;
    if (!ctx || !to) throw new Error('no strategic layer or sector');
    const error = this.#canMove(c, id);
    if (error !== ME_OK) return { error };
    plotPathForCharacter(ctx, id, to);
    confirmPathForCharacter(ctx, id);
    return { error };
  }

  #warp(session: CampaignSession, c: CampaignSim, p: Json, a: Json): { problems: string[]; result: unknown } {
    session.drainEvents();
    warpGameTime(c.clockContext, num(a.minutes) * SECONDS_PER_MINUTE, Warp.NORMAL);
    const events = session.drainEvents();
    const outOfGas = events.some((e: SimEvent) => e.type === 'vehicleOutOfGas');
    const boxes = ((p.state as Json | undefined)?.boxes as string[] | undefined) ?? [];
    const problems = outOfGas === boxes.length > 0 ? [] : [`out-of-gas event ${outOfGas}, native boxes ${JSON.stringify(boxes)}`];
    return { problems, result: { worldMinutes: (p.result as Json | undefined)?.worldMinutes } };
  }

  #leaveSector(c: CampaignSim, a: Json, p: Json): Json {
    const flow = c.sectors;
    const selected = this.#merc(c, num(a.who));
    if (!flow || !selected) throw new Error('no sector flow or no such merc');
    const native = (p.result as Json | undefined) ?? {};
    const check = okForSectorExit(flowExitWorld(flow), num(native.exitDirection), 0, selected);
    return { ok: check.result, minutes: check.minutes };
  }

  #nativeResult(p: Json): unknown {
    const r = (p.result as Json | null | undefined) ?? null;
    if (!r) return r;
    switch (p.probe) {
      case 'vehiclecreate':
        return { who: r.who, soldier: this.#nativeCreatedSoldier(r.soldier as Json) };
      case 'vehicleclick':
      case 'vehicleitem': {
        const walk = { ...(r.walk as Json) };
        if (walk.pending === NO_PENDING_ACTION) delete walk.pendingData2;
        if (walk.pending === NO_PENDING_ACTION || walk.pending === PENDING_TOOL_CODES.enterVehicle) delete walk.pendingData3;
        return { ...r, walk };
      }
      case 'vehiclesteal':
        return { inv: r.inv, targetInv: r.targetInv };
      case 'tankturn':
        return { ...r, steps: this.#nativeTurnSteps(p, r.steps as number[][]) };
      case 'tankshoot':
        return { steps: ((r.steps as Json[] | undefined) ?? []).map(({ frame: _frame, ...step }) => step) };
      case 'tankdecide': {
        const ai = r.ai as Json;
        return {
          turnBased: r.turnBased,
          decided: r.decided,
          ai: { actionData: ai.actionData, nextAction: ai.nextAction, nextActionData: ai.nextActionData, lastAction: ai.lastAction },
        };
      }
      case 'vehiclefire':
        return {
          handled: r.handled,
          states: ((r.states as Json[] | undefined) ?? []).map(({ name: _name, ...step }) => step),
          bullets: r.bullets,
          animState: r.animState,
          ap: r.ap,
          inv: r.inv,
        };
      case 'vehicleleavesector':
        return { ok: r.ok, minutes: r.minutes };
      default:
        return r;
    }
  }

  #nativeTurnSteps(p: Json, steps: readonly number[][]): number[][] {
    const trace = (p.draws as Draw[] | undefined) ?? [];
    return steps.map((step) => {
      const seen = step[5] ?? 0;
      const kept = withoutDroppedDraws(trace.slice(0, seen)).length;
      return [...step.slice(0, 5), kept];
    });
  }

  #vehicleRow(c: CampaignSim, v: VehicleRecord, id: number): Json {
    const ctx = c.strategic;
    const g = ctx?.state.forces.groups.find((x) => x.id === v.movementGroup);
    return {
      id,
      type: v.type,
      sector: sectorRow(v.sector),
      z: v.sector.z,
      betweenSectors: v.betweenSectors,
      destroyed: v.destroyed,
      passengers: [...v.passengers],
      path: [...v.path],
      ...(g ? { group: groupRow(g) } : {}),
    };
  }

  #vehicleSoldierRow(c: CampaignSim, t: TacticalState, s: Soldier): Json {
    const merc = s.team === Team.OUR ? this.#merc(c, s.id) : undefined;
    return {
      id: s.id,
      team: s.team,
      side: s.side,
      neutral: s.neutral ? 1 : 0,
      profile: s.profile,
      body: s.bodyType,
      vehicle: s.vehicleId,
      gridNo: grid(s.gridNo),
      x: s.x,
      y: s.y,
      direction: s.direction,
      desiredDirection: s.desiredDirection,
      hiRes: s.hiResDirection,
      flags: seatFlags(s) & VEHICLE_STATUS_FLAGS,
      life: [s.life, s.lifeMax],
      breath: [s.breath, s.breathMax, s.breathRed],
      ap: [s.actionPoints, s.initialActionPoints, calcActionPoints(t, s)],
      assignment: merc?.assignment ?? 0,
      groupId: merc?.groupId ?? 0,
      inSector: s.life > 0 ? s.placed : null,
      damage: s.damageWindow,
      animState: s.state,
    };
  }

  #crewRow(m: RosterMerc): Json {
    const s = m.soldier;
    return {
      id: m.id,
      gridNo: grid(s.gridNo),
      level: s.level,
      direction: s.direction,
      assignment: m.assignment,
      vehicleId: m.assignment === Assignment.VEHICLE ? m.vehicleId : null,
      groupId: m.groupId,
      flags: seatFlags(s),
      inSector: s.life > 0 ? s.placed : null,
      sector: sectorRow(m.sector),
      betweenSectors: m.betweenSectors,
      ap: s.actionPoints,
      life: s.life,
    };
  }

  #nativeCrewRow(r: Json): Json {
    const { insertion: _insertion, ...rest } = r;
    return { ...rest, vehicleId: r.assignment === Assignment.VEHICLE ? r.vehicleId : null, inSector: num(r.life) > 0 ? r.inSector : null };
  }

  #nativeSoldierRow(r: Json): Json {
    const life = (r.life as number[] | undefined) ?? [];
    return { ...r, inSector: (life[0] ?? 0) > 0 ? r.inSector : null };
  }

  #state(c: CampaignSim, p: Json): Json {
    const t = this.#t(c);
    const ctx = c.strategic;
    const roster = c.battle?.roster.all() ?? [];
    const vehicleSoldiers = t.soldiers.filter((s): s is Soldier => active(s) && isVehicleBody(s));
    const ourVehicles = roster.filter((m) => m.isVehicle && !vehicleSoldiers.includes(m.soldier)).map((m) => m.soldier);
    const explosions = t.explosives.aniTiles
      .flatMap((x) => (x.kind === 'explosion' ? [[x.owner?.id ?? NO_SOLDIER_ID, x.x, x.y, x.z, x.gridNo, x.item, x.level]] : []))
      .reverse();
    const state: Json = {
      vehicles: t.vehicles.flatMap((v, id) => (v.valid ? [this.#vehicleRow(c, v, id)] : [])),
      groups: (ctx?.state.forces.groups ?? []).filter((g) => g.player && g.members.length > 0).map(groupRow),
      soldiers: [...vehicleSoldiers, ...ourVehicles].sort((x, y) => x.id - y.id).map((s) => this.#vehicleSoldierRow(c, t, s)),
      crew: roster.filter((m) => !m.isVehicle).map((m) => this.#crewRow(m)),
      squads: c.state.forces.squads.map((q) => [...q]),
      selected: this.#onMapScreen(p) ? null : t.turn.selected,
      explosions,
      busy: t.turn.attackBusyCount,
      inCombat: t.inCombat,
    };
    if (SQUAD_PROBES.has(String(p.probe))) state.currentSquad = c.state.forces.currentSquad;
    return state;
  }

  #onMapScreen(p: Json): boolean {
    return (p.args as Json | undefined)?.screen === 'map';
  }

  #nativeState(p: Json): Json {
    const s = (p.state as Json | undefined) ?? {};
    const state: Json = {
      vehicles: ((s.vehicles as Json[] | undefined) ?? []).map((v) => (v.group ? { ...v, group: nativeGroupRow(v.group as Json) } : v)),
      groups: ((s.groups as Json[] | undefined) ?? []).map(nativeGroupRow),
      soldiers: ((s.soldiers as Json[] | undefined) ?? []).map((r) => this.#nativeSoldierRow(r)),
      crew: ((s.crew as Json[] | undefined) ?? []).map((r) => this.#nativeCrewRow(r)),
      squads: s.squads,
      selected: this.#onMapScreen(p) ? null : s.selected,
      explosions: ((s.explosions as number[][] | undefined) ?? []).map(nativeExplosion),
      busy: s.busy,
      inCombat: s.inCombat,
    };
    if (SQUAD_PROBES.has(String(p.probe))) state.currentSquad = s.currentSquad;
    return state;
  }
}
