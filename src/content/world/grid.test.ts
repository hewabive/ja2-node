import { describe, expect, it } from 'vitest';
import { gridNo, gridX, gridY } from './grid.ts';

describe('grid coordinates', () => {
  it('split a negative grid number with C truncation, as ConvertGridNoToXY', () => {
    expect(gridY(-1)).toBe(0);
    expect(gridX(-1)).toBe(-1);
    expect(gridNo(gridX(-161), gridY(-161))).toBe(-161);
  });
});
