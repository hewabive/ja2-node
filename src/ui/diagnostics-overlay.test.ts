import { describe, expect, it } from 'vitest';
import { pointedCellLine } from './diagnostics-overlay.ts';

describe('the pointed cell line', () => {
  it('gives the grid number, its column and row, the level and the map', () => {
    expect(pointedCellLine({ gridNo: 12345, level: 1, map: 'maps/a10_b1.dat' })).toEqual({
      text: 'cell 12345 (x 25, y 77), level 1, maps/a10_b1.dat',
      alarm: false,
    });
  });

  it('leaves out a map not loaded yet and says when the pointer is off the map', () => {
    expect(pointedCellLine({ gridNo: 0, level: 0, map: null }).text).toBe('cell 0 (x 0, y 0), level 0');
    expect(pointedCellLine({ gridNo: null, level: 0, map: 'maps/a9.dat' }).text).toBe('cell: none');
  });
});
