import { describe, expect, it } from 'vitest';
import { noiseGoal } from './battle.ts';
import { gridNo } from './grid.ts';
import { newMemory } from './player.ts';

describe('the campaign bot search', () => {
  it('gives up a noise the squad does not get near, as a door inside the stub jail (C13, seed 12)', () => {
    const memory = newMemory();
    const noise = gridNo(92, 59);
    memory.noise = noise;
    const goals = Array.from({ length: 6 }, () => noiseGoal(memory, gridNo(86, 58)));
    expect(goals).toEqual([noise, noise, noise, noise, null, null]);
    expect(memory.noise).toBeNull();
  });

  it('drops a noise once the squad stands near it', () => {
    const memory = newMemory();
    memory.noise = gridNo(92, 59);
    expect(noiseGoal(memory, gridNo(90, 59))).toBeNull();
  });
});
