import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignInA10, STUB_NPC } from '../../../tests/support/a10-campaign.ts';
import { approachUntilCombat, BATTLE_SANDBOX_SEED, tacticalOf, untilOurTurn } from '../../../tests/support/save-scenarios.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { addStubTank } from '../../../tests/support/vehicles.ts';
import { Direction, WORLD_COLS } from '../../content/world/grid.ts';
import { createSandboxSession } from '../../server/sandbox.ts';
import { Session } from '../../server/session.ts';
import { REAL_TIME_ORDER_IN_COMBAT } from './real-time-orders.ts';
import { Body, Team } from './soldier.ts';
import { teamMembers } from './state.ts';
import { enterCombatMode } from './turns/turns.ts';

const WALK_STEPS = 3;

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

async function ourTurnInTheSandbox(): Promise<Session> {
  const session = new Session('real-time-orders', await createSandboxSession(kit.read, false, BATTLE_SANDBOX_SEED));
  approachUntilCombat(session, false);
  untilOurTurn(session);
  return session;
}

describe('an order a real-time click sent, flagged realTime', () => {
  it('is refused in combat without a change, and the same order without the flag is carried out', async () => {
    const session = await ourTurnInTheSandbox();
    const t = tacticalOf(session).state;
    const merc = teamMembers(t, Team.OUR).find((s) => s.actionPoints > 0);
    if (!merc) throw new Error('no merc of ours with action points');
    const walk = () => ({
      actionPoints: merc.actionPoints,
      gridNo: merc.gridNo,
      pathSize: merc.pathSize,
      destination: merc.finalDestination,
    });
    const before = walk();
    const move = { type: 'move', soldier: merc.id, to: merc.gridNo - WALK_STEPS * WORLD_COLS };
    const flagged = session.dispatch({ ...move, realTime: true });
    expect(flagged).toEqual({ ok: false, reason: REAL_TIME_ORDER_IN_COMBAT.reason, data: { refusal: 'realTimeOrder' } });
    expect(walk()).toEqual(before);
    expect(session.dispatch(move).ok).toBe(true);
    session.advance({ idle: true });
    expect(merc.actionPoints).toBeLessThan(before.actionPoints);
  });

  it('is carried out in real time', async () => {
    const session = new Session('real-time-orders', await createSandboxSession(kit.read, false, BATTLE_SANDBOX_SEED));
    const merc = teamMembers(tacticalOf(session).state, Team.OUR)[0];
    if (!merc) throw new Error('no merc of ours');
    expect(session.dispatch({ type: 'move', soldier: merc.id, to: merc.gridNo + WALK_STEPS, realTime: true }).ok).toBe(true);
  });

  it('is refused in a campaign combat before the talk flow takes it', async () => {
    const a10 = await campaignInA10(kit, 5);
    const sim = tacticalOf(a10.session);
    const t = sim.state;
    const talker = teamMembers(t, Team.OUR)[0];
    if (!talker) throw new Error('no merc of ours');
    addStubTank(t, { body: Body.TANK_NW, team: Team.ENEMY, gridNo: talker.gridNo + 6 * WORLD_COLS, direction: Direction.NORTH });
    sim.lookAround();
    enterCombatMode(t, Team.OUR);
    expect(t.inCombat).toBe(true);
    const talk = { type: 'talk', soldier: talker.id, target: { npc: STUB_NPC } };
    expect(a10.session.dispatch({ ...talk, realTime: true }).data).toEqual({ refusal: 'realTimeOrder' });
    expect(a10.session.dispatch(talk).data).not.toEqual({ refusal: 'realTimeOrder' });
  });
});
