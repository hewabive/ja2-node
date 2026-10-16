import { describe, expect, it } from 'vitest';
import type { Session } from './session.ts';
import { openSession, type SessionRequest } from './session-registry.ts';

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
});
