// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc HandleAtNewGridNo (the escorted Skyrider reaching his chopper in the Drassen airport).
// @src See docs/25 §9.3, §10.2.

import { pythSpacesAway } from '../../../content/world/grid.ts';
import { stopMerc } from '../movement.ts';
import { type Soldier, Team } from '../soldier.ts';
import type { SectorRef, TacticalState } from '../state.ts';
import { Profile } from './constants.ts';

export const DRASSEN_AIRPORT: SectorRef = { x: 13, y: 2, z: 0 };
export const CHOPPER_GRIDNO = 8842;
const CHOPPER_RADIUS = 11;
const FACT_SKYRIDER_CLOSE_TO_CHOPPER = 43;
const SKYRIDER_AT_CHOPPER_RECORD = 15;

function inDrassenAirport(t: TacticalState): boolean {
  const s = t.sector;
  return s !== null && s.x === DRASSEN_AIRPORT.x && s.y === DRASSEN_AIRPORT.y && s.z === DRASSEN_AIRPORT.z;
}

export function handleEscortArrival(t: TacticalState, s: Soldier): void {
  if (s.team !== Team.OUR || !t.narrative.isEpc(s) || !inDrassenAirport(t)) return;
  if (s.profile !== Profile.SKYRIDER || pythSpacesAway(s.gridNo, CHOPPER_GRIDNO) >= CHOPPER_RADIUS) return;
  stopMerc(t, s);
  t.narrative.setFactTrue(FACT_SKYRIDER_CLOSE_TO_CHOPPER);
  t.narrative.triggerNpcRecord(Profile.SKYRIDER, SKYRIDER_AT_CHOPPER_RECORD);
  t.narrative.setUpHelicopterForPlayer(DRASSEN_AIRPORT);
}
