import { TransportMask } from '../../content/strategic/policy.ts';
import { parseSectorString, type Sector, sectorId, strategicIndex } from '../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../content/strategic/strategic-content.ts';
import { NO_CURRENT_SQUAD, NUMBER_OF_SQUADS, SectorFlag } from '../strategic/forces/constants.ts';
import { emptyPassengerSlots, type Group, type VehicleRecord } from '../strategic/forces/groups.ts';
import { SKYRIDER } from '../strategic/forces/helicopter.ts';
import type { StrategicContext } from '../strategic/forces/ports.ts';
import { initializeMapStructure, initStrategicMovementCosts } from '../strategic/map/init.ts';
import { sectorInfo } from '../strategic/map/sectors.ts';
import type { StrategicState } from '../strategic/state.ts';
import { worldTotalMinutes } from '../strategic/time/world-clock.ts';
import type { ProfileProgress } from '../tactical/profiles.ts';
import { type GuardOptions, guardFields } from './guard.ts';
import type { KnowledgeGroup, KnowledgeSector, KnowledgeStrategic, KnowledgeVehicle } from './view.ts';

const UNDERGROUND_SEPARATOR = '-';
const NO_HELICOPTER = -1;
const UNKNOWN_ENEMY_COUNT = 1;
const NO_LAST_REASSIGNMENT = 255;
const ONE_WAY = 0;

export const STATE_FIELDS: ReadonlySet<PropertyKey> = new Set([
  'clock',
  'flow',
  'worldSector',
  'map',
  'forces',
  'economy',
  'profiles',
  'didGameJustStart',
]);

const GROUP_FIELDS: ReadonlySet<PropertyKey> = new Set([
  'id',
  'player',
  'vehicle',
  'sector',
  'next',
  'betweenSectors',
  'arrivalTime',
  'members',
  'transportMask',
  'enemy',
  'size',
]);

const SKYRIDER_FIELDS: ReadonlySet<PropertyKey> = new Set(['balance']);

const VEHICLE_FIELDS: ReadonlySet<PropertyKey> = new Set([
  'valid',
  'destroyed',
  'type',
  'sector',
  'movementGroup',
  'path',
  'betweenSectors',
  'passengers',
]);

export function sectorFromName(name: string): Sector {
  const [short, z] = name.split(UNDERGROUND_SEPARATOR);
  return parseSectorString(short ?? name, z === undefined ? 0 : Number(z));
}

export function pathFromNames(names: readonly string[]): number[] {
  return names.map((n) => strategicIndex(sectorFromName(n)));
}

function knownEnemyCount(enemies: number | '?' | null): number {
  if (enemies === null) return 0;
  return enemies === '?' ? UNKNOWN_ENEMY_COUNT : enemies;
}

function overlaySector(state: StrategicState, v: KnowledgeSector): void {
  const s = sectorFromName(v.sector);
  if (s.z !== 0) return;
  const info = sectorInfo(state.map, s);
  info.numTroops = knownEnemyCount(v.enemies);
  info.numAdmins = 0;
  info.numElites = 0;
  info.militia = [...v.militia];
  if (v.visited) info.flags |= SectorFlag.ALREADY_VISITED;
  const element = state.map.elements[strategicIndex(s)];
  if (element && v.playerControlled !== null) element.enemyControlled = !v.playerControlled;
}

function hiddenGarrisonsCleared(state: StrategicState): void {
  for (const info of state.map.sectors) {
    info.numTroops = 0;
    info.numAdmins = 0;
    info.numElites = 0;
    info.numCreatures = 0;
  }
  state.map.underground = [];
}

function vehicleOfGroup(vehicles: readonly KnowledgeVehicle[], id: number): KnowledgeVehicle | undefined {
  return vehicles.find((v) => v.group === id);
}

function projectedGroup(
  content: StrategicContent,
  view: KnowledgeGroup,
  vehicles: readonly KnowledgeVehicle[],
  now: number,
  guard: GuardOptions,
): Group {
  const sector = sectorFromName(view.sector);
  const vehicle = vehicleOfGroup(vehicles, view.id);
  const mask =
    vehicle && vehicle.type !== undefined ? (content.vehicles[vehicle.type]?.movementType ?? TransportMask.CAR) : TransportMask.FOOT;
  const g: Group = {
    id: view.id,
    debug: false,
    player: true,
    vehicle: vehicle !== undefined,
    persistent: false,
    size: view.members.length,
    sector,
    next: view.next ? sectorFromName(view.next) : sector,
    prev: sector,
    originalSector: sectorId(sector),
    createdSectorId: sectorId(sector),
    sectorIdOfLastReassignment: NO_LAST_REASSIGNMENT,
    betweenSectors: view.betweenSectors,
    moveType: ONE_WAY,
    nextWaypointId: 0,
    arrivalTime: now + (view.nextArrivalMinutes ?? 0),
    traverseTime: 0,
    waypoints: [],
    transportMask: mask,
    flags: 0,
    members: [...view.members],
    enemy: null,
  };
  return guardFields(g, GROUP_FIELDS, `group ${view.id}`, guard);
}

function vehicleOnlyGroups(groups: readonly KnowledgeGroup[], vehicles: readonly KnowledgeVehicle[]): KnowledgeGroup[] {
  const listed = new Set(groups.map((g) => g.id));
  return vehicles
    .filter((v) => !listed.has(v.group ?? 0))
    .map((v) => ({
      id: v.group ?? 0,
      sector: v.sector,
      next: v.next ?? null,
      betweenSectors: v.betweenSectors,
      members: [],
      path: v.path,
      nextArrivalMinutes: v.nextArrivalMinutes ?? null,
    }));
}

function projectedVehicle(view: KnowledgeVehicle, guard: GuardOptions): VehicleRecord {
  const passengers = emptyPassengerSlots();
  view.passengers.forEach((id, k) => {
    passengers[k] = id;
  });
  const v: VehicleRecord = {
    valid: true,
    destroyed: false,
    type: view.type ?? -1,
    sector: sectorFromName(view.sector),
    movementGroup: view.group ?? 0,
    path: pathFromNames(view.path),
    betweenSectors: view.betweenSectors,
    passengers,
    soldierId: -1,
  };
  return guardFields(v, VEHICLE_FIELDS, `vehicle ${view.id}`, guard);
}

function squadsOf(view: KnowledgeStrategic): number[][] {
  const squads = Array.from({ length: NUMBER_OF_SQUADS }, (): number[] => []);
  for (const m of view.mercs) {
    const q = m.squad;
    if (q === null || q === NO_CURRENT_SQUAD) continue;
    squads[q]?.push(m.id);
  }
  return squads;
}

function skyriderProfile(owed: number, guard: GuardOptions): ProfileProgress {
  const known = { balance: -owed };
  return guardFields(known, SKYRIDER_FIELDS, 'profile skyrider', guard) as unknown as ProfileProgress;
}

export function overlayStrategicState(ctx: StrategicContext, view: KnowledgeStrategic, guard: GuardOptions): void {
  const state = ctx.state;
  initializeMapStructure(ctx);
  for (const e of state.map.elements) e.enemyControlled = true;
  initStrategicMovementCosts(ctx);
  hiddenGarrisonsCleared(state);
  for (const s of view.sectors) overlaySector(state, s);
  for (const name of view.enemyAirspace ?? []) {
    const e = state.map.elements[strategicIndex(sectorFromName(name))];
    if (e) e.enemyAirControlled = true;
  }
  state.flow = view.flow as StrategicState['flow'];
  state.worldSector = view.worldSector ? sectorFromName(view.worldSector) : null;
  const now = worldTotalMinutes(state.clock);
  const vehicles = view.vehicles ?? [];
  const forces = state.forces;
  forces.groups = [...view.groups, ...vehicleOnlyGroups(view.groups, vehicles)].map((g) =>
    projectedGroup(ctx.content, g, vehicles, now, guard),
  );
  forces.squads = squadsOf(view);
  forces.vehicles = [];
  for (const v of vehicles) forces.vehicles[v.id] = projectedVehicle(v, guard);
  const heli = view.helicopter;
  forces.helicopterVehicleId = heli?.vehicle ?? NO_HELICOPTER;
  forces.helicopterAirborne = heli?.airborne === true;
  forces.helicopter.setUp = heli !== undefined && heli.destroyed !== true;
  forces.helicopter.destroyed = heli?.destroyed === true;
  forces.helicopter.returningToBase = heli?.returning === true;
  state.profiles.set(SKYRIDER, skyriderProfile(heli?.owed ?? 0, guard));
  for (const t of view.towns ?? []) {
    const town = state.economy.towns[t.town];
    if (town) {
      town.rating = t.loyalty;
      town.started = true;
    }
  }
}
