import { describe, expect, it } from 'vitest';
import { edgeToward } from './campaign.ts';
import { centroid, gridNo, tiles, towards } from './grid.ts';

describe('the campaign bot geometry', () => {
  it('leaves an attacked sector by the edge it came in from', () => {
    expect(edgeToward('M3', 'L3')).toBe('north');
    expect(edgeToward('N3', 'O3')).toBe('south');
    expect(edgeToward('O3', 'O4')).toBe('east');
    expect(edgeToward('O4', 'O3')).toBe('west');
  });

  it('steps towards a goal without overshooting it', () => {
    const from = gridNo(10, 10);
    expect(towards(from, gridNo(20, 10), 4)).toBe(gridNo(14, 10));
    expect(towards(from, gridNo(12, 11), 5)).toBe(gridNo(12, 11));
    expect(tiles(gridNo(0, 0), gridNo(3, 4))).toBe(5);
    expect(centroid([gridNo(10, 10), gridNo(20, 30)])).toBe(gridNo(15, 20));
  });
});
