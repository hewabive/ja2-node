import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { AnimHeight, endHeight } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { AP } from './points.ts';
import { checkSoldierHitRoof, findHigherLevel, findLowerLevel, setSoldierHeight } from './roofs.ts';
import { Attitude, Orders, Team } from './soldier.ts';
import { whoIsThere } from './state.ts';

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
