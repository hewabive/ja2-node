import { describe, expect, it } from 'vitest';
import { parseSoldierPalettes, writeSoldierPalettes } from './ja2pal.ts';

describe('soldier palettes', () => {
  it('round-trips sub-ranges and named replacements', () => {
    const palettes = {
      subRanges: [
        { start: 16, end: 31, replacementCount: 2 },
        { start: 32, end: 47, replacementCount: 1 },
      ],
      replacements: [
        { subRange: 0, id: 'BROWNHEAD', rgb: Uint8Array.from({ length: 48 }, (_, i) => i) },
        { subRange: 0, id: 'BLONDEHEAD', rgb: new Uint8Array(48).fill(200) },
        { subRange: 1, id: 'REDVEST', rgb: new Uint8Array(48).fill(9) },
      ],
    };
    expect(parseSoldierPalettes(writeSoldierPalettes(palettes))).toEqual(palettes);
  });
});
