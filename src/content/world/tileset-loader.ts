import { type TilesetDatabase, tileSurfaceSource } from '../formats/ja2set.ts';
import { parseStructureFile } from '../formats/jsd.ts';
import { decodeSti, type StiAppData } from '../formats/sti.ts';
import { pictureFromSti } from '../picture/from-sti.ts';
import type { IndexedPicture } from '../picture/picture.ts';
import { parseStubSpriteManifest, pictureFromStubSprite, STUB_SPRITE_SUFFIX } from '../picture/stub-sprite.ts';
import type { TileSurface } from './tile-database.ts';
import type { TileTables } from './tile-tables.ts';

export type ReadFile = (path: string) => Promise<Uint8Array | null>;

export interface LoadedTileSurface extends TileSurface {
  readonly picture: IndexedPicture;
}

interface DecodedSurface {
  readonly picture: IndexedPicture;
  readonly appData: readonly StiAppData[] | null;
}

async function decodeSurface(read: ReadFile, path: string): Promise<DecodedSurface | null> {
  const bytes = await read(path);
  if (!bytes) return null;
  if (path.endsWith(STUB_SPRITE_SUFFIX)) {
    const manifest = parseStubSpriteManifest(JSON.parse(new TextDecoder().decode(bytes)));
    const png = await read(path.replace(/[^/]+$/, manifest.image));
    return png ? { picture: pictureFromStubSprite(manifest, png), appData: null } : null;
  }
  const sti = decodeSti(bytes);
  if (sti.kind !== 'indexed') return null;
  const picture = pictureFromSti(sti);
  return picture.kind === 'indexed' ? { picture, appData: sti.appData } : null;
}

export async function loadTileSurfaces(
  read: ReadFile,
  tables: TileTables,
  tilesets: TilesetDatabase,
  tilesetId: number,
  root = '',
): Promise<(LoadedTileSurface | null)[]> {
  return Promise.all(
    tables.types.map(async (t): Promise<LoadedTileSurface | null> => {
      const source = tileSurfaceSource(tilesets, tilesetId, t.index);
      if (!source) return null;
      const path = root + source.path;
      const decoded = await decodeSurface(read, path);
      if (!decoded) return null;
      const jsd = path.endsWith('.sti') ? await read(path.replace(/\.sti$/, '.jsd')) : null;
      const structures = jsd ? parseStructureFile(jsd) : null;
      const frames = decoded.picture.frames;
      const auxData = structures?.auxData ?? decoded.appData;
      return {
        type: t.index,
        path,
        frames: frames.map((f) => ({ offsetX: f.offsetX, offsetY: f.offsetY, width: f.width })),
        auxData: auxData && auxData.length === frames.length ? auxData : null,
        structures,
        picture: decoded.picture,
      };
    }),
  );
}
