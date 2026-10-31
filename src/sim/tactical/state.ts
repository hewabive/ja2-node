// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-30. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/WorldMan.cc WhoIsThere2.

import type { OpOutcome } from '../../content/anim/script.ts';
import type { MapDef, MapDoor } from '../../content/formats/map.ts';
import { WORLD_MAX } from '../../content/world/grid.ts';
import type { MovementCosts, MovementWorld } from '../../content/world/movement-costs.ts';
import { gridNoOnVisibleWorldTile, restrictedScrollIdOf } from '../../content/world/render-bounds.ts';
import type { TileElement } from '../../content/world/tile-database.ts';
import { PreRandom, type Rng } from '../../core/rng.ts';
import type { SimEvent } from '../events.ts';
import { type GameOptions, gameOptions } from '../options.ts';
import { type CivGroupState, createCivGroupState } from '../strategic/narrative/civ-groups.ts';
import { type BoxingRecord, createBoxingRecord } from '../strategic/narrative/facts.ts';
import { anim } from './anim-states.ts';
import { type Buildings, createBuildings } from './buildings.ts';
import type { Bullet, MissAnimation } from './combat/bullets.ts';
import { type ExperienceHooks, NO_EXPERIENCE_HOOKS } from './combat/context.ts';
import type { Corpse } from './combat/death.ts';
import type { TacticalContent } from './content.ts';
import { createKeyTable, type KeyTable } from './doors/keys.ts';
import type { MapEdgepoints } from './edgepoints.ts';
import { createEquipmentState, type EquipmentState } from './equipment.ts';
import { createExplosivesState, type ExplosivesState, type WorldClockSource } from './explosions/state.ts';
import type { GameEvent } from './game-events.ts';
import type { SoldierInitNode } from './init-list.ts';
import { createLightingState, type LightingState } from './lighting/lighting.ts';
import type { AddedExitGrid, MapChange } from './map-changes.ts';
import { multiTileShape } from './multi-tile.ts';
import { type NarrativePort, NO_NARRATIVE_PORT } from './narrative/port.ts';
import { createScheduleList, NO_SCHEDULE_CLOCK, type ScheduleClock, type ScheduleList } from './narrative/schedule-state.ts';
import type { DoorStatus, PathEnv, PathSoldier, PathWorld } from './pathfinding.ts';
import { createFogOfWar, type FogOfWar } from './perception/fov.ts';
import { createPerception, type Perception } from './perception/sight.ts';
import type { ProfileProgress } from './profiles.ts';
import { createSmellMap, type SmellMap } from './smell.ts';
import { NOBODY, type Soldier, TOTAL_SOLDIERS } from './soldier.ts';
import { createTurnState, type TurnState } from './turns/turn-state.ts';
import type { WorldItem } from './world-items.ts';

export type SectorMapData = Pick<MapDef, 'info' | 'rooms' | 'ambient' | 'placements' | 'exitGrids' | 'edgepoints' | 'tilesetId'>;

export interface TacticalWorldData extends MovementWorld {
  readonly costs: MovementCosts;
  readonly mapDoors: Map<number, MapDoor>;
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

export function inCavesOrBasement(t: { readonly world: TacticalWorldData }): boolean {
  const ambient = sectorMapOf(t).ambient;
  return ambient?.caves === true || ambient?.basement === true;
}

export type TacticalEvent = DistributiveOmit<SimEvent, 'tick'>;

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export interface CampaignState {
  difficultyModifier: number;
  progress: number;
}

export interface TacticalHooks {
  atNewGridNo(t: TacticalState, s: Soldier): boolean;
  newAiSituation(t: TacticalState, s: Soldier): void;
  look(t: TacticalState, s: Soldier): void;
  climbedRoof(t: TacticalState, s: Soldier): void;
  turnFinished(t: TacticalState, s: Soldier): void;
  stanceChanged(t: TacticalState, s: Soldier): void;
  stanceFreeUp(t: TacticalState, s: Soldier): void;
  pendingAction(t: TacticalState, s: Soldier): boolean;
  runningIntoGas(t: TacticalState, s: Soldier): boolean;
  enteredGridNo(t: TacticalState, s: Soldier, g: number): void;
  doorOpeningNoise(t: TacticalState, s: Soldier): number;
  doorOpened(t: TacticalState, s: Soldier, noise: number): void;
  endAiGuysTurn(t: TacticalState, s: Soldier): void;
  collapse(t: TacticalState, s: Soldier): void;
  opcode(t: TacticalState, s: Soldier, code: number): OpOutcome | null;
}

export const NO_HOOKS: TacticalHooks = {
  atNewGridNo: () => false,
  newAiSituation: () => {},
  look: () => {},
  climbedRoof: () => {},
  turnFinished: () => {},
  stanceChanged: () => {},
  stanceFreeUp: () => {},
  pendingAction: () => false,
  runningIntoGas: () => false,
  enteredGridNo: () => {},
  doorOpeningNoise: () => 0,
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
  ourTeamSeesSomeone(s: Soldier, revealed: number, unknown: number, enemies: readonly number[]): void;
  enterCombatMode(team: number, s: Soldier): void;
}

export const NO_PERCEPTION_HOOKS: PerceptionHooks = {
  checkForChangingOrders: () => {},
  setNewSituation: () => {},
  haltFromSighting: () => {},
  haltFromItemSighting: () => {},
  ourTeamSeesSomeone: () => {},
  enterCombatMode: () => {},
};

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
  murderOfCivilian(t: TacticalState, s: Soldier): void;
  soldierTakingDamage(t: TacticalState, s: Soldier): void;
  addPendingEnemies(t: TacticalState): void;
  soldierLeftMap(t: TacticalState, s: Soldier): void;
  mercsWaitOver(t: TacticalState, code: number): void;
  mercDied(t: TacticalState, s: Soldier): void;
  pendingEnemies(t: TacticalState): boolean;
  militiaFinishBattle(t: TacticalState): boolean;
  battleLost(t: TacticalState): void;
  battleEnded(t: TacticalState, result: BattleResult): void;
  tacticalTurnEnded(t: TacticalState): void;
  combatEntered(t: TacticalState): void;
  enemyPresence(t: TacticalState): void;
  structureDamaged(t: TacticalState, gridNo: number, damage: number): void;
}

export const NO_SECTOR_HOOKS: SectorHooks = {
  soldierDied: () => {},
  murderOfCivilian: () => {},
  soldierTakingDamage: () => {},
  addPendingEnemies: () => {},
  soldierLeftMap: () => {},
  mercsWaitOver: () => {},
  mercDied: () => {},
  pendingEnemies: () => false,
  militiaFinishBattle: () => false,
  battleLost: () => {},
  battleEnded: () => {},
  tacticalTurnEnded: () => {},
  combatEntered: () => {},
  enemyPresence: () => {},
  structureDamaged: () => {},
};

export interface TacticalState {
  clockMs: number;
  tick: number;
  readonly realtimeClock: RealtimeClock;
  readonly aiPass: AiPassState;
  readonly world: TacticalWorldData;
  readonly content: TacticalContent;
  readonly soldiers: Soldier[];
  readonly mercSlots: (Soldier | null)[];
  readonly awaySlots: (Soldier | null)[];
  readonly occupant: readonly [Int16Array, Int16Array];
  readonly reserved: Int16Array;
  readonly doorStatus: Map<number, DoorStatus>;
  readonly rng: Rng;
  readonly pre: PreRandom;
  inCombat: boolean;
  readonly options: GameOptions;
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
  readonly smell: SmellMap;
  worldClock: WorldClockSource | null;
  edgepoints: MapEdgepoints | null;
  edgepointReservations: number[] | null;
  initList: SoldierInitNode[];
  readonly mapChanges: MapChange[];
  readonly addedExitGrids: AddedExitGrid[];
  mercsWaiting: MercsWaiting | null;
  ignoreAllObstacles: boolean;
  sectorHooks: SectorHooks;
  experienceHooks: ExperienceHooks;
  narrative: NarrativePort;
  sector: SectorRef | null;
  readonly keyTable: KeyTable;
  readonly civGroups: CivGroupState;
  readonly boxing: BoxingRecord;
  readonly hostileQuoteList: Soldier[];
  engagedInConv: boolean;
  schedules: ScheduleList;
  scheduleClock: ScheduleClock;
  engagedInConvFromActionMerc: number;
  readonly actionItems: ActionItemQueue;
}

export interface RealtimeClock {
  lastTurnMs: number;
  lastOpplistDecaySeconds: number;
  lastOverheadMs: number;
}

export function createRealtimeClock(): RealtimeClock {
  return { lastTurnMs: 0, lastOpplistDecaySeconds: 0, lastOverheadMs: 0 };
}

export const RESET_AWAY_AI_CURSOR = 0xffff;

export interface AiPassState {
  lastTickMs: number;
  cursor: number;
  awayCursor: number;
  handleThisPass: boolean;
}

export function createAiPassState(): AiPassState {
  return { lastTickMs: 0, cursor: 0, awayCursor: RESET_AWAY_AI_CURSOR, handleThisPass: false };
}

export interface ActionItemQueue {
  readonly queue: WorldItem[];
  active: boolean;
  person: Soldier | null;
  sightChanged: boolean;
}

export interface SharedCampaignState {
  readonly options?: GameOptions;
  readonly pre?: PreRandom;
  readonly profiles?: Map<number, ProfileProgress>;
  readonly keyTable?: KeyTable;
  readonly civGroups?: CivGroupState;
  readonly boxing?: BoxingRecord;
  readonly realtimeClock?: RealtimeClock;
}

export interface SectorRef {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PathEnvSettings {
  readonly showAllMercs: boolean;
  readonly autoBandage: boolean;
  readonly stats: { searches: number };
}

export function defaultPathEnvSettings(): PathEnvSettings {
  return { showAllMercs: false, autoBandage: false, stats: { searches: 0 } };
}

export function pathEnvSettings(env: PathEnv): PathEnvSettings {
  return { showAllMercs: env.showAllMercs, autoBandage: env.autoBandage, stats: env.stats ?? { searches: 0 } };
}

export interface PathEnvParts {
  readonly world: TacticalWorldData;
  readonly pathWorld: PathWorld;
  readonly occupant: readonly [Int16Array, Int16Array];
  readonly soldiers: Soldier[];
  readonly doorStatus: Map<number, DoorStatus>;
  readonly content: TacticalContent;
}

export function createPathEnv(parts: PathEnvParts, settings: PathEnvSettings): PathEnv {
  const { world, pathWorld, occupant, soldiers, doorStatus, content } = parts;
  return {
    world: pathWorld,
    restrictedScrollId: restrictedScrollIdOf(world),
    whoIsThere: (g, level) => whoIsThere({ world, occupant, soldiers }, g, level),
    doorStatus: (g) => doorStatus.get(g) ?? null,
    showAllMercs: settings.showAllMercs,
    autoBandage: settings.autoBandage,
    multiTile: (p, mode) => {
      const s = p as Soldier;
      if (!s.multiTile) return null;
      return multiTileShape(content, s, mode === null ? s.uiMovementMode : anim(content, mode));
    },
    stats: settings.stats,
  };
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
  const pathEnv = createPathEnv({ world, pathWorld, occupant, soldiers, doorStatus, content }, defaultPathEnvSettings());
  const options = shared.options ?? gameOptions();
  return {
    clockMs: 0,
    tick: 0,
    realtimeClock: shared.realtimeClock ?? createRealtimeClock(),
    aiPass: createAiPassState(),
    world,
    content,
    soldiers,
    mercSlots: [],
    awaySlots: [],
    occupant,
    reserved: new Int16Array(WORLD_MAX).fill(-1),
    doorStatus,
    rng,
    pre: shared.pre ?? PreRandom.create(rng),
    inCombat: false,
    options,
    campaign: { difficultyModifier: 30, progress: 0 },
    events: [],
    gameEvents: [],
    pathWorld,
    pathEnv,
    hooks: NO_HOOKS,
    perception: createPerception(TOTAL_SOLDIERS),
    lighting: createLightingState(world.level),
    fog: createFogOfWar(),
    perceptionHooks: NO_PERCEPTION_HOOKS,
    turn: createTurnState(TOTAL_SOLDIERS),
    turnHooks: NO_TURN_HOOKS,
    equipment: createEquipmentState(content.items, options),
    profiles: shared.profiles ?? new Map(),
    worldItems: [],
    buildings: createBuildings(),
    bullets: [],
    missAnimations: [],
    corpses: [],
    pendingSkullReleases: [],
    explosives: createExplosivesState(),
    smell: createSmellMap(),
    worldClock: null,
    edgepoints: null,
    edgepointReservations: null,
    initList: [],
    mapChanges: [],
    addedExitGrids: [],
    mercsWaiting: null,
    ignoreAllObstacles: false,
    sectorHooks: NO_SECTOR_HOOKS,
    experienceHooks: NO_EXPERIENCE_HOOKS,
    narrative: NO_NARRATIVE_PORT,
    sector: null,
    keyTable: shared.keyTable ?? createKeyTable(),
    civGroups: shared.civGroups ?? createCivGroupState(),
    boxing: shared.boxing ?? createBoxingRecord(),
    hostileQuoteList: [],
    engagedInConv: false,
    schedules: createScheduleList(),
    scheduleClock: NO_SCHEDULE_CLOCK,
    engagedInConvFromActionMerc: NOBODY,
    actionItems: { queue: [], active: false, person: null, sightChanged: false },
  };
}

export function onVisibleWorldTile(t: { readonly world: TacticalWorldData }, g: number): boolean {
  return gridNoOnVisibleWorldTile(restrictedScrollIdOf(t.world), g);
}

export function whoIsThere(state: Pick<TacticalState, 'world' | 'occupant' | 'soldiers'>, g: number, level: number): Soldier | null {
  if (!onVisibleWorldTile(state, g)) return null;
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
  return t.mercSlots.filter((s): s is Soldier => s?.placed === true);
}

export function soldiersById(t: Pick<TacticalState, 'soldiers'>): Soldier[] {
  return t.soldiers.filter((s): s is Soldier => s?.placed === true);
}

export function teamMembers(t: Pick<TacticalState, 'soldiers'>, team: number): Soldier[] {
  return t.soldiers.filter((s): s is Soldier => s?.placed === true && s.team === team);
}
