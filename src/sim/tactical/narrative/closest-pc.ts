// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/AIUtils.cc ClosestPC.

import { pythSpacesAway, WORLD_MAX } from '../../../content/world/grid.ts';
import { Opp } from '../perception/opp.ts';
import { NOWHERE, OKLIFE, type Soldier, Team } from '../soldier.ts';
import { type TacticalState, teamMembers } from '../state.ts';

const UNSEEN_PC_DISTANCE_PENALTY = 10;

export interface ClosestPc {
  readonly gridNo: number;
  readonly distance: number;
}

export function closestPc(t: TacticalState, s: Soldier): ClosestPc {
  let distance = WORLD_MAX;
  let gridNo = NOWHERE;
  for (const pc of teamMembers(t, Team.OUR)) {
    if (pc.life < OKLIFE || t.narrative.isEpc(pc)) continue;
    let d = pythSpacesAway(s.gridNo, pc.gridNo);
    if (pc.team !== s.team && s.oppList[pc.id] !== Opp.SEEN_CURRENTLY) d += UNSEEN_PC_DISTANCE_PENALTY;
    if (d < distance) {
      distance = d;
      gridNo = pc.gridNo;
    }
  }
  return { gridNo, distance };
}
