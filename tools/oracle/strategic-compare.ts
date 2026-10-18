import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSaveGame, type SaveGame } from '../../src/content/formats/savegame.ts';
import { parseSaveEncryptionTable, SAVE_ENCRYPTION_PATH } from '../../src/content/formats/savegame-header.ts';
import { TransportMask } from '../../src/content/strategic/policy.ts';
import {
  parseSectorString,
  type Sector,
  sectorFromStrategicIndex,
  sectorId,
  strategicIndex,
} from '../../src/content/strategic/sector-ids.ts';
import { loadStrategicContent, type StrategicContent } from '../../src/content/strategic/strategic-content.ts';
import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import { importNativeGameOptions } from '../../src/sim/options.ts';
import { createStrategicContext, emptyMercPort } from '../../src/sim/strategic/forces/context.ts';
import {
  createNewPlayerGroupDepartingFromSector,
  type Group,
  groupAtFinalDestination,
  removeGroup,
} from '../../src/sim/strategic/forces/groups.ts';
import { buildAStrategicPath, nowMinutes, rebuildWayPointsForGroupPath } from '../../src/sim/strategic/forces/movement.ts';
import type { MercPort, StrategicContext, StrategicMerc } from '../../src/sim/strategic/forces/ports.ts';
import { initStrategicLayerMap } from '../../src/sim/strategic/map/init.ts';
import { importStrategicMap } from '../../src/sim/strategic/map/save-import.ts';
import { calculateTravelTimeOfGroup, getSectorMvtTimeForGroup } from '../../src/sim/strategic/map/travel.ts';
import { createStrategicState } from '../../src/sim/strategic/state.ts';
import { EventKind } from '../../src/sim/strategic/time/constants.ts';
import { deleteStrategicEvent } from '../../src/sim/strategic/time/event-queue.ts';
import { importStrategicTime } from '../../src/sim/strategic/time/save-import.ts';
import { carriedWeightPercentOf } from '../../src/sim/tactical/points.ts';
import type { TacticalSim } from '../../src/sim/tactical/tactical-sim.ts';

type Json = Record<string, unknown>;

const SECTORS = 256;
const MOVE_DIRECTIONS = 4;
const PLAYER_TEAM = 0;
const STATUS_VEHICLE = 0x00008000;
const STATUS_ROBOT = 0x00001000;
const STATUS_PASSENGER_OR_DRIVER = 0x18000000;
const NORTH_MOVE = -18;
const EAST_MOVE = 1;
const SOUTH_MOVE = 18;
const MAX_REPORTED = 6;

export const STRATEGIC_PROBES: ReadonlySet<string> = new Set(['stratcosts', 'stratpath', 'groups']);

function report(label: string, same: boolean, detail: string): number {
  console.log(`${label}: ${same ? 'ok' : 'MISMATCH'} ${detail}`);
  return same ? 0 : 1;
}

const signed = (minutes: number) => minutes | 0;
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function moveBetween(from: number, to: number): number {
  const d = to - from;
  return d === NORTH_MOVE ? 0 : d === EAST_MOVE ? 1 : d === SOUTH_MOVE ? 2 : 3;
}

function savedMercPort(save: SaveGame, sim: TacticalSim | null): MercPort {
  const mercs = new Map<number, StrategicMerc>();
  for (const e of save.soldiers) {
    const s = e.soldier;
    if (s.team !== PLAYER_TEAM) continue;
    mercs.set(s.id, {
      id: s.id,
      profile: s.profile,
      life: s.stats.life,
      lifeMax: s.stats.lifeMax,
      strength: s.stats.strength,
      isVehicle: (s.statusFlags & STATUS_VEHICLE) !== 0,
      isRobot: (s.statusFlags & STATUS_ROBOT) !== 0,
      isEpc: false,
      isPassengerOrDriver: (s.statusFlags & STATUS_PASSENGER_OR_DRIVER) !== 0,
      asleep: false,
      sector: { ...s.sector },
      betweenSectors: s.betweenSectors,
      groupId: s.groupId,
      prevSectorId: 0,
      insertionCode: s.strategicInsertionCode,
      insertionDirection: 0,
      path: [...e.mercPath],
      assignment: s.assignment,
      vehicleId: s.vehicleId,
    });
  }
  return {
    ...emptyMercPort,
    get: (id) => mercs.get(id),
    all: () => [...mercs.values()],
    byProfile: (p) => [...mercs.values()].find((m) => m.profile === p),
    carriedWeightPercent: (id) => {
      const s = sim?.state.soldiers[id];
      return s && sim ? carriedWeightPercentOf(sim.state.content, s) : 0;
    },
  };
}

export class StrategicComparer {
  readonly #read: ReadFile;
  #content: StrategicContent | null = null;
  #ctx: StrategicContext | null = null;
  #encumbranceKnown: (id: number) => boolean = () => false;

  constructor(read: ReadFile) {
    this.#read = read;
  }

  async #loadContent(): Promise<StrategicContent> {
    this.#content ??= await loadStrategicContent(this.#read);
    return this.#content;
  }

  async #context(): Promise<StrategicContext> {
    if (this.#ctx) return this.#ctx;
    const ctx = createStrategicContext({ state: createStrategicState(), content: await this.#loadContent() });
    initStrategicLayerMap(ctx);
    this.#ctx = ctx;
    return ctx;
  }

  async loadSave(savesDir: string, name: string, sim: TacticalSim | null): Promise<void> {
    const table = await this.#read(SAVE_ENCRYPTION_PATH);
    if (!table) throw new Error(`missing ${SAVE_ENCRYPTION_PATH}`);
    const bytes = new Uint8Array(readFileSync(join(savesDir, `${name}.sav`)));
    const save = parseSaveGame(bytes, parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode(table))));
    const state = createStrategicState({ options: importNativeGameOptions(save.generalInfo.gameOptions).options });
    importStrategicTime(state, save);
    const ctx = createStrategicContext({ state, content: await this.#loadContent(), mercs: savedMercPort(save, sim) });
    importStrategicMap(ctx, save);
    this.#ctx = ctx;
    this.#encumbranceKnown = (id) => sim?.state.soldiers[id] !== undefined;
  }

  async compare(p: Json): Promise<number> {
    const ctx = await this.#context();
    if (p.probe === 'stratcosts') return compareStratCosts(ctx, p);
    if (p.probe === 'stratpath') return compareStratPath(ctx, p);
    return compareGroups(ctx, p, this.#encumbranceKnown);
  }
}

function scratchGroupMask(p: Json): number {
  return TransportMask[String(p.mask ?? 'FOOT') as keyof typeof TransportMask] ?? TransportMask.FOOT;
}

function compareStratCosts(ctx: StrategicContext, p: Json): number {
  const traversability = p.traversability as number[][];
  const minutes = p.minutes as number[][];
  const group = { player: false, transportMask: scratchGroupMask(p), members: [] };
  const differing: string[] = [];
  for (let id = 0; id < SECTORS; id++) {
    const ours = ctx.state.map.sectors[id]?.traversability ?? [];
    if (!sameJson(ours, traversability[id]))
      differing.push(`${id} traversability ${JSON.stringify(ours)}/${JSON.stringify(traversability[id])}`);
    for (let d = 0; d < MOVE_DIRECTIONS; d++) {
      const time = signed(getSectorMvtTimeForGroup(ctx, id, d, group));
      if (time !== minutes[id]?.[d]) differing.push(`${id}/${d} ${time}/${minutes[id]?.[d]}`);
    }
  }
  return report(
    `stratcosts line ${p.line} ${p.mask}`,
    differing.length === 0,
    `${differing.length} differences ${differing.slice(0, MAX_REPORTED).join('; ')}`,
  );
}

function withScratchGroup<T>(ctx: StrategicContext, from: Sector, use: (g: Group) => T): T {
  const f = ctx.state.forces;
  const saved = f.groups;
  const g = createNewPlayerGroupDepartingFromSector(ctx, from);
  f.groups = [g];
  try {
    return use(g);
  } finally {
    removeGroup(ctx, g);
    let more = true;
    while (more) more = deleteStrategicEvent(ctx.state.queue, EventKind.GROUP_ABOUT_TO_ARRIVE, g.id);
    f.groups = saved.filter((x) => x !== g);
  }
}

function compareStratPath(ctx: StrategicContext, p: Json): number {
  const from = parseSectorString(String(p.from));
  const to = parseSectorString(String(p.to));
  const ours = withScratchGroup(ctx, from, (g) => {
    g.transportMask = scratchGroupMask(p);
    const path = buildAStrategicPath(ctx, strategicIndex(from), strategicIndex(to), g, { tacticalTraversal: p.tactical === true }) ?? [];
    const minutes = path.slice(0, -1).map((node, k) => {
      const next = path[k + 1] ?? node;
      return signed(getSectorMvtTimeForGroup(ctx, sectorId(sectorFromStrategicIndex(node)), moveBetween(node, next), g));
    });
    const now = nowMinutes(ctx);
    rebuildWayPointsForGroupPath(ctx, path.length > 0 ? path : null, g);
    return {
      path,
      minutes,
      waypoints: g.waypoints.map((w) => [w.x, w.y, w.z]),
      next: [g.next.x, g.next.y, g.next.z],
      betweenSectors: g.betweenSectors,
      arrivalInMinutes: g.arrivalTime - now,
      traverseTime: g.traverseTime,
      eta: calculateTravelTimeOfGroup(ctx, g),
    };
  });
  const theirs = {
    path: p.path,
    minutes: p.minutes,
    waypoints: p.waypoints,
    next: p.next,
    betweenSectors: p.betweenSectors,
    arrivalInMinutes: p.arrivalInMinutes,
    traverseTime: p.traverseTime,
    eta: p.eta,
  };
  const differing = (Object.keys(theirs) as (keyof typeof theirs)[]).filter((k) => !sameJson(ours[k], theirs[k]));
  return report(
    `stratpath line ${p.line} ${p.from}→${p.to} ${p.mask}${p.tactical ? ' tactical' : ''}`,
    differing.length === 0,
    `length ${ours.path.length}/${(p.path as unknown[]).length} eta ${ours.eta}/${p.eta}` +
      differing.map((k) => ` ${k} ${JSON.stringify(ours[k])}/${JSON.stringify(theirs[k])}`).join(''),
  );
}

function describeGroup(ctx: StrategicContext, g: Group, etaKnown: boolean): Json {
  return {
    id: g.id,
    player: g.player,
    vehicle: g.vehicle,
    persistent: g.persistent,
    debug: g.debug,
    size: g.size,
    sector: [g.sector.x, g.sector.y, g.sector.z],
    next: [g.next.x, g.next.y, g.next.z],
    prev: [g.prev.x, g.prev.y, g.prev.z],
    originalSector: g.originalSector,
    betweenSectors: g.betweenSectors,
    moveType: g.moveType,
    nextWaypointId: g.nextWaypointId,
    arrivalTime: g.arrivalTime,
    traverseTime: g.traverseTime,
    transportMask: g.transportMask,
    flags: g.flags,
    createdSectorId: g.createdSectorId,
    sectorIdOfLastReassignment: g.sectorIdOfLastReassignment,
    atFinalDestination: groupAtFinalDestination(g),
    eta: etaKnown ? calculateTravelTimeOfGroup(ctx, g) : 'unknown',
    waypoints: g.waypoints.map((w) => [w.x, w.y, w.z]),
    ...(g.player
      ? { members: g.members }
      : {
          enemy: g.enemy
            ? [
                g.enemy.numTroops,
                g.enemy.numElites,
                g.enemy.numAdmins,
                g.enemy.pendingReinforcements,
                g.enemy.adminsInBattle,
                g.enemy.intention,
                g.enemy.troopsInBattle,
                g.enemy.elitesInBattle,
              ]
            : null,
        }),
  };
}

function diffEntries(label: string, ours: readonly unknown[], theirs: readonly unknown[], out: string[]): void {
  if (ours.length !== theirs.length) out.push(`${label} count ${ours.length}/${theirs.length}`);
  for (let k = 0; k < Math.max(ours.length, theirs.length); k++) {
    if (!sameJson(ours[k], theirs[k])) out.push(`${label}[${k}] ${JSON.stringify(ours[k])}/${JSON.stringify(theirs[k])}`);
  }
}

function compareGroups(ctx: StrategicContext, p: Json, encumbranceKnown: (id: number) => boolean): number {
  const s = ctx.state;
  const f = s.forces;
  const differing: string[] = [];
  const theirGroups = (p.groups as Json[]).map((g) => {
    const known = !g.player || (g.members as number[]).every(encumbranceKnown);
    return known ? g : { ...g, eta: 'unknown' };
  });
  const ourGroups = f.groups.map((g) => describeGroup(ctx, g, !g.player || g.members.every(encumbranceKnown)));
  diffEntries('group', ourGroups, theirGroups, differing);
  diffEntries(
    'squad',
    f.squads.map((q) => [...q, ...new Array<number>(Math.max(0, ctx.content.policy.squadSize - q.length)).fill(-1)]),
    p.squads as unknown[],
    differing,
  );
  diffEntries('squadGroup', f.squadGroupIds, p.squadGroups as unknown[], differing);
  diffEntries('deadSquadMembers', f.deadSquadMembers, p.deadSquadMembers as unknown[], differing);
  diffEntries('vehicleGroup', f.vehicleGroupIds, p.vehicleGroups as unknown[], differing);
  diffEntries(
    'vehicle',
    f.vehicles.map((v) => ({
      valid: v.valid,
      movementGroup: v.movementGroup,
      type: v.type,
      sector: [v.sector.x, v.sector.y, v.sector.z],
      betweenSectors: v.betweenSectors,
      destroyed: v.destroyed,
      passengers: v.passengers,
    })),
    p.vehicles as unknown[],
    differing,
  );
  diffEntries('sector', s.map.sectors.map(sectorSummary), p.sectors as unknown[], differing);
  diffEntries(
    'element',
    s.map.elements.map((e) => [e.nameId, Number(e.enemyControlled), Number(e.enemyAirControlled), e.samCondition]),
    p.elements as unknown[],
    differing,
  );
  diffEntries(
    'underground',
    s.map.underground.map((u) => [
      u.sector.x,
      u.sector.y,
      u.sector.z,
      u.flags,
      u.numElites,
      u.numTroops,
      u.numAdmins,
      u.numCreatures,
      u.timeLastLoaded,
      u.adjacentSectors,
      u.creatureHabitat,
    ]),
    p.underground as unknown[],
    differing,
  );
  diffEntries(
    'event',
    s.queue.events
      .filter((e) => e.kind === EventKind.GROUP_ARRIVAL || e.kind === EventKind.GROUP_ABOUT_TO_ARRIVE)
      .map((e) => [e.stamp, e.kind, e.param]),
    p.events as unknown[],
    differing,
  );
  diffEntries(
    'mercPath',
    (p.mercs as Json[]).map((m) => [m.id, ctx.mercs.get(Number(m.id))?.path ?? null]),
    (p.mercs as Json[]).map((m) => [m.id, m.path]),
    differing,
  );
  diffEntries(
    'secret',
    ctx.content.secrets.map((secret, k) => [secret.sector, Number(s.map.secretsFound[k] === true)]),
    p.secrets as unknown[],
    differing,
  );
  const scalars = {
    helicopterVehicleId: f.helicopterVehicleId,
    helicopterAirborne: f.helicopterAirborne,
    selectedSector: [s.map.selectedSector.x, s.map.selectedSector.y, s.map.selectedSector.z],
    worldMinutes: nowMinutes(ctx),
  };
  for (const [k, v] of Object.entries(scalars)) if (!sameJson(v, p[k])) differing.push(`${k} ${JSON.stringify(v)}/${JSON.stringify(p[k])}`);
  return report(
    `groups line ${p.line}`,
    differing.length === 0,
    `${f.groups.length} groups, ${differing.length} differences ${differing.slice(0, MAX_REPORTED).join('; ')}`,
  );
}

function sectorSummary(i: StrategicContext['state']['map']['sectors'][number]): number[] {
  return [
    i.flags,
    i.garrisonId,
    i.pendingReinforcements,
    i.numTroops,
    i.numElites,
    i.numAdmins,
    i.numCreatures,
    i.troopsInBattle,
    i.elitesInBattle,
    i.adminsInBattle,
    i.creaturesInBattle,
    i.facilities,
    i.bloodCats,
    i.bloodCatPlacements,
    i.travelRating,
    i.militia[0] ?? 0,
    i.militia[1] ?? 0,
    i.militia[2] ?? 0,
    i.timeLastLoaded,
    i.timeLastPlayerLiberated,
    Number(i.surfaceWasEverPlayerControlled),
    i.visibleItems,
  ];
}
