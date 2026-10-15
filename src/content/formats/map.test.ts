import { describe, expect, it } from 'vitest';
import { FormatError } from '../binary/errors.ts';
import { WORLD_MAX } from '../world/grid.ts';
import { emptyTileLayer, LAYER_NAMES, type MapDef, MapFlags, parseMap, tileLayerFromLists, tilesAt, writeMap } from './map.ts';

function sampleMap(minorVersion = 25): Omit<MapDef, 'trailingBytes'> {
  const lists = Array.from({ length: WORLD_MAX }, () => [] as { type: number; subIndex: number }[]);
  lists[100] = [
    { type: 0, subIndex: 3 },
    { type: 5, subIndex: 1 },
  ];
  const objects = Array.from({ length: WORLD_MAX }, () => [] as { type: number; subIndex: number }[]);
  objects[7] = [{ type: 40, subIndex: 300 }];
  const heights = new Uint8Array(WORLD_MAX);
  heights[100] = 8;
  const rooms = new Uint8Array(WORLD_MAX);
  rooms[100] = 3;
  const layers = Object.fromEntries(LAYER_NAMES.map((n) => [n, emptyTileLayer()])) as unknown as MapDef['layers'];
  return {
    majorVersion: 5,
    minorVersion,
    flags:
      MapFlags.WORLD_LIGHTS |
      MapFlags.EXIT_GRIDS |
      MapFlags.DOOR_TABLE |
      MapFlags.EDGEPOINTS |
      MapFlags.NPC_SCHEDULES |
      MapFlags.AMBIENT_LIGHT_LEVEL,
    tilesetId: 9,
    heights,
    worldFlags: new Uint8Array(WORLD_MAX),
    layers: { ...layers, land: tileLayerFromLists(lists), objects: tileLayerFromLists(objects) },
    rooms,
    items: [],
    ambient: { basement: true, caves: false, lightLevel: 12 },
    lights: { colors: [[255, 200, 100]], sprites: [{ x: 10, y: 20, flags: 0x100, template: 'L-R04.LHT' }] },
    info: {
      northGridNo: 1,
      eastGridNo: 2,
      southGridNo: 3,
      westGridNo: -1,
      numIndividuals: 0,
      mapVersion: minorVersion,
      restrictedScrollId: 0,
      editorSmoothingType: 0,
      centerGridNo: 12880,
      isolatedGridNo: -1,
    },
    placements: [],
    exitGrids: [{ mapIndex: 5, gridNo: 6, sector: { x: 9, y: 1, z: 1 } }],
    doors: [{ gridNo: 333, locked: true, trapLevel: 2, trapId: 1, lockId: 4, lockDamage: 0 }],
    edgepoints: {
      primary: [0, 1, 2, 3].map((i) => ({ middle: i, gridNos: [i, i + 160] })),
      secondary: [0, 1, 2, 3].map(() => ({ middle: 0, gridNos: [] })),
    },
    schedules: [{ times: [1, 2, 3, 4], data1: [5, 6, 7, 8], data2: [9, 10, 11, 12], actions: [1, 2, 3, 4], flags: 7 }],
  };
}

describe('map .dat', () => {
  it('round-trips every section', () => {
    const map = sampleMap();
    const parsed = parseMap(writeMap(map));
    expect(parsed).toEqual({ ...map, trailingBytes: 0 });
    expect(tilesAt(parsed.layers.land, 100)).toEqual([
      { type: 0, subIndex: 3 },
      { type: 5, subIndex: 1 },
    ]);
    expect(tilesAt(parsed.layers.objects, 7)).toEqual([{ type: 40, subIndex: 300 }]);
  });

  it('uses one-byte object sub-indices before minor version 15 and ignores trailing bytes', () => {
    const old = sampleMap(14);
    const objects = Array.from({ length: WORLD_MAX }, () => [] as { type: number; subIndex: number }[]);
    objects[7] = [{ type: 40, subIndex: 200 }];
    const map = {
      ...old,
      layers: { ...old.layers, objects: tileLayerFromLists(objects) },
      edgepoints: { primary: old.edgepoints?.primary ?? [], secondary: null },
    };
    const bytes = writeMap(map);
    const parsed = parseMap(Uint8Array.from([...bytes, 1, 2, 3]));
    expect(tilesAt(parsed.layers.objects, 7)).toEqual([{ type: 40, subIndex: 200 }]);
    expect(parsed.trailingBytes).toBe(3);
  });

  it('rejects newer versions and mismatched map information', () => {
    expect(() => parseMap(writeMap({ ...sampleMap(), majorVersion: 7 }))).toThrow(FormatError);
    const map = sampleMap();
    expect(() => parseMap(writeMap({ ...map, info: { ...map.info, mapVersion: 24 } }))).toThrow(/does not match/);
  });
});
