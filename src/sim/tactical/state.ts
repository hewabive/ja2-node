import type { OpOutcome } from '../../content/anim/script.ts';
import type { MapDef, MapDoor } from '../../content/formats/map.ts';
import { isVisibleTile, WORLD_MAX } from '../../content/world/grid.ts';
import type { MovementCosts, MovementWorld } from '../../content/world/movement-costs.ts';
import type { TileElement } from '../../content/world/tile-database.ts';
import { PreRandom, type Rng } from '../../core/rng.ts';
import type { SimEvent } from '../events.ts';
import { type Buildings, createBuildings } from './buildings.ts';
import type { Bullet, MissAnimation } from './combat/bullets.ts';
import { type ExperienceHooks, NO_EXPERIENCE_HOOKS } from './combat/context.ts';
import type { Corpse } from './combat/death.ts';
import type { TacticalContent } from './content.ts';
import type { MapEdgepoints } from './edgepoints.ts';
import { createEquipmentState, type EquipmentState } from './equipment.ts';
import { createExplosivesState, type ExplosivesState, type WorldClockSource } from './explosions/state.ts';
import type { GameEvent } from './game-events.ts';
import type { SoldierInitNode } from './init-list.ts';
import { createLightingState, type LightingState } from './lighting/lighting.ts';
import type { MapChange } from './map-changes.ts';
import type { DoorStatus, PathEnv, PathSoldier, PathWorld } from './pathfinding.ts';
import { createFogOfWar, type FogOfWar } from './perception/fov.ts';
import { createPerception, type Perception } from './perception/sight.ts';
import type { ProfileProgress } from './profiles.ts';
import { type Soldier, TOTAL_SOLDIERS } from './soldier.ts';
import { createTurnState, type TurnState } from './turns/turn-state.ts';
import type { WorldItem } from './world-items.ts';

export type SectorMapData = Pick<MapDef, 'info' | 'rooms' | 'ambient' | 'placements' | 'exitGrids' | 'edgepoints' | 'tilesetId'>;

export interface TacticalWorldData extends MovementWorld {
  readonly costs: MovementCosts;
  readonly mapDoors: ReadonlyMap<number, MapDoor>;
  readonly map?: SectorMapData;
  readonly tiles?: readonly TileElement[];
}

const NO_ENTRY = -1;
const NO_SECTOR_MAP: SectorMapData = {
  info: {
    northGridNo: NO_ENTRY,
    eastGridNo: NO_ENTRY,
    southGridNo: NO_ENTRY,
    westGridNo: NO_ENTRY,
    numIndividuals: 0,
    mapVersion: 0,
    restrictedScrollId: 0,
    editorSmoothingType: 0,
    centerGridNo: NO_ENTRY,
    isolatedGridNo: NO_ENTRY,
  },
  rooms: new Uint8Array(WORLD_MAX),
  ambient: null,
  placements: [],
  exitGrids: [],
  edgepoints: null,
  tilesetId: 0,
};

export function sectorMapOf(t: { readonly world: TacticalWorldData }): SectorMapData {
  return t.world.map ?? NO_SECTOR_MAP;
}

export type TacticalEvent = DistributiveOmit<SimEvent, 'tick'>;

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export interface GameOptions {
  gunNut: boolean;
  bloodAndGore: boolean;
}

export interface CampaignState {
  difficultyModifier: number;
  progress: number;
}

export interface TacticalHooks {
  atNewGridNo(t: TacticalState, s: Soldier): boolean;
  newAiSituation(t: TacticalState, s: Soldier): void;
  look(t: TacticalState, s: Soldier): void;
  turnFinished(t: TacticalState, s: Soldier): void;
  stanceChanged(t: TacticalState, s: Soldier): void;
  stanceFreeUp(t: TacticalState, s: Soldier): void;
  pendingAction(t: TacticalState, s: Soldier): boolean;
  runningIntoGas(t: TacticalState, s: Soldier): boolean;
  enteredGridNo(t: TacticalState, s: Soldier, g: number): void;
  doorOpened(t: TacticalState, s: Soldier): void;
  endAiGuysTurn(t: TacticalState, s: Soldier): void;
  collapse(t: TacticalState, s: Soldier): void;
  opcode(t: TacticalState, s: Soldier, code: number): OpOutcome | null;
}

export const NO_HOOKS: TacticalHooks = {
  atNewGridNo: () => false,
  newAiSituation: () => {},
  look: () => {},
  turnFinished: () => {},
  stanceChanged: () => {},
  stanceFreeUp: () => {},
  pendingAction: () => false,
  runningIntoGas: () => false,
  enteredGridNo: () => {},
  doorOpened: () => {},
  endAiGuysTurn: () => {},
  collapse: () => {},
  opcode: () => null,
};

export interface PerceptionHooks {
  checkForChangingOrders(s: Soldier): void;
  setNewSituation(s: Soldier): void;
  haltFromSighting(s: Soldier): void;
  haltFromItemSighting(s: Soldier): void;
  ourTeamSeesSomeone(s: Soldier, revealed: number, unknown: number): void;
  enterCombatMode(team: number, s: Soldier): void;
}

export interface TurnHooks {
  startNPCAI(t: TacticalState, s: Soldier): void;
  cancelAIAction(t: TacticalState, s: Soldier): void;
  decideAlertStatus(t: TacticalState, s: Soldier): void;
  setNewSituation(t: TacticalState, s: Soldier): void;
  checkForChangingOrders(t: TacticalState, s: Soldier): void;
  minAPsToAttack(t: TacticalState, s: Soldier, target: number, addTurning: boolean): number;
  suppressedStanceChange(t: TacticalState, s: Soldier, stance: number): void;
  freeUpFromAttacking(t: TacticalState, s: Soldier): void;
  aiAttack(t: TacticalState, s: Soldier, target: number, level: number): number;
  freeUpFromPendingAction(t: TacticalState, s: Soldier): void;
  actionDone(t: TacticalState, s: Soldier): void;
  freeUpFromRoofClimb(t: TacticalState, s: Soldier): void;
  aiPickup(t: TacticalState, s: Soldier, gridNo: number, item: WorldItem | null): boolean;
  aiDropHandItem(t: TacticalState, s: Soldier): void;
}

export const NO_TURN_HOOKS: TurnHooks = {
  startNPCAI: () => {},
  cancelAIAction: () => {},
  decideAlertStatus: () => {},
  setNewSituation: () => {},
  checkForChangingOrders: () => {},
  minAPsToAttack: () => 0,
  suppressedStanceChange: () => {},
  freeUpFromAttacking: () => {},
  aiAttack: () => 0,
  freeUpFromPendingAction: () => {},
  actionDone: () => {},
  freeUpFromRoofClimb: () => {},
  aiPickup: () => false,
  aiDropHandItem: () => {},
};

export const WaitForMercs = { NONE: 0, WALKOFF_SCREEN: 1, WALKON_SCREEN: 2, WALK_TO_GRIDNO: 3 } as const;

export interface MercsWaiting {
  readonly code: number;
  remaining: number;
  readonly sinceMs: number;
}

export type BattleResult = 'won' | 'lost';

export interface SectorHooks {
  soldierDied(t: TacticalState, s: Soldier): void;
  addPendingEnemies(t: TacticalState): void;
  soldierLeftMap(t: TacticalState, s: Soldier): void;
  mercsWaitOver(t: TacticalState, code: number): void;
  mercDied(t: TacticalState, s: Soldier): void;
  pendingEnemies(t: TacticalState): boolean;
  militiaFinishBattle(t: TacticalState): boolean;
  battleLost(t: TacticalState): void;
  battleEnded(t: TacticalState, result: BattleResult): void;
}

export const NO_SECTOR_HOOKS: SectorHooks = {
  soldierDied: () => {},
  addPendingEnemies: () => {},
  soldierLeftMap: () => {},
  mercsWaitOver: () => {},
  mercDied: () => {},
  pendingEnemies: () => false,
  militiaFinishBattle: () => false,
  battleLost: () => {},
  battleEnded: () => {},
};

export interface TacticalState {
  clockMs: number;
  readonly world: TacticalWorldData;
  readonly content: TacticalContent;
  readonly soldiers: Soldier[];
  readonly mercSlots: (Soldier | null)[];
  readonly occupant: readonly [Int16Array, Int16Array];
  readonly reserved: Int16Array;
  readonly doorStatus: Map<number, DoorStatus>;
  readonly rng: Rng;
  readonly pre: PreRandom;
  inCombat: boolean;
  options: GameOptions;
  campaign: CampaignState;
  readonly events: TacticalEvent[];
  readonly gameEvents: GameEvent[];
  readonly pathWorld: PathWorld;
  readonly pathEnv: PathEnv;
  hooks: TacticalHooks;
  readonly perception: Perception;
  readonly lighting: LightingState;
  readonly fog: FogOfWar;
  perceptionHooks: PerceptionHooks;
  readonly turn: TurnState;
  turnHooks: TurnHooks;
  readonly equipment: EquipmentState;
  readonly profiles: Map<number, ProfileProgress>;
  readonly worldItems: WorldItem[];
  readonly buildings: Buildings;
  readonly bullets: Bullet[];
  readonly missAnimations: MissAnimation[];
  readonly corpses: Corpse[];
  readonly pendingSkullReleases: { readonly soldier: Soldier; readonly at: number }[];
  readonly explosives: ExplosivesState;
  worldClock: WorldClockSource | null;
  edgepoints: MapEdgepoints | null;
  edgepointReservations: number[] | null;
  initList: SoldierInitNode[];
  readonly mapChanges: MapChange[];
  mercsWaiting: MercsWaiting | null;
  ignoreAllObstacles: boolean;
  sectorHooks: SectorHooks;
  experienceHooks: ExperienceHooks;
}

export interface SharedCampaignState {
  readonly pre?: PreRandom;
  readonly profiles?: Map<number, ProfileProgress>;
}

export function createTacticalState(
  world: TacticalWorldData,
  content: TacticalContent,
  rng: Rng,
  shared: SharedCampaignState = {},
): TacticalState {
  const occupant: [Int16Array, Int16Array] = [new Int16Array(WORLD_MAX).fill(-1), new Int16Array(WORLD_MAX).fill(-1)];
  const soldiers: Soldier[] = [];
  const doorStatus = new Map<number, DoorStatus>();
  const pathWorld: PathWorld = {
    costs: world.costs,
    terrain: world.terrain,
    heights: world.level.heights,
    structures: world.structures,
    mapDoors: world.mapDoors,
  };
  const pathEnv: PathEnv = {
    world: pathWorld,
    whoIsThere: (g, level) => whoIsThere({ occupant, soldiers }, g, level),
    doorStatus: (g) => doorStatus.get(g) ?? null,
    showAllMercs: false,
    autoBandage: false,
    stats: { searches: 0 },
  };
  return {
    clockMs: 0,
    world,
    content,
    soldiers,
    mercSlots: [],
    occupant,
    reserved: new Int16Array(WORLD_MAX).fill(-1),
    doorStatus,
    rng,
    pre: shared.pre ?? PreRandom.create(rng),
    inCombat: false,
    options: { gunNut: false, bloodAndGore: true },
    campaign: { difficultyModifier: 30, progress: 0 },
    events: [],
    gameEvents: [],
    pathWorld,
    pathEnv,
    hooks: NO_HOOKS,
    perception: createPerception(TOTAL_SOLDIERS),
    lighting: createLightingState(world.level),
    fog: createFogOfWar(),
    perceptionHooks: {
      checkForChangingOrders: () => {},
      setNewSituation: () => {},
      haltFromSighting: () => {},
      haltFromItemSighting: () => {},
      ourTeamSeesSomeone: () => {},
      enterCombatMode: () => {},
    },
    turn: createTurnState(TOTAL_SOLDIERS),
    turnHooks: NO_TURN_HOOKS,
    equipment: createEquipmentState(content.items),
    profiles: shared.profiles ?? new Map(),
    worldItems: [],
    buildings: createBuildings(),
    bullets: [],
    missAnimations: [],
    corpses: [],
    pendingSkullReleases: [],
    explosives: createExplosivesState(),
    worldClock: null,
    edgepoints: null,
    edgepointReservations: null,
    initList: [],
    mapChanges: [],
    mercsWaiting: null,
    ignoreAllObstacles: false,
    sectorHooks: NO_SECTOR_HOOKS,
    experienceHooks: NO_EXPERIENCE_HOOKS,
  };
}

export function whoIsThere(state: Pick<TacticalState, 'occupant' | 'soldiers'>, g: number, level: number): Soldier | null {
  if (!isVisibleTile(g)) return null;
  const id = state.occupant[level > 0 ? 1 : 0][g] ?? -1;
  return id < 0 ? null : (state.soldiers[id] ?? null);
}

export function placeOccupant(state: TacticalState, s: Soldier): void {
  const layer = state.occupant[s.level > 0 ? 1 : 0];
  if (layer[s.gridNo] === -1) layer[s.gridNo] = s.id;
}

export function removeOccupant(state: TacticalState, s: Soldier): void {
  const layer = state.occupant[s.level > 0 ? 1 : 0];
  if (layer[s.gridNo] === s.id) layer[s.gridNo] = -1;
}

export function asPathSoldier(s: Soldier): PathSoldier {
  return s;
}

export function registerSoldier(t: TacticalState, s: Soldier): void {
  t.soldiers[s.id] = s;
  const free = t.mercSlots.indexOf(null);
  if (free >= 0) t.mercSlots[free] = s;
  else t.mercSlots.push(s);
}

export function unregisterSoldier(t: TacticalState, s: Soldier): void {
  const slot = t.mercSlots.indexOf(s);
  if (slot >= 0) t.mercSlots[slot] = null;
}

export function mercs(t: Pick<TacticalState, 'mercSlots'>): Soldier[] {
  return t.mercSlots.filter((s): s is Soldier => s !== null && s.placed);
}

export function soldiersById(t: Pick<TacticalState, 'soldiers'>): Soldier[] {
  return t.soldiers.filter((s): s is Soldier => s !== undefined && s.placed);
}

export function teamMembers(t: Pick<TacticalState, 'soldiers'>, team: number): Soldier[] {
  return t.soldiers.filter((s): s is Soldier => s !== undefined && s.placed && s.team === team);
}
