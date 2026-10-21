// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_Map.cc DisplayPositionOfHelicopter (the flight ratio, clamped to 0..100),
// @src DisplayDistancesForHelicopter (safe and unsafe sectors); Strategic/Map_Screen_Helicopter.cc CanHelicopterFly.

import { type Sector, sectorFromStrategicIndex, sectorShortString, strategicIndex } from '../content/strategic/sector-ids.ts';
import type { DestroyedHelicopterView, StrategicHelicopterView, StrategicVehicleView } from '../protocol/view.ts';
import type { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import { type Group, getGroup, passengersOf, type VehicleRecord } from '../sim/strategic/forces/groups.ts';
import {
  canHelicopterFly,
  helicopterGroup,
  helicopterVehicle,
  heliState,
  okUseVehicle,
  skyriderBalance,
  whyHelicopterCannotFly,
} from '../sim/strategic/forces/helicopter.ts';
import { REFUEL_SITES } from '../sim/strategic/forces/helicopter-state.ts';
import { groupBetweenSectorsAndSectorXYIsInDifferentDirection } from '../sim/strategic/forces/movement.ts';
import type { StrategicContext } from '../sim/strategic/forces/ports.ts';
import { vehicleSeats } from '../sim/strategic/forces/vehicles.ts';
import { calculateTravelTimeOfGroup, TRAVERSE_TIME_IMPOSSIBLE } from '../sim/strategic/map/travel.ts';
import { worldTotalMinutes } from '../sim/strategic/time/world-clock.ts';

const name = (s: Sector) => sectorShortString(s);
const pathNames = (path: readonly number[]) => path.map((i) => name(sectorFromStrategicIndex(i)));
const KIND_NAMES: Readonly<Record<string, string>> = {
  PROF_ELDERODO: 'eldorado',
  PROF_HUMMER: 'hummer',
  PROF_ICECREAM: 'iceCreamTruck',
  PROF_HELICOPTER: 'helicopter',
  NPC164: 'tank',
};

function kindOf(ctx: StrategicContext, v: VehicleRecord): string {
  const profile = ctx.content.vehicles[v.type]?.profile ?? '';
  return KIND_NAMES[profile] ?? profile;
}

function vehicleLeg(
  ctx: StrategicContext,
  v: VehicleRecord,
): Pick<StrategicVehicleView, 'next' | 'nextArrivalMinutes' | 'traverseMinutes'> {
  const g = getGroup(ctx, v.movementGroup);
  if (!g?.betweenSectors) return { next: null, nextArrivalMinutes: null, traverseMinutes: null };
  return {
    next: name(g.next),
    nextArrivalMinutes: Math.max(0, g.arrivalTime - worldTotalMinutes(ctx.state.clock)),
    traverseMinutes: g.traverseTime,
  };
}

const MAX_FLIGHT_RATIO = 100;

function flightProgress(ctx: StrategicContext, g: Group | undefined): number {
  if (!g || g.traverseTime <= 0 || g.traverseTime === TRAVERSE_TIME_IMPOSSIBLE) return 0;
  const ratio = Math.fround((g.traverseTime + worldTotalMinutes(ctx.state.clock) - g.arrivalTime) / Math.fround(g.traverseTime));
  return Math.min(MAX_FLIGHT_RATIO, Math.max(0, ratio));
}

export function vehicleViews(campaign: CampaignSim): StrategicVehicleView[] | undefined {
  const ctx = campaign.strategic;
  if (!ctx) return undefined;
  const views = ctx.state.forces.vehicles.flatMap((v, id) =>
    v.valid && !v.destroyed
      ? [
          {
            id,
            kind: kindOf(ctx, v),
            sector: name(v.sector),
            betweenSectors: v.betweenSectors,
            passengers: passengersOf(v),
            seats: vehicleSeats(ctx, v),
            path: pathNames(v.path),
            type: v.type,
            group: v.movementGroup,
            usable: okUseVehicle(ctx, v),
            ...vehicleLeg(ctx, v),
          },
        ]
      : [],
  );
  return views.length > 0 ? views : undefined;
}

function airspaceCounts(ctx: StrategicContext, v: VehicleRecord): { readonly safe: number; readonly unsafe: number } {
  if (!canHelicopterFly(ctx)) return { safe: 0, unsafe: 0 };
  const g = helicopterGroup(ctx);
  const nodes = v.path;
  const second = nodes[1];
  const skipFirst =
    nodes[0] === strategicIndex(v.sector) &&
    second !== undefined &&
    (!g || !groupBetweenSectorsAndSectorXYIsInDifferentDirection(g, sectorFromStrategicIndex(second)));
  let safe = 0;
  let unsafe = 0;
  for (const index of skipFirst ? nodes.slice(1) : nodes) {
    if (ctx.state.map.elements[index]?.enemyAirControlled) unsafe++;
    else safe++;
  }
  return { safe, unsafe };
}

export function helicopterView(campaign: CampaignSim): StrategicHelicopterView | DestroyedHelicopterView | undefined {
  const ctx = campaign.strategic;
  if (!ctx) return undefined;
  const heli = heliState(ctx);
  if (heli.destroyed) return { destroyed: true };
  const v = helicopterVehicle(ctx);
  if (!heli.setUp || !v) return undefined;
  const g = helicopterGroup(ctx);
  const reason = whyHelicopterCannotFly(ctx);
  const { safe, unsafe } = airspaceCounts(ctx, v);
  return {
    vehicle: ctx.state.forces.helicopterVehicleId,
    sector: name(v.sector),
    next: g?.betweenSectors ? name(g.next) : null,
    airborne: ctx.state.forces.helicopterAirborne,
    hovering: heli.hovering,
    returning: heli.returningToBase,
    passengers: passengersOf(v),
    seats: vehicleSeats(ctx, v),
    canFly: reason === null,
    ...(reason ? { reason } : {}),
    owed: Math.max(0, -skyriderBalance(ctx)),
    hits: heli.hitsTaken,
    path: pathNames(v.path),
    etaMinutes: calculateTravelTimeOfGroup(ctx, g ?? null),
    safeSectors: safe,
    unsafeSectors: unsafe,
    routeCost: safe * ctx.content.travel.airspaceCostSafe + unsafe * ctx.content.travel.airspaceCostUnsafe,
    refuelSites: REFUEL_SITES.map((r, i) => ({ sector: name(r.sector), available: heli.refuelSiteAvailable[i] === true })),
    progress: flightProgress(ctx, g),
  };
}
