// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/SAM_Sites.cc DoesSAMExistHere, UpdateAndDamageSAMIfFound, UpdateSAMDoneRepair,
// @src GetNumberOfSAMSitesUnderPlayerControl, IsThereAFunctionalSAMSiteInSector;
// @src src/externalized/strategic/SamSiteModel.cc doesSamExistHere.

import { type Sector, sectorFromId, sectorId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { MIN_CONDITION_FOR_SAM_SITE_TO_WORK, SAM_CONDITION_AT_START } from '../forces/constants.ts';
import type { StrategicContext } from '../forces/ports.ts';
import { samIdOfSector, updateAirspaceControl } from './control.ts';

export function doesSamExistHere(ctx: StrategicContext, s: Sector, gridNo: number): boolean {
  if (s.z !== 0) return false;
  const id = sectorId(s);
  return ctx.content.samSites.some((sam) => sam.sector === id && sam.gridNos.includes(gridNo));
}

export function damageSamIfFound(ctx: StrategicContext, s: Sector, gridNo: number, damage: number): boolean {
  if (!doesSamExistHere(ctx, s, gridNo)) return false;
  const element = ctx.state.map.elements[strategicIndex(s)];
  if (!element) return false;
  element.samCondition = element.samCondition >= damage ? element.samCondition - damage : 0;
  updateAirspaceControl(ctx);
  return true;
}

export function repairSamSite(ctx: StrategicContext, s: Sector): boolean {
  if (s.z !== 0 || samIdOfSector(ctx, s) === -1) return false;
  const element = ctx.state.map.elements[strategicIndex(s)];
  if (element) element.samCondition = SAM_CONDITION_AT_START;
  updateAirspaceControl(ctx);
  return true;
}

export function numberOfSamSitesUnderPlayerControl(ctx: StrategicContext): number {
  let n = 0;
  for (const sam of ctx.content.samSites) if (!ctx.state.map.elements[strategicIndex(sectorFromId(sam.sector))]?.enemyControlled) n++;
  return n;
}

export function isThereAFunctionalSamSiteInSector(ctx: StrategicContext, s: Sector): boolean {
  return s.z === 0 && samIdOfSector(ctx, s) !== -1 && samSiteWorks(ctx, s);
}

export function samSiteWorks(ctx: StrategicContext, s: Sector): boolean {
  return (ctx.state.map.elements[strategicIndex(s)]?.samCondition ?? 0) >= MIN_CONDITION_FOR_SAM_SITE_TO_WORK;
}
