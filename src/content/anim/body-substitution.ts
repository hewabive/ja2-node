// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Animation_Control.cc SubstituteBodyTypeAnimation.

import { Body } from './body-types.ts';
import { type AnimationTables, stateId } from './tables.ts';

type Substitutions = Readonly<Record<string, string>>;

export interface SubstitutedBody {
  readonly bodyType: number;
  readonly civilianTeam: boolean;
}

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

function substitutionsFor(body: SubstitutedBody): Substitutions | null {
  switch (body.bodyType) {
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
      return body.civilianTeam ? CIV_ROBOT : ROBOT;
    default:
      return body.bodyType >= Body.FATCIV && body.bodyType <= Body.CRIPPLECIV ? CIVILIAN : null;
  }
}

export function substituteBodyTypeState(tables: AnimationTables, body: SubstitutedBody, state: number): number {
  const replacement = substitutionsFor(body)?.[tables.controls[state]?.id ?? ''];
  return replacement ? stateId(tables, replacement) : state;
}
