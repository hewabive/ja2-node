import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSaveKit, type SaveKit } from '../../tests/support/saves.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { CampaignSession } from './campaign-session.ts';
import { snapshotText } from './save-file.ts';
import { reseedSessionSim, sessionSnapshot } from './save-service.ts';
import type { Session } from './session.ts';

const STEP_SOUTH = 160 * 2;
const SANDBOX_TICKS = 300;
const TEST_TIMEOUT_MS = 120_000;

describe('save service on the stub pack', () => {
  let kit: StubSectorKit;
  let saves: SaveKit;
  let seeds: number[];

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  async function freshKit(): Promise<SaveKit> {
    seeds = [4242, 777, 31337];
    saves = await createSaveKit(kit, { entropy: () => seeds.shift() ?? 1 });
    return saves;
  }

  function walk(session: Session): void {
    for (const merc of session.sim.view().soldiers.filter((s) => s.team === Team.OUR))
      session.dispatch({ type: 'move', soldier: merc.id, to: merc.gridNo + STEP_SOUTH, mode: 'run' });
    session.advance({ idle: true });
  }

  it(
    'saves a sandbox, lists it and loads it exactly and with a reseed',
    async () => {
      const k = await freshKit();
      try {
        const session = await k.open({ seed: 5 });
        session.advance({ ticks: SANDBOX_TICKS });
        walk(session);
        const saved = await k.saves.save(session, { description: 'after the walk' });
        expect(saved).toMatchObject({ ok: true, kind: 'player' });
        if (!saved.ok) return;
        expect(saved.name).toMatch(/^2026-10-18t12-00-0\dz-after-the-walk$/);
        expect(saved.header).toMatchObject({ description: 'after the walk', session: 'sandbox', sector: null, flow: 'tactical' });
        const list = await k.saves.list();
        expect(list.map((s) => s.name)).toEqual([saved.name]);

        const exact = await k.open({ load: saved.name, reseed: false });
        expect(k.saves.lastLoad(exact)).toMatchObject({ name: saved.name, seed: null, warnings: [] });
        expect(snapshotText(sessionSnapshot(exact))).toBe(snapshotText(sessionSnapshot(session)));
        session.advance({ ticks: SANDBOX_TICKS });
        exact.advance({ ticks: SANDBOX_TICKS });
        expect(snapshotText(sessionSnapshot(exact))).toBe(snapshotText(sessionSnapshot(session)));

        const player = await k.open({ load: saved.name });
        expect(k.saves.lastLoad(player)?.seed).toBe(4242);
        const manual = await k.open({ load: saved.name, reseed: false });
        reseedSessionSim(manual.sim, 4242);
        expect(snapshotText(sessionSnapshot(player))).toBe(snapshotText(sessionSnapshot(manual)));
        expect(player.log.entries().map((e) => e.kind)).toEqual(['reseed']);

        const replayed = await k.replay(saved.name);
        expect(replayed).toMatchObject({ equal: true, difference: null });
      } finally {
        await saves.dispose();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'saves a landed campaign and replays its log',
    async () => {
      const k = await freshKit();
      try {
        const session = await k.open({ seed: 9, campaign: {} });
        expect(session.sim).toBeInstanceOf(CampaignSession);
        walk(session);
        const saved = await k.saves.save(session, { name: 'landed' });
        expect(saved).toMatchObject({ ok: true, name: 'landed' });
        expect(await k.replay('landed')).toMatchObject({ equal: true });
        const loaded = await k.open({ load: 'landed', reseed: false });
        expect(snapshotText(sessionSnapshot(loaded))).toBe(snapshotText(sessionSnapshot(session)));
      } finally {
        await saves.dispose();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
