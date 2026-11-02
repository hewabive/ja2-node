import { describe, expect, it } from 'vitest';
import { encodePcx } from '../../content/formats/pcx.ts';
import { rgbToRgb565 } from '../../content/formats/rgb565.ts';
import { decodeSti, encodeStiIndexed } from '../../content/formats/sti.ts';
import { MemoryLayer, Vfs } from '../../content/vfs/vfs.ts';
import type { UiRenderer } from '../../render/ui-draw/ui-renderer.ts';
import { createApp } from '../../server/app.ts';
import { AssetCache } from '../assets/asset-cache.ts';
import { HttpAssetSource } from '../assets/asset-source.ts';
import type { Fetcher } from '../assets/http-vfs-layer.ts';
import { imageInfo, pcxAsRgbSti, UiAssets } from './ui-assets.ts';

const TOKEN = 'ui-assets-test-token-0123456789';
const FACE = 'faces/33face/01.sti';

async function heldSource(entries: readonly [string, Uint8Array][]): Promise<{ source: HttpAssetSource; release: () => void }> {
  const app = createApp({
    vfs: new Vfs([new MemoryLayer('mem', entries)]),
    token: TOKEN,
    info: { originalData: false, slfCount: 0, stubs: true },
  });
  let held: Promise<void> | null = null;
  let release = () => {};
  const fetcher: Fetcher = async (url, init) => {
    if (held) await held;
    return app.fetch(new Request(url, init));
  };
  const source = await HttpAssetSource.open({ fetch: fetcher, baseUrl: 'http://localhost', headers: { authorization: `Bearer ${TOKEN}` } });
  held = new Promise((resolve) => {
    release = resolve;
  });
  return { source, release };
}

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

describe('the UI images', () => {
  it('count the images still loading, so a frozen screen waits for them', async () => {
    const face = encodeStiIndexed({
      palette: new Uint8Array(768),
      subImages: [{ offsetX: 0, offsetY: 0, width: 2, height: 2, pixels: new Uint8Array(4) }],
    });
    const { source, release } = await heldSource([[FACE, face]]);
    const renderer = { addImage: () => {}, addFont: () => {} } as unknown as UiRenderer;
    const assets = new UiAssets(renderer, source, new AssetCache());
    const loading = assets.image(FACE);
    expect([assets.imagesLoading, assets.info(FACE)]).toEqual([1, undefined]);
    release();
    expect(await loading).toBe(true);
    expect([assets.imagesLoading, assets.info(FACE)?.frames.length]).toEqual([0, 1]);
    expect([await assets.image('faces/none.sti'), assets.imagesLoading]).toEqual([false, 0]);
  });
});
