// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-19. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/MapScreen.cc HandleMapUI MAP_EVENT_PLOT_PATH (PlotPathForCharacter, then
// @src CopyPathToAllSelectedCharacters), CancelOrShortenPlottedPath, CheckIfClickOnLastSectorInPath,
// @src RebuildWayPointsForAllSelectedCharsGroups, HandleNewDestConfirmation's wake-up, AbortMovementPlottingMode,
// @src RememberPreviousPathForAllSelectedChars, RestorePreviousPaths, CancelPathsOfAllSelectedCharacters;
// @src Map_Screen_Interface_Map.cc ClearPathAfterThisSectorForCharacter; Map_Screen_Interface.cc
// @src DeselectSelectedListMercsWhoCantMoveWithThisGuy, CanEntireMovementGroupMercIsInMove.

import { strategicIndex } from '../../content/strategic/sector-ids.ts';
import type { CommandRefused, CommandResult } from '../command.ts';
import { travellersWith } from '../strategic/forces/move-box.ts';
import { canEntireMovementGroupMove, type LoadedSectorStatus } from '../strategic/forces/move-permission.ts';
import { isCut, type PlotStep, pathsAfterSteps, plotSteps } from '../strategic/forces/plot-steps.ts';
import type { StrategicContext, StrategicMerc } from '../strategic/forces/ports.ts';
import {
  cancelPathOfCharacterWithRoute,
  copyPathToAllSelectedCharacters,
  pathStoreOf,
  rebuildWayPointsForAllSelectedCharsGroups,
  restorePreviousPaths,
  setPathForCharacter,
  setStoredPathOf,
  soldierGroup,
  soldierMercPath,
} from '../strategic/forces/routes.ts';
import { refuse } from '../tactical/refusal.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { idList, refuseMove, routeResult, type StrategicCommand, wakeTravellersOfConfirmedRoute } from './commands.ts';

export const PlotEnd = { CONFIRM: 'confirm', ABORT: 'abort', CANCEL: 'cancel', DROP: 'drop' } as const;
export type PlotEnd = (typeof PlotEnd)[keyof typeof PlotEnd];

const PLOT_ENDS: ReadonlySet<string> = new Set(Object.values(PlotEnd));

export const STEP_REFUSAL_TEXT: Readonly<Record<string, string>> = {
  badSector: 'a leg ends on a sector that cannot be plotted to',
  noRoute: 'no route to a leg of the plot',
  notOnPath: 'a cut is on no sector of the path but its first, or shortens nothing',
};

export function plotEndOf(value: unknown): PlotEnd | null {
  return typeof value === 'string' && PLOT_ENDS.has(value) ? (value as PlotEnd) : null;
}

export function stepsOf(cmd: StrategicCommand): PlotStep[] | CommandRefused {
  const steps = plotSteps(cmd.steps);
  return steps ?? refuse('badStep', 'steps must list {to, shortest?, selected?} legs and {cut, selected?} cuts');
}

function knownIds(ctx: StrategicContext, ids: readonly number[]): boolean {
  return ids.every((id) => ctx.mercs.get(id) !== undefined);
}

interface Travellers {
  readonly atSteps: readonly (readonly number[])[];
  readonly atEnd: readonly number[];
}

function travellersOf(ctx: StrategicContext, plotter: StrategicMerc, steps: readonly PlotStep[], selected: readonly number[]): Travellers {
  const travelling = (ids: readonly number[]) => travellersWith(ctx, plotter, ids);
  return { atSteps: steps.map((step) => travelling(step.selected)), atEnd: travelling(selected) };
}

function everyTraveller(t: Travellers): number[] {
  return [...new Set([...t.atSteps.flat(), ...t.atEnd])];
}

function applyStep(
  ctx: StrategicContext,
  plotter: StrategicMerc,
  step: PlotStep,
  path: readonly number[],
  selected: readonly number[],
): void {
  if (isCut(step)) setStoredPathOf(ctx, plotter, path);
  else setPathForCharacter(ctx, plotter.id, path);
  copyPathToAllSelectedCharacters(ctx, selected, pathStoreOf(plotter), soldierMercPath(ctx, plotter));
}

function finish(
  campaign: CampaignSim,
  ctx: StrategicContext,
  plotter: StrategicMerc,
  end: PlotEnd,
  t: Travellers,
  previous: readonly number[],
): void {
  switch (end) {
    case PlotEnd.CONFIRM:
      rebuildWayPointsForAllSelectedCharsGroups(ctx, plotter, t.atEnd);
      if (soldierMercPath(ctx, plotter).length > 0) wakeTravellersOfConfirmedRoute(campaign, t.atEnd);
      return;
    case PlotEnd.ABORT:
      restorePreviousPaths(ctx, t.atEnd, previous);
      return;
    case PlotEnd.CANCEL:
      for (const id of t.atEnd) cancelPathOfCharacterWithRoute(ctx, id);
      return;
    case PlotEnd.DROP:
      return;
  }
}

export function endMercPlot(
  campaign: CampaignSim,
  ctx: StrategicContext,
  cmd: StrategicCommand,
  loaded: LoadedSectorStatus,
): CommandResult {
  const id = typeof cmd.soldier === 'number' ? cmd.soldier : -1;
  const plotter = ctx.mercs.get(id);
  if (!plotter) return refuse('noSuchMerc', 'no such merc');
  const steps = stepsOf(cmd);
  if ('ok' in steps) return steps;
  const end = plotEndOf(cmd.outcome);
  if (!end) return refuse('badOutcome', "outcome must be 'confirm', 'abort', 'cancel' or 'drop'");
  const selected = idList(cmd.selected ?? []);
  if (!selected || !knownIds(ctx, selected) || !steps.every((s) => knownIds(ctx, s.selected)))
    return refuse('badSoldiers', 'selected lists must name mercs by soldier id');
  const t = travellersOf(ctx, plotter, steps, selected);
  const block = canEntireMovementGroupMove(ctx, id, loaded, everyTraveller(t));
  if (block) return refuseMove(block);
  const g = soldierGroup(ctx, plotter);
  if (!g) return refuse('noRoute', 'the merc has no movement group');
  const previous = [...soldierMercPath(ctx, plotter)];
  const paths = pathsAfterSteps(ctx, g, previous, strategicIndex(plotter.sector), steps);
  if (typeof paths === 'string') return refuse(paths, STEP_REFUSAL_TEXT[paths] ?? paths);
  for (const [i, step] of steps.entries()) applyStep(ctx, plotter, step, paths[i] ?? [], t.atSteps[i] ?? []);
  finish(campaign, ctx, plotter, end, t, previous);
  return routeResult(ctx, id);
}
