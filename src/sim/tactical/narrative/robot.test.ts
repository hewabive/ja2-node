import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import type { TacticalContent } from '../content.ts';
import { effectiveExpLevel } from '../skills.ts';
import { Body, type Soldier, Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { NO_NARRATIVE_PORT } from './port.ts';
import { interruptBasePoints, uncontrolledRobot } from './robot.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const AT = 12080;
const NORTH = 0;
const DISTRACTION = 2;

function robotSetup(controlled: boolean): { sim: TacticalSim; robot: Soldier; holder: Soldier } {
  const sim = newCombatSim(content);
  const holder = spawnSoldier(sim, 0, Team.OUR, AT, NORTH);
  holder.stats.experience = 6;
  const robot = spawnSoldier(sim, 1, Team.OUR, AT + 2, NORTH);
  robot.bodyType = Body.ROBOTNOWEAPON;
  sim.state.narrative = {
    ...NO_NARRATIVE_PORT,
    robotCanBeControlled: () => controlled,
    robotController: (s) => (controlled && s === robot ? holder : null),
    controllingRobot: (s) => controlled && s === holder,
  };
  return { sim, robot, holder };
}

describe('the robot in tactical (TeamTurns.cc, Overhead.cc UIOKMoveDestination)', () => {
  it('takes its interrupt points from the controller, who loses two for the distraction', () => {
    const { sim, robot, holder } = robotSetup(true);
    expect(interruptBasePoints(sim.state, robot)).toBe(effectiveExpLevel(holder) - DISTRACTION);
    expect(interruptBasePoints(sim.state, holder)).toBe(effectiveExpLevel(holder) - DISTRACTION);
  });

  it('uses its own level without a controller and then takes no orders', () => {
    const { sim, robot } = robotSetup(false);
    expect(interruptBasePoints(sim.state, robot)).toBe(effectiveExpLevel(robot));
    expect(uncontrolledRobot(sim.state, robot)).toBe(true);
    expect(sim.canAct(robot)).toMatch(/robot has no controller/);
    expect(sim.dispatch({ type: 'move', soldier: robot.id, to: AT + 6 })).toMatchObject({ ok: false });
  });

  it('obeys while a controller holds the remote', () => {
    const { sim, robot } = robotSetup(true);
    expect(sim.canAct(robot)).toBeNull();
  });
});
