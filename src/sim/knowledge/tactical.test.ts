import { beforeAll, describe, expect, it } from 'vitest';
import { knowledgeOf, newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { spawnCreature } from '../../../tests/support/creatures.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { calcActionPoints } from '../tactical/points.ts';
import { Body, Personality, type Soldier, Team } from '../tactical/soldier.ts';
import type { TacticalSim } from '../tactical/tactical-sim.ts';
import type { KnowledgeStrategic } from './view.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const MERC_PROFILE = 5;
const MERC_ID = 0;
const CREATURE_ID = 30;

function phobicMerc(sim: TacticalSim, trait: number): Soldier {
  const merc = spawnSoldier(sim, MERC_ID, Team.OUR, gridNo(80, 80), Direction.SOUTH, { profile: MERC_PROFILE });
  merc.personalityTrait = trait;
  return merc;
}

function projectedTurnAPs(sim: TacticalSim, strategic?: Partial<KnowledgeStrategic>): number {
  const tactical = knowledgeOf(sim, strategic ? { strategic: strategic as KnowledgeStrategic } : {}).tactical;
  const merc = tactical?.ownSoldier(MERC_ID);
  if (!tactical || !merc) throw new Error('no projected merc');
  return calcActionPoints(tactical.state, merc);
}

describe('the tactical projection of the hints', () => {
  it("takes the loaded sector from the strategic view, so a claustrophobe's turn APs match the server's underground", () => {
    const sim = newCombatSim(content);
    sim.state.sector = { x: 9, y: 1, z: 1 };
    const merc = phobicMerc(sim, Personality.CLAUSTROPHOBIC);
    const server = calcActionPoints(sim.state, merc);
    expect(server).toBeLessThan(calcActionPoints({ sector: null, soldiers: sim.state.soldiers }, merc));
    expect(projectedTurnAPs(sim, { worldSector: 'A9-1' })).toBe(server);
  });

  it("takes an own merc's seen opponents from the view, so an insect-phobic merc's turn APs match the server's", () => {
    const sim = newCombatSim(content);
    const merc = phobicMerc(sim, Personality.FEAR_OF_INSECTS);
    spawnCreature(sim, CREATURE_ID, Body.YAM_MONSTER, gridNo(80, 86), Direction.NORTH);
    sim.lookAround();
    const server = calcActionPoints(sim.state, merc);
    expect(server).toBeLessThan(calcActionPoints({ sector: null, soldiers: [] }, merc));
    expect(projectedTurnAPs(sim)).toBe(server);
  });
});
