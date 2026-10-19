import { describe, expect, it } from 'vitest';
import { decodeSti, encodeStiIndexed } from '../../content/formats/sti.ts';
import { RADAR_HEIGHT, RADAR_WIDTH, radarCellAt, radarPathForMap, radarPixels } from './radar.ts';

describe('the radar logic', () => {
  it('finds the radar map of a sector map', () => {
    expect(radarPathForMap('maps/a9.dat')).toBe('radarmaps/a9.sti');
    expect(radarPathForMap('stubs/world/maps/village.dat')).toBe('stubs/world/radarmaps/village.sti');
  });

  it('centres a click on the middle of a ten-cell block', () => {
    const { cellX, cellY } = radarCellAt(0.5, 0.5);
    expect(cellX % 10).toBe(5);
    expect(cellY % 10).toBe(5);
  });

  it('turns an indexed radar picture into RGBA through its palette', () => {
    const palette = new Uint8Array(768);
    palette.set([10, 20, 30], 3);
    const sti = decodeSti(
      encodeStiIndexed({ palette, subImages: [{ offsetX: 0, offsetY: 0, width: 2, height: 1, pixels: Uint8Array.of(1, 0) }] }),
    );
    const rgba = radarPixels(sti);
    expect(rgba).toHaveLength(RADAR_WIDTH * RADAR_HEIGHT * 4);
    expect([...(rgba ?? new Uint8ClampedArray()).subarray(0, 8)]).toEqual([10, 20, 30, 255, 0, 0, 0, 255]);
  });
});
