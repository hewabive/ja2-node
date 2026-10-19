import { describe, expect, it } from 'vitest';
import { shadedPalette } from './shaded-palette.ts';

describe('shaded palettes (Create16BPPPaletteShaded)', () => {
  const palette = new Uint8Array(768);
  palette.set([200, 100, 50], 3);
  palette.set([255, 255, 255], 6);

  it('scales each channel by scale/256 and clamps to 255', () => {
    const out = shadedPalette(palette, { red: 128, green: 256, blue: 512, mono: false });
    expect([...out.subarray(3, 9)]).toEqual([100, 100, 100, 127, 255, 255]);
  });

  it('tints the luminance in mono mode', () => {
    const out = shadedPalette(palette, { red: 256, green: 128, blue: 0, mono: true });
    expect([...out.subarray(3, 6)]).toEqual([124, 62, 0]);
  });
});
