import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import type { TacticalContent } from '../content.ts';
import { Profile } from '../narrative/constants.ts';
import { setSoldierHeight } from '../roofs.ts';
import { Attitude, NOWHERE, Orders, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { closestKnownOpponent, noiseHeard } from './knowledge.ts';
import { makeNoise, NoiseKind } from './noise.ts';
import { Opp } from './opp.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const GROUND = 0;
const ROOF = 1;
const ON_THE_ROOF = 50;
const BUILDING = 1;
const LOUD = 60;
const CLIMB_UP_AT = gridNo(84, 80);
const CLIMB_DOWN_AT = gridNo(85, 80);

function building(): Set<number> {
  const roofs = new Set<number>();
  for (let x = 85; x <= 90; x++) for (let y = 78; y <= 82; y++) roofs.add(gridNo(x, y));
  return roofs;
}

function simWithBuilding(): TacticalSim {
  const roofs = building();
  const sim = newCombatSim(content, [], 3, roofs);
  const t = sim.state;
  for (const g of roofs) t.buildings.info[g] = BUILDING;
  t.buildings.list.push({ upClimbSpots: [CLIMB_UP_AT], downClimbSpots: [CLIMB_DOWN_AT] });
  return sim;
}

function lastKnownAt(s: Soldier, opp: Soldier, value: number, g: number, level: number): void {
  s.oppList[opp.id] = value;
  s.lastKnownOpp[opp.id] = g;
  s.lastKnownOppLevel[opp.id] = level;
}

describe('the last-known levels (OppList.cc UpdatePersonal, UpdatePublic)', () => {
  it('remembers the level a merc saw an enemy on and radios it to his team', () => {
    const sim = simWithBuilding();
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.EAST);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(86, 80), Direction.WEST);
    setSoldierHeight(t, enemy, ON_THE_ROOF);
    sim.lookAround();
    expect(merc.oppList[enemy.id]).toBe(Opp.SEEN_CURRENTLY);
    expect(merc.lastKnownOppLevel[enemy.id]).toBe(ROOF);
    expect(t.perception.publicLastKnownLevel[Team.OUR]?.[enemy.id]).toBe(ROOF);
  });

  it('remembers the level of a noise an enemy out of sight made, personally and for the squad', () => {
    const sim = simWithBuilding();
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(45, 80), Direction.EAST);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(86, 80), Direction.WEST);
    setSoldierHeight(t, enemy, ON_THE_ROOF);
    makeNoise(t, enemy, enemy.gridNo, enemy.level, LOUD, NoiseKind.GUNFIRE);
    expect(merc.oppList[enemy.id]).toBe(Opp.HEARD_THIS_TURN);
    expect(merc.lastKnownOppLevel[enemy.id]).toBe(ROOF);
    expect(t.perception.publicLastKnownLevel[Team.OUR]?.[enemy.id]).toBe(ROOF);
  });
});

describe('the closest known opponent (AIUtils.cc ClosestKnownOpponent)', () => {
  function guardAndTwoMercs(): { t: TacticalState; guard: Soldier; near: Soldier; far: Soldier } {
    const sim = simWithBuilding();
    const guard = spawnSoldier(sim, 20, Team.ENEMY, gridNo(87, 80), Direction.WEST);
    const near = spawnSoldier(sim, 0, Team.OUR, gridNo(88, 82), Direction.NORTH);
    const far = spawnSoldier(sim, 1, Team.OUR, gridNo(70, 80), Direction.EAST);
    lastKnownAt(guard, near, Opp.SEEN_LAST_TURN, near.gridNo, GROUND);
    lastKnownAt(guard, far, Opp.SEEN_LAST_TURN, far.gridNo, GROUND);
    return { t: sim.state, guard, near, far };
  }

  it('lets a bounty hunter know of Slay only', () => {
    const { t, guard, far } = guardAndTwoMercs();
    expect(closestKnownOpponent(t, guard)).not.toBe(far.gridNo);
    guard.ai.attitude = Attitude.ATTACKSLAYONLY;
    expect(closestKnownOpponent(t, guard)).toBe(NOWHERE);
    far.profile = Profile.SLAY;
    expect(closestKnownOpponent(t, guard)).toBe(far.gridNo);
  });

  it('skips an opponent last known on another level of the building the soldier stands in, wherever he is now', () => {
    const { t, guard, near, far } = guardAndTwoMercs();
    expect(closestKnownOpponent(t, guard)).toBe(near.gridNo);
    guard.lastKnownOppLevel[near.id] = ROOF;
    expect(near.level).toBe(GROUND);
    expect(closestKnownOpponent(t, guard)).toBe(far.gridNo);
    guard.lastKnownOpp[far.id] = gridNo(89, 79);
    guard.lastKnownOppLevel[far.id] = ROOF;
    expect(closestKnownOpponent(t, guard)).toBe(NOWHERE);
  });
});

describe('the most important noise (Knowledge.cc MostImportantNoiseHeard)', () => {
  it('sends a soldier to the climb point when the opponent was last heard on a roof, though he has since come down', () => {
    const sim = simWithBuilding();
    const guard = spawnSoldier(sim, 20, Team.ENEMY, gridNo(78, 80), Direction.EAST);
    guard.ai.orders = Orders.SEEKENEMY;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(70, 80), Direction.NORTH);
    lastKnownAt(guard, merc, Opp.HEARD_THIS_TURN, gridNo(88, 80), ROOF);
    expect(noiseHeard(sim.state, guard)).toEqual({ gridNo: CLIMB_UP_AT, value: -10, climb: true, reachable: true });
  });
});
