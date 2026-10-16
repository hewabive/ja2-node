// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_Map.cc WhatPlayerKnowsAboutEnemiesInSector, CanMercsScoutThisSector;
// @src Town_Militia.cc CanNearbyMilitiaScoutThisSector; Map_Screen_Helicopter.cc IsSkyriderFlyingInSector. See docs/16 §6.3.

import { MAP_SIDE, type Sector, sameSector } from '../../../content/strategic/sector-ids.ts';
import { u32 } from '../../../core/int.ts';
import { OKLIFE } from '../../tactical/soldier.ts';
import { Assignment, SectorFlag } from '../forces/constants.ts';
import type { StrategicContext, StrategicMerc } from '../forces/ports.ts';
import { getSectorFlagStatus, sectorInfo, totalMilitia } from './sectors.ts';

export const EnemyKnowledge = { NOTHING: 0, THEYRE_THERE: 1, HOW_MANY: 2 } as const;

const MILITIA_SCOUT_RANGE = 1;

function inHelicopter(ctx: StrategicContext, m: StrategicMerc): boolean {
  const heli = ctx.state.forces.helicopterVehicleId;
  return heli !== -1 && m.assignment === Assignment.VEHICLE && m.vehicleId === heli;
}

function canScout(ctx: StrategicContext, m: StrategicMerc, s: Sector): boolean {
  if (m.isVehicle) return false;
  if (m.assignment === Assignment.IN_TRANSIT || m.assignment === Assignment.ASSIGNMENT_POW || m.assignment === Assignment.ASSIGNMENT_DEAD)
    return false;
  if (m.asleep || m.life < OKLIFE || inHelicopter(ctx, m) || m.betweenSectors) return false;
  return sameSector(m.sector, s);
}

export function canMercsScoutThisSector(ctx: StrategicContext, s: Sector): boolean {
  return ctx.mercs.all().some((m) => canScout(ctx, m, s));
}

export function canNearbyMilitiaScoutThisSector(ctx: StrategicContext, s: Sector): boolean {
  const xStart = s.x > MILITIA_SCOUT_RANGE ? s.x - MILITIA_SCOUT_RANGE : 1;
  const yStart = s.y > MILITIA_SCOUT_RANGE ? s.y - MILITIA_SCOUT_RANGE : 1;
  const xEnd = s.x < MAP_SIDE - MILITIA_SCOUT_RANGE ? s.x + MILITIA_SCOUT_RANGE : MAP_SIDE;
  const yEnd = s.y < MAP_SIDE - MILITIA_SCOUT_RANGE ? s.y + MILITIA_SCOUT_RANGE : MAP_SIDE;
  for (let y = yStart; y <= yEnd; y++)
    for (let x = xStart; x <= xEnd; x++) if (totalMilitia(sectorInfo(ctx.state.map, { x, y }))) return true;
  return false;
}

function skyriderFlyingIn(ctx: StrategicContext, s: Sector): boolean {
  const f = ctx.state.forces;
  if (f.helicopterVehicleId === -1 || !f.helicopterAirborne) return false;
  const heli = f.vehicles[f.helicopterVehicleId];
  return heli !== undefined && sameSector(heli.sector, s);
}

export function whatPlayerKnowsAboutEnemiesInSector(ctx: StrategicContext, s: Sector): number {
  const info = sectorInfo(ctx.state.map, s);
  if (canMercsScoutThisSector(ctx, s) || canNearbyMilitiaScoutThisSector(ctx, s) || info.flags & SectorFlag.PLAYER_KNOWS_ENEMIES_ARE_HERE) {
    return ctx.ai.numStationaryEnemiesInSector(s) > 0 ? EnemyKnowledge.THEYRE_THERE : EnemyKnowledge.HOW_MANY;
  }
  if (getSectorFlagStatus(ctx.state.map, s, SectorFlag.ALREADY_VISITED)) return EnemyKnowledge.THEYRE_THERE;
  if (info.flags & SectorFlag.SKYRIDER_NOTICED_ENEMIES_HERE) {
    if (skyriderFlyingIn(ctx, s)) return EnemyKnowledge.THEYRE_THERE;
    info.flags = u32(info.flags & ~SectorFlag.SKYRIDER_NOTICED_ENEMIES_HERE);
  }
  return EnemyKnowledge.NOTHING;
}
