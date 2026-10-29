import { describe, expect, it } from 'vitest';
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
  it('gives sessions created at the same time distinct ids and default seeds', async () => {
    const sessions = new Map<string, Session>();
    const seeds: number[] = [];
    const created = await Promise.all([0, 1, 2, 3].map(() => openSession(sessions, 'sandbox', slowFactory(seeds), {})));
    expect(new Set(created.map((s) => s.id)).size).toBe(4);
    expect([...sessions.keys()].sort()).toEqual(['sandbox-0', 'sandbox-1', 'sandbox-2', 'sandbox-3']);
    expect([...seeds].sort()).toEqual([0, 1, 2, 3]);
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
    const seeds: number[] = [];
    const next = await openSession(sessions, 'sandbox', slowFactory(seeds), {});
    expect(next.id).toBe('sandbox-2');
    expect(seeds).toEqual([1]);
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
