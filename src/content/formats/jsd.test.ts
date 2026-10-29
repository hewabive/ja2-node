import { describe, expect, it } from 'vitest';
import { FormatError } from '../binary/errors.ts';
import { WORLD_COLS } from '../world/grid.ts';
import { Orientation, parseStructureFile, type StructureDef, writeStructureFile } from './jsd.ts';

const solid = new Uint8Array(25).fill(0x0f);

function structure(number: number, tiles: [number, number][], orientation = 0): StructureDef {
  return {
    number,
    armour: 3,
    hitPoints: 0,
    density: 70,
    flags: 0x10000,
    wallOrientation: orientation,
    destructionPartner: -2,
    partnerDelta: 1,
    zTileOffsetX: 1,
    zTileOffsetY: -1,
    tiles: tiles.map(([x, y]) => ({
      posRelToBase: x + y * WORLD_COLS,
      xRelToBase: x,
      yRelToBase: y,
      shape: solid,
      flags: 0,
      vehicleHitLocation: 0,
    })),
  };
}

describe('JSD structure files', () => {
  it('reads structures sparsely by number and computes hit points from the profile', () => {
    const file = parseStructureFile(writeStructureFile({ structureCount: 3, structures: [structure(2, [[0, 0]])] }));
    expect(file.structureCount).toBe(3);
    expect(file.structures[0]).toBeNull();
    const s = file.structures[2];
    expect(s?.hitPoints).toBe(Math.trunc((25 * 4 * 100) / 255));
    expect(s).toMatchObject({ armour: 3, density: 70, destructionPartner: -2, zTileOffsetX: 1, zTileOffsetY: -1 });
  });

  it('keeps only the low byte of the hit points of a structure with more than 650 filled cubes', () => {
    const sevenTiles = Array.from({ length: 7 }, (_, x): [number, number] => [x, 0]);
    const s = parseStructureFile(writeStructureFile({ structureCount: 1, structures: [structure(0, sevenTiles)] })).structures[0];
    const filledCubes = 7 * 25 * 4;
    expect(s?.hitPoints).toBe(Math.trunc((filledCubes * 100) / 255) - 256);
  });

  it('moves a missing base tile to (0, 0) like NormalizeStructureTiles', () => {
    const s = parseStructureFile(
      writeStructureFile({
        structureCount: 1,
        structures: [
          structure(0, [
            [1, 1],
            [2, 1],
          ]),
        ],
      }),
    ).structures[0];
    expect(s?.tiles.map((t) => [t.xRelToBase, t.yRelToBase, t.posRelToBase])).toEqual([
      [0, 0, 0],
      [1, 0, 1],
    ]);
  });

  it('converts contiguous orientations to flags when aux data is present', () => {
    const aux = { wallOrientation: 4, numberOfTiles: 2, tileLocationIndex: 0, currentFrame: 0, numberOfFrames: 0, flags: 1 };
    const file = parseStructureFile(
      writeStructureFile({
        structureCount: 1,
        auxData: [aux],
        tileLocations: [
          { x: 0, y: 0 },
          { x: -1, y: 0 },
        ],
        structures: [structure(0, [[0, 0]], 4)],
      }),
    );
    expect(file.structures[0]?.wallOrientation).toBe(Orientation.OUTSIDE_RIGHT);
    expect(file.auxData?.[0]?.wallOrientation).toBe(Orientation.OUTSIDE_RIGHT);
    expect(file.tileLocations).toEqual([
      { x: 0, y: 0 },
      { x: -1, y: 0 },
    ]);
  });

  it('rejects foreign files', () => {
    expect(() => parseStructureFile(new TextEncoder().encode('NOPE............'))).toThrow(FormatError);
  });
});
