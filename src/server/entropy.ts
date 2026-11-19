import { randomInt } from 'node:crypto';

export const SEED_LIMIT = 2 ** 32;

export type Entropy = () => number;

export function serverEntropy(): number {
  return randomInt(0, SEED_LIMIT);
}
