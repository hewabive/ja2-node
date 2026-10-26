import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type ClientSide, clientAnswer, clientSide, type HintSources, serialisedView, withQueries } from '../../../tests/support/hints.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import type { CommandEnvelope } from '../../protocol/messages.ts';
import type { PlayerView } from '../../protocol/view.ts';
import { createSandboxSession } from '../../server/sandbox.ts';
import { Session } from '../../server/session.ts';
import { type HintChannel, HintProvider, type LocalKnowledge, PATHFIND_REST_MS, type QueryReply } from './hint-provider.ts';

const SLOW_MS = 60_000;

let kit: StubSectorKit;
let sources: HintSources;
let client: ClientSide;
let session: Session;
let view: PlayerView;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  sources = { read: kit.read, exists: (p) => kit.worlds.exists(p), world: (p) => kit.worlds.world(p) };
  client = await clientSide(sources);
  session = withQueries(new Session('provider', await createSandboxSession(kit.read, false, 1)), sources);
  view = serialisedView(session);
});

afterAll(async () => {
  await kit.dispose();
});

function knowledge(usable = true): LocalKnowledge {
  return { usable, rules: client.rules, worlds: { has: () => true, ensure: async () => {} } };
}

interface TestChannel extends HintChannel {
  asked: number;
  latestView: PlayerView;
}

function channel(answer: (q: CommandEnvelope) => Promise<QueryReply> = (q) => session.query(q)): TestChannel {
  const c: TestChannel = {
    asked: 0,
    latestView: view,
    query: (q: CommandEnvelope) => {
      c.asked++;
      return answer(q);
    },
  };
  return c;
}

function moveRequest(): CommandEnvelope {
  const merc = view.soldiers.find((s) => s.team === 0);
  if (!merc) throw new Error('no merc');
  return { type: 'previewMove', soldier: merc.id, to: merc.gridNo + 3 };
}

describe('local hint provider', () => {
  it(
    'answers locally after the 80 ms rest, caches by request and view, and restarts the timer on a new request',
    () => {
      let now = 1000;
      const ch = channel();
      const provider = new HintProvider({ channel: ch, knowledge: () => knowledge(), now: () => now });
      const q = moveRequest();
      expect(provider.hint(q).state).toBe('pending');
      now += PATHFIND_REST_MS - 1;
      expect(provider.hint(q).state).toBe('pending');
      now += 1;
      const ready = provider.hint(q);
      expect(ready).toMatchObject({ state: 'ready', source: 'local', answer: { ok: true } });
      expect(provider.hint(q)).toEqual(ready);
      expect(provider.stats).toMatchObject({ local: 1, cacheHits: 1, server: 0 });
      expect(provider.hint({ ...q, mode: 'run' }).state).toBe('pending');
      expect(ch.asked).toBe(0);
      expect(provider.stats.latency.count).toBe(1);
    },
    SLOW_MS,
  );

  it(
    'keeps its answers and its projection over a view where only the tick moved, and drops them on any other change',
    () => {
      let now = 1000;
      const ch = channel();
      const provider = new HintProvider({ channel: ch, knowledge: () => knowledge(), now: () => now });
      const q = moveRequest();
      provider.hint(q);
      now += PATHFIND_REST_MS;
      provider.hint(q);
      ch.latestView = { ...view, tick: view.tick + 10 };
      expect(provider.hint(q).state).toBe('ready');
      expect(provider.stats).toMatchObject({ local: 1, cacheHits: 1 });
      expect(provider.stats.projection.count).toBe(1);
      ch.latestView = { ...ch.latestView, soldiers: [...view.soldiers] };
      expect(provider.hint(q).state).toBe('ready');
      expect(provider.stats).toMatchObject({ local: 2, cacheHits: 1 });
      expect(provider.stats.projection.count).toBe(2);
    },
    SLOW_MS,
  );

  it(
    'falls back to the server query when the rules or the engine differ',
    async () => {
      let now = 0;
      const ch = channel();
      const provider = new HintProvider({ channel: ch, knowledge: () => knowledge(false), now: () => now });
      const q = moveRequest();
      provider.hint(q);
      now += PATHFIND_REST_MS;
      expect(provider.hint(q).state).toBe('pending');
      await vi.waitFor(() => expect(provider.hint(q)).toMatchObject({ state: 'ready', source: 'server', answer: { ok: true } }));
      expect(ch.asked).toBe(1);
    },
    SLOW_MS,
  );

  it(
    'in shadow mode sends each local hint to the server and reports no difference',
    async () => {
      const ch = channel();
      const provider = new HintProvider({ channel: ch, knowledge: () => knowledge(), now: () => 0, shadow: true });
      await provider.hintNow(moveRequest());
      await vi.waitFor(() => expect(provider.stats).toMatchObject({ shadowCompared: 1, mismatchCount: 0, shadowStale: 0 }));
    },
    SLOW_MS,
  );

  it(
    'reports a difference',
    async () => {
      const tampered = channel(async (q) => ({ ...(await session.query(q)), ok: false }));
      const provider = new HintProvider({ channel: tampered, knowledge: () => knowledge(), now: () => 0, shadow: true });
      await provider.hintNow(moveRequest());
      await vi.waitFor(() => expect(provider.stats.mismatchCount).toBe(1));
      expect(provider.stats.mismatches[0]?.request).toEqual(moveRequest());
    },
    SLOW_MS,
  );

  it(
    'compares a reply with the view held when it arrives, and counts it stale when that view cannot be answered locally',
    async () => {
      const q = moveRequest();
      const moved: PlayerView = {
        ...view,
        soldiers: view.soldiers.map((s) => (s.id === q.soldier ? { ...s, gridNo: s.gridNo + 1 } : s)),
      };
      expect(JSON.stringify(clientAnswer(client, moved, q))).not.toBe(JSON.stringify(clientAnswer(client, view, q)));
      const arriving = (held: PlayerView, heldAnswerable: boolean) => {
        const ch = {
          latestView: view,
          query: async (r: CommandEnvelope): Promise<QueryReply> => {
            ch.latestView = held;
            return { ...clientAnswer(client, held, r), tick: held.tick };
          },
        };
        const has = () => ch.latestView !== held || heldAnswerable;
        return new HintProvider({
          channel: ch,
          knowledge: () => ({ ...knowledge(), worlds: { has, ensure: async () => {} } }),
          now: () => 0,
          shadow: true,
        });
      };
      const fresh = arriving(moved, true);
      await fresh.hintNow(q);
      await vi.waitFor(() => expect(fresh.stats).toMatchObject({ shadowCompared: 1, mismatchCount: 0, shadowStale: 0 }));
      const unanswerable = arriving(moved, false);
      await unanswerable.hintNow(q);
      await vi.waitFor(() => expect(unanswerable.stats).toMatchObject({ shadowStale: 1, shadowCompared: 0, mismatchCount: 0 }));
    },
    SLOW_MS,
  );
});
