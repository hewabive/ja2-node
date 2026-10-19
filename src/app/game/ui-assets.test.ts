import { describe, expect, it } from 'vitest';
import { encodePcx } from '../../content/formats/pcx.ts';
import { rgbToRgb565 } from '../../content/formats/rgb565.ts';
import { decodeSti, encodeStiIndexed } from '../../content/formats/sti.ts';
import { imageInfo, pcxAsRgbSti } from './ui-assets.ts';

describe('the UI asset decoders', () => {
  it('turn a PCX into an opaque RGB565 picture through its palette', () => {
    const palette = new Uint8Array(768);
    palette.set([255, 0, 0], 3);
    palette.set([0, 0, 255], 6);
    const sti = pcxAsRgbSti(encodePcx(3, 1, Uint8Array.of(0, 1, 2), palette));
    expect([sti.width, sti.height]).toEqual([3, 1]);
    expect([...sti.pixels]).toEqual([0, rgbToRgb565(255, 0, 0), rgbToRgb565(0, 0, 255)]);
  });

  it('read the frame metrics and the animated frame count of an STI', () => {
    const subImages = [0, 1].map((i) => ({ offsetX: i, offsetY: 2 * i, width: 4 + i, height: 3, pixels: new Uint8Array((4 + i) * 3) }));
    const appData = subImages.map(() => ({
      wallOrientation: 0,
      numberOfTiles: 0,
      tileLocationIndex: 0,
      currentFrame: 0,
      numberOfFrames: 7,
      flags: 2,
    }));
    const info = imageInfo(decodeSti(encodeStiIndexed({ palette: new Uint8Array(768), subImages, appData })));
    expect(info).toEqual({
      kind: 'indexed',
      frames: [
        { width: 4, height: 3, offsetX: 0, offsetY: 0 },
        { width: 5, height: 3, offsetX: 1, offsetY: 2 },
      ],
      animatedFrames: 7,
    });
  });
});
