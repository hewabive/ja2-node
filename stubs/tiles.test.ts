import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Orientation, parseStructureFile, writeStructureFile } from '../src/content/formats/jsd.ts';
import { asArray, asInt, asObject, asString } from '../src/content/strategic/json-fields.ts';
import { parseJsonc } from '../src/content/strategic/jsonc.ts';
import { StructureFlags } from '../src/content/world/structures.ts';
import { buildTileDatabase, TileFlags, type TileSurface } from '../src/content/world/tile-database.ts';
import { parseTileTables, TILE_TABLES_PATH, tileIndexFromTypeSubIndex, typeIndex } from '../src/content/world/tile-tables.ts';
import { PROJECT_DATA_DIR } from '../src/node/repo.ts';
import { STUB_ITEM_TILE_COUNTS, STUB_TILE_SURFACES, StubMaterial } from './tiles.ts';

const ITEM_FILES = ['items.json', 'weapons.json', 'magazines.json', 'armours.json', 'explosives.json'];

async function tables() {
  return parseTileTables(JSON.parse(await readFile(join(PROJECT_DATA_DIR, TILE_TABLES_PATH), 'utf8')));
}

function surface(type: string) {
  const s = STUB_TILE_SURFACES.find((x) => x.type === type);
  if (!s) throw new Error(`no stub surface for ${type}`);
  return s;
}

function flagsOf(type: string): number[] {
  return (surface(type).structures ?? []).map((d) => d.flags);
}

async function itemTileGraphics(): Promise<{ type: string; subIndex: number; item: string }[]> {
  const found: { type: string; subIndex: number; item: string }[] = [];
  for (const file of ITEM_FILES) {
    const list = asArray(parseJsonc(await readFile(join(PROJECT_DATA_DIR, 'externalized', file), 'utf8')), file);
    list.forEach((entry, i) => {
      const o = asObject(entry, `${file}[${i}]`);
      if (o.tileGraphic === undefined) return;
      const g = asObject(o.tileGraphic, `${file}[${i}].tileGraphic`);
      found.push({
        type: asString(g.type, `${file}[${i}].tileGraphic.type`),
        subIndex: asInt(g.subIndex, `${file}[${i}].tileGraphic.subIndex`),
        item: `${file}[${i}]`,
      });
    });
  }
  return found;
}

describe('stub tile families', () => {
  it('give the stone wall the end pieces ReplaceWall puts beside a destroyed wall, sub-indices 48 to 55', () => {
    const ends = (surface('SECONDWALL').structures ?? []).filter((d) => d.number >= 47);
    expect(ends.map((d) => [d.number + 1, d.flags, d.wallOrientation])).toEqual(
      [
        Orientation.OUTSIDE_LEFT,
        Orientation.OUTSIDE_LEFT,
        Orientation.OUTSIDE_RIGHT,
        Orientation.OUTSIDE_RIGHT,
        Orientation.INSIDE_LEFT,
        Orientation.INSIDE_LEFT,
        Orientation.INSIDE_RIGHT,
        Orientation.INSIDE_RIGHT,
      ].map((orientation, k) => [48 + k, StructureFlags.WALL, orientation]),
    );
    expect(surface('SECONDWALL').sprite.frames).toHaveLength(55);
  });

  it('fill each tile type with at most as many frames as the type has and a structure per used frame, in frame order', async () => {
    const t = await tables();
    for (const s of STUB_TILE_SURFACES) {
      const count = t.types[typeIndex(t, s.type)]?.count ?? 0;
      expect(s.sprite.frames.length, s.type).toBeGreaterThan(0);
      expect(s.sprite.frames.length, s.type).toBeLessThanOrEqual(count);
      if (!s.structures) continue;
      const numbers = s.structures.map((d) => d.number);
      expect(numbers, s.type).toEqual([...numbers].sort((a, b) => a - b));
      expect(new Set(numbers).size, s.type).toBe(numbers.length);
      expect(Math.max(...numbers), s.type).toBeLessThan(s.sprite.frames.length);
      const file = parseStructureFile(writeStructureFile({ structureCount: s.sprite.frames.length, structures: s.structures }));
      expect(
        numbers.map((n) => file.structures[n]).map((d) => [d?.flags, d?.wallOrientation, d?.armour, d?.partnerDelta, d?.density]),
      ).toEqual(s.structures.map((d) => [d.flags, d.wallOrientation, d.armour, d.partnerDelta, d.density]));
    }
  });

  it('pair every window and wire fence with its broken partner', () => {
    const W = StructureFlags.WALLNWINDOW;
    const O = StructureFlags.OPEN;
    expect(flagsOf('SECONDWALL').slice(0, 6)).toEqual([StructureFlags.WALL, StructureFlags.WALL, W, W | O, W, W | O]);
    expect(surface('SECONDWALL').structures?.map((d) => d.partnerDelta)).toEqual([0, 0, 1, 0, 1, 0, ...Array(8).fill(0)]);
    const wire = StructureFlags.WIREFENCE | StructureFlags.TRANSPARENT;
    const cut = wire | O | StructureFlags.PASSABLE;
    expect(flagsOf('FENCESTRUCT')).toEqual([StructureFlags.FENCE, StructureFlags.FENCE, wire, cut, wire, cut]);
    expect(surface('FENCESTRUCT').structures?.map((d) => d.wallOrientation)).toEqual([
      Orientation.OUTSIDE_LEFT,
      Orientation.OUTSIDE_RIGHT,
      Orientation.OUTSIDE_LEFT,
      Orientation.OUTSIDE_LEFT,
      Orientation.OUTSIDE_RIGHT,
      Orientation.OUTSIDE_RIGHT,
    ]);
  });

  it('make sandbags, roofs and the cliff from the materials and flags the mechanics read', () => {
    expect(surface('SECONDOSTRUCT').structures?.map((d) => d.armour)).toEqual([StubMaterial.SANDBAG, StubMaterial.SANDBAG]);
    expect(flagsOf('SECONDROOF')).toEqual([StructureFlags.NORMAL_ROOF]);
    expect(flagsOf('FIRSTSLANTROOF')).toEqual([StructureFlags.SLANTED_ROOF]);
    expect(flagsOf('FIRSTHIGHROOF')).toEqual([StructureFlags.TALL_ROOF]);
    expect(flagsOf('FIRSTCLIFF')).toEqual([StructureFlags.GENERIC]);
    expect(surface('FIRSTCLIFF').structures?.[0]?.armour).toBe(StubMaterial.INDESTRUCTABLE_STONE);
    for (const type of ['FIRSTCLIFFHANG', 'DEBRISROCKS', 'HUMANBLOOD', 'CREATUREBLOOD', 'GUNS', 'P1ITEMS', 'P2ITEMS', 'P3ITEMS'])
      expect(surface(type).structures, type).toBeUndefined();
  });

  it('draw the roof marker FIRSTPOINTERS11 and leave the pointer tiles before it undrawn', () => {
    const frames = surface('FIRSTPOINTERS').sprite.frames;
    expect(frames.map((f) => f.raster.pixels.some((p) => p !== 0))).toEqual([...Array(10).fill(false), true]);
    expect(frames.slice(0, 10).every((f) => f.raster.width === 0 && f.raster.height === 0)).toBe(true);
  });

  it('draw every blood pool graphic, four sizes in four variants', async () => {
    const t = await tables();
    for (const type of ['HUMANBLOOD', 'CREATUREBLOOD'])
      expect(surface(type).sprite.frames, type).toHaveLength(t.types[typeIndex(t, type)]?.count ?? 0);
  });

  it('draw a ground tile for every item graphic the item tables name', async () => {
    const t = await tables();
    for (const [type, count] of Object.entries(STUB_ITEM_TILE_COUNTS)) {
      expect(t.types[typeIndex(t, type)]?.count, type).toBe(count);
      expect(surface(type).sprite.frames, type).toHaveLength(count);
    }
    const surfaces: (TileSurface | null)[] = t.types.map(() => null);
    for (const s of STUB_TILE_SURFACES) {
      const type = typeIndex(t, s.type);
      surfaces[type] = {
        type,
        path: s.sprite.path,
        frames: s.sprite.frames.map((f) => ({ offsetX: f.ox, offsetY: f.oy, width: f.raster.width })),
        auxData: null,
        structures: null,
      };
    }
    const db = buildTileDatabase(t, surfaces);
    const graphics = await itemTileGraphics();
    expect(graphics.length).toBeGreaterThan(300);
    for (const g of graphics) {
      const te = db[tileIndexFromTypeSubIndex(t, typeIndex(t, g.type), g.subIndex)];
      expect((te?.flags ?? TileFlags.UNDERFLOW_FILLER) & TileFlags.UNDERFLOW_FILLER, g.item).toBe(0);
      expect(te?.surfacePath, g.item).toBe(surface(g.type).sprite.path);
    }
  });
});
