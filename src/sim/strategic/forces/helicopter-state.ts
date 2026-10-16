// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Helicopter.cc InitializeHelicopter, g_refuel_site, the helicopter globals;
// @src Map_Screen_Helicopter.h DRASSEN_REFUELING_SITE, ESTONI_REFUELING_SITE. See docs/25 §10.1.

import type { Sector } from '../../../content/strategic/sector-ids.ts';

export const RefuelSiteId = { DRASSEN: 0, ESTONI: 1 } as const;

export interface RefuelSite {
  readonly sector: Sector;
  readonly gridNo: number;
}

export const REFUEL_SITES: readonly RefuelSite[] = [
  { sector: { x: 13, y: 2, z: 0 }, gridNo: 9001 },
  { sector: { x: 6, y: 9, z: 0 }, gridNo: 13067 },
];

export interface HelicopterState {
  setUp: boolean;
  returningToBase: boolean;
  hovering: boolean;
  startHoverMinute: number;
  totalCost: number;
  destroyed: boolean;
  talkState: number;
  lastMonologueMinute: number;
  emptyHelpGiven: boolean;
  hitsTaken: number;
  saidCongratsOnTakingSam: boolean;
  progressLastCommentedOn: number;
  readonly refuelSiteAvailable: boolean[];
}

export function createHelicopterState(): HelicopterState {
  return {
    setUp: false,
    returningToBase: false,
    hovering: false,
    startHoverMinute: 0,
    totalCost: 0,
    destroyed: false,
    talkState: 0,
    lastMonologueMinute: 0,
    emptyHelpGiven: false,
    hitsTaken: 0,
    saidCongratsOnTakingSam: false,
    progressLastCommentedOn: 0,
    refuelSiteAvailable: REFUEL_SITES.map(() => false),
  };
}
