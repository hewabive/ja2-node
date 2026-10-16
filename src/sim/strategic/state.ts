import { PreRandom, Rng } from '../../core/rng.ts';
import { createFinanceState, type FinanceState } from '../campaign/finances.ts';
import type { SectorDiff } from '../campaign/sector-diff.ts';
import type { ProfileProgress } from '../tactical/profiles.ts';
import {
  createMeanwhileState,
  createQueenState,
  createStrategicStatus,
  type MeanwhileState,
  type QueenState,
  type StrategicStatus,
} from './ai/queen-state.ts';
import { createEconomyState, type EconomyState } from './economy/state.ts';
import { createEncounterState, createMovementFlowState, type EncounterState, type MovementFlowState } from './forces/flow-state.ts';
import { createForcesState, type ForcesState } from './forces/groups.ts';
import { createMapState, type StrategicMapState } from './map/sectors.ts';
import { createEnvironment, type Environment } from './time/environment.ts';
import { createEventQueue, type EventQueue } from './time/event-queue.ts';
import { createWorldClock, type WorldClock } from './time/world-clock.ts';

export type Flow = 'strategic' | 'tactical';

export interface SectorPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface StrategicState {
  readonly clock: WorldClock;
  readonly queue: EventQueue;
  readonly env: Environment;
  readonly rng: Rng;
  readonly pre: PreRandom;
  realMs: number;
  flow: Flow;
  didGameJustStart: boolean;
  atLeastOneMercHired: boolean;
  worldSector: SectorPosition | null;
  readonly options: GameOptions;
  readonly profiles: Map<number, ProfileProgress>;
  readonly map: StrategicMapState;
  readonly forces: ForcesState;
  readonly movement: MovementFlowState;
  readonly encounter: EncounterState;
  readonly queen: QueenState;
  readonly status: StrategicStatus;
  readonly meanwhile: MeanwhileState;
  readonly economy: EconomyState;
  readonly finances: FinanceState;
  readonly sectorDiffs: Map<string, SectorDiff>;
}

export interface GameOptions {
  difficulty: number;
  sciFi: boolean;
  gunNut: boolean;
}

export interface RandomStreams {
  readonly rng: Rng;
  readonly pre: PreRandom;
}

export interface StrategicStateOptions {
  readonly worldSeconds?: number;
  readonly seed?: number;
  readonly streams?: RandomStreams;
  readonly options?: Partial<GameOptions>;
  readonly profiles?: Map<number, ProfileProgress>;
}

const DEFAULT_SEED = 1;
const DEFAULT_OPTIONS: GameOptions = { difficulty: 2, sciFi: true, gunNut: false };

export function createStrategicState(options: StrategicStateOptions = {}): StrategicState {
  const rng = options.streams?.rng ?? Rng.fromSeed(options.seed ?? DEFAULT_SEED);
  return {
    clock: createWorldClock(options.worldSeconds),
    queue: createEventQueue(),
    env: createEnvironment(),
    rng,
    pre: options.streams?.pre ?? PreRandom.create(rng),
    realMs: 0,
    flow: 'strategic',
    didGameJustStart: false,
    atLeastOneMercHired: false,
    worldSector: null,
    options: { ...DEFAULT_OPTIONS, ...options.options },
    profiles: options.profiles ?? new Map(),
    map: createMapState(),
    forces: createForcesState(),
    movement: createMovementFlowState(),
    encounter: createEncounterState(),
    queen: createQueenState(),
    status: createStrategicStatus(),
    meanwhile: createMeanwhileState(),
    economy: createEconomyState(),
    finances: createFinanceState(),
    sectorDiffs: new Map(),
  };
}
