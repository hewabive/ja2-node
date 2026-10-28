// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_Map.cc WhatPlayerKnowsAboutEnemiesInSector, CanMercsScoutThisSector;
// @src Town_Militia.cc CanNearbyMilitiaScoutThisSector; Map_Screen_Helicopter.cc IsSkyriderFlyingInSector.

import { MAP_SIDE, SECTOR_COUNT, type Sector, sameSector, sectorFromId, sectorId } from '../../../content/strategic/sector-ids.ts';
import { u32 } from '../../../core/int.ts';
import { OKLIFE } from '../../tactical/soldier.ts';
import { Assignment, SectorFlag } from '../forces/constants.ts';
import { isSurfaceMapSector } from '../forces/groups.ts';
import { isSkyriderFlyingInSector } from '../forces/helicopter.ts';
import type { StrategicContext, StrategicMerc } from '../forces/ports.ts';
import { inHelicopter } from '../forces/vehicles.ts';
import { getSectorFlagStatus, sectorInfo, totalMilitia } from './sectors.ts';

export const EnemyKnowledge = { NOTHING: 0, THEYRE_THERE: 1, HOW_MANY: 2 } as const;

const MILITIA_SCOUT_RANGE = 1;

function isScoutingMerc(ctx: StrategicContext, m: StrategicMerc): boolean {
  if (m.isVehicle) return false;
  if (m.assignment === Assignment.IN_TRANSIT || m.assignment === Assignment.ASSIGNMENT_POW || m.assignment === Assignment.ASSIGNMENT_DEAD)
    return false;
  return !(m.asleep || m.life < OKLIFE || inHelicopter(ctx, m) || m.betweenSectors);
}

function canScout(ctx: StrategicContext, m: StrategicMerc, s: Sector): boolean {
  return isScoutingMerc(ctx, m) && sameSector(m.sector, s);
}

export function canMercsScoutThisSector(ctx: StrategicContext, s: Sector): boolean {
  return ctx.mercs.all().some((m) => canScout(ctx, m, s));
}

function anyMilitiaNear(s: Sector, hasMilitia: (x: number, y: number) => boolean): boolean {
  const xStart = s.x > MILITIA_SCOUT_RANGE ? s.x - MILITIA_SCOUT_RANGE : 1;
  const yStart = s.y > MILITIA_SCOUT_RANGE ? s.y - MILITIA_SCOUT_RANGE : 1;
  const xEnd = s.x < MAP_SIDE - MILITIA_SCOUT_RANGE ? s.x + MILITIA_SCOUT_RANGE : MAP_SIDE;
  const yEnd = s.y < MAP_SIDE - MILITIA_SCOUT_RANGE ? s.y + MILITIA_SCOUT_RANGE : MAP_SIDE;
  for (let y = yStart; y <= yEnd; y++) for (let x = xStart; x <= xEnd; x++) if (hasMilitia(x, y)) return true;
  return false;
}

export function canNearbyMilitiaScoutThisSector(ctx: StrategicContext, s: Sector): boolean {
  return anyMilitiaNear(s, (x, y) => totalMilitia(sectorInfo(ctx.state.map, { x, y })) !== 0);
}

interface Scouting {
  readonly mercs: (ctx: StrategicContext, s: Sector) => boolean;
  readonly militia: (ctx: StrategicContext, s: Sector) => boolean;
}

const LIVE_SCOUTING: Scouting = { mercs: canMercsScoutThisSector, militia: canNearbyMilitiaScoutThisSector };

function surfaceScouting(ctx: StrategicContext): Scouting {
  const mercSectors = new Set<number>();
  for (const m of ctx.mercs.all()) if (isSurfaceMapSector(m.sector) && isScoutingMerc(ctx, m)) mercSectors.add(sectorId(m.sector));
  const militia = new Uint8Array(SECTOR_COUNT);
  for (let id = 0; id < SECTOR_COUNT; id++) militia[id] = totalMilitia(sectorInfo(ctx.state.map, sectorFromId(id))) !== 0 ? 1 : 0;
  const hasMilitia = (x: number, y: number) => militia[sectorId({ x, y })] === 1;
  return { mercs: (_, s) => mercSectors.has(sectorId(s)), militia: (_, s) => anyMilitiaNear(s, hasMilitia) };
}

function scoutedKnowledge(ctx: StrategicContext, s: Sector, scouting: Scouting): number | null {
  const info = sectorInfo(ctx.state.map, s);
  if (scouting.mercs(ctx, s) || scouting.militia(ctx, s) || info.flags & SectorFlag.PLAYER_KNOWS_ENEMIES_ARE_HERE) {
    return ctx.ai.numStationaryEnemiesInSector(s) > 0 ? EnemyKnowledge.THEYRE_THERE : EnemyKnowledge.HOW_MANY;
  }
  if (getSectorFlagStatus(ctx.state.map, s, SectorFlag.ALREADY_VISITED)) return EnemyKnowledge.THEYRE_THERE;
  return null;
}

function peekKnowledge(ctx: StrategicContext, s: Sector, scouting: Scouting): number {
  const known = scoutedKnowledge(ctx, s, scouting);
  if (known !== null) return known;
  const noticed = (sectorInfo(ctx.state.map, s).flags & SectorFlag.SKYRIDER_NOTICED_ENEMIES_HERE) !== 0;
  return noticed && isSkyriderFlyingInSector(ctx, s) ? EnemyKnowledge.THEYRE_THERE : EnemyKnowledge.NOTHING;
}

export function peekPlayerKnowledgeOfEnemies(ctx: StrategicContext, s: Sector): number {
  return peekKnowledge(ctx, s, LIVE_SCOUTING);
}

export function surfaceKnowledgeOfEnemies(ctx: StrategicContext): (s: Sector) => number {
  const scouting = surfaceScouting(ctx);
  return (s) => peekKnowledge(ctx, s, isSurfaceMapSector(s) ? scouting : LIVE_SCOUTING);
}

export function whatPlayerKnowsAboutEnemiesInSector(ctx: StrategicContext, s: Sector): number {
  const known = scoutedKnowledge(ctx, s, LIVE_SCOUTING);
  if (known !== null) return known;
  const info = sectorInfo(ctx.state.map, s);
  if (info.flags & SectorFlag.SKYRIDER_NOTICED_ENEMIES_HERE) {
    if (isSkyriderFlyingInSector(ctx, s)) return EnemyKnowledge.THEYRE_THERE;
    info.flags = u32(info.flags & ~SectorFlag.SKYRIDER_NOTICED_ENEMIES_HERE);
  }
  return EnemyKnowledge.NOTHING;
}
