import { PreRandom, Rng } from '../../core/rng.ts';
import { type ContractState, createContractState } from '../campaign/contracts/contract-state.ts';
import { createEndingState, type EndingState } from '../campaign/ending-state.ts';
import { createFinanceState, type FinanceState } from '../campaign/finances.ts';
import { createLaptopState, type LaptopState } from '../campaign/laptop/laptop-state.ts';
import type { SectorDiff } from '../campaign/sector-diff.ts';
import { createTeamMoraleState, type TeamMoraleState } from '../campaign/team-morale.ts';
import { createNpcRecordState, type NpcRecordState } from '../narrative/records.ts';
import { createKeyTable, type KeyTable } from '../tactical/doors/keys.ts';
import type { ProfileProgress } from '../tactical/profiles.ts';
import {
  createMeanwhileState,
  createQueenState,
  createStrategicStatus,
  type MeanwhileState,
  type QueenState,
  type StrategicStatus,
} from './ai/queen-state.ts';
import { type CreatureState, createCreatureState } from './creatures/creatures.ts';
import { createMerchantState, type MerchantState } from './economy/merchants/state.ts';
import { createEconomyState, type EconomyState } from './economy/state.ts';
import { type BattleState, createBattleState } from './forces/battle-state.ts';
import { createEncounterState, createMovementFlowState, type EncounterState, type MovementFlowState } from './forces/flow-state.ts';
import { createForcesState, type ForcesState } from './forces/groups.ts';
import { createMapState, type StrategicMapState } from './map/sectors.ts';
import { type CivGroupState, createCivGroupState } from './narrative/civ-groups.ts';
import { type BoxingRecord, createNarrativeState, type NarrativeState } from './narrative/facts.ts';
import { createEnvironment, type Environment } from './time/environment.ts';
import { createEventQueue, type EventQueue } from './time/event-queue.ts';
import { createWorldClock, type WorldClock } from './time/world-clock.ts';

export type Flow = 'strategic' | 'tactical' | 'autoresolve' | 'laptop';

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
  readonly battle: BattleState;
  readonly queen: QueenState;
  readonly status: StrategicStatus;
  readonly meanwhile: MeanwhileState;
  readonly ending: EndingState;
  readonly economy: EconomyState;
  readonly finances: FinanceState;
  readonly sectorDiffs: Map<string, SectorDiff>;
  readonly teamMorale: TeamMoraleState;
  readonly creatures: CreatureState;
  readonly merchants: MerchantState;
  readonly contracts: ContractState;
  readonly laptop: LaptopState;
  readonly narrative: NarrativeState;
  readonly npcRecords: NpcRecordState;
  readonly terrorists: TerroristState;
  readonly civGroups: CivGroupState;
  readonly keyTable: KeyTable;
}

export interface TerroristState {
  count: number;
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
  readonly civGroups?: CivGroupState;
  readonly keyTable?: KeyTable;
  readonly boxing?: BoxingRecord;
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
    battle: createBattleState(),
    queen: createQueenState(),
    status: createStrategicStatus(),
    meanwhile: createMeanwhileState(),
    ending: createEndingState(),
    economy: createEconomyState(),
    finances: createFinanceState(),
    sectorDiffs: new Map(),
    teamMorale: createTeamMoraleState(),
    creatures: createCreatureState(),
    merchants: createMerchantState(),
    contracts: createContractState(),
    laptop: createLaptopState(),
    narrative: createNarrativeState(options.boxing),
    npcRecords: createNpcRecordState(),
    terrorists: { count: 0 },
    civGroups: options.civGroups ?? createCivGroupState(),
    keyTable: options.keyTable ?? createKeyTable(),
  };
}
