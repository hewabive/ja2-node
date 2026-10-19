import { type TilesetDatabase, tileSurfaceSource } from '../formats/ja2set.ts';
import { parseStructureFile } from '../formats/jsd.ts';
import { decodeSti, type StiAppData } from '../formats/sti.ts';
import { pictureFromSti } from '../picture/from-sti.ts';
import type { IndexedPicture } from '../picture/picture.ts';
import { parseStubSpriteManifest, pictureFromStubSprite, STUB_SPRITE_SUFFIX } from '../picture/stub-sprite.ts';
import { readGraphicFacts, stiFrameGeometry } from '../rules/graphic-facts.ts';
import type { TileSurface } from './tile-database.ts';
import type { TileTables } from './tile-tables.ts';
import type { FrameGeometry } from './zstrip.ts';

export type ReadFile = (path: string) => Promise<Uint8Array | null>;

export interface LoadedTileSurface extends TileSurface {
  readonly picture: IndexedPicture;
}

interface DecodedSurface {
  readonly frames: readonly FrameGeometry[];
  readonly picture: IndexedPicture | null;
  readonly appData: readonly StiAppData[] | null;
}

type SurfaceDecoder = (read: ReadFile, path: string) => Promise<DecodedSurface | null>;

async function decodeSurfacePicture(read: ReadFile, path: string): Promise<DecodedSurface | null> {
  const bytes = await read(path);
  if (!bytes) return null;
  if (path.endsWith(STUB_SPRITE_SUFFIX)) {
    const manifest = parseStubSpriteManifest(JSON.parse(new TextDecoder().decode(bytes)));
    const frames = manifest.frames.map((f) => ({ offsetX: f.ox, offsetY: f.oy, width: f.w }));
    const png = await read(path.replace(/[^/]+$/, manifest.image));
    return png ? { frames, picture: pictureFromStubSprite(manifest, png), appData: null } : null;
  }
  const sti = decodeSti(bytes, true);
  if (sti.kind !== 'indexed') return null;
  const frames = sti.subImages.map((f) => ({ offsetX: f.offsetX, offsetY: f.offsetY, width: f.width }));
  const picture = pictureFromSti(sti);
  return picture.kind === 'indexed' ? { frames, picture, appData: sti.appData } : null;
}

async function decodeSurfaceGeometry(read: ReadFile, path: string): Promise<DecodedSurface | null> {
  const facts = await readGraphicFacts(read, path);
  const geometry = facts ? stiFrameGeometry(facts) : null;
  return geometry ? { ...geometry, picture: null } : null;
}

function structurePathFor(path: string): string {
  return path.endsWith(STUB_SPRITE_SUFFIX) ? `${path.slice(0, -STUB_SPRITE_SUFFIX.length)}.jsd` : path.replace(/\.sti$/, '.jsd');
}

async function loadSurfaces(
  read: ReadFile,
  tables: TileTables,
  tilesets: TilesetDatabase,
  tilesetId: number,
  root: string,
  decode: SurfaceDecoder,
): Promise<((TileSurface & { picture: IndexedPicture | null }) | null)[]> {
  return Promise.all(
    tables.types.map(async (t) => {
      const source = tileSurfaceSource(tilesets, tilesetId, t.index);
      if (!source) return null;
      const path = root + source.path;
      const decoded = await decode(read, path);
      if (!decoded) return null;
      const jsd = await read(structurePathFor(path));
      const structures = jsd ? parseStructureFile(jsd) : null;
      const auxData = structures?.auxData ?? decoded.appData;
      return {
        type: t.index,
        path,
        frames: decoded.frames,
        auxData: auxData && auxData.length === decoded.frames.length ? auxData : null,
        structures,
        picture: decoded.picture,
      };
    }),
  );
}

export async function loadTileSurfaces(
  read: ReadFile,
  tables: TileTables,
  tilesets: TilesetDatabase,
  tilesetId: number,
  root = '',
): Promise<(LoadedTileSurface | null)[]> {
  const surfaces = await loadSurfaces(read, tables, tilesets, tilesetId, root, decodeSurfacePicture);
  return surfaces.map((s) => (s?.picture ? { ...s, picture: s.picture } : null));
}

export async function loadTileSurfaceGeometry(
  read: ReadFile,
  tables: TileTables,
  tilesets: TilesetDatabase,
  tilesetId: number,
  root = '',
): Promise<(TileSurface | null)[]> {
  return loadSurfaces(read, tables, tilesets, tilesetId, root, decodeSurfaceGeometry);
}
