// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/PathAI.cc UIPlotPath (0 off the interface level), PlotPath (0 without a path, the footsteps).

import { pathMoveMode } from '../tactical/movement-mode.ts';
import { findBestPath, PathCopy } from '../tactical/pathfinding.ts';
import { type Footstep, plotPathSteps } from '../tactical/plot-path.ts';
import type { Soldier } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';

export interface WalkPlot {
  readonly cost: number;
  readonly steps: readonly Footstep[];
}

const NO_WALK: WalkPlot = { cost: 0, steps: [] };

export function plotWalk(t: TacticalState, s: Soldier, to: number, mode: number, interfaceLevel: number): WalkPlot {
  if (s.level !== interfaceLevel) return NO_WALK;
  const route = findBestPath(t.pathEnv, s, to, s.level, { copy: PathCopy.NONE, mode: pathMoveMode(t.content, mode) });
  if (route.length === 0) return NO_WALK;
  const plotted = plotPathSteps(t, s, route.steps, mode, { plot: true, budget: s.actionPoints });
  return { cost: plotted.points, steps: plotted.footsteps };
}

export function interfaceLevelOf(s: Soldier, level: unknown): number {
  return level === 1 ? 1 : level === 0 ? 0 : s.level;
}
