import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { animName } from './anim-states.ts';
import { changeSoldierStance, states } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { getNewSoldierPath } from './movement.ts';
import { Team } from './soldier.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const AT = gridNo(80, 80);
const STEP_EAST = gridNo(81, 80);
const CROUCH = 3;
const TICKS_UNDER_WAY = 40;

describe('the stop order (Soldier_Control.cc StopSoldier)', () => {
  it('halts a walking merc on his tile and drops his walk (EVENT_StopMerc)', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, AT, Direction.EAST);
    expect(sim.dispatch({ type: 'move', soldier: 0, to: gridNo(90, 80) })).toEqual({ ok: true });
    for (let tick = 0; tick < TICKS_UNDER_WAY; tick++) sim.step();
    expect(sim.dispatch({ type: 'stop', soldier: 0 })).toEqual({ ok: true });
    const stoppedAt = merc.gridNo;
    expect([merc.pathSize, merc.finalDestination]).toEqual([0, stoppedAt]);
    runUntilIdle(sim);
    expect(merc.gridNo).toBe(stoppedAt);
  });

  it('only moves the final destination of a merc kneeling up to walk, an ANIM_STATIONARY animation: he takes his step and walks back (:3596-3609, Overhead.cc:918-953)', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, AT, Direction.EAST);
    changeSoldierStance(t, merc, CROUCH);
    runUntilIdle(sim);
    expect(getNewSoldierPath(t, merc, STEP_EAST, states(t.content.animations).WALKING, 0, true)).toBe(true);
    expect([animName(t.content, merc.state), merc.pendingAnimation]).toEqual(['KNEEL_UP', states(t.content.animations).WALKING]);
    expect(sim.dispatch({ type: 'stop', soldier: 0 })).toEqual({ ok: true });
    expect([merc.finalDestination, merc.pathSize]).toEqual([AT, 1]);
    const tiles = new Set<number>();
    for (let tick = 0; tick < 4_000 && !sim.isIdle(); tick++) {
      sim.step();
      tiles.add(merc.gridNo);
    }
    expect([...tiles]).toEqual([AT, STEP_EAST]);
    expect([merc.gridNo, merc.direction, animName(t.content, merc.state)]).toEqual([AT, Direction.WEST, 'STANDING']);
  });
});
