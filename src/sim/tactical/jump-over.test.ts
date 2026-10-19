import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { DIRECTION_INCREMENT, Direction, gridNo } from '../../content/world/grid.ts';
import { AnimHeight, states } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { apsToJumpOver, isValidJumpLocation, jumpOverAt } from './jump-over.ts';
import { AP, apsToChangeStance } from './points.ts';
import { Team } from './soldier.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const SOUTH = DIRECTION_INCREMENT[Direction.SOUTH] ?? 0;
const ORIGIN = gridNo(80, 80);

function scene() {
  const sim = newCombatSim(content);
  const jumper = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.SOUTH);
  const lying = spawnSoldier(sim, 1, Team.OUR, ORIGIN + SOUTH, Direction.SOUTH);
  return { sim, jumper, lying };
}

describe('jumping over a prone soldier (IsValidJumpLocation)', () => {
  it('needs a prone soldier on the side tile between the jumper and the target', () => {
    const { sim, jumper, lying } = scene();
    const target = ORIGIN + 2 * SOUTH;
    expect(isValidJumpLocation(sim.state, jumper, target, 0)).toBe(false);
    lying.state = states(content.animations).PRONE;
    expect(jumpOverAt(sim.state, jumper, target, 0)).toEqual({ over: ORIGIN + SOUTH, direction: Direction.SOUTH });
    expect(isValidJumpLocation(sim.state, jumper, ORIGIN, 0)).toBe(false);
    expect(isValidJumpLocation(sim.state, jumper, ORIGIN + 3 * SOUTH, 0)).toBe(false);
  });

  it('refuses an occupied landing tile and while the jumper turns', () => {
    const blocked = scene();
    blocked.lying.state = states(content.animations).PRONE;
    spawnSoldier(blocked.sim, 2, Team.OUR, ORIGIN + 2 * SOUTH, Direction.NORTH);
    expect(isValidJumpLocation(blocked.sim.state, blocked.jumper, ORIGIN + 2 * SOUTH, 0)).toBe(false);
    const open = scene();
    open.lying.state = states(content.animations).PRONE;
    expect(isValidJumpLocation(open.sim.state, open.jumper, ORIGIN + 2 * SOUTH, 0)).toBe(true);
    open.jumper.turningUntilDone = true;
    expect(isValidJumpLocation(open.sim.state, open.jumper, ORIGIN + 2 * SOUTH, 0)).toBe(false);
  });

  it('costs the stand-up plus AP_JUMP_OVER', () => {
    const { sim, jumper } = scene();
    expect(apsToJumpOver(sim.state, jumper)).toBe(apsToChangeStance(content, jumper, AnimHeight.STAND) + AP.JUMP_OVER);
    jumper.state = states(content.animations).CROUCHING;
    expect(apsToJumpOver(sim.state, jumper)).toBe(AP.CROUCH + AP.JUMP_OVER);
  });
});
