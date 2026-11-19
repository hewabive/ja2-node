import { describe, expect, it } from 'vitest';
import { SEED_LIMIT } from './entropy.ts';
import type { Session } from './session.ts';
import { MAX_SESSIONS, MAX_SESSIONS_ENV, openSession, type SessionRequest, sessionLimit } from './session-registry.ts';

function slowFactory(seeds: number[]) {
  return async (id: string, request: SessionRequest): Promise<Session> => {
    seeds.push(request.seed);
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { id } as unknown as Session;
  };
}

describe('openSession', () => {
  it('gives sessions created at the same time distinct ids', async () => {
    const sessions = new Map<string, Session>();
    const created = await Promise.all([0, 1, 2, 3].map(() => openSession(sessions, 'sandbox', slowFactory([]), {})));
    expect(new Set(created.map((s) => s.id)).size).toBe(4);
    expect([...sessions.keys()].sort()).toEqual(['sandbox-0', 'sandbox-1', 'sandbox-2', 'sandbox-3']);
  });

  it('seeds a session from the server entropy unless the request names a seed, however many sessions are open', async () => {
    const sessions = new Map<string, Session>();
    const seeds: number[] = [];
    const drawn = [40_000_001, 40_000_002];
    const entropy = () => drawn.shift() ?? 0;
    const first = await openSession(sessions, 'sandbox', slowFactory(seeds), { campaign: {} }, entropy);
    sessions.delete(first.id);
    await openSession(sessions, 'sandbox', slowFactory(seeds), { campaign: {} }, entropy);
    await openSession(sessions, 'sandbox', slowFactory(seeds), { seed: 7, campaign: {} }, entropy);
    expect(seeds).toEqual([40_000_001, 40_000_002, 7]);
    expect(drawn).toEqual([]);
    await openSession(sessions, 'sandbox', slowFactory(seeds), {});
    expect(seeds[3]).toBeGreaterThanOrEqual(0);
    expect(seeds[3]).toBeLessThan(SEED_LIMIT);
  });

  it('releases the id of a session whose creation failed', async () => {
    const sessions = new Map<string, Session>();
    const failing = async (): Promise<Session> => {
      throw new Error('no such save');
    };
    await expect(openSession(sessions, 'sandbox', failing, {})).rejects.toThrow('no such save');
    const next = await openSession(sessions, 'sandbox', slowFactory([]), {});
    expect(next.id).toBe('sandbox-0');
  });

  it("never gives a closed session's id to a new one, so a client still holding it cannot reach another session", async () => {
    const sessions = new Map<string, Session>();
    await openSession(sessions, 'sandbox', slowFactory([]), {});
    const latest = await openSession(sessions, 'sandbox', slowFactory([]), {});
    sessions.delete(latest.id);
    const next = await openSession(sessions, 'sandbox', slowFactory([]), {});
    expect(next.id).toBe('sandbox-2');
  });
});

describe('sessionLimit', () => {
  it('is 16 unless the environment names a positive whole number', () => {
    expect(sessionLimit({})).toBe(MAX_SESSIONS);
    expect(sessionLimit({ [MAX_SESSIONS_ENV]: '64' })).toBe(64);
    expect(sessionLimit({ [MAX_SESSIONS_ENV]: '0' })).toBe(MAX_SESSIONS);
    expect(sessionLimit({ [MAX_SESSIONS_ENV]: 'many' })).toBe(MAX_SESSIONS);
  });
});
