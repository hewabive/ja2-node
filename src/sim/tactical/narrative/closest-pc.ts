// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/AIUtils.cc ClosestPC (a helicopter passenger over the loaded sector at the original's NOWHERE,
// 2026-11-08).

import { pythSpacesAway, WORLD_MAX } from '../../../content/world/grid.ts';
import { Opp } from '../perception/opp.ts';
import { NOWHERE, OKLIFE, type Soldier, Team, withOriginalNowhere } from '../soldier.ts';
import { type TacticalState, teamInSector } from '../state.ts';

const UNSEEN_PC_DISTANCE_PENALTY = 10;

export interface ClosestPc {
  readonly gridNo: number;
  readonly distance: number;
}

export function closestPc(t: TacticalState, s: Soldier, isEpc: (pc: Soldier) => boolean = (pc) => t.narrative.isEpc(pc)): ClosestPc {
  let distance = WORLD_MAX;
  let gridNo = NOWHERE;
  for (const pc of teamInSector(t, Team.OUR)) {
    if (pc.life < OKLIFE || isEpc(pc)) continue;
    let d = pythSpacesAway(withOriginalNowhere(s.gridNo), withOriginalNowhere(pc.gridNo));
    if (pc.team !== s.team && s.oppList[pc.id] !== Opp.SEEN_CURRENTLY) d += UNSEEN_PC_DISTANCE_PENALTY;
    if (d < distance) {
      distance = d;
      gridNo = pc.gridNo;
    }
  }
  return { gridNo, distance };
}
