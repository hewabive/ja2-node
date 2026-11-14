import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Orientation } from '../../content/formats/jsd.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { syntheticStructure } from '../../content/world/synthetic.ts';
import type { TileElement } from '../../content/world/tile-database.ts';
import { parseTileTables, typeIndex } from '../../content/world/tile-tables.ts';
import { ShadeChannel } from './instances.ts';
import { structureShadeChannels } from './structure-shades.ts';

const tables = parseTileTables(JSON.parse(readFileSync(join(import.meta.dirname, '../../../data/tables/tiles.json'), 'utf8')));

function channelOf(type: string, structure: TileElement['structure'] = null): number {
  const te = { index: 0, type: typeIndex(tables, type), structure } as unknown as TileElement;
  return structureShadeChannels([te], tables)[0] as number;
}

describe('the light a struct node takes (LightAddTile)', () => {
  it('lights a wall, a window or a door by its structure orientation, a corner piece by both and one without orientation through windows only', () => {
    expect(channelOf('FIRSTWALL', syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_LEFT))).toBe(ShadeChannel.LEFT_WALL);
    expect(channelOf('FIRSTWALL', syntheticStructure(StructureFlags.WALLNWINDOW, Orientation.INSIDE_RIGHT))).toBe(ShadeChannel.RIGHT_WALL);
    expect(channelOf('FIRSTDOOR', syntheticStructure(StructureFlags.DOOR, Orientation.INSIDE_LEFT))).toBe(ShadeChannel.LEFT_WALL);
    const corner = Orientation.INSIDE_LEFT | Orientation.INSIDE_RIGHT;
    expect(channelOf('FIRSTWALL', syntheticStructure(StructureFlags.WALL, corner))).toBe(ShadeChannel.CORNER_WALL);
    expect(channelOf('FIRSTWALL', syntheticStructure(StructureFlags.WALL))).toBe(ShadeChannel.BARE_WALL);
  });

  it("takes the base tile's orientation, which a multi-tile wall keeps only on a base tile", () => {
    const offBase = syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_LEFT, { tiles: [[1, 0]] });
    expect(channelOf('FIRSTWALL', offBase)).toBe(ShadeChannel.BARE_WALL);
  });

  it('lights any other structure as the ground, a door flagged only by the old hidden flag among them', () => {
    expect(channelOf('FIRSTOSTRUCT', syntheticStructure(StructureFlags.GENERIC))).toBe(ShadeChannel.LAND);
    expect(channelOf('FIRSTOSTRUCT', syntheticStructure(StructureFlags.GARAGEDOOR, Orientation.OUTSIDE_LEFT))).toBe(ShadeChannel.LAND);
    expect(channelOf('FIRSTOSTRUCT')).toBe(ShadeChannel.LAND);
  });

  it('lights a node without structure data as a wall decal when its type lies between the first and the eighth wall decal, floors and debris among them', () => {
    expect(channelOf('FIRSTWALLDECAL')).toBe(ShadeChannel.DECAL);
    expect(channelOf('EIGTHWALLDECAL')).toBe(ShadeChannel.DECAL);
    expect(channelOf('FIRSTFLOOR')).toBe(ShadeChannel.DECAL);
    expect(channelOf('DEBRISROCKS')).toBe(ShadeChannel.DECAL);
    expect(channelOf('HUMANBLOOD')).toBe(ShadeChannel.LAND);
    expect(channelOf('FIRSTWALLDECAL', syntheticStructure(StructureFlags.GENERIC))).toBe(ShadeChannel.LAND);
  });

  it('never lights a cliff hang in the struct layer', () => {
    expect(channelOf('FIRSTCLIFFHANG')).toBe(ShadeChannel.NATURAL);
    expect(channelOf('FIRSTCLIFFHANG', syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_LEFT))).toBe(ShadeChannel.NATURAL);
  });
});
