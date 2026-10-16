import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import type { StrategicState } from '../state.ts';
import type { StrategicEvent } from '../time/event-queue.ts';
import type { ClockContext } from '../time/world-clock.ts';
import { getGroup } from './groups.ts';
import { groupArrivedAtSector } from './movement.ts';
import {
  defaultStrategicAiPort,
  defaultTacticalWorldPort,
  type MercPort,
  type RollSource,
  type StrategicAiPort,
  type StrategicContext,
  type TacticalWorldPort,
} from './ports.ts';

export interface StrategicContextOptions {
  readonly state: StrategicState;
  readonly content: StrategicContent;
  readonly clock?: ClockContext;
  readonly mercs?: MercPort;
  readonly ai?: StrategicAiPort;
  readonly world?: TacticalWorldPort;
  readonly random?: RollSource;
  readonly preRandom?: RollSource;
}

export const emptyMercPort: MercPort = {
  get: () => undefined,
  byProfile: () => undefined,
  all: () => [],
  carriedWeightPercent: () => 0,
  changeAssignment: () => {},
  awardTravelExperience: () => {},
  removeFromTacticalSector: () => {},
  updateMercInSector: () => {},
  tooTiredToTravel: () => false,
  collapseFromFatigue: () => {},
  spendVehicleFuel: () => 0,
};

export function standaloneClockContext(state: StrategicState): ClockContext {
  return {
    clock: state.clock,
    queue: state.queue,
    screen: () => state.flow,
    inCombat: () => false,
    execute: () => true,
    afterAdvance: () => {},
    compressionModeSet: () => {},
    firstCompressionSinceMapEntry: () => {},
    compressionRefusal: () => null,
  };
}

export function createStrategicContext(options: StrategicContextOptions): StrategicContext {
  const { state } = options;
  return {
    state,
    content: options.content,
    clock: options.clock ?? standaloneClockContext(state),
    mercs: options.mercs ?? emptyMercPort,
    ai: options.ai ?? defaultStrategicAiPort,
    world: options.world ?? defaultTacticalWorldPort,
    random: options.random ?? state.rng,
    preRandom: options.preRandom ?? state.pre,
  };
}

export function handleGroupArrivalEvent(ctx: StrategicContext, event: StrategicEvent): void {
  const g = getGroup(ctx, event.param);
  if (g) groupArrivedAtSector(ctx, g, true, false);
}

export function handleGroupAboutToArriveEvent(): void {}
