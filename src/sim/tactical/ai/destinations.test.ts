import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo, spacesAway } from '../../../content/world/grid.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import type { TacticalContent } from '../content.ts';
import { setSoldierPosition } from '../movement.ts';
import { NOWHERE } from '../pathfinding.ts';
import { Orders, type Soldier, TEAM_FIRST_ID, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { AiAction } from './actions.ts';
import { goAsFarAsPossibleTowards, pointPatrolAI, randomPointPatrolAI, roamingRange } from './destinations.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const NEXT_TO = 1;

describe('the fallback of GoAsFarAsPossibleTowards (Movement.cc InternalGoAsFarAsPossibleTowards)', () => {
  it('heads for a tile beside an illegal destination, shuffling the eight directions past Random as std::shuffle draws on the engine itself', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const civilian = spawnSoldier(sim, TEAM_FIRST_ID[Team.CIV] ?? 0, Team.CIV, gridNo(80, 90), Direction.NORTH);
    const blacklisted = gridNo(80, 84);
    civilian.ai.orders = Orders.SEEKENEMY;
    civilian.ai.blackList = blacklisted;
    Object.assign(t.rng, {
      int: () => {
        throw new Error('the fallback drew through Random');
      },
    });
    const reached = goAsFarAsPossibleTowards(t, civilian, blacklisted, AiAction.SEEK_NOISE, (s) => s.uiMovementMode);
    expect([spacesAway(reached, blacklisted), civilian.finalDestination]).toEqual([NEXT_TO, reached]);
  });
});

const OFF_THE_VISIBLE_WORLD = [gridNo(0, 0), gridNo(1, 0), gridNo(2, 0)];
const keepMode = (s: Soldier) => s.uiMovementMode;

function patroller(orders: number, patrolGrid: readonly number[]): { t: TacticalState; guard: Soldier } {
  const sim = newCombatSim(content);
  const guard = spawnSoldier(sim, TEAM_FIRST_ID[Team.ENEMY] ?? 0, Team.ENEMY, gridNo(80, 80), Direction.NORTH);
  guard.ai.orders = orders;
  guard.ai.patrolGrid = [guard.gridNo, ...patrolGrid];
  guard.ai.patrolCount = patrolGrid.length;
  guard.ai.nextPatrolPoint = 1;
  return { t: sim.state, guard };
}

function patrolTo(t: TacticalState, guard: Soldier): number | null {
  const patrol = guard.ai.orders === Orders.RNDPTPATROL ? randomPointPatrolAI : pointPatrolAI;
  return patrol(t, guard, keepMode, AiAction.POINT_PATROL) ? guard.ai.actionData : null;
}

describe('the patrol points (Movement.cc PointPatrolAI, RandomPointPatrolAI)', () => {
  const POINTS = [gridNo(80, 90), gridNo(90, 90), gridNo(90, 80)];

  it('walks back to the current patrol point between random points: the drawn index stays local', () => {
    const { t, guard } = patroller(Orders.RNDPTPATROL, POINTS);
    const current = POINTS[0] as number;
    setSoldierPosition(t, guard, current);
    const drawn = patrolTo(t, guard) as number;
    expect([POINTS.includes(drawn), drawn !== current, guard.ai.nextPatrolPoint]).toEqual([true, true, 1]);
    expect(roamingRange(guard).origin).toBe(current);
    setSoldierPosition(t, guard, drawn);
    expect(patrolTo(t, guard)).toBe(current);
  });

  it('heads for a patrol point in water', () => {
    for (const orders of [Orders.POINTPATROL, Orders.RNDPTPATROL]) {
      const { t, guard } = patroller(orders, [POINTS[0] as number]);
      t.world.terrain[POINTS[0] as number] = Terrain.LOW_WATER;
      expect(patrolTo(t, guard)).toBe(POINTS[0]);
    }
  });

  it('stores the path to the patrol point, so the move does not search again', () => {
    for (const orders of [Orders.POINTPATROL, Orders.RNDPTPATROL]) {
      const { t, guard } = patroller(orders, POINTS);
      expect(patrolTo(t, guard)).toBe(POINTS[0]);
      expect(guard.pathStored).toBe(true);
    }
  });

  it('turns a random point patrol without a legal point into a far patrol', () => {
    const { t, guard } = patroller(Orders.RNDPTPATROL, [NOWHERE, NOWHERE]);
    guard.ai.nextPatrolPoint = 0;
    expect([patrolTo(t, guard), guard.ai.orders]).toEqual([null, Orders.FARPATROL]);
  });

  it('turns a patrol whose points are all junk into a far patrol instead of looking for a good point for ever', () => {
    for (const orders of [Orders.POINTPATROL, Orders.RNDPTPATROL]) {
      const { t, guard } = patroller(orders, OFF_THE_VISIBLE_WORLD);
      guard.ai.nextPatrolPoint = 0;
      expect([patrolTo(t, guard), guard.ai.orders]).toEqual([null, Orders.FARPATROL]);
    }
  });

  it('waits on a random point patrol whose every point is its own tile instead of drawing for ever', () => {
    const { t, guard } = patroller(Orders.RNDPTPATROL, [gridNo(80, 80), gridNo(80, 80)]);
    expect([patrolTo(t, guard), guard.ai.orders]).toEqual([null, Orders.RNDPTPATROL]);
  });
});
