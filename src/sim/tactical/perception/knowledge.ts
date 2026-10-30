// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/Knowledge.cc MostImportantNoiseHeard (personal and public heard entries, personal and team
// @src noise), WhatIKnowThatPublicDont; AIUtils.cc ClosestKnownOpponent, GuySawEnemyThisTurnOrBefore.

import { pythSpacesAway, spacesAway } from '../../../content/world/grid.ts';
import { u8 } from '../../../core/int.ts';
import { getInterveningClimbingLocation } from '../buildings.ts';
import { soldierTo3DLocationLos } from '../combat/positions.ts';
import { CivilianGroup, isCreatureOrBloodcat, NOWHERE, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { knowledge, Opp } from './sight.ts';

const NOISE_FORGET_DISTANCE = 6;
const MAX_DISTANCE_VISIBLE = 26;
const NO_NOISE_VALUE = -10000;

export interface NoiseKnowledge {
  readonly gridNo: number;
  readonly value: number;
  readonly climb: boolean;
  readonly reachable: boolean;
}

export interface KnownPosition {
  readonly gridNo: number;
  readonly level: number;
}

function considered(s: Soldier, opp: Soldier): boolean {
  return (opp.neutral && s.team !== Team.CREATURE) || s.side === opp.side;
}

export function personalLastKnown(s: Soldier, opp: Soldier): KnownPosition {
  return { gridNo: s.lastKnownOpp[opp.id] ?? NOWHERE, level: s.lastKnownOppLevel[opp.id] ?? 0 };
}

function publicLastKnown(t: TacticalState, team: number, opp: Soldier): KnownPosition {
  const p = t.perception;
  return { gridNo: p.publicLastKnown[team]?.[opp.id] ?? NOWHERE, level: p.publicLastKnownLevel[team]?.[opp.id] ?? 0 };
}

export function freshestLastKnown(t: TacticalState, s: Soldier, opp: Soldier, personal: number, publicValue: number): KnownPosition {
  return knowledge(publicValue, personal) > 0 || personal === publicValue ? personalLastKnown(s, opp) : publicLastKnown(t, s.team, opp);
}

export function noiseStillUseful(t: TacticalState, s: Soldier, g: number, level: number): boolean {
  return (
    level !== s.level ||
    pythSpacesAway(s.gridNo, g) >= NOISE_FORGET_DISTANCE ||
    soldierTo3DLocationLos(t, s, g, level, 0, MAX_DISTANCE_VISIBLE, false) === 0
  );
}

interface LoudestNoise {
  readonly gridNo: number;
  readonly value: number;
  readonly level: number;
}

function loudestNoise(t: TacticalState, s: Soldier): LoudestNoise {
  let best: LoudestNoise = { gridNo: NOWHERE, value: NO_NOISE_VALUE, level: 0 };
  const consider = (gridNo: number, value: number, level: number) => {
    if (value > best.value) best = { gridNo, value, level };
  };
  for (const opp of t.mercSlots) {
    if (!opp?.placed || !opp.life || considered(s, opp)) continue;
    const personal = s.oppList[opp.id] ?? 0;
    if (personal < Opp.NOT_HEARD_OR_SEEN) {
      const heard = personalLastKnown(s, opp);
      consider(heard.gridNo, personal * spacesAway(s.gridNo, heard.gridNo), heard.level);
    }
    const publicValue = t.perception.publicOpp[s.team]?.[opp.id] ?? 0;
    if (publicValue < Opp.NOT_HEARD_OR_SEEN) {
      const heard = publicLastKnown(t, s.team, opp);
      consider(heard.gridNo, publicValue * spacesAway(s.gridNo, heard.gridNo), heard.level);
    }
  }
  if (s.ai.noiseGridNo !== NOWHERE) {
    if (noiseStillUseful(t, s, s.ai.noiseGridNo, s.ai.noiseLevel))
      consider(s.ai.noiseGridNo, noiseValue(s.ai.noiseVolume, spacesAway(s.gridNo, s.ai.noiseGridNo)), s.ai.noiseLevel);
    else {
      s.ai.noiseGridNo = NOWHERE;
      s.ai.noiseVolume = 0;
    }
  }
  if (s.team !== Team.CIV || s.civilianGroup === CivilianGroup.KINGPIN) {
    const g = t.perception.publicNoiseGridNo[s.team] ?? NOWHERE;
    const level = t.perception.publicNoiseLevel[s.team] ?? 0;
    if (g !== NOWHERE && noiseStillUseful(t, s, g, level))
      consider(g, noiseValue(t.perception.publicNoiseVolume[s.team] ?? 0, spacesAway(s.gridNo, g)), level);
  }
  return best;
}

function noiseValue(volume: number, distance: number): number {
  return (Math.trunc(volume / 2) - 6) * distance;
}

export function noiseHeard(t: TacticalState, s: Soldier): NoiseKnowledge {
  const { gridNo, value, level } = loudestNoise(t, s);
  if (gridNo === NOWHERE) return { gridNo, value, climb: false, reachable: false };
  const intervening = getInterveningClimbingLocation(t, s, gridNo, level);
  if (!intervening.necessary) return { gridNo, value, climb: false, reachable: true };
  if (intervening.gridNo === NOWHERE) return { gridNo, value, climb: false, reachable: false };
  return { gridNo: intervening.gridNo, value, climb: true, reachable: true };
}

export function mostImportantNoiseHeard(t: TacticalState, s: Soldier): number {
  return loudestNoise(t, s).gridNo;
}

export function whatIKnowThatPublicDont(t: TacticalState, s: Soldier, inSightOnly: boolean): number {
  let total = 0;
  const publicVolume = t.perception.publicNoiseVolume[s.team] ?? 0;
  if (!isCreatureOrBloodcat(s) && s.ai.noiseVolume > publicVolume) total = u8(total + s.ai.noiseVolume - publicVolume);
  for (const opp of t.mercSlots) {
    if (!opp?.placed || considered(s, opp)) continue;
    const personal = s.oppList[opp.id] ?? 0;
    const publicValue = t.perception.publicOpp[s.team]?.[opp.id] ?? 0;
    if (inSightOnly) {
      if (personal === Opp.SEEN_CURRENTLY && publicValue !== Opp.SEEN_CURRENTLY) total = u8(total + 1);
    } else total = u8(total + knowledge(publicValue, personal));
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
    if (considered(s, opp)) continue;
    const personal = s.oppList[opp.id] ?? 0;
    const publicValue = t.perception.publicOpp[s.team]?.[opp.id] ?? 0;
    if (personal === Opp.NOT_HEARD_OR_SEEN && publicValue === Opp.NOT_HEARD_OR_SEEN) continue;
    const known = freshestLastKnown(t, s, opp, personal, publicValue);
    if (known.gridNo === NOWHERE || known.gridNo === s.gridNo) continue;
    const range = rangeInCells(s.gridNo, known.gridNo);
    if (range < closestRange) {
      closestRange = range;
      closest = known.gridNo;
    }
  }
  return closest;
}
