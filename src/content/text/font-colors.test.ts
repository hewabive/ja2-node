import { describe, expect, it } from 'vitest';
import { DEFAULT_SHADOW, FontColor, NEAR_BLACK_RGB, NO_SHADOW, resolveFontColors } from './font-colors.ts';

function palette(entries: Readonly<Record<number, readonly [number, number, number]>>): Uint8Array {
  const out = new Uint8Array(768);
  for (const [index, rgb] of Object.entries(entries)) out.set(rgb, Number(index) * 3);
  return out;
}

describe('font colours resolved through the font palette (docs/28 §3.4)', () => {
  const pal = palette({ [FontColor.WHITE]: [255, 255, 255], [DEFAULT_SHADOW]: [4, 2, 4], 7: [40, 50, 60], 9: [7, 3, 7] });

  it('resolves the foreground, shadow and background indices to the palette colours', () => {
    expect(resolveFontColors(pal, FontColor.WHITE, 7, 7)).toEqual({ foreground: 0xffffff, shadow: 0x28323c, background: 0x28323c });
  });

  it('keeps a black shadow visible as near-black and drops no shadow', () => {
    expect(resolveFontColors(pal, FontColor.WHITE, DEFAULT_SHADOW, 0).shadow).toBe(NEAR_BLACK_RGB);
    expect(resolveFontColors(pal, FontColor.WHITE, NO_SHADOW, 0).shadow).toBeNull();
  });

  it('treats a background that is black in 16 bits as transparent', () => {
    expect(resolveFontColors(pal, FontColor.WHITE, NO_SHADOW, 9).background).toBeNull();
    expect(resolveFontColors(pal, FontColor.BLACK, NO_SHADOW, 0)).toEqual({ foreground: 0, shadow: null, background: null });
  });

  it('refuses a palette that is not 256 colours', () => {
    expect(() => resolveFontColors(new Uint8Array(3), 0, 0, 0)).toThrow(RangeError);
  });
});
