// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Loading_Screen.cc GetLoadScreenID (the Random(2) of town sectors on the gameplay generator);
// @src Strategic/Game_Clock.cc NightTime; Strategic/Campaign_Types.h the traversability values. See docs/28 §4.10, §12.5.

import { LoadingScreen } from '../../../content/strategic/loading-screens.ts';
import { StrategicMove } from '../../../content/strategic/map-tables.ts';
import { type Sector, sectorId } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContext } from '../forces/ports.ts';
import { worldHour } from '../time/world-clock.ts';
import { isThisSectorASamSector } from './control.ts';
import { sectorInfo } from './sectors.ts';

const NIGHT_ENDS_HOUR = 7;
const NIGHT_STARTS_HOUR = 21;
const TOWN_PICTURES = 2;

const Terrain = {
  TOWN: 0,
  ROAD: 1,
  PLAINS: 2,
  SAND: 3,
  SPARSE: 4,
  DENSE: 5,
  SWAMP: 6,
  WATER: 7,
  HILLS: 8,
  NS_RIVER: 10,
  EW_RIVER: 11,
  TROPICS: 13,
  FARMLAND: 14,
  PLAINS_ROAD: 15,
  SPARSE_ROAD: 16,
  FARMLAND_ROAD: 17,
  TROPICS_ROAD: 18,
  DENSE_ROAD: 19,
  COASTAL: 20,
  HILLS_ROAD: 21,
  COASTAL_ROAD: 22,
  SAND_ROAD: 23,
  SWAMP_ROAD: 24,
} as const;

const DESERT: ReadonlySet<number> = new Set([Terrain.SAND, Terrain.SAND_ROAD]);
const GENERIC: ReadonlySet<number> = new Set([Terrain.FARMLAND, Terrain.FARMLAND_ROAD, Terrain.ROAD]);
const WILD: ReadonlySet<number> = new Set([
  Terrain.PLAINS,
  Terrain.SPARSE,
  Terrain.HILLS,
  Terrain.PLAINS_ROAD,
  Terrain.SPARSE_ROAD,
  Terrain.HILLS_ROAD,
]);
const FOREST: ReadonlySet<number> = new Set([Terrain.DENSE, Terrain.SWAMP, Terrain.SWAMP_ROAD, Terrain.DENSE_ROAD]);
const TROPICAL: ReadonlySet<number> = new Set([
  Terrain.TROPICS,
  Terrain.TROPICS_ROAD,
  Terrain.WATER,
  Terrain.NS_RIVER,
  Terrain.EW_RIVER,
  Terrain.COASTAL,
  Terrain.COASTAL_ROAD,
]);

export interface RandomDraw {
  int(n: number): number;
}

export function nightTime(ctx: StrategicContext): boolean {
  const hour = worldHour(ctx.state.clock);
  return hour < NIGHT_ENDS_HOUR || hour >= NIGHT_STARTS_HOUR;
}

function surfaceScreen(ctx: StrategicContext, s: Sector, night: boolean, random: RandomDraw): number {
  if (isThisSectorASamSector(ctx, s)) return night ? LoadingScreen.NIGHTSAM : LoadingScreen.DAYSAM;
  const terrain = sectorInfo(ctx.state.map, s).traversability[StrategicMove.THROUGH] ?? Terrain.ROAD;
  if (terrain === Terrain.TOWN) {
    const first = random.int(TOWN_PICTURES) === 0;
    if (night) return first ? LoadingScreen.NIGHTTOWN1 : LoadingScreen.NIGHTTOWN2;
    return first ? LoadingScreen.DAYTOWN1 : LoadingScreen.DAYTOWN2;
  }
  if (DESERT.has(terrain)) return night ? LoadingScreen.NIGHTDESERT : LoadingScreen.DAYDESERT;
  if (WILD.has(terrain)) return night ? LoadingScreen.NIGHTWILD : LoadingScreen.DAYWILD;
  if (FOREST.has(terrain)) return night ? LoadingScreen.NIGHTFOREST : LoadingScreen.DAYFOREST;
  if (TROPICAL.has(terrain)) return night ? LoadingScreen.NIGHTTROPICAL : LoadingScreen.DAYTROPICAL;
  if (GENERIC.has(terrain)) return night ? LoadingScreen.NIGHTGENERIC : LoadingScreen.DAYGENERIC;
  return night ? LoadingScreen.NIGHTGENERIC : LoadingScreen.DAYGENERIC;
}

export function loadScreenId(ctx: StrategicContext, s: Sector, random: RandomDraw): number {
  const night = nightTime(ctx);
  if (ctx.state.didGameJustStart) return LoadingScreen.HELI;
  const mapped = ctx.content.loadingScreens.screenForSector(sectorId(s), s.z, night);
  if (mapped !== null) return mapped;
  switch (s.z) {
    case 0:
      return surfaceScreen(ctx, s, night, random);
    case 1:
      return LoadingScreen.MINE;
    case 2:
    case 3:
      return LoadingScreen.CAVE;
    default:
      return night ? LoadingScreen.NIGHTGENERIC : LoadingScreen.DAYGENERIC;
  }
}
