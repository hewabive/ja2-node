// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/MapScreen.cc GetPathTravelTimeDuringPlotting, GetGroundTravelTimeOfSoldier;
// @src Map_Screen_Interface_Map.cc PlotATemporaryPathForCharacter, PlotATemporaryPathForHelicopter,
// @src DisplayDistancesForHelicopter; Map_Screen_Helicopter.cc DistanceOfIntendedHelicopterPath, GetNumSafeSectorsInPath,
// @src GetNumUnSafeSectorsInPath, GetLastSectorOfHelicoptersPath. See docs/28 §7.6, §7.7.

import { type Sector, sectorFromStrategicIndex, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { i32 } from '../../../core/int.ts';
import type { Group, VehicleRecord } from '../forces/groups.ts';
import { groupBetweenSectorsAndSectorXYIsInDifferentDirection } from '../forces/movement.ts';
import type { StrategicContext } from '../forces/ports.ts';
import { worldTotalMinutes } from '../time/world-clock.ts';
import { findTravelTimeBetweenWaypoints } from './travel.ts';

const HELICOPTER_CANNOT_FLY_DISTANCE = 9999;

export function pathTravelTimeDuringPlotting(ctx: StrategicContext, path: readonly number[] | null, g: Group): number {
  if (!path || path.length === 0) return 0;
  let time = 0;
  let skipFirstNode = false;
  if (g.betweenSectors) {
    time = g.arrivalTime - worldTotalMinutes(ctx.state.clock);
    skipFirstNode = true;
  }
  for (let k = 0; k + 1 < path.length; k++) {
    if (skipFirstNode) {
      skipFirstNode = false;
      continue;
    }
    const from = sectorFromStrategicIndex(path[k] ?? 0);
    const to = sectorFromStrategicIndex(path[k + 1] ?? 0);
    time = i32(time + findTravelTimeBetweenWaypoints(ctx, from, to, g));
  }
  return time;
}

export function plottingEtaMinutes(ctx: StrategicContext, temp: readonly number[] | null, mercPath: readonly number[], g: Group): number {
  return i32(pathTravelTimeDuringPlotting(ctx, temp, g) + pathTravelTimeDuringPlotting(ctx, mercPath, g));
}

export function edgeTravelMinutes(ctx: StrategicContext, path: readonly number[], g: Group): number[] {
  const minutes: number[] = [];
  for (let k = 0; k + 1 < path.length; k++) {
    const from = sectorFromStrategicIndex(path[k] ?? 0);
    const to = sectorFromStrategicIndex(path[k + 1] ?? 0);
    minutes.push(findTravelTimeBetweenWaypoints(ctx, from, to, g));
  }
  return minutes;
}

export interface HelicopterPathFigures {
  readonly distance: number;
  readonly safe: number;
  readonly unsafe: number;
}

function edges(path: readonly number[] | null): number {
  return path && path.length > 0 ? path.length - 1 : 0;
}

function skipsCurrentSector(path: readonly number[], heliSector: Sector, g: Group | undefined): boolean {
  const second = path[1];
  if (path[0] !== strategicIndex(heliSector) || second === undefined) return false;
  return !g || !groupBetweenSectorsAndSectorXYIsInDifferentDirection(g, sectorFromStrategicIndex(second));
}

function countAirspace(ctx: StrategicContext, nodes: readonly number[]): { safe: number; unsafe: number } {
  let safe = 0;
  let unsafe = 0;
  for (const index of nodes) {
    if (ctx.state.map.elements[index]?.enemyAirControlled) unsafe++;
    else safe++;
  }
  return { safe, unsafe };
}

export function helicopterPathFigures(
  ctx: StrategicContext,
  canFly: boolean,
  v: VehicleRecord,
  g: Group | undefined,
  mercPath: readonly number[],
  temp: readonly number[] | null,
): HelicopterPathFigures {
  if (!canFly) return { distance: HELICOPTER_CANNOT_FLY_DISTANCE, safe: 0, unsafe: 0 };
  const distance = edges(mercPath) + edges(temp);
  let merc: readonly number[] = mercPath;
  if (merc.length > 0 && skipsCurrentSector(merc, v.sector, g)) merc = merc.slice(1);
  let tail: readonly number[] = temp ?? [];
  if (tail.length > 0 && (skipsCurrentSector(tail, v.sector, g) || mercPath.length > 0)) tail = tail.slice(1);
  const a = countAirspace(ctx, merc);
  const b = countAirspace(ctx, tail);
  return { distance, safe: a.safe + b.safe, unsafe: a.unsafe + b.unsafe };
}
