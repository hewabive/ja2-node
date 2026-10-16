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
  realMs: number;
  flow: Flow;
  didGameJustStart: boolean;
  worldSector: SectorPosition | null;
}

export function createStrategicState(worldSeconds?: number): StrategicState {
  return {
    clock: createWorldClock(worldSeconds),
    queue: createEventQueue(),
    env: createEnvironment(),
    realMs: 0,
    flow: 'strategic',
    didGameJustStart: false,
    worldSector: null,
  };
}
