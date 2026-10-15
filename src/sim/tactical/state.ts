import type { MapDoor } from '../../content/formats/map.ts';
import { isVisibleTile, WORLD_MAX } from '../../content/world/grid.ts';
import type { MovementCosts, MovementWorld } from '../../content/world/movement-costs.ts';
import { PreRandom, type Rng } from '../../core/rng.ts';
import type { SimEvent } from '../events.ts';
import type { TacticalContent } from './content.ts';
import type { DoorStatus, PathEnv, PathSoldier, PathWorld } from './pathfinding.ts';
import { createFogOfWar, type FogOfWar } from './perception/fov.ts';
import { createPerception, type Perception } from './perception/sight.ts';
import { type Soldier, TOTAL_SOLDIERS } from './soldier.ts';
import { createTurnState, type TurnState } from './turns/turn-state.ts';

export interface TacticalWorldData extends MovementWorld {
  readonly costs: MovementCosts;
  readonly mapDoors: ReadonlyMap<number, MapDoor>;
}

export type TacticalEvent = DistributiveOmit<SimEvent, 'tick'>;

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export interface GameOptions {
  gunNut: boolean;
}

export interface TacticalHooks {
  atNewGridNo(t: TacticalState, s: Soldier): boolean;
  newAiSituation(t: TacticalState, s: Soldier): void;
  look(t: TacticalState, s: Soldier): void;
  turnFinished(t: TacticalState, s: Soldier): void;
  stanceChanged(t: TacticalState, s: Soldier): void;
  doorOpened(t: TacticalState, s: Soldier): void;
  endAiGuysTurn(t: TacticalState, s: Soldier): void;
}

export const NO_HOOKS: TacticalHooks = {
  atNewGridNo: () => false,
  newAiSituation: () => {},
  look: () => {},
  turnFinished: () => {},
  stanceChanged: () => {},
  doorOpened: () => {},
  endAiGuysTurn: () => {},
};

export interface PerceptionHooks {
  checkForChangingOrders(s: Soldier): void;
  setNewSituation(s: Soldier): void;
  haltFromSighting(s: Soldier): void;
  ourTeamSeesSomeone(s: Soldier, revealed: number, unknown: number): void;
  enterCombatMode(team: number, s: Soldier): void;
}

export interface TurnHooks {
  startNPCAI(t: TacticalState, s: Soldier): void;
  cancelAIAction(t: TacticalState, s: Soldier): void;
  decideAlertStatus(t: TacticalState, s: Soldier): void;
  setNewSituation(t: TacticalState, s: Soldier): void;
  checkForChangingOrders(t: TacticalState, s: Soldier): void;
  minAPsToAttack(t: TacticalState, s: Soldier, target: number): number;
}

export const NO_TURN_HOOKS: TurnHooks = {
  startNPCAI: () => {},
  cancelAIAction: () => {},
  decideAlertStatus: () => {},
  setNewSituation: () => {},
  checkForChangingOrders: () => {},
  minAPsToAttack: () => 0,
};

export interface DesiredDirectionEvent {
  readonly soldier: number;
  readonly direction: number;
}

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
  readonly events: TacticalEvent[];
  readonly desiredDirectionEvents: DesiredDirectionEvent[];
  readonly pathWorld: PathWorld;
  readonly pathEnv: PathEnv;
  hooks: TacticalHooks;
  readonly perception: Perception;
  readonly fog: FogOfWar;
  perceptionHooks: PerceptionHooks;
  readonly turn: TurnState;
  turnHooks: TurnHooks;
}

export function createTacticalState(world: TacticalWorldData, content: TacticalContent, rng: Rng): TacticalState {
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
    pre: PreRandom.create(rng),
    inCombat: false,
    options: { gunNut: false },
    events: [],
    desiredDirectionEvents: [],
    pathWorld,
    pathEnv,
    hooks: NO_HOOKS,
    perception: createPerception(TOTAL_SOLDIERS),
    fog: createFogOfWar(),
    perceptionHooks: {
      checkForChangingOrders: () => {},
      setNewSituation: () => {},
      haltFromSighting: () => {},
      ourTeamSeesSomeone: () => {},
      enterCombatMode: () => {},
    },
    turn: createTurnState(TOTAL_SOLDIERS),
    turnHooks: NO_TURN_HOOKS,
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
