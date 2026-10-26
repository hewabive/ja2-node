import { ITEM_TABLE_PATHS } from '../../content/items/items.ts';
import { type TileTables, tileIndexFromTypeSubIndex } from '../../content/world/tile-tables.ts';
import { fetchVfsFile, type ReadVfsFile } from '../net/vfs.ts';

const GRAPHIC_TABLES = [
  ITEM_TABLE_PATHS.items,
  ITEM_TABLE_PATHS.weapons,
  ITEM_TABLE_PATHS.magazines,
  ITEM_TABLE_PATHS.armours,
  ITEM_TABLE_PATHS.explosives,
];

interface ItemGraphicRecord {
  readonly internalName?: unknown;
  readonly tileGraphic?: { readonly type?: unknown; readonly subIndex?: unknown };
}

export type ItemTileLookup = (item: string) => number | null;

export type ItemGraphicTables = readonly unknown[];

export function readItemGraphicTables(read: ReadVfsFile = fetchVfsFile): Promise<ItemGraphicTables> {
  return Promise.all(GRAPHIC_TABLES.map(async (path) => JSON.parse(new TextDecoder().decode(await read(path))) as unknown));
}

export async function loadItemTiles(tables: TileTables, read: ReadVfsFile = fetchVfsFile): Promise<ItemTileLookup> {
  return itemTileLookup(tables, await readItemGraphicTables(read));
}

export function itemTileLookup(tables: TileTables, lists: ItemGraphicTables): ItemTileLookup {
  const byName = new Map<string, number>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const record of list as ItemGraphicRecord[]) {
      const name = record.internalName;
      const graphic = record.tileGraphic;
      if (typeof name !== 'string' || typeof graphic?.type !== 'string' || typeof graphic.subIndex !== 'number') continue;
      const type = tables.typeIndexByName.get(graphic.type);
      if (type === undefined) continue;
      byName.set(name, tileIndexFromTypeSubIndex(tables, type, graphic.subIndex));
    }
  }
  return (item) => byName.get(item) ?? null;
}
