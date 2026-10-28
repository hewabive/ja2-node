// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Movement.cc GetSectorMvtTimeForGroup, FindTravelTimeBetweenWaypoints,
// @src CalculateTravelTimeOfGroup.

import { StrategicMove } from '../../../content/strategic/map-tables.ts';
import { TransportMask } from '../../../content/strategic/policy.ts';
import { type Sector, sectorId } from '../../../content/strategic/sector-ids.ts';
import type { TravelTable } from '../../../content/strategic/travel-table.ts';
import { i32, idiv, u8 } from '../../../core/int.ts';
import { Assignment } from '../forces/constants.ts';
import type { Group } from '../forces/groups.ts';
import type { StrategicContext } from '../forces/ports.ts';
import { worldTotalMinutes } from '../time/world-clock.ts';
import { Traversability } from './sectors.ts';

export const TRAVERSE_TIME_IMPOSSIBLE = 0xffffffff;
const NO_BEST_TIME = 1000000;
const PERCENT = 100;
const ROW_STEP = 16;

export type EncumbranceOf = (memberId: number) => number;

export interface TravellingGroup {
  readonly player: boolean;
  readonly transportMask: number;
  readonly members: readonly number[];
}

export interface TravelInputs {
  readonly table: TravelTable;
  readonly traversability: (sectorId: number, direction: number) => number;
  readonly memberAssignment: (memberId: number) => number;
  readonly encumbrance: EncumbranceOf;
}

export function sectorMovementTime(inputs: TravelInputs, id: number, direction: number, g: TravellingGroup): number {
  const terrain = inputs.traversability(id, direction);
  if (terrain === Traversability.EDGEOFWORLD) return TRAVERSE_TIME_IMPOSSIBLE;
  if (terrain === Traversability.TOWN && g.transportMask !== TransportMask.AIR) return inputs.table.townMinutes;
  let best = NO_BEST_TIME;
  for (const t of inputs.table.transports) {
    if (!(g.transportMask & t.mask)) continue;
    let time = t.baseMinutes;
    if (t.modifiers) {
      const modifier = t.modifiers.get(terrain);
      if (modifier === undefined) return TRAVERSE_TIME_IMPOSSIBLE;
      time = idiv(t.baseMinutes * PERCENT, modifier);
    }
    if (best > time) best = time;
    if (t.mask === TransportMask.FOOT && g.player) best = idiv(best * highestEncumbrance(inputs, g), PERCENT);
  }
  return best;
}

function highestEncumbrance(inputs: TravelInputs, g: TravellingGroup): number {
  let highest = PERCENT;
  for (const id of g.members) {
    if (inputs.memberAssignment(id) === Assignment.VEHICLE) continue;
    const e = inputs.encumbrance(id);
    if (highest < e) highest = e;
  }
  return highest;
}

export function travelInputs(ctx: StrategicContext): TravelInputs {
  return {
    table: ctx.content.travel,
    traversability: (id, direction) => ctx.state.map.sectors[id]?.traversability[direction] ?? Traversability.EDGEOFWORLD,
    memberAssignment: (id) => ctx.mercs.get(id)?.assignment ?? Assignment.ON_DUTY,
    encumbrance: (id) => ctx.mercs.carriedWeightPercent(id),
  };
}

export function getSectorMvtTimeForGroup(ctx: StrategicContext, id: number, direction: number, g: TravellingGroup): number {
  return sectorMovementTime(travelInputs(ctx), id, direction, g);
}

function directionOfStep(delta: number): { step: number; direction: number } {
  if (delta > 0)
    return delta % ROW_STEP === 0 ? { step: ROW_STEP, direction: StrategicMove.SOUTH } : { step: 1, direction: StrategicMove.EAST };
  return delta % ROW_STEP === 0 ? { step: -ROW_STEP, direction: StrategicMove.NORTH } : { step: -1, direction: StrategicMove.WEST };
}

export function findTravelTimeBetweenWaypoints(ctx: StrategicContext, from: Sector, to: Sector, g: TravellingGroup): number {
  const start = sectorId(from);
  const end = sectorId(to);
  if (start === end) return 0;
  const { step, direction } = directionOfStep(end - start);
  let total = 0;
  for (let current = start; current !== end; current = u8(current + step)) {
    total = i32(total + getSectorMvtTimeForGroup(ctx, current, direction, g));
  }
  return total;
}

export function calculateTravelTimeOfGroup(ctx: StrategicContext, g: Group | null): number {
  if (!g) return 0;
  if (sectorId(g.sector) - sectorId(g.next) === 0) return 0;
  const now = worldTotalMinutes(ctx.state.clock);
  let eta = 0;
  let current: Sector = g.sector;
  if (g.betweenSectors) {
    if (g.arrivalTime >= now) eta += g.arrivalTime - now;
    current = g.next;
  }
  for (const wp of g.waypoints) {
    eta = i32(eta + findTravelTimeBetweenWaypoints(ctx, current, wp, g));
    current = wp;
  }
  return eta;
}
