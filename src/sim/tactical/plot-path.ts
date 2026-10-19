// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/PathAI.cc PlotPath (the costing, gusAPtsToMove, the footstep colour bands sFootOrder and the
// @src real-time red steps), UIPlotPath (the interface level). See docs/28 §2.4, §6.4.

import { newGridNo } from '../../content/world/grid.ts';
import { TravelCost } from '../../content/world/movement-costs.ts';
import { DIRECTION_INCREMENT } from './directions.ts';
import { isWater } from './pathfinding.ts';
import { AP, minAPsToStartMovement, stateName, terrainActionPoints } from './points.ts';
import { Body, type Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';

const RUNDIVISOR = 1.8;
const WALKCOST = -1;
const SWATCOST = 0;
const CRAWLCOST = 1;

export const FootstepBand = { CRAWL: 0, SWAT: 1, WALK: 2, RUN: 3, NONE: 4 } as const;

export interface Footstep {
  readonly gridNo: number;
  readonly enterDir: number;
  readonly leaveDir: number;
  readonly band: number;
}

export interface PlottedPath {
  readonly points: number;
  readonly firstStepPoints: number;
  readonly footsteps: readonly Footstep[];
}

interface BandPoints {
  crawl: number;
  swat: number;
  walk: number;
  run: number;
}

const isVehicle = (s: Soldier) => s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP;
const runPoints = (tile: number) => Math.trunc(tile / RUNDIVISOR);

function nextBand(s: Soldier, band: number, pts: BandPoints, budget: number): number {
  if (isVehicle(s)) return pts.swat > budget ? FootstepBand.NONE : FootstepBand.RUN;
  let b = band;
  if (b === FootstepBand.CRAWL && pts.crawl > budget) b++;
  if (b === FootstepBand.SWAT && pts.swat > budget) b++;
  if (b === FootstepBand.WALK && pts.walk > budget) b++;
  if (b === FootstepBand.RUN && pts.run > budget) b++;
  return b;
}

export interface PlotOptions {
  readonly plot: boolean;
  readonly budget: number;
}

export function plotPathSteps(t: TacticalState, s: Soldier, steps: readonly number[], mode: number, options: PlotOptions): PlottedPath {
  const content = t.content;
  const ctx = { env: t.pathEnv, content, inCombat: t.inCombat };
  const moving = stateName(content, s.state);
  const bands = options.plot && t.inCombat;
  const pts: BandPoints = { crawl: 0, swat: 0, walk: 0, run: moving !== 'RUNNING' ? AP.START_RUN_COST : 0 };
  let points = minAPsToStartMovement(content, s, mode);
  const first = newGridNo(s.gridNo, DIRECTION_INCREMENT[steps[0] ?? 0] ?? 0);
  if (
    t.world.costs.get(first, steps[0] ?? 0, s.level) === TravelCost.FENCE &&
    stateName(content, mode) === 'RUNNING' &&
    moving !== 'RUNNING'
  )
    points -= AP.START_RUN_COST;
  let firstStepPoints = 0;
  let band: number = FootstepBand.CRAWL;
  let ignoreNext = false;
  let g = s.gridNo;
  const footsteps: Footstep[] = [];
  const n = steps.length;
  for (let i = 0; i < n; i++) {
    const d = steps[i] ?? 0;
    let extraStand = 0;
    let extraSwat = 0;
    g = newGridNo(g, DIRECTION_INCREMENT[d] ?? 0);
    const sw = t.world.costs.get(g, d, s.level);
    const tile = terrainActionPoints(ctx, s, g, d, s.level);
    const cls = stateName(content, isWater(t.pathWorld, g) ? (content.animations.stateIndex.get('WALKING') ?? mode) : mode);
    if (ignoreNext) ignoreNext = false;
    else if (sw === TravelCost.FENCE) {
      points += tile;
      ignoreNext = true;
      if ((cls === 'RUNNING' || cls === 'WALKING') && i + 2 < n) {
        extraStand += AP.CROUCH + (cls === 'RUNNING' ? 1 : 0);
        points += extraStand;
      } else if (cls === 'SWATTING') {
        extraSwat += AP.CROUCH;
        points += extraSwat;
      }
    } else if (tile > 0) {
      if (sw === TravelCost.NOT_STANDING && (cls === 'RUNNING' || cls === 'WALKING')) extraStand += AP.CROUCH;
      if (cls === 'RUNNING') points += runPoints(tile) + extraStand;
      else if (cls === 'WALKING') points += tile + WALKCOST + extraStand;
      else if (cls === 'SWATTING') points += tile + SWATCOST + extraSwat;
      else if (cls === 'CRAWLING') points += tile + CRAWLCOST;
      else points += tile;
    }
    if (bands) {
      pts.walk += tile + WALKCOST + extraStand;
      pts.crawl += tile + CRAWLCOST;
      pts.swat += tile + SWATCOST + extraSwat;
      pts.run += runPoints(tile) + extraStand;
    }
    if (i === 0 && options.plot) firstStepPoints = points;
    if (options.plot && i < n - 1) {
      band = t.inCombat ? nextBand(s, band, pts, options.budget) : FootstepBand.NONE;
      footsteps.push({ gridNo: g, enterDir: d, leaveDir: steps[i + 1] ?? 0, band: t.inCombat ? band : FootstepBand.NONE });
    }
  }
  return { points, firstStepPoints, footsteps };
}
