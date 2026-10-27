import { describe, expect, it } from 'vitest';
import { Direction, gridNo } from '../world/grid.ts';
import { heardSoundTile } from './heard-place.ts';

describe('the tile a heard sound comes from', () => {
  it('lies off the listener in the heard direction, nearer the louder it is', () => {
    const at = gridNo(80, 80);
    expect(heardSoundTile(at, Direction.NORTH, 0)).toBe(gridNo(80, 50));
    expect(heardSoundTile(at, Direction.EAST, 3)).toBe(gridNo(84, 80));
    expect(heardSoundTile(at, Direction.SOUTHWEST, 2)).toBe(gridNo(70, 90));
  });

  it('stays on the map and on the listener for a sound from above or below', () => {
    expect(heardSoundTile(gridNo(2, 80), Direction.WEST, 0)).toBe(gridNo(0, 80));
    expect(heardSoundTile(gridNo(40, 40), 'above', 3)).toBe(gridNo(40, 40));
  });
});
