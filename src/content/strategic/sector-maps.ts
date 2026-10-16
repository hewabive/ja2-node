import { mapFileName, type Sector } from './sector-ids.ts';

export const ORIGINAL_MAPS_DIR = 'maps/';
export const STUB_MAPS_DIR = 'stubs/world/maps/';
export const STUB_FALLBACK_MAP = `${STUB_MAPS_DIR}wilderness.dat`;

export function sectorMapPath(exists: (path: string) => boolean, s: Sector, alternate: boolean): string {
  const file = mapFileName(s, alternate).toLowerCase();
  for (const path of [`${ORIGINAL_MAPS_DIR}${file}`, `${STUB_MAPS_DIR}${file}`]) if (exists(path)) return path;
  return STUB_FALLBACK_MAP;
}
