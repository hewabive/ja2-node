import { describe, expect, it } from 'vitest';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';

describe('mines from data/externalized', () => {
  it("reads the y offset of each head miner's face, 0 where the mine has none", async () => {
    const { economy } = await loadEconomyTestContent();
    expect(economy.mines.map((m) => m.faceDisplayYOffset)).toEqual([0, 135, 0, 0, 117, 0]);
  });
});
