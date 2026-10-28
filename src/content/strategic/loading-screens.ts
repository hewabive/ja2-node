// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/externalized/LoadingScreenModel.cc PREDEFINED_SCREENS, LoadingScreenModel::deserialize, getScreenForSector;
// @src src/game/Loading_Screen.h LoadingScreenID.

import { FormatError } from '../binary/errors.ts';
import { asArray, asObject, asString } from './json-fields.ts';
import { parseSectorString, sectorId } from './sector-ids.ts';

export const LOADING_SCREENS_PATH = 'externalized/loading-screens.json';
export const LOADING_SCREENS_MAPPING_PATH = 'externalized/loading-screens-mapping.json';
export const LOADSCREENS_DIR = 'loadscreens';

export const LoadingScreen = {
  NOTHING: 0,
  DAYGENERIC: 1,
  DAYTOWN1: 2,
  DAYTOWN2: 3,
  DAYWILD: 4,
  DAYTROPICAL: 5,
  DAYFOREST: 6,
  DAYDESERT: 7,
  DAYPALACE: 8,
  NIGHTGENERIC: 9,
  NIGHTWILD: 10,
  NIGHTTOWN1: 11,
  NIGHTTOWN2: 12,
  NIGHTFOREST: 13,
  NIGHTTROPICAL: 14,
  NIGHTDESERT: 15,
  NIGHTPALACE: 16,
  HELI: 17,
  BASEMENT: 18,
  MINE: 19,
  CAVE: 20,
  DAYPINE: 21,
  NIGHTPINE: 22,
  DAYMILITARY: 23,
  NIGHTMILITARY: 24,
  DAYSAM: 25,
  NIGHTSAM: 26,
} as const;

const PREDEFINED_FILES: readonly (readonly [string, string])[] = [
  ['NOTHING', '/ls_heli.sti'],
  ['DAYGENERIC', '/ls_daygeneric.sti'],
  ['DAYTOWN1', '/ls_daytown1.sti'],
  ['DAYTOWN2', '/ls_daytown2.sti'],
  ['DAYWILD', '/ls_daywild.sti'],
  ['DAYTROPICAL', '/ls_daytropical.sti'],
  ['DAYFOREST', '/ls_dayforest.sti'],
  ['DAYDESERT', '/ls_daydesert.sti'],
  ['DAYPALACE', '/ls_daypalace.sti'],
  ['NIGHTGENERIC', '/ls_nightgeneric.sti'],
  ['NIGHTWILD', '/ls_nightwild.sti'],
  ['NIGHTTOWN1', '/ls_nighttown1.sti'],
  ['NIGHTTOWN2', '/ls_nighttown2.sti'],
  ['NIGHTFOREST', '/ls_nightforest.sti'],
  ['NIGHTTROPICAL', '/ls_nighttropical.sti'],
  ['NIGHTDESERT', '/ls_nightdesert.sti'],
  ['NIGHTPALACE', '/ls_nightpalace.sti'],
  ['HELI', '/ls_heli.sti'],
  ['BASEMENT', '/ls_basement.sti'],
  ['MINE', '/ls_mine.sti'],
  ['CAVE', '/ls_cave.sti'],
  ['DAYPINE', '/ls_daypine.sti'],
  ['NIGHTPINE', '/ls_nightpine.sti'],
  ['DAYMILITARY', '/ls_daymilitary.sti'],
  ['NIGHTMILITARY', '/ls_nightmilitary.sti'],
  ['DAYSAM', '/ls_daysam.sti'],
  ['NIGHTSAM', '/ls_nightsam.sti'],
];

export interface LoadingScreenEntry {
  readonly index: number;
  readonly name: string;
  readonly path: string;
}

export interface LoadingScreenTable {
  readonly screens: readonly LoadingScreenEntry[];
  screenForSector(sector: number, level: number, night: boolean): number | null;
}

interface SectorScreens {
  readonly day: number;
  readonly night: number;
}

function entry(index: number, name: string, file: string): LoadingScreenEntry {
  return { index, name, path: `${LOADSCREENS_DIR}${file}`.toLowerCase() };
}

export function parseLoadingScreens(list: unknown, mapping: unknown): LoadingScreenTable {
  const screens = PREDEFINED_FILES.map(([name, file], index) => entry(index, name, file));
  asArray(list, 'loading screens').forEach((item, i) => {
    const o = asObject(item, `loading screens[${i}]`);
    screens.push(entry(screens.length, asString(o.internalName, 'internalName'), asString(o.filename, 'filename')));
  });
  const byName = new Map(screens.map((s) => [s.name, s.index]));
  const indexOf = (name: string): number => {
    const index = byName.get(name);
    if (index === undefined) throw new FormatError(`unknown loading screen ${name}`);
    return index;
  };
  const bySector = new Map<string, SectorScreens>();
  asArray(mapping, 'loading screen mapping').forEach((item, i) => {
    const o = asObject(item, `loading screen mapping[${i}]`);
    const level = typeof o.sectorLevel === 'number' ? o.sectorLevel : 0;
    const id = sectorId(parseSectorString(asString(o.sector, 'sector')));
    const key = `${id}/${level}`;
    if (!bySector.has(key)) bySector.set(key, { day: indexOf(asString(o.day, 'day')), night: indexOf(asString(o.night, 'night')) });
  });
  return {
    screens,
    screenForSector: (sector, level, night) => {
      const found = bySector.get(`${sector}/${level}`);
      if (!found) return null;
      return night ? found.night : found.day;
    },
  };
}
