import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tacticalOf } from '../../tests/support/save-scenarios.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { WORLD_COLS } from '../content/world/grid.ts';
import type { ViewFrame } from '../protocol/view.ts';
import type { SimEvent } from '../sim/events.ts';
import { Team, Visible } from '../sim/tactical/soldier.ts';
import { teamMembers } from '../sim/tactical/state.ts';
import { createSandboxSession } from './sandbox.ts';
import { Session } from './session.ts';

const PATROL_SEED = 3;
const PATROL_TICKS = 2000;

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

async function watchedSandbox(): Promise<{ session: Session; framed: () => SimEvent[] }> {
  const session = new Session('fair', await createSandboxSession(kit.read, false, PATROL_SEED));
  const frames: ViewFrame[] = [];
  session.subscribe((m) => {
    if (m.t === 'frames') frames.push(...m.frames);
  });
  return { session, framed: () => frames.flatMap((f) => f.events ?? []) };
}

const arrivals = (events: readonly SimEvent[]) => events.filter((e) => e.type === 'arrived');

describe('fairness of the events: soldiers the squad does not see (D16)', () => {
  it('stops no advance at the end of an unseen enemy patrol walk and tells it neither in the report nor in the frames', async () => {
    const { session, framed } = await watchedSandbox();
    const t = tacticalOf(session).state;
    const hidden = () => teamMembers(t, Team.ENEMY).filter((s) => s.visible === Visible.HIDDEN);
    const start = new Map(hidden().map((s) => [s.id, s.gridNo]));
    expect(start.size).toBeGreaterThan(0);
    const report = session.advance({ events: ['arrived'], ticks: PATROL_TICKS });
    const walked = hidden().filter((s) => s.gridNo !== start.get(s.id) && s.gridNo === s.finalDestination && s.pathSize === 0);
    expect(walked.length).toBeGreaterThan(0);
    expect(arrivals(report.events)).toEqual([]);
    expect(arrivals(framed())).toEqual([]);
    expect(report.reason).toBe('ticks');
  });

  it("still stops an advance at our merc's arrival, in the report and the frames", async () => {
    const { session, framed } = await watchedSandbox();
    const merc = teamMembers(tacticalOf(session).state, Team.OUR)[0];
    if (!merc) throw new Error('the sandbox has no merc');
    const to = merc.gridNo + WORLD_COLS;
    expect(session.dispatch({ type: 'move', soldier: merc.id, to, mode: 'walk' }).ok).toBe(true);
    const report = session.advance({ events: ['arrived'], ticks: PATROL_TICKS });
    const ours = { type: 'arrived', soldier: merc.id, gridNo: to };
    expect(report.reason).toBe('event');
    expect(arrivals(report.events)).toEqual([expect.objectContaining(ours)]);
    expect(arrivals(framed())).toEqual([expect.objectContaining(ours)]);
  });
});
