import { describe, expect, it } from 'vitest';
import { readDataJson } from '../../../tests/support/tactical.ts';
import { substituteBodyTypeState } from './body-substitution.ts';
import { Body } from './body-types.ts';
import { ANIM_CONTROL_PATH, ANIM_SURFACES_PATH, parseAnimationTables, stateId } from './tables.ts';

const tables = parseAnimationTables(readDataJson(ANIM_CONTROL_PATH), readDataJson(ANIM_SURFACES_PATH));

function substituted(bodyType: number, stateName: string, civilianTeam = false): string {
  return tables.controls[substituteBodyTypeState(tables, { bodyType, civilianTeam }, stateId(tables, stateName))]?.id ?? '';
}

describe('the state a body plays instead of the one asked for', () => {
  it('stands a civilian robot with its camera still and walks or runs every robot with the robot walk', () => {
    expect(substituted(Body.ROBOTNOWEAPON, 'STANDING', true)).toBe('ROBOT_CAMERA_NOT_MOVING');
    expect(substituted(Body.ROBOTNOWEAPON, 'STANDING')).toBe('STANDING');
    expect(substituted(Body.ROBOTNOWEAPON, 'RUNNING')).toBe('ROBOT_WALK');
  });

  it('breathes for the queen and the larvae when they stand, and lets a crow eat', () => {
    expect(substituted(Body.QUEENMONSTER, 'WALKING')).toBe('QUEEN_MONSTER_BREATHING');
    expect(substituted(Body.LARVAE_MONSTER, 'STANDING')).toBe('LARVAE_BREATH');
    expect(substituted(Body.CROW, 'STANDING')).toBe('CROW_EAT');
  });

  it("turns a civilian's kneeling into cowering and his sleep into standing, and leaves mercs alone", () => {
    expect(substituted(Body.FATCIV, 'KNEEL_DOWN')).toBe('START_COWER');
    expect(substituted(Body.KIDCIV, 'SLEEPING')).toBe('STANDING');
    expect(substituted(Body.REGMALE, 'KNEEL_DOWN')).toBe('KNEEL_DOWN');
  });
});
