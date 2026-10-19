// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_UI.cc UIHandleMOnTerrain (the height check, CANNOT_MOVE_UICURSOR), DrawUIMovementPath
// @src (MOVEUI_TARGET_NONE), SelectedMercCanAffordMove (first step plus stance change); Overhead.cc UIOKMoveDestination;
// @src PathAI.cc UIPlotPath, PlotPath. See docs/28 §2.4, §6.1, §6.4.

import { isVisibleTile } from '../../content/world/grid.ts';
import { withTemporaryFields } from '../knowledge/guard.ts';
import type { KnowledgeWorld } from '../knowledge/knowledge-world.ts';
import { height } from '../tactical/animation.ts';
import { movementModeState, pathMoveMode } from '../tactical/movement-mode.ts';
import { uncontrolledRobot } from '../tactical/narrative/robot.ts';
import { findBestPath, newOKDestination, PathCopy } from '../tactical/pathfinding.ts';
import { type Footstep, plotPathSteps } from '../tactical/plot-path.ts';
import { apsToChangeStance, enoughPoints, ptsToMoveDirection } from '../tactical/points.ts';
import { type ActingSoldier, actingSoldier } from './soldier-check.ts';
import { type HintRequestBase, type HintResult, hintData, refuseHint } from './types.ts';

export type MoveDestination = 'ok' | 'blocked' | 'heightDiffers' | 'robotUncontrolled';

export interface PreviewMove {
  readonly destination: MoveDestination;
  readonly apCost: number;
  readonly firstStepCost: number;
  readonly affordable: boolean;
  readonly steps: readonly Footstep[];
  readonly refusal?: string;
}

export interface PreviewMoveRequest extends HintRequestBase {
  readonly soldier?: unknown;
  readonly to?: unknown;
  readonly mode?: unknown;
  readonly reverse?: unknown;
  readonly level?: unknown;
}

function destinationOf(acting: ActingSoldier, to: number, level: number): MoveDestination {
  const { state: t, soldier: s } = acting;
  const heights = t.world.level.heights;
  if (heights[to] !== heights[s.gridNo]) return 'heightDiffers';
  if (!newOKDestination(t.pathEnv, s, to, false, level)) return 'blocked';
  if (uncontrolledRobot(t, s)) return 'robotUncontrolled';
  return 'ok';
}

const NOT_PLOTTED: Omit<PreviewMove, 'destination'> = { apCost: 0, firstStepCost: 0, affordable: false, steps: [] };

export function previewMove(world: KnowledgeWorld, req: PreviewMoveRequest): HintResult<PreviewMove> {
  const acting = actingSoldier(world, req.soldier);
  if ('refusal' in acting) return acting.refusal;
  const to = req.to;
  if (typeof to !== 'number' || !Number.isInteger(to) || !isVisibleTile(to))
    return refuseHint('badDestination', 'destination must be a visible gridNo');
  const { state: t, soldier: s } = acting;
  const mode = movementModeState(t.content, s, req.mode);
  return withTemporaryFields(s, { uiMovementMode: mode, reverse: req.reverse === true }, () => plotMove(acting, to, mode, req.level));
}

function plotMove(acting: ActingSoldier, to: number, mode: number, level: unknown): HintResult<PreviewMove> {
  const { state: t, soldier: s } = acting;
  const interfaceLevel = level === 1 ? 1 : level === 0 ? 0 : s.level;
  const destination = destinationOf(acting, to, interfaceLevel);
  const refusal = acting.blocked ? { refusal: acting.blocked } : {};
  if (destination !== 'ok' || s.level !== interfaceLevel) return hintData({ destination, ...NOT_PLOTTED, ...refusal });
  const route = findBestPath(t.pathEnv, s, to, s.level, { copy: PathCopy.NONE, mode: pathMoveMode(t.content, mode) });
  if (route.length === 0) return hintData({ destination, ...NOT_PLOTTED, ...refusal });
  const plotted = plotPathSteps(t, s, route.steps, mode, { plot: true, budget: s.actionPoints });
  const ctx = { env: t.pathEnv, content: t.content, inCombat: t.inCombat };
  const firstStepCost = ptsToMoveDirection(ctx, s, route.steps[0] ?? 0, mode) + apsToChangeStance(t.content, s, height(t.content, mode));
  return hintData({
    destination,
    apCost: plotted.points,
    firstStepCost,
    affordable: enoughPoints(t.inCombat, s, firstStepCost),
    steps: plotted.footsteps,
    ...refusal,
  });
}
