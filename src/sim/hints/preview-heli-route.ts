// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_Map.cc DisplayDistancesForHelicopter (distance, safe and unsafe sectors,
// @src COST_AIRSPACE_SAFE / COST_AIRSPACE_UNSAFE, the ETA from the temporary path and the helicopter's merc path, the
// @src passengers), PlotATemporaryPathForHelicopter, PlotPathForHelicopter; Map_Screen_Helicopter.cc
// @src GetLastSectorOfHelicoptersPath. See docs/28 §7.7.

import { strategicIndex } from '../../content/strategic/sector-ids.ts';
import type { KnowledgeWorld } from '../knowledge/knowledge-world.ts';
import { passengersOf } from '../strategic/forces/groups.ts';
import { canHelicopterFly, helicopterGroup, whyHelicopterCannotFly } from '../strategic/forces/helicopter.ts';
import { helicopterPathFigures, plottingEtaMinutes } from '../strategic/map/plotting.ts';
import { plotLegsHint, viaSectors } from './preview-route.ts';
import { sectorNames, sectorParam, strategicOf } from './strategic-check.ts';
import { type HintRequestBase, type HintResult, hintData, refuseHint } from './types.ts';

export interface PreviewHeliRoute {
  readonly path: readonly string[];
  readonly temp: readonly string[];
  readonly distance: number;
  readonly safe: number;
  readonly unsafe: number;
  readonly cost: number;
  readonly etaMinutes: number;
  readonly passengers: number;
  readonly refusal?: string;
}

export interface PreviewHeliRouteRequest extends HintRequestBase {
  readonly to?: unknown;
  readonly via?: unknown;
  readonly extend?: unknown;
}

export function previewHeliRoute(world: KnowledgeWorld, req: PreviewHeliRouteRequest): HintResult<PreviewHeliRoute> {
  const sk = strategicOf(world);
  if ('refusal' in sk) return sk.refusal;
  const ctx = sk.ctx;
  const v = ctx.state.forces.vehicles[ctx.state.forces.helicopterVehicleId];
  const g = helicopterGroup(ctx);
  if (!v || !g) return refuseHint('noHelicopter', 'there is no helicopter');
  const to = sectorParam(req.to);
  if (!to) return refuseHint('badSector', 'to must be a sector such as B13');
  const via = viaSectors(req.via);
  if (!via) return refuseHint('badSector', 'via must be a list of sectors');
  const legs = plotLegsHint(sk, g, req.extend === true ? v.path : [], strategicIndex(v.sector), via, to, false);
  if ('ok' in legs) return legs;
  const canFly = canHelicopterFly(ctx);
  const figures = helicopterPathFigures(ctx, canFly, v, g, legs.path, legs.temp);
  const travel = ctx.content.travel;
  const refusal = canFly ? null : whyHelicopterCannotFly(ctx);
  return hintData({
    path: sectorNames(legs.path),
    temp: sectorNames(legs.temp ?? []),
    distance: figures.distance,
    safe: figures.safe,
    unsafe: figures.unsafe,
    cost: figures.safe * travel.airspaceCostSafe + figures.unsafe * travel.airspaceCostUnsafe,
    etaMinutes: plottingEtaMinutes(ctx, legs.temp, legs.path, g),
    passengers: passengersOf(v).length,
    ...(refusal ? { refusal } : {}),
  });
}
