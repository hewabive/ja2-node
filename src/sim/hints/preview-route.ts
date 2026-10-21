// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/MapScreen.cc (the destination column: CanCharacterMoveInStrategic before plotting;
// @src GetGroundTravelTimeOfSoldier for the ETA box); Map_Screen_Interface_Map.cc PlotPathForCharacter (a leg appended to
// @src the merc path), PlotATemporaryPathForCharacter (from the last sector of the merc path);
// @src Strategic_Pathing.cc GetLastSectorIdInCharactersPath, GetSoldierMercPathPtr; Strategic_Pathing.cc FindStratPath
// @src (Shift: the shortest route). See docs/28 §7.6.

import { type Sector, strategicIndex } from '../../content/strategic/sector-ids.ts';
import type { KnowledgeWorld } from '../knowledge/knowledge-world.ts';
import type { StrategicKnowledge } from '../knowledge/strategic.ts';
import type { CrewMember } from '../strategic/economy/ports.ts';
import type { Group } from '../strategic/forces/groups.ts';
import { canCharacterMoveInStrategic, canEntireMovementGroupMove } from '../strategic/forces/move-permission.ts';
import { type PlotRefusal, type PlottedLegs, plotLegs, soldierGroup, soldierMercPath } from '../strategic/forces/routes.ts';
import { appendStrategicPath } from '../strategic/map/pathing.ts';
import { edgeTravelMinutes, plottingEtaMinutes } from '../strategic/map/plotting.ts';
import { mercOf, sectorNames, sectorParam, strategicOf } from './strategic-check.ts';
import { type HintRefusal, type HintRequestBase, type HintResult, hintData, refuseHint } from './types.ts';

export interface PreviewRoute {
  readonly path: readonly string[];
  readonly temp: readonly string[];
  readonly edgeMinutes: readonly number[];
  readonly etaMinutes: number;
}

export interface PreviewRouteRequest extends HintRequestBase {
  readonly soldier?: unknown;
  readonly to?: unknown;
  readonly via?: unknown;
  readonly shortest?: unknown;
  readonly extend?: unknown;
  readonly alone?: unknown;
}

export function viaSectors(via: unknown): Sector[] | null {
  if (via === undefined) return [];
  if (!Array.isArray(via)) return null;
  const sectors = via.map(sectorParam);
  return sectors.every((s) => s !== null) ? (sectors as Sector[]) : null;
}

const PLOT_REFUSAL_TEXT: Readonly<Record<PlotRefusal, string>> = {
  badSector: 'a leg ends on a sector the cursor cannot plot to',
  noRoute: 'no route to a leg of the path',
};

export function plotLegsHint(
  sk: StrategicKnowledge,
  g: Group,
  start: readonly number[],
  origin: number,
  via: readonly Sector[],
  to: Sector,
  direct: boolean,
): PlottedLegs | HintRefusal {
  const legs = plotLegs(sk.ctx, g, start, origin, via, to, { direct });
  return typeof legs === 'string' ? refuseHint(legs, PLOT_REFUSAL_TEXT[legs]) : legs;
}

function ownMoveRefusal(sk: StrategicKnowledge, id: number): string | null {
  const merc = sk.ctx.mercs.get(id);
  return merc ? canCharacterMoveInStrategic(sk.ctx, merc, sk.loaded) : null;
}

function routeFor(sk: StrategicKnowledge, m: CrewMember, req: PreviewRouteRequest): HintResult<PreviewRoute> {
  const ctx = sk.ctx;
  const to = sectorParam(req.to);
  if (!to) return refuseHint('badSector', 'to must be a sector such as B9');
  const via = viaSectors(req.via);
  if (!via) return refuseHint('badSector', 'via must be a list of sectors');
  const refusal = req.alone === true ? ownMoveRefusal(sk, m.id) : canEntireMovementGroupMove(ctx, m.id, sk.loaded);
  if (refusal) return refuseHint(refusal, `the squad cannot move: ${refusal}`);
  const g = soldierGroup(ctx, m);
  if (!g) return refuseHint('noRoute', 'the merc has no movement group');
  const start = req.extend === true ? soldierMercPath(ctx, m) : [];
  const legs = plotLegsHint(sk, g, start, strategicIndex(m.sector), via, to, req.shortest === true);
  if ('ok' in legs) return legs;
  const full = appendStrategicPath(legs.temp, legs.path);
  return hintData({
    path: sectorNames(legs.path),
    temp: sectorNames(legs.temp ?? []),
    edgeMinutes: edgeTravelMinutes(ctx, full, g),
    etaMinutes: plottingEtaMinutes(ctx, legs.temp, legs.path, g),
  });
}

export function previewRoute(world: KnowledgeWorld, req: PreviewRouteRequest): HintResult<PreviewRoute> {
  const sk = strategicOf(world);
  if ('refusal' in sk) return sk.refusal;
  const m = mercOf(sk, req.soldier);
  if ('refusal' in m) return m.refusal;
  return routeFor(sk, m, req);
}
