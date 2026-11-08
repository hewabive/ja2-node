// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-30. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/WorldMan.cc WhoIsThere2; Tactical/Overhead.cc AddMercSlot, RemoveMercSlot (the vector of
// @src Stracciatella, 2026-11-02); Soldier_Control.cc SetSoldierGridNo (no level node for a driver or passenger, 2026-11-05).

import type { OpOutcome } from '../../content/anim/script.ts';
import type { MapDef, MapDoor } from '../../content/formats/map.ts';
import { WORLD_MAX } from '../../content/world/grid.ts';
import type { MovementCosts, MovementWorld } from '../../content/world/movement-costs.ts';
import { gridNoOnVisibleWorldTile, restrictedScrollIdOf } from '../../content/world/render-bounds.ts';
import { has, StructureFlags } from '../../content/world/structures.ts';
import type { TileElement } from '../../content/world/tile-database.ts';
import type { TileTables } from '../../content/world/tile-tables.ts';
import { PreRandom, type Rng } from '../../core/rng.ts';
import type { SimEvent } from '../events.ts';
import { type GameOptions, gameOptions } from '../options.ts';
import { type CivGroupState, createCivGroupState } from '../strategic/narrative/civ-groups.ts';
import { type BoxingRecord, createBoxingRecord } from '../strategic/narrative/facts.ts';
import type { VehicleRecord } from '../vehicles/vehicle-list.ts';
import { createPanicState, type PanicState } from './ai/panic-triggers.ts';
import { anim } from './anim-states.ts';
import type { ExplosionQueue } from './bombs/bomb-queue.ts';
import { mineFlagsOfMap } from './bombs/mine-flags.ts';
import type { WorldBomb } from './bombs/world-bombs.ts';
import { type Buildings, createBuildings } from './buildings.ts';
import { type ChangeCounts, createChangeCounts, occupancyChanged } from './change-counts.ts';
import type { Bullet, MissAnimation } from './combat/bullets.ts';
import { type ExperienceHooks, NO_EXPERIENCE_HOOKS } from './combat/context.ts';
import type { Corpse } from './combat/death.ts';
import type { TacticalContent } from './content.ts';
import type { DoorStatusEntry } from './doors/door-status.ts';
import { createKeyTable, type KeyTable } from './doors/keys.ts';
import type { MapEdgepoints } from './edgepoints.ts';
import { createEquipmentState, type EquipmentState } from './equipment.ts';
import { createExplosivesState, type ExplosivesState, type WorldClockSource } from './explosions/state.ts';
import type { GameEvent } from './game-events.ts';
import type { LandedHelicopter } from './helicopter-pieces.ts';
import type { SoldierInitNode } from './init-list.ts';
import { createLightingState, type LightingState, NO_TIME_OF_DAY_LIGHT, type TimeOfDayLight } from './lighting/lighting.ts';
import type { AddedExitGrid, MapChange } from './map-changes.ts';
import { multiTileShape } from './multi-tile.ts';
import { type NarrativePort, NO_NARRATIVE_PORT } from './narrative/port.ts';
import { createScheduleList, NO_SCHEDULE_CLOCK, type ScheduleClock, type ScheduleList } from './narrative/schedule-state.ts';
import type { DoorStatus, PathEnv, PathSoldier, PathWorld } from './pathfinding.ts';
import { createFogOfWar, createViewMarkers, type FogOfWar, type ViewMarkers } from './perception/fov.ts';
import { createLookMemo, type LookMemo } from './perception/look-memo.ts';
import { createPerception, type Perception } from './perception/sight.ts';
import { createSightMemo, type SightMemo } from './perception/sight-memo.ts';
import type { ProfileProgress } from './profiles.ts';
import { type BoobyTrap, createBoobyTrap, type TacticalPrompt } from './prompts.ts';
import { createSmellMap, type SmellMap } from './smell.ts';
import { inVehicle, NOBODY, type Soldier, Team, TOTAL_SOLDIERS } from './soldier.ts';
import { createTurnState, type TurnState } from './turns/turn-state.ts';
import { PRIVATE_VEHICLE_LIST, type VehicleHooks } from './vehicle-soldiers.ts';
import type { WorldItem } from './world-items.ts';

export type SectorMapData = Pick<
  MapDef,
  'info' | 'rooms' | 'ambient' | 'placements' | 'exitGrids' | 'edgepoints' | 'tilesetId' | 'worldFlags'
>;

export interface TacticalWorldData extends MovementWorld {
  readonly costs: MovementCosts;
  readonly mapDoors: Map<number, MapDoor>;
  readonly map?: SectorMapData;
  readonly tiles?: readonly TileElement[];
  readonly tables?: TileTables;
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
  worldFlags: new Uint8Array(WORLD_MAX),
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
  rottingCorpses(t: TacticalState): void;
  crowsFlyAway(t: TacticalState, team: number): void;
  crowsSeeingAttackerFlyAway(t: TacticalState, team: number, attacker: Soldier): void;
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
  rottingCorpses: () => {},
  crowsFlyAway: () => {},
  crowsSeeingAttackerFlyAway: () => {},
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
  aiHandleItem(t: TacticalState, s: Soldier, target: number, level: number): number;
  freeUpFromPendingAction(t: TacticalState, s: Soldier): void;
  freeUpNpcFromPendingAction(t: TacticalState, s: Soldier): void;
  actionDone(t: TacticalState, s: Soldier): void;
  freeUpFromRoofClimb(t: TacticalState, s: Soldier): void;
  aiPickup(t: TacticalState, s: Soldier, gridNo: number, item: WorldItem | null): boolean;
  aiDropHandItem(t: TacticalState, s: Soldier): void;
  makeClosestEnemyChosenOne(t: TacticalState): void;
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
  aiHandleItem: () => 0,
  freeUpFromPendingAction: () => {},
  freeUpNpcFromPendingAction: () => {},
  actionDone: () => {},
  freeUpFromRoofClimb: () => {},
  aiPickup: () => false,
  aiDropHandItem: () => {},
  makeClosestEnemyChosenOne: () => {},
};

export const WaitForMercs = { NONE: 0, WALKOFF_SCREEN: 1, WALKON_SCREEN: 2, WALK_TO_GRIDNO: 3 } as const;

export interface PickedOwnershipCheck {
  readonly picker: Soldier;
  readonly gridNo: number;
  readonly dueMs: number;
}

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
  mercDiedOffTheMap(t: TacticalState, s: Soldier): void;
  inMapScreen(t: TacticalState): boolean;
  ourWholeTeam(t: TacticalState): readonly Soldier[];
  pendingEnemies(t: TacticalState): boolean;
  militiaFinishBattle(t: TacticalState): boolean;
  battleLost(t: TacticalState): void;
  battleEnded(t: TacticalState, result: BattleResult): void;
  battleWon(t: TacticalState): void;
  tacticalTurnEnded(t: TacticalState): void;
  combatEntered(t: TacticalState): void;
  enemyPresence(t: TacticalState): void;
  structureDamaged(t: TacticalState, gridNo: number, damage: number): void;
  inCreatureLair(t: TacticalState): boolean;
  worldLoaded(t: TacticalState): boolean;
  autoBandageStarted(t: TacticalState): void;
  autoBandageEnded(t: TacticalState, warpSeconds: number): void;
  inDeidrannaEndgame(t: TacticalState): boolean;
}

export const NO_SECTOR_HOOKS: SectorHooks = {
  soldierDied: () => {},
  murderOfCivilian: () => {},
  soldierTakingDamage: () => {},
  addPendingEnemies: () => {},
  soldierLeftMap: () => {},
  mercsWaitOver: () => {},
  mercDied: () => {},
  mercDiedOffTheMap: () => {},
  inMapScreen: () => false,
  ourWholeTeam: (t) => teamMembers(t, Team.OUR),
  pendingEnemies: () => false,
  militiaFinishBattle: () => false,
  battleLost: () => {},
  battleEnded: () => {},
  battleWon: () => {},
  tacticalTurnEnded: () => {},
  combatEntered: () => {},
  enemyPresence: () => {},
  structureDamaged: () => {},
  inCreatureLair: () => false,
  worldLoaded: () => true,
  autoBandageStarted: () => {},
  autoBandageEnded: () => {},
  inDeidrannaEndgame: () => false,
};

export interface TacticalState {
  clockMs: number;
  tick: number;
  readonly realtimeClock: RealtimeClock;
  readonly crows: CrowStatus;
  readonly autoBandage: AutoBandageState;
  readonly aiPass: AiPassState;
  readonly world: TacticalWorldData;
  readonly content: TacticalContent;
  readonly soldiers: Soldier[];
  readonly mercSlots: Soldier[];
  readonly awaySlots: Soldier[];
  readonly occupant: readonly [Int16Array, Int16Array];
  readonly reserved: Int16Array;
  readonly doorStatus: Map<number, DoorStatusEntry>;
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
  readonly sightMemo: SightMemo;
  readonly lookMemo: LookMemo;
  readonly changes: ChangeCounts;
  readonly lighting: LightingState;
  timeOfDayLight: TimeOfDayLight;
  readonly fog: FogOfWar;
  readonly viewMarkers: ViewMarkers;
  perceptionHooks: PerceptionHooks;
  readonly turn: TurnState;
  turnHooks: TurnHooks;
  readonly equipment: EquipmentState;
  readonly profiles: Map<number, ProfileProgress>;
  readonly vehicles: VehicleRecord[];
  vehicleHooks: VehicleHooks;
  readonly worldItems: WorldItem[];
  readonly worldBombs: WorldBomb[];
  readonly mineFlags: Uint8Array;
  readonly buildings: Buildings;
  readonly bullets: Bullet[];
  readonly missAnimations: MissAnimation[];
  readonly corpses: Corpse[];
  readonly corpseHoles: number[];
  readonly pendingSkullReleases: { readonly soldier: Soldier; readonly at: number }[];
  readonly explosives: ExplosivesState;
  readonly smell: SmellMap;
  worldClock: WorldClockSource | null;
  edgepoints: MapEdgepoints | null;
  edgepointReservations: number[] | null;
  initList: SoldierInitNode[];
  readonly mapChanges: MapChange[];
  readonly addedExitGrids: AddedExitGrid[];
  landedHelicopter: LandedHelicopter | null;
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
  readonly explosionQueue: ExplosionQueue;
  prompt: TacticalPrompt | null;
  promptSeq: number;
  readonly boobyTrap: BoobyTrap;
  readonly panic: PanicState;
  pickedOwnershipCheck: PickedOwnershipCheck | null;
}

export interface RealtimeClock {
  lastTurnMs: number;
  lastOpplistDecaySeconds: number;
  lastOverheadMs: number;
  lastRottingCorpsesSeconds: number;
  creatureTenseQuoteDelaySeconds: number;
  lastCreatureTenseQuoteMs: number;
}

export function createRealtimeClock(): RealtimeClock {
  return {
    lastTurnMs: 0,
    lastOpplistDecaySeconds: 0,
    lastOverheadMs: 0,
    lastRottingCorpsesSeconds: 0,
    creatureTenseQuoteDelaySeconds: 0,
    lastCreatureTenseQuoteMs: 0,
  };
}

export interface CrowStatus {
  possible: number;
  dontAddNew: boolean;
}

export function createCrowStatus(): CrowStatus {
  return { possible: 0, dontAddNew: false };
}

export interface AutoBandageState {
  pending: boolean;
  complete: boolean;
  failed: boolean;
  seconds: number;
  endRequested: boolean;
  fullCheckSoldier: number;
  readonly medics: number[];
  readonly patients: number[];
}

export function createAutoBandageState(): AutoBandageState {
  return {
    pending: false,
    complete: false,
    failed: false,
    seconds: 0,
    endRequested: false,
    fullCheckSoldier: NOBODY,
    medics: [],
    patients: [],
  };
}

export function setAutoBandageMode(t: Pick<TacticalState, 'pathEnv'>, on: boolean): void {
  t.pathEnv.autoBandage = on;
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

export interface SharedCampaignState {
  readonly options?: GameOptions;
  readonly pre?: PreRandom;
  readonly profiles?: Map<number, ProfileProgress>;
  readonly vehicles?: VehicleRecord[];
  readonly keyTable?: KeyTable;
  readonly civGroups?: CivGroupState;
  readonly boxing?: BoxingRecord;
  readonly realtimeClock?: RealtimeClock;
  readonly crows?: CrowStatus;
  readonly autoBandage?: AutoBandageState;
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
  readonly mineFlags: Uint8Array;
  readonly content: TacticalContent;
}

export function createPathEnv(parts: PathEnvParts, settings: PathEnvSettings): PathEnv {
  const { world, pathWorld, occupant, soldiers, doorStatus, mineFlags, content } = parts;
  return {
    world: pathWorld,
    mineFlags,
    restrictedScrollId: restrictedScrollIdOf(world),
    whoIsThere: (g, level) => whoIsThere({ world, occupant, soldiers }, g, level),
    doorStatus: (g) => doorStatus.get(g) ?? null,
    showAllMercs: settings.showAllMercs,
    autoBandage: settings.autoBandage,
    globalFlags: 0,
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
  const doorStatus = new Map<number, DoorStatusEntry>();
  const pathWorld: PathWorld = {
    costs: world.costs,
    terrain: world.terrain,
    heights: world.level.heights,
    structures: world.structures,
    mapDoors: world.mapDoors,
  };
  const mineFlags = mineFlagsOfMap(sectorMapOf({ world }).worldFlags);
  const pathEnv = createPathEnv({ world, pathWorld, occupant, soldiers, doorStatus, mineFlags, content }, defaultPathEnvSettings());
  const options = shared.options ?? gameOptions();
  return {
    clockMs: 0,
    tick: 0,
    realtimeClock: shared.realtimeClock ?? createRealtimeClock(),
    crows: shared.crows ?? createCrowStatus(),
    autoBandage: shared.autoBandage ?? createAutoBandageState(),
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
    sightMemo: createSightMemo(),
    lookMemo: createLookMemo(),
    changes: createChangeCounts(),
    lighting: createLightingState(world.level),
    timeOfDayLight: NO_TIME_OF_DAY_LIGHT,
    fog: createFogOfWar(),
    viewMarkers: createViewMarkers(),
    perceptionHooks: NO_PERCEPTION_HOOKS,
    turn: createTurnState(TOTAL_SOLDIERS),
    turnHooks: NO_TURN_HOOKS,
    equipment: createEquipmentState(content.items, options),
    profiles: shared.profiles ?? new Map(),
    vehicles: shared.vehicles ?? [],
    vehicleHooks: PRIVATE_VEHICLE_LIST,
    worldItems: [],
    worldBombs: [],
    mineFlags,
    buildings: createBuildings(),
    bullets: [],
    missAnimations: [],
    corpses: [],
    corpseHoles: [],
    pendingSkullReleases: [],
    explosives: createExplosivesState(),
    smell: createSmellMap(),
    worldClock: null,
    edgepoints: null,
    edgepointReservations: null,
    initList: [],
    mapChanges: [],
    addedExitGrids: [],
    landedHelicopter: null,
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
    explosionQueue: { entries: [], active: false, mayHaveChangedSight: false, person: null },
    prompt: null,
    promptSeq: 0,
    boobyTrap: createBoobyTrap(),
    panic: createPanicState(),
    pickedOwnershipCheck: null,
  };
}

export function onVisibleWorldTile(t: { readonly world: TacticalWorldData }, g: number): boolean {
  return gridNoOnVisibleWorldTile(restrictedScrollIdOf(t.world), g);
}

export function whoIsThere(state: Pick<TacticalState, 'world' | 'occupant' | 'soldiers'>, g: number, level: number): Soldier | null {
  if (!onVisibleWorldTile(state, g)) return null;
  const id = state.occupant[level > 0 ? 1 : 0][g] ?? -1;
  if (id >= 0) return state.soldiers[id] ?? null;
  return personLyingOver(state, g, level);
}

function personLyingOver(state: Pick<TacticalState, 'world' | 'soldiers'>, g: number, level: number): Soldier | null {
  const onRoof = level > 0;
  for (const piece of state.world.structures.at(g)) {
    if (!has(piece.flags, StructureFlags.PERSON) || has(piece.flags, StructureFlags.PASSABLE)) continue;
    if (onRoof !== piece.cubeOffset > 0) continue;
    const owner = state.soldiers[piece.id];
    if (owner?.placed && owner.gridNo !== g) return owner;
  }
  return null;
}

export function placeOccupant(state: TacticalState, s: Soldier): void {
  if (inVehicle(s)) return;
  const layer = state.occupant[s.level > 0 ? 1 : 0];
  if (layer[s.gridNo] !== -1) return;
  layer[s.gridNo] = s.id;
  occupancyChanged(state);
}

export function removeOccupant(state: TacticalState, s: Soldier): void {
  const layer = state.occupant[s.level > 0 ? 1 : 0];
  if (layer[s.gridNo] !== s.id) return;
  layer[s.gridNo] = -1;
  occupancyChanged(state);
}

export function clearOccupants(state: TacticalState): void {
  for (const layer of state.occupant) layer.fill(-1);
  occupancyChanged(state);
}

export function asPathSoldier(s: Soldier): PathSoldier {
  return s;
}

export function eraseFromSlots(slots: Soldier[], s: Soldier): boolean {
  const before = slots.length;
  let kept = 0;
  for (const other of slots) if (other !== s) slots[kept++] = other;
  slots.length = kept;
  return kept !== before;
}

export function registerSoldier(t: TacticalState, s: Soldier): void {
  t.soldiers[s.id] = s;
  t.mercSlots.push(s);
}

export function unregisterSoldier(t: TacticalState, s: Soldier): boolean {
  return eraseFromSlots(t.mercSlots, s);
}

const placedMercsOfSlots = new WeakMap<readonly Soldier[], readonly Soldier[]>();

function stillPlacedMercs(slots: readonly Soldier[], placed: readonly Soldier[]): boolean {
  let k = 0;
  for (const s of slots) {
    if (!s.placed) continue;
    if (placed[k] !== s) return false;
    k++;
  }
  return k === placed.length;
}

export function mercs(t: Pick<TacticalState, 'mercSlots'>): readonly Soldier[] {
  const known = placedMercsOfSlots.get(t.mercSlots);
  if (known && stillPlacedMercs(t.mercSlots, known)) return known;
  const placed = t.mercSlots.filter((s) => s.placed);
  placedMercsOfSlots.set(t.mercSlots, placed);
  return placed;
}

export function soldiersById(t: Pick<TacticalState, 'soldiers'>): Soldier[] {
  return t.soldiers.filter((s): s is Soldier => s?.placed === true);
}

export function teamMembers(t: Pick<TacticalState, 'soldiers'>, team: number): Soldier[] {
  return t.soldiers.filter((s): s is Soldier => s?.placed === true && s.team === team);
}
