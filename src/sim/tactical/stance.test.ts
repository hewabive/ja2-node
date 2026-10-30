import { beforeAll, describe, expect, it } from 'vitest';
import { hintAnswer, newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { layProne, raiseTiles, withTwoTileProneBody } from '../../../tests/support/prone-body.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { DIRECTION_COUNT, Direction, gridNo } from '../../content/world/grid.ts';
import { TravelCost } from '../../content/world/movement-costs.ts';
import { Terrain } from '../../content/world/terrain.ts';
import { animName } from './anim-states.ts';
import { AnimHeight, changeSoldierStance, endHeight, states } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { isValidStance } from './person-structure.ts';
import { AP, ptsToMoveDirection } from './points.ts';
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
const RAISED_HEIGHT = 1;
const WALLED_IN = gridNo(90, 90);

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

describe('the stance of the API joins the height and the run', () => {
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

  it('changes nothing when R cannot stand a crouched merc up, so his next stand-up walks (deviation "Refused run")', () => {
    const { sim, merc } = battle();
    order(sim, { type: 'stance', stance: 'crouch' });
    runUntilIdle(sim);
    merc.actionPoints = AP.CROUCH - 1;
    const mode = merc.uiMovementMode;
    expect(order(sim, { type: 'stance', stance: 'run' })).toMatchObject({ ok: false, data: { refusal: 'notEnoughAP' } });
    expect([merc.uiMovementFast, merc.uiMovementMode]).toEqual([false, mode]);
    expect(shown(sim, merc).stance).toBe('crouch');
    changeSoldierStance(sim.state, merc, AnimHeight.STAND);
    runUntilIdle(sim);
    expect(shown(sim, merc).stance).toBe('stand');
  });

  it('keeps a crouched merc crouched on R once a group run with no path left him in the running mode: the original tests the mode, not the height', () => {
    const sim = newCombatSim(content, [], 3, new Set(), (world) => {
      for (let direction = 0; direction < DIRECTION_COUNT; direction++) world.costs.force(WALLED_IN, direction, 0, TravelCost.OBSTACLE);
    });
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    order(sim, { type: 'stance', stance: 'crouch' });
    runUntilIdle(sim);
    expect(sim.dispatch({ type: 'moveGroup', soldiers: [0], to: WALLED_IN, mode: 'run' })).toEqual({
      ok: true,
      data: { moved: [], noPath: [0] },
    });
    expect(order(sim, { type: 'stance', stance: 'run' }).ok).toBe(true);
    runUntilIdle(sim);
    expect(endHeight(content, merc.state)).toBe(AnimHeight.CROUCH);
    expect([merc.uiMovementMode, merc.uiMovementFast]).toEqual([states(content.animations).RUNNING, true]);
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

describe('the first step a move in combat must afford (Handle_UI.cc SelectedMercCanAffordMove)', () => {
  it("comes from the path in the order's mode: a crawler whose tail would lie on a raised tile pays for a diagonal first step", () => {
    const sim = newCombatSim(withTwoTileProneBody(content));
    const start = gridNo(80, 80);
    const merc = spawnSoldier(sim, 0, Team.OUR, start, Direction.SOUTH);
    spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 88), Direction.NORTH);
    sim.lookAround();
    expect(sim.state.inCombat).toBeTruthy();
    layProne(sim.state, merc);
    raiseTiles(sim.state, [start - 1]);
    const ctx = { env: sim.state.pathEnv, content: sim.state.content, inCombat: true };
    merc.actionPoints = ptsToMoveDirection(ctx, merc, Direction.EAST, merc.uiMovementMode);
    expect(order(sim, { type: 'move', to: start + 2, mode: 'crawl' })).toMatchObject({ ok: false, data: { refusal: 'notEnoughAP' } });
    expect(shown(sim, merc).continueTo).toBe(start + 2);
  });
});

describe('stances a merc cannot take (Handle_UI.cc UIHandleSoldierStanceChange, Interface.cc PopupMovementMenu)', () => {
  it('refuses lying down where the body has no room, and the movement menu offers no crawl there', () => {
    const behind = gridNo(80, 79);
    const sim = newCombatSim(withTwoTileProneBody(content), [], 3, new Set(), (world) => {
      world.level.heights[behind] = RAISED_HEIGHT;
    });
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    expect(hintAnswer(sim, 'movementOptions', { soldier: 0 })).toEqual({ ok: true, data: { run: true, sneak: true, crawl: false } });
    expect(order(sim, { type: 'stance', stance: 'prone' })).toMatchObject({ ok: false, data: { refusal: 'invalidStance' } });
    expect(endHeight(content, merc.state)).toBe(AnimHeight.STAND);
  });

  it('takes run, sneak and crawl away in water and refuses crouching there', () => {
    const at = gridNo(80, 80);
    const sim = newCombatSim(content, [], 3, new Set(), (world) => {
      world.terrain[at] = Terrain.MED_WATER;
    });
    const merc = spawnSoldier(sim, 0, Team.OUR, at, Direction.SOUTH);
    expect(hintAnswer(sim, 'movementOptions', { soldier: 0 })).toEqual({ ok: true, data: { run: false, sneak: false, crawl: false } });
    expect(order(sim, { type: 'stance', stance: 'crouch' })).toMatchObject({ ok: false, data: { refusal: 'invalidStance' } });
    expect(endHeight(content, merc.state)).toBe(AnimHeight.STAND);
  });

  it('never lets an escort lie down', () => {
    const { sim, merc } = realTime();
    sim.state.narrative = { ...sim.state.narrative, isEpc: (s) => s === merc };
    expect(isValidStance(sim.state, merc, AnimHeight.CROUCH)).toBe(true);
    expect(isValidStance(sim.state, merc, AnimHeight.PRONE)).toBe(false);
    expect(order(sim, { type: 'stance', stance: 'prone' })).toMatchObject({ ok: false, data: { refusal: 'invalidStance' } });
  });
});
