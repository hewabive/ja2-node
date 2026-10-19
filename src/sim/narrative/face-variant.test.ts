import { describe, expect, it } from 'vitest';
import { elliotFaceVariant } from './face-variant.ts';

describe("Elliot's big face (InitFace)", () => {
  it('follows bNPCData through the beaten variants', () => {
    expect([0, 3, 4, 6, 7, 9, 10, 12, 13, 15, 16, 17, 18].map(elliotFaceVariant)).toEqual([
      null,
      null,
      'a',
      'a',
      'b',
      'b',
      'c',
      'c',
      'd',
      'd',
      null,
      'e',
      null,
    ]);
  });
});
