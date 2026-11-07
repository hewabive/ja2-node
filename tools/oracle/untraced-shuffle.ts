import type { Rng } from '../../src/core/rng.ts';

export type ShuffleEngine = Pick<Rng, 'shuffled'>;

export function withUntracedShuffle<R extends object>(replay: R, engine: ShuffleEngine): R & ShuffleEngine {
  return Object.assign(replay, { shuffled: <T>(items: readonly T[]): T[] => engine.shuffled(items) });
}
