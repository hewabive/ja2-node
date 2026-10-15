import { describe, expect, it } from 'vitest';
import type { StructureDef } from '../formats/jsd.ts';
import { tileSurfaceZStrips, zStripInfo } from './zstrip.ts';

const STRUCTURE_DOOR = 0x00080000;

function structure(tileOffsets: number[], flags = 0): StructureDef {
  return {
    number: 0,
    armour: 0,
    hitPoints: 0,
    density: 0,
    flags,
    wallOrientation: 0,
    destructionPartner: 0,
    partnerDelta: 0,
    zTileOffsetX: 0,
    zTileOffsetY: 0,
    tiles: tileOffsets.map((posRelToBase) => ({
      posRelToBase,
      xRelToBase: 0,
      yRelToBase: 0,
      shape: new Uint8Array(25),
      flags: 0,
      vehicleHitLocation: 0,
    })),
  };
}

describe('ZStripInfo', () => {
  it('splits an image straddling the base corner into rising, flat and falling strips', () => {
    expect(zStripInfo({ offsetX: -30, offsetY: 0, width: 80 }, structure([0, 1]))).toEqual({
      zChanges: [1, 1, 0, -1],
      initialZChange: -2,
      firstStripWidth: 10,
    });
  });

  it('folds an exact half-tile remainder into a full first strip', () => {
    expect(zStripInfo({ offsetX: -20, offsetY: 0, width: 40 }, structure([0, 1]))).toEqual({
      zChanges: [1],
      initialZChange: -1,
      firstStripWidth: 20,
    });
  });

  it('handles images entirely right of the base corner', () => {
    expect(zStripInfo({ offsetX: 25, offsetY: 0, width: 50 }, structure([0, 1]))).toEqual({
      zChanges: [0, -1, -1],
      initialZChange: 0,
      firstStripWidth: 15,
    });
  });

  it('only creates strips for multi-tile non-door structures', () => {
    const frames = [0, 1, 2].map(() => ({ offsetX: -30, offsetY: 0, width: 80 }));
    const file = {
      structureCount: 3,
      auxData: null,
      tileLocations: [],
      structures: [structure([0]), structure([0, 160]), structure([0, 1], STRUCTURE_DOOR)],
    };
    expect(tileSurfaceZStrips(frames, file).map((z) => z !== null)).toEqual([false, true, false]);
    const singleTileOnly = { ...file, structures: [structure([0]), structure([0])] };
    expect(tileSurfaceZStrips(frames, singleTileOnly).every((z) => z === null)).toBe(true);
  });
});
