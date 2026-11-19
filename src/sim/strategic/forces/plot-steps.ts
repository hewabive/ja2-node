// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-19. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/MapScreen.cc HandleMapUI MAP_EVENT_PLOT_PATH (a leg from the last sector of the path),
// @src CancelOrShortenPlottedPath; Map_Screen_Interface_Map.cc PlotPathForCharacter, PlotPathForHelicopter,
// @src ClearPathAfterThisSectorForCharacter, ClearPathAfterThisSectorForHelicopter; Strategic_Pathing.cc
// @src ClearStrategicPathListAfterThisSector.

import { parseSectorString, type Sector, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { appendStrategicPath, clearStrategicPathAfterSector, lastSectorOfPath } from '../map/pathing.ts';
import type { Group } from './groups.ts';
import { buildAStrategicPath } from './movement.ts';
import type { StrategicContext } from './ports.ts';
import { canPlotLegTo, PlotRefusal } from './routes.ts';

export interface PlotLeg {
  readonly to: Sector;
  readonly shortest: boolean;
  readonly selected: readonly number[];
}

export interface PlotCut {
  readonly cut: Sector;
  readonly selected: readonly number[];
}

export type PlotStep = PlotLeg | PlotCut;

export const NOT_ON_PATH = 'notOnPath';

export type StepRefusal = PlotRefusal | typeof NOT_ON_PATH;

export function isCut(step: PlotStep): step is PlotCut {
  return 'cut' in step;
}

function sectorOf(value: unknown): Sector | null {
  if (typeof value !== 'string') return null;
  try {
    return parseSectorString(value);
  } catch {
    return null;
  }
}

function soldierIds(value: unknown): number[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  return value.every((x) => typeof x === 'number' && Number.isInteger(x)) ? (value as number[]) : null;
}

function plotStep(value: unknown): PlotStep | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Readonly<Record<string, unknown>>;
  const selected = soldierIds(raw.selected);
  if (!selected) return null;
  if (raw.cut !== undefined) {
    const cut = sectorOf(raw.cut);
    return cut ? { cut, selected } : null;
  }
  const to = sectorOf(raw.to);
  return to ? { to, shortest: raw.shortest === true, selected } : null;
}

export function plotSteps(value: unknown): PlotStep[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const steps = value.map(plotStep);
  return steps.every((s) => s !== null) ? (steps as PlotStep[]) : null;
}

function pathWithLeg(
  ctx: StrategicContext,
  g: Group,
  path: readonly number[],
  origin: number,
  leg: PlotLeg,
  helicopter: boolean,
): readonly number[] | StepRefusal {
  if (!canPlotLegTo(ctx, leg.to, helicopter)) return PlotRefusal.BAD_SECTOR;
  const section = buildAStrategicPath(ctx, lastSectorOfPath(path, origin), strategicIndex(leg.to), g, { direct: leg.shortest });
  return section ? appendStrategicPath(section, path) : PlotRefusal.NO_ROUTE;
}

function pathCutAfter(path: readonly number[], origin: number, cut: Sector): readonly number[] | StepRefusal {
  const at = strategicIndex(cut);
  if (path.length === 0 || at === origin) return NOT_ON_PATH;
  const shortened = clearStrategicPathAfterSector(path, at);
  return shortened.length < path.length ? shortened : NOT_ON_PATH;
}

export function pathsAfterSteps(
  ctx: StrategicContext,
  g: Group,
  start: readonly number[],
  origin: number,
  steps: readonly PlotStep[],
  helicopter = false,
): (readonly number[])[] | StepRefusal {
  const paths: (readonly number[])[] = [];
  let path = start;
  for (const step of steps) {
    const next = isCut(step) ? pathCutAfter(path, origin, step.cut) : pathWithLeg(ctx, g, path, origin, step, helicopter);
    if (typeof next === 'string') return next;
    path = next;
    paths.push(path);
  }
  return paths;
}
