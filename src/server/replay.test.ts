import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approachUntilCombat, ourTurn } from '../../tests/support/save-scenarios.ts';
import { createSaveKit, type SaveKit } from '../../tests/support/saves.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { MemoryInstallation, meanwhileSceneBit } from '../sim/campaign/installation.ts';
import { Meanwhile } from '../sim/strategic/ai/constants.ts';
import { scheduleMeanwhileEvent } from '../sim/strategic/ai/meanwhile.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { CampaignSession } from './campaign-session.ts';
import { decodeInputLog } from './input-log.ts';

const FRAME_MS = 16;
const REALTIME_FRAMES = 40;
const SCENE_IN_MINUTES = 2;
const A9 = { x: 9, y: 1, z: 0 };
const NO_GARRISON = { numAdmins: 0, numTroops: 0, numElites: 0 };
const SCENE_TICKS = 50_000;

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

async function withKit(work: (k: SaveKit) => Promise<void>): Promise<void> {
  const k = await createSaveKit(kit);
  try {
    await work(k);
  } finally {
    await k.dispose();
  }
}

async function logKinds(k: SaveKit, name: string): Promise<string[]> {
  return decodeInputLog((await k.store.readLog(name)) ?? new Uint8Array()).entries.map((e) => e.kind);
}

describe('pnpm cli replay', () => {
  it('reproduces a save from its log under the real-time and the instant driver', async () => {
    await withKit(async (k) => {
      const session = await k.open({ seed: 7 });
      let now = 0;
      session.setDriver({ mode: 'realtime', speed: 4 }, () => now);
      for (let frame = 0; frame < REALTIME_FRAMES; frame++) {
        now += FRAME_MS;
        session.runRealtime(now);
      }
      session.setDriver({ mode: 'instant' });
      approachUntilCombat(session, false);
      expect(ourTurn(session)).toBe(true);
      const merc = session.sim.view().soldiers.find((s) => s.team === Team.OUR);
      session.dispatch({ type: 'stance', soldier: merc?.id ?? 0, stance: 'crouch' });
      expect(session.dispatch({ type: 'endTurn' }).ok).toBe(true);
      session.setDriver({ mode: 'manual' });
      expect(await k.saves.save(session, { name: 'instant' })).toMatchObject({ ok: true });
      const log = decodeInputLog((await k.store.readLog('instant')) ?? new Uint8Array());
      expect(log.entries.slice(0, 3).map((e) => [e.kind, e.payload])).toEqual([
        ['drive', { driver: { mode: 'realtime', speed: 4 } }],
        ['advance', { until: { ticks: (REALTIME_FRAMES * FRAME_MS * 4) / 5 }, realtime: true }],
        ['drive', { driver: { mode: 'instant' } }],
      ]);
      expect(log.entries.filter((e) => e.kind === 'advance' && (e.payload.until as { idle?: boolean }).idle).length).toBeGreaterThan(1);
      expect(await k.replay('instant')).toMatchObject({ equal: true });
      expect(await k.replay('Auto01')).toMatchObject({ equal: true });
    });
  });

  it('reproduces a campaign save under the manual driver, map preparation included', async () => {
    await withKit(async (k) => {
      const session = await k.open({ seed: 3, campaign: { mercs: 2, land: false } });
      expect(session.sim).toBeInstanceOf(CampaignSession);
      expect(await session.prepareAndDispatch({ type: 'compressTime', mode: 2 })).toMatchObject({ ok: true });
      session.advance({ idle: true });
      expect(session.sim.view().mapPath).toBe('stubs/world/maps/a9.dat');
      for (const merc of session.sim.view().soldiers.filter((x) => x.team === Team.OUR))
        await session.prepareAndDispatch({ type: 'move', soldier: merc.id, to: merc.gridNo + 2, mode: 'walk' });
      session.advance({ idle: true });
      expect(await k.saves.save(session, { name: 'manual' })).toMatchObject({ ok: true });
      expect(await logKinds(k, 'manual')).toContain('prepare');
      expect(await k.replay('manual')).toMatchObject({ equal: true });
    });
  });

  it('reproduces a meanwhile scene skipped at its box from the seen flag the box read, whatever the installation says on replay', async () => {
    await withKit(async (k) => {
      const first = await k.open({ seed: 5, campaign: { mercs: 2, land: false } });
      const campaign = (first.sim as CampaignSession).campaign;
      Object.assign(sectorInfo(campaign.state.map, A9), NO_GARRISON);
      expect(await first.prepareAndDispatch({ type: 'compressTime', mode: 2 })).toMatchObject({ ok: true });
      first.advance({ idle: true });
      const minute = Math.trunc(campaign.state.clock.seconds / 60) + SCENE_IN_MINUTES;
      if (!campaign.queen) throw new Error('no queen');
      scheduleMeanwhileEvent(campaign.queen, Meanwhile.AWOL_SCIENTIST, minute);
      expect(await k.saves.save(first, { name: 'posted' })).toMatchObject({ ok: true });
      const session = await k.open({ load: 'posted', reseed: false });
      session.useInstallation(new MemoryInstallation(meanwhileSceneBit(Meanwhile.AWOL_SCIENTIST)));
      expect(session.advance({ ticks: SCENE_TICKS }).reason).toBe('decision');
      const prompt = session.sim.view().prompt;
      expect(prompt).toMatchObject({ kind: 'meanwhile', scene: 'awolScientist' });
      expect(session.dispatch({ type: 'answer', prompt: prompt?.id, choice: 'skip' })).toMatchObject({ ok: true });
      session.advance({ idle: true });
      expect(await k.saves.save(session, { name: 'skipped' })).toMatchObject({ ok: true });
      const log = decodeInputLog((await k.store.readLog('skipped')) ?? new Uint8Array());
      expect(log.entries.filter((e) => e.kind === 'installation').map((e) => e.payload)).toEqual([
        { meanwhileScene: Meanwhile.AWOL_SCIENTIST, seen: true },
      ]);
      expect(await k.replay('skipped')).toMatchObject({ equal: true });
    });
  });
});
