import { type TilesetDatabase, tileSurfaceSource } from '../formats/ja2set.ts';
import { parseStructureFile } from '../formats/jsd.ts';
import { decodeSti, type StiIndexed } from '../formats/sti.ts';
import type { TileSurface } from './tile-database.ts';
import type { TileTables } from './tile-tables.ts';

export type ReadFile = (path: string) => Promise<Uint8Array | null>;

export interface LoadedTileSurface extends TileSurface {
  readonly sti: StiIndexed;
}

function structurePath(stiPath: string): string {
  return stiPath.replace(/\.sti$/i, '.jsd');
}

export async function loadTileSurfaces(
  read: ReadFile,
  tables: TileTables,
  tilesets: TilesetDatabase,
  tilesetId: number,
): Promise<(LoadedTileSurface | null)[]> {
  return Promise.all(
    tables.types.map(async (t): Promise<LoadedTileSurface | null> => {
      const source = tileSurfaceSource(tilesets, tilesetId, t.index);
      if (!source) return null;
      const bytes = await read(source.path);
      if (!bytes) return null;
      const sti = decodeSti(bytes);
      if (sti.kind !== 'indexed') return null;
      const jsd = await read(structurePath(source.path));
      const structures = jsd ? parseStructureFile(jsd) : null;
      const auxData = structures?.auxData ?? sti.appData;
      return {
        type: t.index,
        path: source.path,
        frames: sti.subImages.map((s) => ({ offsetX: s.offsetX, offsetY: s.offsetY, width: s.width })),
        auxData: auxData && auxData.length === sti.subImages.length ? auxData : null,
        structures,
        sti,
      };
    }),
  );
}
