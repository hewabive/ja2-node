import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import type { InterfaceLevelEvent, SimEvent } from '../events.ts';
import { tacticalViewParts } from '../knowledge/sim-view.ts';
import { AiAction } from './ai/actions.ts';
import { animName } from './anim-states.ts';
import { AnimHeight, endHeight, states } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { Opp } from './perception/opp.ts';
import { AP } from './points.ts';
import {
  beginSoldierClimbDownRoof,
  beginSoldierClimbUpRoof,
  checkSoldierHitRoof,
  findHigherLevel,
  findLowerLevel,
  setSoldierHeight,
} from './roofs.ts';
import { Attitude, Body, Orders, Team } from './soldier.ts';
import { setAutoBandageMode, whoIsThere } from './state.ts';

const CLIMB_TICKS = 5000;
const CLIMBED_UP_HEIGHT = 50;

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function building(): Set<number> {
  const roofs = new Set<number>();
  for (let x = 85; x <= 90; x++) for (let y = 78; y <= 82; y++) roofs.add(gridNo(x, y));
  return roofs;
}

describe('climbing roofs', () => {
  it('finds the roof edge with the fewest turns and none from under a roof', () => {
    const sim = newCombatSim(content, [], 3, building());
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(84, 80), Direction.NORTH);
    expect(findHigherLevel(sim.state, merc)).toBe(Direction.EAST);
    expect(findLowerLevel(sim.state, merc)).toBe(-1);
    const inside = spawnSoldier(sim, 1, Team.OUR, gridNo(87, 80), Direction.NORTH);
    expect(findHigherLevel(sim.state, inside)).toBe(-1);
  });

  it('climbs up onto the roof and back down, paying the climb and stance APs', () => {
    const sim = newCombatSim(content, [], 3, building());
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(84, 80), Direction.NORTH);
    spawnSoldier(sim, 20, Team.ENEMY, gridNo(60, 60), Direction.SOUTH);
    t.inCombat = true;
    const before = merc.actionPoints;
    expect(sim.dispatch({ type: 'climb', soldier: 0 })).toEqual({ ok: true });
    runUntilIdle(sim);
    expect(merc.level).toBe(1);
    expect(merc.gridNo).toBe(gridNo(85, 80));
    expect(whoIsThere(t, gridNo(85, 80), 1)).toBe(merc);
    expect(whoIsThere(t, gridNo(84, 80), 0)).toBeNull();
    expect(endHeight(t.content, merc.state)).toBe(AnimHeight.CROUCH);
    expect(t.perception.disallowSight).toBe(false);
    expect(before - merc.actionPoints).toBe(AP.CLIMBROOF + AP.LOOK_STANDING);
    merc.actionPoints = 25;
    expect(sim.dispatch({ type: 'climb', soldier: 0 })).toEqual({ ok: true });
    runUntilIdle(sim);
    expect(merc.level).toBe(0);
    expect(merc.gridNo).toBe(gridNo(84, 80));
    expect(endHeight(t.content, merc.state)).toBe(AnimHeight.STAND);
  });

  it('looks around once he is up, and spots the enemy on the roof (Soldier_Ani.cc 408)', () => {
    const sim = newCombatSim(content, [], 3, building());
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(84, 80), Direction.EAST);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(89, 80), Direction.EAST);
    setSoldierHeight(t, enemy, 50);
    sim.lookAround();
    expect(merc.oppList[enemy.id]).toBe(Opp.NOT_HEARD_OR_SEEN);
    expect(sim.dispatch({ type: 'climb', soldier: 0 })).toEqual({ ok: true });
    runUntilIdle(sim);
    expect(merc.level).toBe(1);
    expect(merc.oppList[enemy.id]).toBe(Opp.SEEN_CURRENTLY);
    expect(t.inCombat).toBe(true);
  });

  it('climbs up from a walk past the roof edge, as the climb button and the j key never ask him to stop first', () => {
    const sim = newCombatSim(content, [], 3, building());
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(84, 74), Direction.SOUTH);
    expect(sim.dispatch({ type: 'move', soldier: 0, to: gridNo(84, 88) })).toEqual({ ok: true });
    for (let tick = 0; tick < CLIMB_TICKS && merc.gridNo !== gridNo(84, 80); tick++) sim.step();
    expect([merc.gridNo, animName(sim.state.content, merc.state)]).toEqual([gridNo(84, 80), 'WALKING']);
    expect(sim.dispatch({ type: 'climb', soldier: 0 })).toEqual({ ok: true });
    runUntilIdle(sim);
    expect([merc.level, merc.gridNo]).toEqual([1, gridNo(85, 80)]);
  });
});

describe('the interface level after a climb (Soldier_Ani.cc 408, 475: ChangeInterfaceLevel)', () => {
  const levels = (events: readonly SimEvent[]) =>
    events.filter((e): e is InterfaceLevelEvent => e.type === 'interfaceLevel').map((e) => [e.soldier, e.level]);

  it('switches to the roof once the selected merc of ours is up, and back to the ground once he is down', () => {
    const sim = newCombatSim(content, [], 3, building());
    spawnSoldier(sim, 0, Team.OUR, gridNo(84, 80), Direction.NORTH);
    expect(sim.dispatch({ type: 'select', soldier: 0 }).ok).toBe(true);
    sim.drainEvents();
    expect(sim.dispatch({ type: 'climb', soldier: 0 })).toEqual({ ok: true });
    expect(levels(runUntilIdle(sim))).toEqual([[0, 1]]);
    expect(sim.dispatch({ type: 'climb', soldier: 0 })).toEqual({ ok: true });
    expect(levels(runUntilIdle(sim))).toEqual([[0, 0]]);
  });

  it('leaves the interface where it is when a merc who is not selected climbs', () => {
    const sim = newCombatSim(content, [], 3, building());
    const climber = spawnSoldier(sim, 0, Team.OUR, gridNo(84, 80), Direction.NORTH);
    spawnSoldier(sim, 1, Team.OUR, gridNo(80, 80), Direction.NORTH);
    expect(sim.dispatch({ type: 'select', soldier: 1 }).ok).toBe(true);
    sim.drainEvents();
    expect(beginSoldierClimbUpRoof(sim.state, climber)).toBe(true);
    const events = runUntilIdle(sim);
    expect([climber.level, levels(events)]).toEqual([1, []]);
  });
});

describe('a climb of ours in auto-bandage (Soldier_Ani.cc 408, 475: FreeUpNPCFromRoofClimb)', () => {
  it('frees a merc of ours from his climb like the AI once he is up, and once he is down', () => {
    const sim = newCombatSim(content, [], 3, building());
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(84, 80), Direction.NORTH);
    setAutoBandageMode(t, true);
    const climbAsAI = (climb: () => boolean) => {
      merc.ai.action = AiAction.CLIMB_ROOF;
      merc.ai.actionInProgress = true;
      expect(climb()).toBe(true);
      for (let tick = 0; tick < CLIMB_TICKS && merc.ai.action !== AiAction.NONE; tick++) sim.step();
      return [merc.level, merc.ai.action];
    };
    expect(climbAsAI(() => beginSoldierClimbUpRoof(t, merc))).toEqual([1, AiAction.NONE]);
    expect(climbAsAI(() => beginSoldierClimbDownRoof(t, merc))).toEqual([0, AiAction.NONE]);
  });
});

describe('the gait once up (Soldier_Ani.cc 408: UIHandleSoldierStanceChange to a crouch, SetUIbasedOnStance)', () => {
  function gaitOnceUp(team: number, id: number): number | undefined {
    const sim = newCombatSim(content, [], 3, building());
    const climber = spawnSoldier(sim, id, team, gridNo(84, 80), Direction.NORTH);
    setAutoBandageMode(sim.state, true);
    climber.uiMovementMode = states(content.animations).RUNNING;
    climber.ai.action = AiAction.CLIMB_ROOF;
    climber.ai.actionInProgress = true;
    expect(beginSoldierClimbUpRoof(sim.state, climber)).toBe(true);
    for (let tick = 0; tick < CLIMB_TICKS; tick++) {
      sim.step();
      if (climber.heightAdjustment === CLIMBED_UP_HEIGHT) return climber.uiMovementMode;
    }
    return undefined;
  }

  it('swats a merc of ours from the frame he is up, where an enemy keeps his gait', () => {
    const st = states(content.animations);
    expect([gaitOnceUp(Team.OUR, 0), gaitOnceUp(Team.ENEMY, 20)]).toEqual([st.SWATTING, st.RUNNING]);
  });
});

describe('the height a climbing soldier is drawn at (sHeightAdjustment)', () => {
  function viewHeights(sim: ReturnType<typeof newCombatSim>, id: number, until: () => boolean): number[] {
    const shown = () => tacticalViewParts(sim).soldiers.find((s) => s.id === id)?.heightAdjustment ?? 0;
    const seen: number[] = [];
    let last = shown();
    for (let tick = 0; tick < 5000 && !until(); tick++) {
      sim.step();
      const h = shown();
      if (h !== last) seen.push(h);
      last = h;
    }
    return seen.map((h) => Math.round(h * 10) / 10);
  }

  it('rises in the climb steps and lands at 50, then climbing down starts at 5 and sinks below his tile before landing (Soldier_Ani.cc 454, 455, 408, 411, 456, 410)', () => {
    const sim = newCombatSim(content, [], 3, building());
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(84, 80), Direction.NORTH);
    expect(sim.dispatch({ type: 'climb', soldier: 0 })).toEqual({ ok: true });
    const up = viewHeights(sim, 0, () => merc.level === 1 && !sim.isBusy(merc));
    expect(up).toEqual([2, 4, 6, 8, 7.1, 6.2, 5.3, 4.4, 3.5, 2.6, 1.7, 0.8, 50]);
    expect(sim.dispatch({ type: 'climb', soldier: 0 })).toEqual({ ok: true });
    const down = viewHeights(sim, 0, () => merc.level === 0 && merc.heightAdjustment === 0 && !sim.isBusy(merc));
    expect(down).toEqual([5, 3, 1, -1, 0]);
  });

  it('lifts a big man a tenth of a pixel per climb step, so he stays under one pixel for the first steps (gClimbUpRoofDist)', () => {
    const sim = newCombatSim(content, [], 3, building());
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(84, 80), Direction.NORTH, { body: Body.BIGMALE });
    expect(sim.dispatch({ type: 'climb', soldier: 0 })).toEqual({ ok: true });
    const up = viewHeights(sim, 0, () => merc.level === 1 && !sim.isBusy(merc));
    expect(up.slice(0, 4)).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(up.at(-1)).toBe(50);
  });
});

describe('AI climbing', () => {
  it('sends an enemy who heard a noise on the roof to the climb point and up the wall', () => {
    const roofs = building();
    const sim = newCombatSim(content, [], 3, roofs);
    const t = sim.state;
    for (const g of roofs) t.buildings.info[g] = 1;
    t.buildings.list.push({ upClimbSpots: [gridNo(84, 80)], downClimbSpots: [gridNo(85, 80)] });
    spawnSoldier(sim, 0, Team.OUR, gridNo(20, 20), Direction.NORTH);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(78, 80), Direction.EAST);
    enemy.ai.orders = Orders.SEEKENEMY;
    enemy.ai.attitude = Attitude.AGGRESSIVE;
    enemy.ai.noiseGridNo = gridNo(88, 80);
    enemy.ai.noiseLevel = 1;
    enemy.ai.noiseVolume = 20;
    for (let tick = 0; tick < 40_000 && (enemy.gridNo !== gridNo(85, 80) || enemy.level !== 1); tick++) sim.step();
    expect(enemy.level).toBe(1);
    expect(enemy.gridNo).toBe(gridNo(85, 80));
  });
});

describe('falling off a roof', () => {
  it('drops an incapacitated soldier standing at the roof edge down to the ground', () => {
    const sim = newCombatSim(content, [], 3, building());
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(85, 80), Direction.EAST, { life: 10 });
    setSoldierHeight(t, merc, 50);
    expect(merc.level).toBe(1);
    expect(checkSoldierHitRoof(t, merc)).toBe(true);
    for (let tick = 0; tick < 5000 && merc.level !== 0; tick++) sim.step();
    for (let tick = 0; tick < 5000 && sim.isBusy(merc); tick++) sim.step();
    expect(merc.level).toBe(0);
    expect([gridNo(83, 80), gridNo(84, 80)]).toContain(merc.gridNo);
    expect(merc.life).toBe(0);
  });
});
