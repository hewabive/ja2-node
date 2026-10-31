import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { anim, animName } from './anim-states.ts';
import { initNewSoldierAnim } from './animation.ts';
import {
  animateAssignmentDone,
  animateFallingAsleep,
  animateWakingUp,
  reflectAssignment,
  SectorAssignment,
} from './assignment-animations.ts';
import type { TacticalContent } from './content.ts';
import { Body, OKLIFE, type Soldier, Team } from './soldier.ts';
import type { TacticalSim } from './tactical-sim.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const SQUAD_1 = 0;
const TRAIN_SELF = 26;
const ON_TACTICAL_SCREEN = true;
const ON_THE_MAP = false;
const TICK_BUDGET = 2_000;

function merc(state = 'STANDING', body: number = Body.REGMALE): { sim: TacticalSim; s: Soldier } {
  const sim = newCombatSim(content);
  const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { body });
  initNewSoldierAnim(sim.state, s, anim(content, state), 1, true);
  return { sim, s };
}

function stateName(s: Soldier): string {
  return animName(content, s.state);
}

function playUntilNot(sim: TacticalSim, s: Soldier, states: readonly string[]): string {
  for (let tick = 0; tick < TICK_BUDGET && states.includes(stateName(s)); tick++) sim.step();
  return stateName(s);
}

describe('sleep in the loaded sector (PutMercInAsleepState, PutMercInAwakeState)', () => {
  it('goes to sleep through GOTO_SLEEP on the tactical screen and straight to SLEEPING on the map', () => {
    const tactical = merc();
    animateFallingAsleep(tactical.sim.state, tactical.s, ON_TACTICAL_SCREEN);
    expect(stateName(tactical.s)).toBe('GOTO_SLEEP');
    expect(playUntilNot(tactical.sim, tactical.s, ['GOTO_SLEEP'])).toBe('SLEEPING');
    const map = merc();
    animateFallingAsleep(map.sim.state, map.s, ON_THE_MAP);
    expect(stateName(map.s)).toBe('SLEEPING');
  });

  it('wakes up through WKAEUP_FROM_SLEEP on the tactical screen and straight to STANDING on the map', () => {
    const tactical = merc('SLEEPING');
    animateWakingUp(tactical.sim.state, tactical.s, ON_TACTICAL_SCREEN);
    expect(stateName(tactical.s)).toBe('WKAEUP_FROM_SLEEP');
    const map = merc('SLEEPING');
    animateWakingUp(map.sim.state, map.s, ON_THE_MAP);
    expect(stateName(map.s)).toBe('STANDING');
  });
});

describe('the end of an assignment in the loaded sector (AssignmentDone)', () => {
  it('ends doctoring with END_DOCTOR, whose code 457 stands him up, and repairing with END_REPAIRMAN', () => {
    const doctor = merc('BEING_DOCTOR');
    animateAssignmentDone(doctor.sim.state, doctor.s, SectorAssignment.DOCTOR, ON_TACTICAL_SCREEN);
    expect(stateName(doctor.s)).toBe('END_DOCTOR');
    expect(playUntilNot(doctor.sim, doctor.s, ['END_DOCTOR'])).toBe('KNEEL_UP');
    expect(playUntilNot(doctor.sim, doctor.s, ['KNEEL_UP'])).toBe('STANDING');
    const repairman = merc('BEING_REPAIRMAN');
    animateAssignmentDone(repairman.sim.state, repairman.s, SectorAssignment.REPAIR, ON_TACTICAL_SCREEN);
    expect(stateName(repairman.s)).toBe('END_REPAIRMAN');
  });

  it('gets a healed patient up to a crouch on the tactical screen, and everyone to his feet on the map', () => {
    const patient = merc('BEING_PATIENT');
    animateAssignmentDone(patient.sim.state, patient.s, SectorAssignment.PATIENT, ON_TACTICAL_SCREEN);
    expect(stateName(patient.s)).toBe('PRONE_UP');
    for (const [state, assignment] of [
      ['BEING_PATIENT', SectorAssignment.PATIENT],
      ['BEING_DOCTOR', SectorAssignment.DOCTOR],
    ] as const) {
      const map = merc(state);
      animateAssignmentDone(map.sim.state, map.s, assignment, ON_THE_MAP);
      expect(stateName(map.s)).toBe('STANDING');
    }
    const trainee = merc('CROUCHING');
    animateAssignmentDone(trainee.sim.state, trainee.s, TRAIN_SELF, ON_TACTICAL_SCREEN);
    expect(stateName(trainee.s)).toBe('CROUCHING');
  });
});

describe('a new assignment in the loaded sector (MakeSoldiersTacticalAnimationReflectAssignment)', () => {
  it('takes the pose of a doctor, patient or repairman, which other bodies than mercs take standing', () => {
    for (const [assignment, pose] of [
      [SectorAssignment.DOCTOR, 'BEING_DOCTOR'],
      [SectorAssignment.PATIENT, 'BEING_PATIENT'],
      [SectorAssignment.REPAIR, 'BEING_REPAIRMAN'],
    ] as const) {
      const { sim, s } = merc('CROUCHING');
      reflectAssignment(sim.state, s, assignment);
      expect(stateName(s)).toBe(pose);
    }
    const civilian = merc('CROUCHING', Body.MANCIV);
    reflectAssignment(civilian.sim.state, civilian.s, SectorAssignment.DOCTOR);
    expect(stateName(civilian.s)).toBe('STANDING');
  });

  it('stands a merc up for any other assignment, unless he is waking up', () => {
    const { sim, s } = merc('BEING_DOCTOR');
    reflectAssignment(sim.state, s, SQUAD_1);
    expect(stateName(s)).toBe('STANDING');
    const waking = merc('WKAEUP_FROM_SLEEP');
    reflectAssignment(waking.sim.state, waking.s, SQUAD_1);
    expect(stateName(waking.s)).toBe('WKAEUP_FROM_SLEEP');
  });

  it('leaves a merc below OKLIFE as he lies', () => {
    const { sim, s } = merc('CROUCHING');
    s.life = OKLIFE - 1;
    reflectAssignment(sim.state, s, SectorAssignment.DOCTOR);
    expect(stateName(s)).toBe('CROUCHING');
  });
});
