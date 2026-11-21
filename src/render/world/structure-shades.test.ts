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
  it('lights every struct node of a tile alike, whatever its orientation, structure or type', () => {
    const corner = Orientation.INSIDE_LEFT | Orientation.INSIDE_RIGHT;
    expect(channelOf('FIRSTWALL', syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_LEFT))).toBe(ShadeChannel.STRUCT);
    expect(channelOf('FIRSTWALL', syntheticStructure(StructureFlags.WALLNWINDOW, Orientation.INSIDE_RIGHT))).toBe(ShadeChannel.STRUCT);
    expect(channelOf('FIRSTDOOR', syntheticStructure(StructureFlags.DOOR, Orientation.INSIDE_LEFT))).toBe(ShadeChannel.STRUCT);
    expect(channelOf('FIRSTWALL', syntheticStructure(StructureFlags.WALL, corner))).toBe(ShadeChannel.STRUCT);
    expect(channelOf('FIRSTOSTRUCT', syntheticStructure(StructureFlags.GENERIC))).toBe(ShadeChannel.STRUCT);
    expect(channelOf('FIRSTWALLDECAL')).toBe(ShadeChannel.STRUCT);
    expect(channelOf('FIRSTFLOOR')).toBe(ShadeChannel.STRUCT);
  });

  it('lights a door flagged only by the old hidden flag as any other struct node', () => {
    expect(channelOf('FIRSTOSTRUCT', syntheticStructure(StructureFlags.GARAGEDOOR, Orientation.OUTSIDE_LEFT))).toBe(ShadeChannel.STRUCT);
  });

  it('never lights a cliff hang in the struct layer', () => {
    expect(channelOf('FIRSTCLIFFHANG')).toBe(ShadeChannel.NATURAL);
    expect(channelOf('FIRSTCLIFFHANG', syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_LEFT))).toBe(ShadeChannel.NATURAL);
  });
});
