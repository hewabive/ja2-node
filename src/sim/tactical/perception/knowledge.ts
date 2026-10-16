// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/Knowledge.cc MostImportantNoiseHeard (personal and public heard entries, personal and team
// @src noise), WhatIKnowThatPublicDont; AIUtils.cc ClosestKnownOpponent, GuySawEnemyThisTurnOrBefore. See docs/09 §4.2,
// @src docs/13 §2.

import { pythSpacesAway, spacesAway } from '../../../content/world/grid.ts';
import { getInterveningClimbingLocation } from '../buildings.ts';
import { soldierTo3DLocationLos } from '../combat/positions.ts';
import { NOWHERE, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { knowledge, Opp } from './sight.ts';

const NOISE_FORGET_DISTANCE = 6;
const MAX_DISTANCE_VISIBLE = 26;
const KINGPIN_CIV_GROUP = 4;

export interface NoiseKnowledge {
  readonly gridNo: number;
  readonly value: number;
  readonly climb: boolean;
  readonly reachable: boolean;
}

function considered(s: Soldier, opp: Soldier): boolean {
  return (opp.neutral && s.team !== Team.CREATURE) || s.side === opp.side;
}

function noiseStillUseful(t: TacticalState, s: Soldier, g: number, level: number): boolean {
  return (
    level !== s.level ||
    pythSpacesAway(s.gridNo, g) >= NOISE_FORGET_DISTANCE ||
    soldierTo3DLocationLos(t, s, g, level, 0, MAX_DISTANCE_VISIBLE, false) === 0
  );
}

export function noiseHeard(t: TacticalState, s: Soldier): NoiseKnowledge {
  let best = NOWHERE;
  let bestValue = -10000;
  let bestLevel = 0;
  const consider = (g: number, value: number, level: number) => {
    if (value > bestValue) {
      bestValue = value;
      best = g;
      bestLevel = level;
    }
  };
  for (const opp of t.mercSlots) {
    if (!opp?.placed || !opp.life || considered(s, opp)) continue;
    const personal = s.oppList[opp.id] ?? 0;
    if (personal < Opp.NOT_HEARD_OR_SEEN) {
      const g = s.lastKnownOpp[opp.id] ?? NOWHERE;
      consider(g, personal * spacesAway(s.gridNo, g), opp.level);
    }
    const publicValue = t.perception.publicOpp[s.team]?.[opp.id] ?? 0;
    if (publicValue < Opp.NOT_HEARD_OR_SEEN) {
      const g = t.perception.publicLastKnown[s.team]?.[opp.id] ?? NOWHERE;
      consider(g, publicValue * spacesAway(s.gridNo, g), opp.level);
    }
  }
  if (s.ai.noiseGridNo !== NOWHERE) {
    if (noiseStillUseful(t, s, s.ai.noiseGridNo, s.ai.noiseLevel))
      consider(s.ai.noiseGridNo, (Math.trunc(s.ai.noiseVolume / 2) - 6) * spacesAway(s.gridNo, s.ai.noiseGridNo), s.ai.noiseLevel);
    else {
      s.ai.noiseGridNo = NOWHERE;
      s.ai.noiseVolume = 0;
    }
  }
  if (s.team !== Team.CIV || s.civilianGroup === KINGPIN_CIV_GROUP) {
    const g = t.perception.publicNoiseGridNo[s.team] ?? NOWHERE;
    const level = t.perception.publicNoiseLevel[s.team] ?? 0;
    if (g !== NOWHERE && noiseStillUseful(t, s, g, level))
      consider(g, (Math.trunc((t.perception.publicNoiseVolume[s.team] ?? 0) / 2) - 6) * spacesAway(s.gridNo, g), level);
  }
  let reachable = false;
  let climb = false;
  if (best !== NOWHERE) {
    reachable = true;
    const intervening = getInterveningClimbingLocation(t, s, best, bestLevel);
    if (intervening.necessary) {
      if (intervening.gridNo === NOWHERE) reachable = false;
      else {
        best = intervening.gridNo;
        climb = true;
      }
    }
  }
  return { gridNo: best, value: bestValue, climb, reachable };
}

export function mostImportantNoiseHeard(t: TacticalState, s: Soldier): number {
  let best = NOWHERE;
  let bestValue = -10000;
  const consider = (g: number, value: number) => {
    if (value > bestValue) {
      bestValue = value;
      best = g;
    }
  };
  for (const opp of t.mercSlots) {
    if (!opp?.placed || !opp.life || considered(s, opp)) continue;
    const personal = s.oppList[opp.id] ?? 0;
    if (personal < Opp.NOT_HEARD_OR_SEEN) {
      const g = s.lastKnownOpp[opp.id] ?? NOWHERE;
      consider(g, personal * spacesAway(s.gridNo, g));
    }
    const publicValue = t.perception.publicOpp[s.team]?.[opp.id] ?? 0;
    if (publicValue < Opp.NOT_HEARD_OR_SEEN) {
      const g = t.perception.publicLastKnown[s.team]?.[opp.id] ?? NOWHERE;
      consider(g, publicValue * spacesAway(s.gridNo, g));
    }
  }
  if (s.ai.noiseGridNo !== NOWHERE) {
    if (noiseStillUseful(t, s, s.ai.noiseGridNo, s.ai.noiseLevel))
      consider(s.ai.noiseGridNo, (Math.trunc(s.ai.noiseVolume / 2) - 6) * spacesAway(s.gridNo, s.ai.noiseGridNo));
    else {
      s.ai.noiseGridNo = NOWHERE;
      s.ai.noiseVolume = 0;
    }
  }
  if (s.team !== Team.CIV || s.civilianGroup === KINGPIN_CIV_GROUP) {
    const g = t.perception.publicNoiseGridNo[s.team] ?? NOWHERE;
    const level = t.perception.publicNoiseLevel[s.team] ?? 0;
    if (g !== NOWHERE && noiseStillUseful(t, s, g, level))
      consider(g, (Math.trunc((t.perception.publicNoiseVolume[s.team] ?? 0) / 2) - 6) * spacesAway(s.gridNo, g));
  }
  return best;
}

export function whatIKnowThatPublicDont(t: TacticalState, s: Soldier, inSightOnly: boolean): number {
  let total = 0;
  const publicVolume = t.perception.publicNoiseVolume[s.team] ?? 0;
  const creature = (s.bodyType >= 4 && s.bodyType <= 10) || s.bodyType === 20;
  if (!creature && s.ai.noiseVolume > publicVolume) total = (total + s.ai.noiseVolume - publicVolume) & 0xff;
  for (const opp of t.mercSlots) {
    if (!opp?.placed || considered(s, opp)) continue;
    const personal = s.oppList[opp.id] ?? 0;
    const publicValue = t.perception.publicOpp[s.team]?.[opp.id] ?? 0;
    if (inSightOnly) {
      if (personal === Opp.SEEN_CURRENTLY && publicValue !== Opp.SEEN_CURRENTLY) total = (total + 1) & 0xff;
    } else total = (total + knowledge(publicValue, personal)) & 0xff;
  }
  return total;
}

export function guySawEnemyThisTurnOrBefore(t: TacticalState, s: Soldier): boolean {
  for (const opp of t.mercSlots) {
    if (!opp?.placed || opp.side === s.side) continue;
    const v = s.oppList[opp.id] ?? 0;
    if (v >= Opp.SEEN_CURRENTLY && v <= Opp.SEEN_3_TURNS_AGO) return true;
  }
  return false;
}

const rangeInCells = (a: number, b: number) => {
  const dx = (a % 160) - (b % 160);
  const dy = Math.trunc(a / 160) - Math.trunc(b / 160);
  return Math.trunc(Math.sqrt(dx * dx + dy * dy) * 10);
};

export function closestKnownOpponent(t: TacticalState, s: Soldier): number {
  let closest = NOWHERE;
  let closestRange = 1500;
  for (const opp of t.mercSlots) {
    if (!opp?.placed) continue;
    if ((opp.neutral && s.team !== Team.CREATURE) || s.side === opp.side) continue;
    const personal = s.oppList[opp.id] ?? 0;
    const publicValue = t.perception.publicOpp[s.team]?.[opp.id] ?? 0;
    if (personal === Opp.NOT_HEARD_OR_SEEN && publicValue === Opp.NOT_HEARD_OR_SEEN) continue;
    const g =
      knowledge(publicValue, personal) > 0 || personal === publicValue
        ? (s.lastKnownOpp[opp.id] ?? NOWHERE)
        : (t.perception.publicLastKnown[s.team]?.[opp.id] ?? NOWHERE);
    if (g === NOWHERE || g === s.gridNo) continue;
    const range = rangeInCells(s.gridNo, g);
    if (range < closestRange) {
      closestRange = range;
      closest = g;
    }
  }
  return closest;
}
