import { PreRandom, Rng } from '../../core/rng.ts';
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
  worldSector: SectorPosition | null;
}

export interface RandomStreams {
  readonly rng: Rng;
  readonly pre: PreRandom;
}

export interface StrategicStateOptions {
  readonly worldSeconds?: number;
  readonly seed?: number;
  readonly streams?: RandomStreams;
}

const DEFAULT_SEED = 1;

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
    worldSector: null,
  };
}
