import type { MapDoor } from '../../content/formats/map.ts';
import { isVisibleTile, WORLD_MAX } from '../../content/world/grid.ts';
import type { MovementCosts } from '../../content/world/movement-costs.ts';
import type { WorldStructures } from '../../content/world/structures.ts';
import type { Rng } from '../../core/rng.ts';
import type { SimEvent } from '../events.ts';
import type { TacticalContent } from './content.ts';
import type { DoorStatus, PathEnv, PathSoldier, PathWorld } from './pathfinding.ts';
import type { Soldier } from './soldier.ts';

export interface TacticalWorldData {
  readonly level: { readonly heights: Uint8Array };
  readonly structures: WorldStructures;
  readonly terrain: Uint8Array;
  readonly costs: MovementCosts;
  readonly mapDoors: ReadonlyMap<number, MapDoor>;
}

export type TacticalEvent = DistributiveOmit<SimEvent, 'tick'>;

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export interface TacticalHooks {
  atNewGridNo(t: TacticalState, s: Soldier): boolean;
  newAiSituation(t: TacticalState, s: Soldier): void;
  look(t: TacticalState, s: Soldier): void;
}

export const NO_HOOKS: TacticalHooks = {
  atNewGridNo: () => false,
  newAiSituation: () => {},
  look: () => {},
};

export interface TacticalState {
  clockMs: number;
  readonly world: TacticalWorldData;
  readonly content: TacticalContent;
  readonly soldiers: Soldier[];
  readonly occupant: readonly [Int16Array, Int16Array];
  readonly reserved: Int16Array;
  readonly doorStatus: Map<number, DoorStatus>;
  readonly rng: Rng;
  inCombat: boolean;
  readonly events: TacticalEvent[];
  readonly pathWorld: PathWorld;
  readonly pathEnv: PathEnv;
  hooks: TacticalHooks;
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
  };
  return {
    clockMs: 0,
    world,
    content,
    soldiers,
    occupant,
    reserved: new Int16Array(WORLD_MAX).fill(-1),
    doorStatus,
    rng,
    inCombat: false,
    events: [],
    pathWorld,
    pathEnv,
    hooks: NO_HOOKS,
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
