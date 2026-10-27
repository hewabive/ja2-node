import { beforeAll, describe, expect, it } from 'vitest';
import { hintAnswer, newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { animName } from './anim-states.ts';
import { AnimHeight, changeSoldierStance, endHeight } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { AP } from './points.ts';
import { type Soldier, Team } from './soldier.ts';
import { ownSoldierFields } from './soldier-view.ts';
import type { TacticalCommand, TacticalSim } from './tactical-sim.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const FAR = gridNo(90, 80);
const NEAR = gridNo(84, 80);
const FEW_RUNNING_STEPS_AP = 8;

function battle() {
  const sim = newCombatSim(content);
  const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
  spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 88), Direction.NORTH);
  sim.lookAround();
  expect(sim.state.inCombat).toBeTruthy();
  return { sim, merc };
}

function realTime() {
  const sim = newCombatSim(content);
  const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
  expect(sim.state.inCombat).toBeFalsy();
  return { sim, merc };
}

function shown(sim: TacticalSim, merc: Soldier) {
  return ownSoldierFields(sim.state, merc, new Set());
}

function order(sim: TacticalSim, cmd: TacticalCommand) {
  return sim.dispatch({ soldier: 0, ...cmd });
}

function stepUntilMoving(sim: TacticalSim, merc: Soldier): string {
  const moving = new Set(['RUNNING', 'WALKING', 'SWATTING', 'CRAWLING']);
  for (let tick = 0; tick < 400; tick++) {
    sim.step();
    const name = animName(content, merc.state);
    if (moving.has(name)) return name;
  }
  return animName(content, merc.state);
}

describe('the stance of the API joins the height and the run (docs/deviations.md "Stance")', () => {
  it('runs in combat after R, which costs nothing, and continues a halted run as a run', () => {
    const { sim, merc } = battle();
    const ap = merc.actionPoints;
    expect(shown(sim, merc).stance).toBe('stand');
    expect(order(sim, { type: 'stance', stance: 'run' }).ok).toBe(true);
    expect(shown(sim, merc).stance).toBe('run');
    expect(merc.actionPoints).toBe(ap);
    merc.actionPoints = FEW_RUNNING_STEPS_AP;
    expect(order(sim, { type: 'move', to: FAR }).ok).toBe(true);
    expect(stepUntilMoving(sim, merc)).toBe('RUNNING');
    runUntilIdle(sim);
    expect(merc.noAPToFinishMove).toBe(true);
    expect(shown(sim, merc)).toMatchObject({ stance: 'run', continueTo: FAR });
    merc.actionPoints = ap;
    expect(order(sim, { type: 'move', to: FAR }).ok).toBe(true);
    expect(stepUntilMoving(sim, merc)).toBe('RUNNING');
    runUntilIdle(sim);
    expect(merc.gridNo).toBe(FAR);
  });

  it('drops the run and the continue location on S while standing, for no APs', () => {
    const { sim, merc } = battle();
    order(sim, { type: 'stance', stance: 'run' });
    merc.actionPoints = FEW_RUNNING_STEPS_AP;
    order(sim, { type: 'move', to: FAR });
    runUntilIdle(sim);
    const ap = merc.actionPoints;
    expect(shown(sim, merc).continueTo).toBe(FAR);
    expect(order(sim, { type: 'stance', stance: 'stand' }).ok).toBe(true);
    expect(shown(sim, merc)).toMatchObject({ stance: 'stand', continueTo: null });
    expect(merc.actionPoints).toBe(ap);
  });

  it('stands a crouched merc up on R, and he runs once the stance change ends', () => {
    const { sim, merc } = battle();
    order(sim, { type: 'stance', stance: 'crouch' });
    runUntilIdle(sim);
    expect(shown(sim, merc).stance).toBe('crouch');
    const ap = merc.actionPoints;
    expect(order(sim, { type: 'stance', stance: 'run' }).ok).toBe(true);
    runUntilIdle(sim);
    expect(endHeight(content, merc.state)).toBe(AnimHeight.STAND);
    expect(merc.actionPoints).toBe(ap - AP.CROUCH);
    expect(shown(sim, merc).stance).toBe('run');
  });

  it('walks after C and S that follow a run', () => {
    const { sim, merc } = battle();
    order(sim, { type: 'stance', stance: 'run' });
    order(sim, { type: 'stance', stance: 'crouch' });
    runUntilIdle(sim);
    expect(shown(sim, merc).stance).toBe('crouch');
    order(sim, { type: 'stance', stance: 'stand' });
    runUntilIdle(sim);
    expect(shown(sim, merc).stance).toBe('stand');
  });

  it('sets the mode by the stance a change the player did not order ends in, running again only after R', () => {
    const { sim, merc } = battle();
    const crouchAndStand = () => {
      changeSoldierStance(sim.state, merc, AnimHeight.CROUCH);
      runUntilIdle(sim);
      expect(shown(sim, merc).stance).toBe('crouch');
      changeSoldierStance(sim.state, merc, AnimHeight.STAND);
      runUntilIdle(sim);
      return shown(sim, merc).stance;
    };
    order(sim, { type: 'stance', stance: 'run' });
    expect(crouchAndStand()).toBe('run');
    merc.uiMovementFast = false;
    expect(crouchAndStand()).toBe('stand');
  });

  it('keeps the stance when a move in another mode is refused, and ends a move in the stance of its mode', () => {
    const { sim, merc } = battle();
    order(sim, { type: 'stance', stance: 'run' });
    const ap = merc.actionPoints;
    merc.actionPoints = 0;
    expect(order(sim, { type: 'move', to: NEAR, mode: 'crawl' }).ok).toBe(false);
    expect(shown(sim, merc).stance).toBe('run');
    merc.actionPoints = ap;
    expect(order(sim, { type: 'move', to: NEAR, mode: 'crawl' }).ok).toBe(true);
    runUntilIdle(sim);
    expect(merc.gridNo).toBe(NEAR);
    expect(shown(sim, merc).stance).toBe('prone');
  });

  it('costs a move preview without a mode as the order runs it', () => {
    const { sim, merc } = battle();
    order(sim, { type: 'stance', stance: 'run' });
    const cost = (mode?: string) =>
      (hintAnswer(sim, 'previewMove', { soldier: merc.id, to: NEAR, ...(mode ? { mode } : {}) }).data as { apCost: number }).apCost;
    expect(cost()).toBe(cost('run'));
    expect(cost('walk')).toBeGreaterThan(cost('run'));
  });

  it('runs the next real-time move after R and walks the one after', () => {
    const { sim, merc } = realTime();
    expect(order(sim, { type: 'stance', stance: 'run' }).ok).toBe(true);
    expect(shown(sim, merc).stance).toBe('run');
    expect(order(sim, { type: 'move', to: NEAR }).ok).toBe(true);
    expect(shown(sim, merc).stance).toBe('stand');
    expect(stepUntilMoving(sim, merc)).toBe('RUNNING');
    runUntilIdle(sim);
    expect(order(sim, { type: 'move', to: FAR }).ok).toBe(true);
    expect(stepUntilMoving(sim, merc)).toBe('WALKING');
  });

  it('turns a real-time run into a walk on S and the walk into swatting on C, on the way', () => {
    const { sim, merc } = realTime();
    expect(order(sim, { type: 'move', to: FAR, mode: 'run' }).ok).toBe(true);
    expect(stepUntilMoving(sim, merc)).toBe('RUNNING');
    expect(order(sim, { type: 'stance', stance: 'stand' }).ok).toBe(true);
    expect(stepUntilMoving(sim, merc)).toBe('WALKING');
    expect(order(sim, { type: 'stance', stance: 'crouch' }).ok).toBe(true);
    expect(stepUntilMoving(sim, merc)).toBe('SWATTING');
    runUntilIdle(sim);
    expect(merc.gridNo).toBe(FAR);
    expect(shown(sim, merc).stance).toBe('crouch');
  });
});
