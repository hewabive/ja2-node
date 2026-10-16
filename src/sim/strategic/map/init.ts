// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/StrategicMap.cc InitializeMapStructure, InitializeStrategicMapSectorTownNames, SetupNewStrategicGame;
// @src Campaign_Init.cc InitNewCampaign, InitKnowFacilitiesFlags, BuildUndergroundSectorInfoList;
// @src src/externalized/strategic/UndergroundSectorModel.cc createUndergroundSectorInfo; Strategic_Movement_Costs.cc
// @src InitStrategicMovementCosts; Game_Init.cc InitStrategicLayer, InitBloodCatSectors, InitNPCs (placements, Tixa basement);
// @src Map_Screen_Helicopter.cc InitializeHelicopter. See docs/16 §1.3–§1.4, docs/15 §4.3.

import { sectorFromId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { u8, u32 } from '../../../core/int.ts';
import { SectorFlag } from '../forces/constants.ts';
import { removeAllGroups } from '../forces/groups.ts';
import { initializeHelicopter } from '../forces/helicopter.ts';
import type { StrategicContext } from '../forces/ports.ts';
import { initSquads, initVehicles } from '../forces/squads.ts';
import { worldDay } from '../time/world-clock.ts';
import { initializeSamSites, initMapSecrets } from './control.ts';
import {
  createMapElement,
  createSectorInfo,
  createUndergroundSector,
  findUndergroundSector,
  setSectorFlag,
  type UndergroundSector,
} from './sectors.ts';

const TIXA_BASEMENT = { x: 9, y: 10, z: 1 };
const LAST_SECTOR_WITH_UNROLLED_BLOODCATS = 255;
const UNROLLED_BLOODCATS = -1;

export interface StrategicLayerHooks {
  readonly initStrategicAI?: (ctx: StrategicContext) => void;
  readonly initNpcs?: (ctx: StrategicContext) => void;
}

export function initializeMapStructure(ctx: StrategicContext): void {
  const map = ctx.state.map;
  map.elements = map.elements.map(createMapElement);
  for (const town of ctx.content.towns) {
    for (const id of town.sectors) {
      const e = map.elements[strategicIndex(sectorFromId(id))];
      if (e) e.nameId = town.townId;
    }
  }
}

export function setupNewStrategicMap(ctx: StrategicContext): void {
  for (const e of ctx.state.map.elements) e.enemyControlled = true;
}

export function initStrategicMovementCosts(ctx: StrategicContext): void {
  const { traversability, travelRatings } = ctx.content.movementCosts;
  ctx.state.map.sectors.forEach((info, id) => {
    info.travelRating = travelRatings[id] ?? 0;
    info.traversability = [...(traversability[id] ?? info.traversability)];
  });
}

export function initKnownFacilitiesFlags(ctx: StrategicContext): void {
  for (const f of ctx.content.facilities) {
    const info = ctx.state.map.sectors[f.sector];
    if (info) info.facilities = u32(info.facilities | f.flags);
  }
}

export function buildUndergroundSectorInfoList(ctx: StrategicContext): void {
  const d = ctx.state.options.difficulty - 1;
  ctx.state.map.underground = ctx.content.underground.map((t): UndergroundSector => {
    const u = createUndergroundSector(sectorFromId(t.sector, t.z), t.adjacentSectors);
    u.numTroops = u8((t.numTroops[d] ?? 0) + ctx.random.int(t.numTroopsVariance[d] ?? 0));
    u.numElites = u8((t.numElites[d] ?? 0) + ctx.random.int(t.numElitesVariance[d] ?? 0));
    u.numCreatures = u8((t.numCreatures[d] ?? 0) + ctx.random.int(t.numCreaturesVariance[d] ?? 0));
    return u;
  });
}

export function initNewCampaignMap(ctx: StrategicContext, hooks: StrategicLayerHooks = {}): void {
  const map = ctx.state.map;
  map.sectors = map.sectors.map(createSectorInfo);
  initStrategicMovementCosts(ctx);
  removeAllGroups(ctx);
  initKnownFacilitiesFlags(ctx);
  buildUndergroundSectorInfoList(ctx);
  const policy = ctx.content.policy;
  if (policy.startSectorRevealed)
    setSectorFlag(map, sectorFromId(policy.startSector), SectorFlag.ALREADY_VISITED, worldDay(ctx.state.clock));
  hooks.initStrategicAI?.(ctx);
}

export function initNpcPlacements(ctx: StrategicContext): void {
  const s = ctx.state;
  s.npcPlacements.clear();
  for (const placement of ctx.content.npcPlacements) {
    if (placement.sciFiOnly && !s.options.sciFi) continue;
    if (placement.sectors.length === 0) continue;
    const sector = placement.sectors[ctx.random.int(placement.sectors.length)] ?? 0;
    const info = s.map.sectors[sector];
    if (placement.useAlternateMap && info) info.flags = u32(info.flags | SectorFlag.USE_ALTERNATE_MAP);
    if (placement.placedAtStart) s.npcPlacements.set(placement.profile, sector);
  }
}

export function initTixaBasementWithoutSciFi(ctx: StrategicContext): void {
  if (ctx.state.options.sciFi) return;
  const u = findUndergroundSector(ctx.state.map, TIXA_BASEMENT);
  if (u) u.flags = u32(u.flags | SectorFlag.USE_ALTERNATE_MAP);
}

export function initBloodCatSectors(ctx: StrategicContext): void {
  const sectors = ctx.state.map.sectors;
  for (let id = 0; id < LAST_SECTOR_WITH_UNROLLED_BLOODCATS; id++) {
    const info = sectors[id];
    if (info) info.bloodCats = UNROLLED_BLOODCATS;
  }
  for (const p of ctx.content.bloodCatPlacements) {
    const info = sectors[p.sector];
    if (info) info.bloodCatPlacements = p.placements;
  }
  const d = ctx.state.options.difficulty - 1;
  for (const s of ctx.content.bloodCatSpawns) {
    const info = sectors[s.sector];
    if (!info) continue;
    info.bloodCatPlacements = s.spawnsByDifficulty[d] ?? 0;
    info.bloodCats = s.spawnsByDifficulty[d] ?? 0;
  }
}

export function initStrategicLayerMap(ctx: StrategicContext, hooks: StrategicLayerHooks = {}): void {
  if (ctx.state.map.elements.every((e) => e.nameId === 0)) initializeMapStructure(ctx);
  setupNewStrategicMap(ctx);
  initNewCampaignMap(ctx, hooks);
  initSquads(ctx);
  initVehicles(ctx);
  hooks.initNpcs?.(ctx);
  initNpcPlacements(ctx);
  initTixaBasementWithoutSciFi(ctx);
  initializeHelicopter(ctx);
  ctx.state.forces.vehicles = [];
  initBloodCatSectors(ctx);
  initializeSamSites(ctx);
  initMapSecrets(ctx);
  ctx.state.map.selectedSector = sectorFromId(ctx.content.policy.startSector);
}
