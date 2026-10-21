// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Spread_Burst.cc AccumulateBurstLocation (up to MAX_BURST_LOCATIONS distinct gridNos in drag
// @src order), PickBurstLocations (the FLOAT step over the shots per burst); Turn_Based_Input.cc and Real_Time_Input.cc
// @src (fDoSpread on release). See docs/28 §6.1, §12.4.

import { isVisibleTile } from '../../../content/world/grid.ts';
import type { Soldier } from '../soldier.ts';

export const MAX_BURST_LOCATIONS = 50;
const MAX_SPREAD_SHOTS = 6;

export function parseSpread(value: unknown): number[] | null | string {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length === 0) return 'spread must be a non-empty list of gridNos';
  const locations: number[] = [];
  for (const g of value) {
    if (typeof g !== 'number' || !Number.isInteger(g) || !isVisibleTile(g)) return 'spread must list visible gridNos';
    if (locations.length < MAX_BURST_LOCATIONS && !locations.includes(g)) locations.push(g);
  }
  return locations;
}

export function pickBurstLocations(s: Soldier, locations: readonly number[], shotsPerBurst: number): void {
  const step = Math.fround(locations.length / shotsPerBurst);
  let accumulator = 0;
  for (let shot = 0; shot < Math.min(shotsPerBurst, MAX_SPREAD_SHOTS); shot++) {
    s.spreadLocations[shot] = locations[Math.trunc(accumulator) & 0xff] ?? 0;
    accumulator = Math.fround(accumulator + step);
  }
  s.doSpread = 1;
}
