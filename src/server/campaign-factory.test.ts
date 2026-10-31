import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { CompressMode } from '../sim/strategic/time/constants.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { createCampaignSession } from './campaign-factory.ts';

const CONTRACTS_ON_THE_MAP_ONLY = {
  ok: false,
  reason: 'mapScreenOnly: contracts are handled on the map screen only',
  data: { refusal: 'mapScreenOnly' },
};

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const create = (seed: number, request: Parameters<typeof createCampaignSession>[3]) =>
  createCampaignSession(kit.read, (path) => kit.worlds.exists(path), seed, request);

describe('a new campaign session', () => {
  it('flies the stub squad into A9 at 07:00 on day 1', async () => {
    const session = await create(3, {});
    const view = session.view();
    expect(view.clock).toMatchObject({ day: 1, hour: 7, minute: 0 });
    expect(view.strategic).toMatchObject({ flow: 'tactical', worldSector: 'A9', balance: 17660 });
    expect(view.mapPath).toBe('stubs/world/maps/a9.dat');
    expect(view.soldiers.filter((s) => s.team === Team.OUR)).toHaveLength(4);
    expect(view.strategic?.mercs.every((m) => m.sector === 'A9' && m.squad === 0)).toBe(true);
  });

  it('honours difficulty, squad size and a delayed landing', async () => {
    const session = await create(4, { difficulty: 3, mercs: 2, land: false });
    const view = session.view();
    expect(view.mapPath).toBeNull();
    expect(view.clock).toMatchObject({ day: 1, hour: 1 });
    expect(view.strategic).toMatchObject({ flow: 'strategic', worldSector: null, balance: 19900 });
    expect(view.strategic?.mercs).toHaveLength(2);
    const land = { type: 'compressTime', mode: CompressMode.MIN5 };
    await session.prepare(land);
    expect(session.dispatch(land).ok).toBe(true);
    expect(session.view()).toMatchObject({ mapPath: 'stubs/world/maps/a9.dat', clock: { hour: 7 } });
  });

  it('is the same game for the same seed', async () => {
    const a = (await create(9, {})).view();
    const b = (await create(9, {})).view();
    expect(b.soldiers).toEqual(a.soldiers);
    expect(b.strategic).toEqual(a.strategic);
  });

  it('hires the authored stub profiles on a week contract and extends one from the map screen', async () => {
    const session = await create(5, { mercs: 2 });
    const mercs = session.view().strategic?.mercs ?? [];
    expect(mercs.map((m) => [m.kind, m.contract?.type])).toEqual([
      ['aim', 'aim'],
      ['aim', 'aim'],
    ]);
    const first = mercs[0];
    if (!first) throw new Error('no merc');
    expect(first.contract).toMatchObject({ totalDays: 7, lastContract: 'week', endsAt: { day: 8, hour: 7 } });
    const options = session.dispatch({ type: 'contractOptions', soldier: first.id });
    expect(options).toMatchObject({ ok: true, data: { balance: expect.any(Number) } });
    const extend = { type: 'extendContract', soldier: first.id, length: 'day' };
    expect(session.dispatch(extend)).toEqual(CONTRACTS_ON_THE_MAP_ONLY);
    expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    expect(session.dispatch(extend)).toMatchObject({ ok: true, data: { extended: true, days: 1, endsAt: { day: 9, hour: 7 } } });
    expect(session.view().strategic?.mercs[0]?.contract).toMatchObject({ totalDays: 8, endsAt: { day: 9, hour: 7 } });
    expect(session.view().contractPrompt ?? null).toBeNull();
  });

  it('asks where a dismissed merc leaves his equipment through the contract prompt', async () => {
    const session = await create(6, { mercs: 2 });
    const [kept, dismissed] = session.view().strategic?.mercs ?? [];
    if (!kept || !dismissed) throw new Error('no mercs');
    expect(session.dispatch({ type: 'dismiss', soldier: dismissed.id })).toEqual(CONTRACTS_ON_THE_MAP_ONLY);
    expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    expect(session.dispatch({ type: 'dismiss', soldier: dismissed.id })).toEqual({ ok: true });
    const prompt = session.view().contractPrompt;
    expect(prompt).toMatchObject({ kind: 'mercDeparture', soldier: dismissed.id, name: dismissed.name, sector: 'A9' });
    expect(prompt?.kind === 'mercDeparture' && prompt.choices).toContain('here');
    expect(session.dispatch({ type: 'compressTime', mode: CompressMode.MIN60 }).ok).toBe(false);
    expect(session.dispatch({ type: 'answer', prompt: prompt?.id, choice: 'here' })).toEqual({ ok: true });
    expect(session.view().contractPrompt ?? null).toBeNull();
    expect(session.view().strategic?.mercs.map((m) => m.id)).toEqual([kept.id]);
  });

  it('refuses impossible requests', async () => {
    await expect(create(1, { difficulty: 7 })).rejects.toThrow(/difficulty/);
    await expect(create(1, { mercs: 0 })).rejects.toThrow(/squad/);
  });
});
