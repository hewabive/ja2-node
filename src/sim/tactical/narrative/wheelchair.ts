// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Ani.cc KickOutWheelchair and animation code 482 (END CRIPPLE KICKOUT). See docs/25 §3.9,
// @src §3.12.

import { DIRECTION_INCREMENT, newGridNo } from '../../../content/world/grid.ts';
import { anim } from '../anim-states.ts';
import { initNewSoldierAnim } from '../animation.ts';
import { setSoldierPosition, stopMerc } from '../movement.ts';
import { newOKDestination } from '../pathfinding.ts';
import { Body, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { Profile } from './constants.ts';

export const OP_END_CRIPPLE_KICKOUT = 482;
const THREATENINGLY_RAISE_GUN = 5;

export function kickOutWheelchair(t: TacticalState, s: Soldier): void {
  let gridNo = newGridNo(s.gridNo, DIRECTION_INCREMENT[s.direction] ?? 0);
  if (!newOKDestination(t.pathEnv, s, gridNo, true, s.level)) gridNo = s.gridNo;
  if (gridNo !== s.gridNo) setSoldierPosition(t, s, gridNo);
  stopMerc(t, s);
  s.bodyType = Body.REGMALE;
  if (s.profile === Profile.SLAY && s.team === Team.CIV && !s.neutral) t.narrative.npcAction(s.profile, THREATENINGLY_RAISE_GUN, 0);
  else initNewSoldierAnim(t, s, anim(t.content, 'STANDING'), 0, true);
}

export function wheelchairOpcode(t: TacticalState, s: Soldier, code: number): 'continue' | null {
  if (code !== OP_END_CRIPPLE_KICKOUT) return null;
  kickOutWheelchair(t, s);
  return 'continue';
}
