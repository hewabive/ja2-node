// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-15. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Map_Information.cc UpdateOldVersionMap (its minor version 25 step)

import type { MapDef } from '../formats/map.ts';

export const MINOR_MAP_VERSION = 25;
const CAVES_LIGHT_LEVEL_OF_VERSION_25 = 13;

export function updateOldVersionMap<M extends Pick<MapDef, 'info' | 'ambient'>>(map: M): M {
  if (map.info.mapVersion >= MINOR_MAP_VERSION || !map.ambient?.caves) return map;
  return { ...map, ambient: { ...map.ambient, lightLevel: CAVES_LIGHT_LEVEL_OF_VERSION_25 } };
}
