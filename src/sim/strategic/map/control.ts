// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Player_Command.cc SetThisSectorAsPlayerControlled, SetThisSectorAsEnemyControlled;
// @src SAM_Sites.cc InitializeSAMSites, UpdateAirspaceControl, IsThisSectorASAMSector, GetSAMIdFromSector;
// @src StrategicMap_Secrets.cc InitMapSecrets, SetSectorSecretAsFound, GetMapSecretBySectorID, IsSecretFoundAt. See docs/16 §6.

import { MAP_SIDE, type Sector, sectorId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { MIN_CONDITION_FOR_SAM_SITE_TO_WORK, SAM_CONDITION_AT_START } from '../forces/constants.ts';
import { numHostilesInSector, playerMercsInSector } from '../forces/groups.ts';
import type { StrategicContext } from '../forces/ports.ts';
import { worldDay } from '../time/world-clock.ts';
import { sectorInfo, updateLastDayOfPlayerActivity } from './sectors.ts';

const FIRST_TOWN = 1;
const NUM_TOWNS = 13;
const OMERTA = 1;
const FIRST_DAY = 1;
const SEC_J9 = 153;
const SEC_K4 = 163;
const SEC_P3 = 242;
const HARD_GRACE_DAYS = 2;
const NORMAL_GRACE_DAYS = 1;

export function samIdOfSector(ctx: StrategicContext, s: Sector): number {
  if (s.z !== 0) return -1;
  const id = sectorId(s);
  return ctx.content.samSites.findIndex((sam) => sam.sector === id);
}

export function isThisSectorASamSector(ctx: StrategicContext, s: Sector): boolean {
  return samIdOfSector(ctx, s) > -1;
}

export function townIdOfSector(ctx: StrategicContext, s: Sector): number {
  return ctx.state.map.elements[strategicIndex(s)]?.nameId ?? 0;
}

function isTown(townId: number): boolean {
  return townId >= FIRST_TOWN && townId < NUM_TOWNS;
}

export function updateAirspaceControl(ctx: StrategicContext): void {
  const { elements } = ctx.state.map;
  const sams = ctx.content.samSites;
  for (let x = 1; x <= MAP_SIDE; x++) {
    for (let y = 1; y <= MAP_SIDE; y++) {
      const controlling = ctx.content.samAirControl[sectorId({ x, y })] ?? -1;
      const sam = controlling >= 0 ? sams[controlling] : undefined;
      let enemy = false;
      if (sam) {
        const e = elements[strategicIndex({ x: (sam.sector % MAP_SIDE) + 1, y: Math.trunc(sam.sector / MAP_SIDE) + 1 })];
        enemy = e?.enemyControlled === true && e.samCondition >= MIN_CONDITION_FOR_SAM_SITE_TO_WORK;
      }
      const element = elements[strategicIndex({ x, y })];
      if (element) element.enemyAirControlled = enemy;
    }
  }
  ctx.world.airspaceControlUpdated?.();
}

export function initializeSamSites(ctx: StrategicContext): void {
  for (const sam of ctx.content.samSites) {
    const e = ctx.state.map.elements[strategicIndex({ x: (sam.sector % MAP_SIDE) + 1, y: Math.trunc(sam.sector / MAP_SIDE) + 1 })];
    if (e) e.samCondition = SAM_CONDITION_AT_START;
  }
  updateAirspaceControl(ctx);
}

export function initMapSecrets(ctx: StrategicContext): void {
  ctx.state.map.secretsFound = ctx.content.secrets.map(() => false);
}

export function secretIndexAt(ctx: StrategicContext, id: number): number {
  return ctx.content.secrets.findIndex((s) => s.sector === id);
}

export function markSecretFoundAt(ctx: StrategicContext, id: number, found = true): void {
  const at = secretIndexAt(ctx, id);
  if (at >= 0) ctx.state.map.secretsFound[at] = found;
}

export function isSecretFoundAt(ctx: StrategicContext, id: number): boolean {
  const at = secretIndexAt(ctx, id);
  return at < 0 || ctx.state.map.secretsFound[at] === true;
}

export function setThisSectorAsPlayerControlled(ctx: StrategicContext, s: Sector, contested: boolean): boolean {
  if (ctx.world.inMeanwhile()) return false;
  let wasEnemy = false;
  if (s.z === 0) {
    if (numHostilesInSector(ctx, s)) return false;
    ctx.world.playerControlsSurfaceSector?.(s);
    const element = ctx.state.map.elements[strategicIndex(s)];
    if (!element) return false;
    wasEnemy = element.enemyControlled;
    element.enemyControlled = false;
    const townId = element.nameId;
    if (isTown(townId)) ctx.world.startTownLoyalty(townId);
    if (wasEnemy && contested) liberate(ctx, s, townId);
    if (contested) ctx.ai.queenLostControlOfSector(s);
  } else if (sectorId(s) === SEC_P3 && s.z === 1) {
    ctx.ai.queenBasementTaken();
  }
  if (s.z === 0) sectorInfo(ctx.state.map, s).surfaceWasEverPlayerControlled = true;
  updateAirspaceControl(ctx);
  return wasEnemy;
}

function liberate(ctx: StrategicContext, s: Sector, townId: number): void {
  const id = sectorId(s);
  const day = worldDay(ctx.state.clock);
  const townCounts = isTown(townId) && (townId !== OMERTA || day !== FIRST_DAY) && id !== SEC_J9 && id !== SEC_K4;
  const samId = samIdOfSector(ctx, s);
  const firstTime = !sectorInfo(ctx.state.map, s).surfaceWasEverPlayerControlled;
  if (samId !== -1 && firstTime) {
    updateLastDayOfPlayerActivity(ctx.state.map, day + (ctx.state.options.difficulty >= 3 ? HARD_GRACE_DAYS : NORMAL_GRACE_DAYS));
  }
  ctx.world.sectorLiberated({ sector: s, townId: townCounts ? townId : 0, samId, firstTime });
}

export function setThisSectorAsEnemyControlled(ctx: StrategicContext, s: Sector): boolean {
  if (ctx.state.battle.autoStart) return false;
  let wasPlayer = false;
  if (s.z === 0) {
    const element = ctx.state.map.elements[strategicIndex(s)];
    if (!element) return false;
    wasPlayer = !element.enemyControlled;
    element.enemyControlled = true;
    if (wasPlayer && playerMercsInSector(ctx, s)) return false;
    ctx.world.sectorTakenByEnemy(s, wasPlayer);
  }
  updateAirspaceControl(ctx);
  return wasPlayer;
}
