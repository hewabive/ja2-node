import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { DIRECTION_INCREMENT, Direction, gridNo, WORLD_COLS } from '../../../content/world/grid.ts';
import { StructureFlags, type WorldStructures } from '../../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../../content/world/tactical-world.ts';
import { states } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { type Soldier, Team } from '../soldier.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { talkWalkUp, teleportNpc } from './talk-reach.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const NORTH = -WORLD_COLS;
const WEST = -1;
const MERC_AT = gridNo(80, 80);
const NPC_AT = gridNo(80, 90);
const VEHICLE_ID = 120;

function simWith(place: (s: WorldStructures) => void): TacticalSim {
  const world = { ...syntheticWorld(testDoorCosts(), place), map: { doors: [], placements: [] }, mapPath: 'synthetic' };
  return new TacticalSim(world as unknown as TacticalWorld, content, 3);
}

function walkingMerc(sim: TacticalSim): Soldier {
  const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH);
  merc.uiMovementMode = states(content.animations).WALKING;
  return merc;
}

describe('the walk-up to talk', () => {
  it('goes to the tile with the shortest path from the merc, within a circle of three tiles around the NPC', () => {
    const sim = newCombatSim(content);
    const merc = walkingMerc(sim);
    const npc = spawnSoldier(sim, 60, Team.CIV, NPC_AT, Direction.NORTH);
    expect(talkWalkUp(sim.state, merc, npc)).toBe(gridNo(78, 87));
  });

  it('skips a free tile the merc does not fit on, such as one under a vehicle', () => {
    const sim = newCombatSim(content);
    const merc = walkingMerc(sim);
    const npc = spawnSoldier(sim, 60, Team.CIV, NPC_AT, Direction.NORTH);
    sim.state.world.structures.add(gridNo(78, 87), 0, syntheticStructure(StructureFlags.MOBILE), { kind: 'soldier', id: VEHICLE_ID });
    expect(talkWalkUp(sim.state, merc, npc)).toBe(gridNo(79, 87));
  });
});

describe('the NPC teleport of a record', () => {
  it('bumps whoever stands on the tile to the closest tile by cell range, then puts the NPC there', () => {
    const sim = newCombatSim(content);
    const npc = spawnSoldier(sim, 60, Team.CIV, MERC_AT, Direction.SOUTH);
    const bumped = spawnSoldier(sim, 61, Team.CIV, NPC_AT, Direction.SOUTH);
    for (const [k, step] of [NORTH, WEST, -WEST, -NORTH].entries()) spawnSoldier(sim, 62 + k, Team.CIV, NPC_AT + step, Direction.SOUTH);
    teleportNpc(sim.state, npc, NPC_AT);
    expect(bumped.gridNo).toBe(NPC_AT + NORTH + WEST);
    expect(npc.gridNo).toBe(NPC_AT);
  });

  it('leaves the NPC in place when the soldier on the tile cannot be bumped', () => {
    const sim = simWith((w) => {
      for (const step of DIRECTION_INCREMENT) w.add(NPC_AT + step, 0, syntheticStructure(StructureFlags.GENERIC));
    });
    const npc = spawnSoldier(sim, 60, Team.CIV, MERC_AT, Direction.SOUTH);
    const stuck = spawnSoldier(sim, 61, Team.CIV, NPC_AT, Direction.SOUTH);
    teleportNpc(sim.state, npc, NPC_AT);
    expect(stuck.gridNo).toBe(NPC_AT);
    expect(npc.gridNo).toBe(MERC_AT);
  });
});
