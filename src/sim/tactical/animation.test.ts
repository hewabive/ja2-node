import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { AiAction } from './ai/actions.ts';
import { anim } from './anim-states.ts';
import {
  adjustToNextAnimationFrame,
  computedAnimationDelay,
  initNewSoldierAnim,
  setDesiredDirection,
  setSoldierDirection,
} from './animation.ts';
import type { TacticalContent } from './content.ts';
import { Body, type Soldier, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const FAST_TURN_DELAY = 30;

function turnOneOctant(t: TacticalState, s: Soldier): void {
  setDesiredDirection(t, s, (s.direction + 4) % 8);
  setSoldierDirection(t, s, (s.direction + s.turnIncrement + 8) % 8);
}

describe('the frame delay', () => {
  it('slows an overloaded mover by his effective agility', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.EAST);
    merc.state = anim(content, 'WALKING');
    const unloaded = computedAnimationDelay(t, merc);
    merc.weightCarriedAtTurnStart = 200;
    const agilityDeficit = (agility: number) => 50 - Math.trunc(agility / 4);
    expect(computedAnimationDelay(t, merc) - unloaded).toBe(agilityDeficit(35) - agilityDeficit(70));
  });

  it('never applies a negative body bonus: men, big men and women walk with the same delay', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.EAST);
    merc.state = anim(content, 'WALKING');
    const walkBonus = (body: number) => content.animations.bodySpeeds.walk[body]?.speed ?? 0;
    const delayOf = (body: number) => {
      merc.bodyType = body;
      return computedAnimationDelay(t, merc);
    };
    expect([walkBonus(Body.BIGMALE), walkBonus(Body.REGFEMALE)].every((bonus) => bonus < 0)).toBe(true);
    const regular = delayOf(Body.REGMALE);
    expect([delayOf(Body.BIGMALE), delayOf(Body.REGFEMALE)]).toEqual([regular, regular]);
    expect(delayOf(Body.FATCIV) - regular).toBe(walkBonus(Body.FATCIV));
  });
});

describe('fast turns', () => {
  it('turn only our mercs at 30 ms an octant', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.EAST);
    const enemy = spawnSoldier(sim, 1, Team.ENEMY, gridNo(84, 80), Direction.WEST);
    expect(t.inCombat).toBe(false);
    turnOneOctant(t, merc);
    turnOneOctant(t, enemy);
    expect(merc.aniDelay).toBe(FAST_TURN_DELAY);
    expect(enemy.aniDelay).toBe(computedAnimationDelay(t, enemy));
  });

  it('leave a merc turning away from a hit to the head at his state speed', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.EAST);
    merc.turningFromHit = true;
    turnOneOctant(t, merc);
    expect(merc.aniDelay).toBe(computedAnimationDelay(t, merc));
  });
});

describe('the end of a door opening', () => {
  it('cancels the AI action of a soldier with a far destination who cannot walk on', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 88), Direction.NORTH);
    enemy.ai.action = AiAction.WALK;
    enemy.ai.actionInProgress = true;
    enemy.absoluteFinalDestination = gridNo(80, 70);
    enemy.finalDestination = enemy.gridNo;
    enemy.endDoorOpenCode = 1;
    const endOpenDoor = anim(content, 'END_OPEN_DOOR');
    initNewSoldierAnim(t, enemy, endOpenDoor, 0, false);
    expect(enemy.state).toBe(endOpenDoor);
    for (let frame = 0; frame < 100 && enemy.state === endOpenDoor; frame++) adjustToNextAnimationFrame(t, enemy);
    expect(enemy.state).not.toBe(endOpenDoor);
    expect(enemy.ai.action).toBe(AiAction.NONE);
    expect(enemy.ai.actionInProgress).toBe(false);
    expect(enemy.endDoorOpenCode).toBe(0);
  });
});
