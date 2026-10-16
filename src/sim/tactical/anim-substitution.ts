// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Animation_Control.cc SubstituteBodyTypeAnimation, IsAnimationValidForBodyType. See docs/06 §1.2.

import { INVALID_SURFACE } from '../../content/anim/tables.ts';
import { anim, animName } from './anim-states.ts';
import type { TacticalContent } from './content.ts';
import { Body, type Soldier, Team } from './soldier.ts';

type Substitutions = Readonly<Record<string, string>>;

const QUEEN: Substitutions = {
  STANDING: 'QUEEN_MONSTER_BREATHING',
  WALKING: 'QUEEN_MONSTER_BREATHING',
  RUNNING: 'QUEEN_MONSTER_BREATHING',
};
const LARVAE: Substitutions = { STANDING: 'LARVAE_BREATH', WALKING: 'LARVAE_WALK', RUNNING: 'LARVAE_WALK' };
const CROW: Substitutions = { WALKING: 'CROW_WALK', STANDING: 'CROW_EAT' };
const BLOODCAT: Substitutions = { RUNNING: 'BLOODCAT_RUN' };
const MONSTER: Substitutions = { WALKING: 'ADULTMONSTER_WALKING', RUNNING: 'ADULTMONSTER_WALKING' };
const ROBOT: Substitutions = { WALKING: 'ROBOT_WALK', RUNNING: 'ROBOT_WALK' };
const CIV_ROBOT: Substitutions = { ...ROBOT, STANDING: 'ROBOT_CAMERA_NOT_MOVING' };
const CIVILIAN: Substitutions = {
  KNEEL_UP: 'END_COWER',
  KNEEL_DOWN: 'START_COWER',
  WKAEUP_FROM_SLEEP: 'STANDING',
  GOTO_SLEEP: 'STANDING',
  SLEEPING: 'STANDING',
};

function substitutionsFor(s: Pick<Soldier, 'bodyType' | 'team'>): Substitutions | null {
  switch (s.bodyType) {
    case Body.QUEENMONSTER:
      return QUEEN;
    case Body.LARVAE_MONSTER:
      return LARVAE;
    case Body.CROW:
      return CROW;
    case Body.BLOODCAT:
      return BLOODCAT;
    case Body.ADULTFEMALEMONSTER:
    case Body.AM_MONSTER:
    case Body.YAF_MONSTER:
    case Body.YAM_MONSTER:
      return MONSTER;
    case Body.ROBOTNOWEAPON:
      return s.team === Team.CIV ? CIV_ROBOT : ROBOT;
    default:
      return s.bodyType >= Body.FATCIV && s.bodyType <= Body.CRIPPLECIV ? CIVILIAN : null;
  }
}

export function substituteBodyTypeAnimation(content: TacticalContent, s: Pick<Soldier, 'bodyType' | 'team'>, state: number): number {
  const replacement = substitutionsFor(s)?.[animName(content, state)];
  return replacement ? anim(content, replacement) : state;
}

export function isAnimationValidForBodyType(content: TacticalContent, s: Pick<Soldier, 'bodyType' | 'team'>, state: number): boolean {
  const surface = content.animations.bodySurfaces[s.bodyType]?.[substituteBodyTypeAnimation(content, s, state)];
  return surface !== undefined && surface !== INVALID_SURFACE;
}
