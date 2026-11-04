// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface.cc MapscreenCanPassItemToChar (an item held on the map screen passes to
// @src a merc only with no enemy in the loaded sector: from the sector inventory to a merc standing in its sector, from a
// @src merc to one in his sector, on the road only within the same squad or vehicle).

import { type Sector, sameSector } from '../../content/strategic/sector-ids.ts';
import { Assignment } from '../strategic/forces/constants.ts';

export interface ItemHolder {
  readonly sector: Sector;
  readonly betweenSectors: boolean;
  readonly assignment: number;
  readonly vehicleId: number;
}

export type HeldItemSource = { readonly holder: ItemHolder } | { readonly stash: Sector };

export function passBetweenHoldersRefused(from: ItemHolder, to: ItemHolder): boolean {
  if (!sameSector(from.sector, to.sector)) return true;
  if (!to.betweenSectors) return false;
  if (!from.betweenSectors || from.assignment !== to.assignment) return true;
  return to.assignment === Assignment.VEHICLE && to.vehicleId !== from.vehicleId;
}

export function mapscreenCanPassItemToChar(enemyInLoadedSector: boolean, source: HeldItemSource, to: ItemHolder): boolean {
  if (enemyInLoadedSector) return false;
  if ('stash' in source) return sameSector(to.sector, source.stash) && !to.betweenSectors;
  return !passBetweenHoldersRefused(source.holder, to);
}
