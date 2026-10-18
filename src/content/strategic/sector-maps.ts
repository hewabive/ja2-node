import type { ExitGrid, MapDef } from '../formats/map.ts';
import { SAME_SECTOR } from '../formats/stub-map.ts';
import { mapFileName, parseSectorString, type Sector } from './sector-ids.ts';

export const ORIGINAL_MAPS_DIR = 'maps/';
export const STUB_MAPS_DIR = 'stubs/world/maps/';
export const STUB_FALLBACK_MAP = `${STUB_MAPS_DIR}wilderness.dat`;

const SECTOR_MAP_FILE = /(?:^|\/)([a-p]\d{1,2})(?:_b(\d))?(?:_a)?\.dat$/i;

export function sectorMapPath(exists: (path: string) => boolean, s: Sector, alternate: boolean): string {
  const file = mapFileName(s, alternate).toLowerCase();
  for (const path of [`${ORIGINAL_MAPS_DIR}${file}`, `${STUB_MAPS_DIR}${file}`]) if (exists(path)) return path;
  return STUB_FALLBACK_MAP;
}

export function sectorOfMapPath(path: string): Sector | null {
  const m = SECTOR_MAP_FILE.exec(path);
  if (!m) return null;
  return parseSectorString(m[1] ?? '', Number(m[2] ?? 0));
}

function leadsToSameSector(e: ExitGrid): boolean {
  return e.sector.x === SAME_SECTOR.x && e.sector.y === SAME_SECTOR.y;
}

export function withSectorExitGrids(map: MapDef, mapPath: string): MapDef {
  const sector = sectorOfMapPath(mapPath);
  if (!sector || !map.exitGrids.some(leadsToSameSector)) return map;
  const exitGrids = map.exitGrids.map((e) => (leadsToSameSector(e) ? { ...e, sector: { x: sector.x, y: sector.y, z: e.sector.z } } : e));
  return { ...map, exitGrids };
}
