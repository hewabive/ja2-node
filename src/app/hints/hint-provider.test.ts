import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type ClientSide, clientSide, type HintSources, serialisedView, withQueries } from '../../../tests/support/hints.ts';
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

function channel(answer: (q: CommandEnvelope) => Promise<QueryReply> = (q) => session.query(q)): HintChannel & { asked: number } {
  const c = {
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
    'reports a difference and skips answers computed on another tick',
    async () => {
      const tampered = channel(async (q) => ({ ...(await session.query(q)), ok: false }));
      const provider = new HintProvider({ channel: tampered, knowledge: () => knowledge(), now: () => 0, shadow: true });
      await provider.hintNow(moveRequest());
      await vi.waitFor(() => expect(provider.stats.mismatchCount).toBe(1));
      expect(provider.stats.mismatches[0]?.request).toEqual(moveRequest());
      const stale = channel(async (q) => ({ ...(await session.query(q)), tick: view.tick + 10 }));
      const later = new HintProvider({ channel: stale, knowledge: () => knowledge(), now: () => 0, shadow: true });
      await later.hintNow(moveRequest());
      await vi.waitFor(() => expect(later.stats).toMatchObject({ shadowStale: 1, shadowCompared: 0, mismatchCount: 0 }));
    },
    SLOW_MS,
  );
});
