import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import type { TacticalContent } from '../content.ts';
import { Opp } from '../perception/opp.ts';
import { NOWHERE, Orders, Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { closestReachableDisturbance } from './utils.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const ROOF = 1;
const BUILDING = 1;
const CLIMB_UP_AT = gridNo(84, 80);

function simWithBuilding(): TacticalSim {
  const roofs = new Set<number>();
  for (let x = 85; x <= 90; x++) for (let y = 78; y <= 82; y++) roofs.add(gridNo(x, y));
  const sim = newCombatSim(content, [], 3, roofs);
  const t = sim.state;
  for (const g of roofs) t.buildings.info[g] = BUILDING;
  t.buildings.list.push({ upClimbSpots: [CLIMB_UP_AT], downClimbSpots: [gridNo(85, 80)] });
  return sim;
}

describe('the closest reachable disturbance (AIUtils.cc ClosestReachableDisturbance)', () => {
  it('moves a public noise the soldier stands next to and sees two tiles west instead of fading it', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const guard = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 80), Direction.EAST);
    const volume = 20;
    t.perception.publicNoiseGridNo[Team.ENEMY] = gridNo(83, 80);
    t.perception.publicNoiseLevel[Team.ENEMY] = 0;
    t.perception.publicNoiseVolume[Team.ENEMY] = volume;
    expect(closestReachableDisturbance(t, guard).gridNo).toBe(NOWHERE);
    expect(t.perception.publicNoiseGridNo[Team.ENEMY]).toBe(gridNo(81, 80));
    expect(t.perception.publicNoiseVolume[Team.ENEMY]).toBe(volume);
  });

  it('heads for the climb point when the opponent was last seen on a roof, though he has since come down', () => {
    const sim = simWithBuilding();
    const t = sim.state;
    const guard = spawnSoldier(sim, 20, Team.ENEMY, gridNo(78, 80), Direction.EAST);
    guard.ai.orders = Orders.SEEKENEMY;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(70, 80), Direction.NORTH);
    guard.oppList[merc.id] = Opp.SEEN_LAST_TURN;
    guard.lastKnownOpp[merc.id] = gridNo(88, 80);
    guard.lastKnownOppLevel[merc.id] = ROOF;
    expect(merc.level).toBe(0);
    expect(closestReachableDisturbance(t, guard)).toEqual({ gridNo: CLIMB_UP_AT, climb: true });
  });
});
