import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { spawnCreature } from '../../../tests/support/creatures.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { DIRECTION_INCREMENT, Direction, gridNo, WORLD_COLS } from '../../content/world/grid.ts';
import { compileTileMovementCosts } from '../../content/world/movement-costs.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { syntheticStructure } from '../../content/world/synthetic.ts';
import type { TacticalContent } from './content.ts';
import { addSoldierToSector, Insertion } from './insertion.ts';
import { Body, type Soldier, TEAM_FIRST_ID, Team } from './soldier.ts';
import type { TacticalSim } from './tactical-sim.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const SWEET = gridNo(90, 80);
const CROWD_REACH = 2;
const ARRIVAL_FACING = Direction.SOUTHWEST;
const FORCED = 100;
const CREATURE_ID = TEAM_FIRST_ID[Team.CREATURE];
const SOLDIER_ID = TEAM_FIRST_ID[Team.MILITIA];

const at = (dx: number, dy: number) => SWEET + dx + dy * WORLD_COLS;

function crowdAroundTheSweetSpot(sim: TacticalSim): void {
  let id = TEAM_FIRST_ID[Team.ENEMY];
  for (let dy = -CROWD_REACH; dy <= CROWD_REACH; dy++)
    for (let dx = -CROWD_REACH; dx <= CROWD_REACH; dx++) {
      if (Math.abs(dx) === CROWD_REACH && Math.abs(dy) === CROWD_REACH) continue;
      spawnSoldier(sim, id++, Team.ENEMY, at(dx, dy), Direction.NORTH);
    }
}

function insert(sim: TacticalSim, s: Soldier, direction: number, calculateDirection: boolean) {
  s.insertionGridNo = SWEET;
  const order = { code: Insertion.GRIDNO, data: SWEET, direction };
  const placed = addSoldierToSector(sim.state, s, order, {}, calculateDirection);
  return { placed, gridNo: s.gridNo, direction: s.direction, orderDirection: order.direction };
}

const arrivingCreature = (sim: TacticalSim) => spawnCreature(sim, CREATURE_ID, Body.AM_MONSTER, gridNo(60, 60), Direction.SOUTH);
const arrivingSoldier = (sim: TacticalSim) => spawnSoldier(sim, SOLDIER_ID, Team.MILITIA, gridNo(60, 60), Direction.SOUTH);

describe('InternalAddSoldierToSector for the creature team (Soldier_Add.cc)', () => {
  it('takes the closest tile in cell coordinates its body fits and faces the first direction it fits, where a soldier takes the closest in rows plus columns and faces the centre', () => {
    const creatures = newCombatSim(content);
    crowdAroundTheSweetSpot(creatures);
    expect(insert(creatures, arrivingCreature(creatures), ARRIVAL_FACING, true)).toEqual({
      placed: true,
      gridNo: at(-2, -2),
      direction: Direction.NORTH,
      orderDirection: ARRIVAL_FACING,
    });
    const soldiers = newCombatSim(content);
    crowdAroundTheSweetSpot(soldiers);
    expect(insert(soldiers, arrivingSoldier(soldiers), ARRIVAL_FACING, true)).toMatchObject({
      placed: true,
      gridNo: at(0, -3),
      direction: Direction.WEST,
    });
  });

  it('keeps the insertion direction when the direction is not calculated, and ignores a forced one when it is', () => {
    const kept = newCombatSim(content);
    expect(insert(kept, arrivingCreature(kept), ARRIVAL_FACING, false)).toMatchObject({ gridNo: SWEET, direction: ARRIVAL_FACING });
    const forced = newCombatSim(content);
    expect(insert(forced, arrivingCreature(forced), ARRIVAL_FACING + FORCED, true)).toEqual({
      placed: true,
      gridNo: SWEET,
      direction: Direction.NORTH,
      orderDirection: ARRIVAL_FACING + FORCED,
    });
  });

  it('leaves a creature out when the search finds no tile, where a soldier falls back on the insertion tile', () => {
    const walledIn = () => {
      const sim = newCombatSim(content, [], 3, new Set(), (world) => {
        for (const step of DIRECTION_INCREMENT) {
          world.structures.add(SWEET + step, 0, syntheticStructure(StructureFlags.GENERIC));
          compileTileMovementCosts(world.costs, world, SWEET + step);
        }
      });
      spawnSoldier(sim, TEAM_FIRST_ID[Team.ENEMY], Team.ENEMY, SWEET, Direction.NORTH);
      return sim;
    };
    const creatures = walledIn();
    expect(insert(creatures, arrivingCreature(creatures), ARRIVAL_FACING, true)).toMatchObject({ placed: false, gridNo: gridNo(60, 60) });
    const soldiers = walledIn();
    expect(insert(soldiers, arrivingSoldier(soldiers), ARRIVAL_FACING, true)).toMatchObject({ placed: true, gridNo: SWEET });
  });
});
