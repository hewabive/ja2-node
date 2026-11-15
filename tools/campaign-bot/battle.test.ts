import { describe, expect, it } from 'vitest';
import { hitOdds, noiseGoal } from './battle.ts';
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

describe('the campaign bot shot odds', () => {
  const SHOT = { marksmanship: 80, tilesAway: 10, aim: 0, seesTarget: true };

  it('reads only what an agent knows: the shooter, the distance, the aim and whether he sees the target', () => {
    expect(hitOdds(SHOT)).toBeCloseTo(0.3);
    expect(hitOdds({ ...SHOT, aim: 4 })).toBeCloseTo(0.5);
    expect(hitOdds({ ...SHOT, tilesAway: 20 })).toBeLessThan(hitOdds(SHOT));
    expect(hitOdds({ ...SHOT, seesTarget: false })).toBeLessThan(hitOdds(SHOT));
    expect(hitOdds({ ...SHOT, seesTarget: false, aim: 4 })).toBe(hitOdds({ ...SHOT, seesTarget: false }));
    expect(hitOdds({ ...SHOT, tilesAway: 40 })).toBe(0);
  });
});
