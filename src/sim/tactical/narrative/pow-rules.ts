// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Doors.cc HandleDoorsOpenClose and TileEngine/Explosion_Control.cc SpreadEffect (the
// @src DoPOWPathChecks calls in I13).

import type { TacticalState } from '../state.ts';

const ALMA_PRISON_X = 13;
const ALMA_PRISON_Y = 9;

export function checkPowPathsInAlmaPrison(t: TacticalState): void {
  const s = t.sector;
  if (s && s.x === ALMA_PRISON_X && s.y === ALMA_PRISON_Y) t.narrative.powPathChecks();
}
