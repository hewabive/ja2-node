import { describe, expect, it } from 'vitest';
import { FormatError } from '../binary/errors.ts';
import { encodePngIndexed } from '../formats/png.ts';
import { parseStubSpriteManifest, pictureFromStubSprite, STUB_SPRITE_FORMAT } from './stub-sprite.ts';

describe('stub sprite', () => {
  const png = encodePngIndexed(4, 2, Uint8Array.of(0, 1, 2, 0, 3, 3, 0, 1), Uint8Array.of(0, 0, 0, 9, 9, 9, 8, 8, 8, 7, 7, 7), {
    transparentIndex0: true,
  });

  it('cuts the atlas into frames and pads the palette to 256 colours', () => {
    const m = parseStubSpriteManifest({
      format: STUB_SPRITE_FORMAT,
      image: 'a.png',
      frames: [
        { x: 0, y: 0, w: 2, h: 2, ox: -1, oy: -2 },
        { x: 2, y: 0, w: 2, h: 2, ox: 0, oy: 0 },
      ],
      meta: { directions: 1 },
    });
    const pic = pictureFromStubSprite(m, png);
    expect(pic.palette.length).toBe(768);
    expect(pic.palette.subarray(3, 6)).toEqual(Uint8Array.of(9, 9, 9));
    expect(pic.frames.map((f) => [...f.pixels])).toEqual([
      [0, 1, 3, 3],
      [2, 0, 0, 1],
    ]);
    expect(pic.frames[0]?.offsetY).toBe(-2);
    expect(m.meta).toEqual({ directions: 1 });
  });

  it('validates the manifest', () => {
    expect(() => parseStubSpriteManifest({ format: 'x' })).toThrow(FormatError);
    expect(() => parseStubSpriteManifest({ format: STUB_SPRITE_FORMAT, image: '../a.png', frames: [] })).toThrow(FormatError);
    const m = parseStubSpriteManifest({ format: STUB_SPRITE_FORMAT, image: 'a.png', frames: [{ x: 3, y: 0, w: 2, h: 2, ox: 0, oy: 0 }] });
    expect(() => pictureFromStubSprite(m, png)).toThrow(/outside/);
  });
});
