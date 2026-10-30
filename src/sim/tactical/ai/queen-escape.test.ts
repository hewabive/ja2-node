import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSoldier } from '../../../../tests/support/combat.ts';
import { testProfile } from '../../../../tests/support/profiles.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { NO_NARRATIVE_PORT } from '../narrative/port.ts';
import { AlertStatus, Team } from '../soldier.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { AiAction } from './actions.ts';
import { executeAction, handleSoldierAI } from './control.ts';
import { queenEscape, traverseDown } from './queen-escape.ts';

const PALACE = 'stubs/world/maps/p3.dat';
const QUEEN = 75;
const JOE = 79;
const STAIRCASE = 12067;
const NEXT_TO_STAIRCASE = STAIRCASE + 1;
const FAR_FROM_STAIRCASE = 11752;

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

function palace(port: Partial<typeof NO_NARRATIVE_PORT> = {}): TacticalSim {
  const sim = new TacticalSim(kit.world(PALACE), kit.content, 3);
  sim.state.sector = { x: 3, y: 16, z: 0 };
  sim.state.narrative = { ...NO_NARRATIVE_PORT, ...port };
  return sim;
}

describe('the Queen heads for the basement', () => {
  it('walks to the staircase, traverses down next to it, and Joe follows only from red alert', () => {
    const sim = palace();
    const queen = spawnSoldier(sim, 140, Team.CIV, FAR_FROM_STAIRCASE, 0, { profile: QUEEN });
    expect(queenEscape(sim.state, queen, true, false)).toBe(AiAction.GET_CLOSER);
    expect(queen.ai.actionData).toBe(STAIRCASE);
    expect(queenEscape(sim.state, queen, false, false)).toBe(AiAction.NONE);
    const joe = spawnSoldier(sim, 141, Team.CIV, NEXT_TO_STAIRCASE, 0, { profile: JOE });
    expect(queenEscape(sim.state, joe, true, false)).toBe(AiAction.NONE);
    expect(queenEscape(sim.state, joe, true, true)).toBe(AiAction.TRAVERSE_DOWN);
  });

  it('stays upstairs at the alternate position or when the basement was taken, and outside P3', () => {
    const queen = (sim: TacticalSim) => spawnSoldier(sim, 140, Team.CIV, NEXT_TO_STAIRCASE, 0, { profile: QUEEN });
    const alternate = palace({ queenCanFlee: () => false });
    expect(queenEscape(alternate.state, queen(alternate), true, false)).toBe(AiAction.NONE);
    const secured = palace({ palaceBasementSecured: () => true });
    expect(queenEscape(secured.state, queen(secured), true, false)).toBe(AiAction.NONE);
    const elsewhere = palace();
    elsewhere.state.sector = { x: 3, y: 16, z: 1 };
    expect(queenEscape(elsewhere.state, queen(elsewhere), true, false)).toBe(AiAction.NONE);
  });

  it('moves her profile one level down and removes her from the sector', () => {
    const sim = palace();
    sim.state.profiles.set(QUEEN, testProfile(QUEEN, { sectorX: 3, sectorY: 16, sectorZ: 0, useProfileInsertion: true }));
    const queen = spawnSoldier(sim, 140, Team.CIV, NEXT_TO_STAIRCASE, 0, { profile: QUEEN });
    traverseDown(sim.state, queen);
    expect(sim.state.profiles.get(QUEEN)).toMatchObject({ sectorZ: 1, useProfileInsertion: false });
    expect(queen.placed).toBe(false);
  });
});

describe("the army's first red alert in the palace (AIMain.cc HandleInitialRedAlert)", () => {
  const ENEMY_RADIO_MAN = 20;
  const MILITIA_RADIO_MAN = 84;
  const JOE_POST = FAR_FROM_STAIRCASE + 2;

  function radioIn(sim: TacticalSim, id: number, team: number): void {
    const radioMan = spawnSoldier(sim, id, team, FAR_FROM_STAIRCASE + 4, 0);
    radioMan.ai.action = AiAction.RED_ALERT;
    executeAction(sim.state, radioMan);
  }

  function queenAndJoe(sim: TacticalSim) {
    return [
      spawnSoldier(sim, 140, Team.CIV, FAR_FROM_STAIRCASE, 0, { profile: QUEEN }),
      spawnSoldier(sim, 141, Team.CIV, JOE_POST, 0, { profile: JOE }),
    ] as const;
  }

  it('puts the Queen and Joe on red alert, and the Queen then heads for the staircase', () => {
    const sim = palace();
    const [queen, joe] = queenAndJoe(sim);
    radioIn(sim, ENEMY_RADIO_MAN, Team.ENEMY);
    expect([queen.ai.alertStatus, joe.ai.alertStatus]).toEqual([AlertStatus.RED, AlertStatus.RED]);
    expect(sim.state.perception.awareOfOpposition[Team.ENEMY]).toBe(true);
    handleSoldierAI(sim.state, queen, sim.ai);
    expect([queen.ai.action, queen.ai.actionData]).toEqual([AiAction.GET_CLOSER, STAIRCASE]);
  });

  it('leaves them green after a militia red alert, outside P3 and once the army knows of us', () => {
    const militia = palace();
    const inPalace = queenAndJoe(militia);
    radioIn(militia, MILITIA_RADIO_MAN, Team.MILITIA);
    const below = palace();
    below.state.sector = { x: 3, y: 16, z: 1 };
    const inBasement = queenAndJoe(below);
    radioIn(below, ENEMY_RADIO_MAN, Team.ENEMY);
    const aware = palace();
    aware.state.perception.awareOfOpposition[Team.ENEMY] = true;
    const alreadyAware = queenAndJoe(aware);
    radioIn(aware, ENEMY_RADIO_MAN, Team.ENEMY);
    for (const s of [...inPalace, ...inBasement, ...alreadyAware]) expect(s.ai.alertStatus).toBe(AlertStatus.GREEN);
  });
});
