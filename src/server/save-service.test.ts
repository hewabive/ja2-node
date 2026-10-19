import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syntheticSaveHeaderBytes } from '../../tests/support/native-save.ts';
import { battleSandbox, ourTurn } from '../../tests/support/save-scenarios.ts';
import { createSaveKit, type SaveKit, type SaveKitOptions } from '../../tests/support/saves.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { PRE_RANDOM_RING_SIZE } from '../core/rng.ts';
import type { SimEvent } from '../sim/events.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { CampaignSession } from './campaign-session.ts';
import type { ContentFileEntry } from './content-identity.ts';
import { decodeInputLog } from './input-log.ts';
import type { TacticalSession } from './sandbox.ts';
import { encodeSaveFile, inflateSave, parseSaveText, SAVE_VERSION, type SaveFile, snapshotText } from './save-file.ts';
import { loadProblemOf, reseedSessionSim, sessionSnapshot } from './save-service.ts';
import { MAX_UPLOAD_BYTES } from './save-store.ts';
import { Session, type SessionSim } from './session.ts';
import type { SessionSnapshot } from './session-snapshot.ts';

const STEP_SOUTH = 160 * 2;
const SANDBOX_TICKS = 300;
const TEST_TIMEOUT_MS = 120_000;
const PLAYER_SEED = 4242;

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

async function withKit(work: (k: SaveKit) => Promise<void>, options: SaveKitOptions = {}): Promise<void> {
  const seeds = [PLAYER_SEED, 777, 31337];
  const k = await createSaveKit(kit, { entropy: () => seeds.shift() ?? 1, ...options });
  try {
    await work(k);
  } finally {
    await k.dispose();
  }
}

function walk(session: Session): void {
  for (const merc of session.sim.view().soldiers.filter((s) => s.team === Team.OUR))
    session.dispatch({ type: 'move', soldier: merc.id, to: merc.gridNo + STEP_SOUTH, mode: 'run' });
  session.advance({ idle: true });
}

function text(session: Session): string {
  return snapshotText(sessionSnapshot(session));
}

async function storedFile(k: SaveKit, name: string): Promise<SaveFile> {
  const bytes = await k.store.read(name);
  if (!bytes) throw new Error(`no save ${name}`);
  return parseSaveText(inflateSave(bytes).text);
}

async function writeVersionOne(k: SaveKit, from: string, to: string, files: readonly ContentFileEntry[], logic: string): Promise<void> {
  const file = await storedFile(k, from);
  const header = { ...file.header, content: { ...file.header.content, logic } };
  const head = `{"format":${JSON.stringify(file.format)},"version":1,"header":${JSON.stringify(header)},\n`;
  const parts = [
    `"session":${JSON.stringify(file.session)}`,
    `"contentFiles":${JSON.stringify(files)}`,
    `"sim":${JSON.stringify(file.sim)}`,
  ];
  const body = `${[...parts, `"presentation":${JSON.stringify(file.presentation)}`].join(',')}}`;
  await k.store.write(to, { bytes: gzipSync(head + body), log: null, backups: false });
}

async function rewrite(k: SaveKit, from: string, to: string, change: (file: SaveFile) => SaveFile): Promise<void> {
  await k.store.write(to, { bytes: encodeSaveFile(change(await storedFile(k, from))).bytes, log: null, backups: false });
}

async function loadProblem(k: SaveKit, name: string): Promise<string> {
  try {
    await k.open({ load: name, reseed: false });
    return 'none';
  } catch (err) {
    return loadProblemOf(err);
  }
}

function preDraws(sim: SessionSim, n: number): number[] {
  const state = sim instanceof CampaignSession ? sim.campaign.state : (sim as TacticalSession).sim.state;
  return Array.from({ length: n }, () => state.pre.int(1_000_000));
}

describe('saves and loads on the stub pack', () => {
  it(
    'saves a sandbox, lists it and loads it exactly and with a reseed',
    async () => {
      await withKit(async (k) => {
        const session = await k.open({ seed: 5 });
        session.advance({ ticks: SANDBOX_TICKS });
        walk(session);
        const saved = await k.saves.save(session, { description: 'after the walk' });
        expect(saved).toMatchObject({ ok: true, kind: 'player' });
        if (!saved.ok) return;
        expect(saved.name).toMatch(/^2026-10-18t12-00-0\dz-after-the-walk$/);
        expect(saved.header).toMatchObject({ description: 'after the walk', session: 'sandbox', sector: null, flow: 'tactical' });
        expect((await k.saves.list()).map((s) => s.name)).toEqual([saved.name]);

        const exact = await k.open({ load: saved.name, reseed: false });
        expect(k.saves.lastLoad(exact)).toMatchObject({ name: saved.name, seed: null, warnings: [] });
        expect(text(exact)).toBe(text(session));
        session.advance({ ticks: SANDBOX_TICKS });
        exact.advance({ ticks: SANDBOX_TICKS });
        expect(text(exact)).toBe(text(session));

        const player = await k.open({ load: saved.name });
        expect(k.saves.lastLoad(player)?.seed).toBe(PLAYER_SEED);
        const manual = await k.open({ load: saved.name, reseed: false });
        reseedSessionSim(manual.sim, PLAYER_SEED);
        expect(text(player)).toBe(text(manual));
        expect(player.log.entries().map((e) => e.kind)).toEqual(['reseed']);
        expect(await k.replay(saved.name)).toMatchObject({ equal: true, difference: null });
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'repeats the saved PreRandom ring after a player load until it is used up',
    async () => {
      await withKit(async (k) => {
        const session = await k.open({ seed: 6 });
        session.advance({ ticks: SANDBOX_TICKS });
        expect(await k.saves.save(session, { name: 'ring' })).toMatchObject({ ok: true });
        const exact = await k.open({ load: 'ring', reseed: false });
        const player = await k.open({ load: 'ring' });
        const exactDraws = preDraws(exact.sim, PRE_RANDOM_RING_SIZE * 2);
        const playerDraws = preDraws(player.sim, PRE_RANDOM_RING_SIZE * 2);
        expect(playerDraws.slice(0, PRE_RANDOM_RING_SIZE)).toEqual(exactDraws.slice(0, PRE_RANDOM_RING_SIZE));
        expect(playerDraws.slice(PRE_RANDOM_RING_SIZE)).not.toEqual(exactDraws.slice(PRE_RANDOM_RING_SIZE));
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'saves a landed campaign, loads it in place and replays both logs',
    async () => {
      await withKit(async (k) => {
        const session = await k.open({ seed: 9, campaign: {} });
        expect(session.sim).toBeInstanceOf(CampaignSession);
        walk(session);
        const saved = await k.saves.save(session, { name: 'landed' });
        expect(saved).toMatchObject({
          ok: true,
          name: 'landed',
          header: { session: 'campaign', sector: 'A9', options: { saveMode: 'anywhere' } },
        });
        expect(await k.replay('landed')).toMatchObject({ equal: true });
        const before = text(session);
        walk(session);
        const messages: string[] = [];
        session.subscribe((m) => messages.push(m.t));
        const loaded = await k.saves.loadInto(session, 'landed', false);
        expect(loaded).toMatchObject({ name: 'landed', seed: null });
        expect(messages).toEqual(['welcome', 'welcome']);
        expect(text(session)).toBe(before);
        const report = session.advance({ ticks: 20 });
        expect(report.events.filter((e) => (e as { type: string }).type === 'gameLoaded')).toEqual([
          { type: 'gameLoaded', name: 'landed', seed: null, tick: expect.any(Number) },
        ]);
        walk(session);
        expect(await k.saves.save(session, { name: 'again' })).toMatchObject({ ok: true });
        const log = decodeInputLog((await k.store.readLog('again')) ?? new Uint8Array());
        expect(log.origin).toMatchObject({ kind: 'load', name: 'landed' });
        expect(await k.replay('again')).toMatchObject({ equal: true });
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'autosaves into Auto01 and Auto02 when endTurn is accepted and combat goes on',
    async () => {
      await withKit(async (k) => {
        const session = await battleSandbox(k);
        expect(ourTurn(session)).toBe(true);
        const before = text(session);
        const tick = session.sim.tick;
        expect(session.dispatch({ type: 'endTurn' })).toMatchObject({ ok: true });
        expect(session.dispatch({ type: 'endTurn' })).toMatchObject({ ok: false });
        await k.saves.flush();
        expect((await k.saves.list()).map((s) => s.name)).toEqual(['Auto01']);
        const auto = await storedFile(k, 'Auto01');
        expect(auto.header).toMatchObject({ kind: 'auto', description: 'Auto01', tick });
        expect(
          snapshotText({ session: auto.session.kind, preparedMaps: auto.session.preparedMaps, sim: auto.sim } as SessionSnapshot),
        ).toBe(before);
        expect(await k.replay('Auto01')).toMatchObject({ equal: true });
        const events: SimEvent[] = [];
        for (const name of ['Auto02', 'Auto01']) {
          events.push(...session.advance({ idle: true }).events);
          if (!ourTurn(session)) break;
          expect(session.dispatch({ type: 'endTurn' }).ok).toBe(true);
          await k.saves.flush();
          expect((await storedFile(k, name)).header.tick).toBe(session.log.entries().at(-1)?.tick);
        }
        expect(events.some((e) => (e as { type: string }).type === 'gameSaved')).toBe(false);
        expect((await k.saves.list()).map((s) => s.name).sort()).toEqual(['Auto01', 'Auto02']);
        expect((await storedFile(k, 'Auto01')).header.tick).toBeGreaterThan((await storedFile(k, 'Auto02')).header.tick);
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'refuses content mismatches and newer versions, and warns about text and engine differences',
    async () => {
      await withKit(async (k) => {
        const session = await k.open({ seed: 5 });
        session.advance({ ticks: 50 });
        expect(await k.saves.save(session, { name: 'base' })).toMatchObject({ ok: true });
        await rewrite(k, 'base', 'logic', (f) => ({ ...f, header: { ...f.header, content: { ...f.header.content, logic: 'x' } } }));
        await rewrite(k, 'base', 'source', (f) => ({
          ...f,
          header: { ...f.header, content: { ...f.header.content, source: 'original' } },
        }));
        const legacyFiles: ContentFileEntry[] = [
          ['tables/tiles.json', 'f'],
          ['npcdata/199.npc', 'm'],
          ['stubs/world/maps/village.dat', 'f'],
        ];
        const legacyHash = await k.identity.legacyHash(legacyFiles);
        await writeVersionOne(k, 'base', 'version1', legacyFiles, legacyHash);
        await writeVersionOne(k, 'base', 'files', [...legacyFiles, ['stubs/world/maps/a9.dat', 'f']], legacyHash);
        await rewrite(k, 'base', 'newer', (f) => ({ ...f, version: SAVE_VERSION + 1 }));
        await rewrite(k, 'base', 'text', (f) => ({ ...f, header: { ...f.header, content: { ...f.header.content, text: 'other' } } }));
        await rewrite(k, 'base', 'engine', (f) => ({ ...f, header: { ...f.header, engine: { version: '9.9.9', commit: 'zzz' } } }));
        expect(await loadProblem(k, 'logic')).toBe('contentMismatch');
        expect(await loadProblem(k, 'source')).toBe('contentMismatch');
        expect(await loadProblem(k, 'files')).toBe('contentMismatch');
        expect(await loadProblem(k, 'newer')).toBe('versionTooNew');
        expect(await loadProblem(k, 'missing')).toBe('notFound');
        expect(await loadProblem(k, 'version1')).toBe('none');
        const warned = await k.open({ load: 'text', reseed: false });
        expect(k.saves.lastLoad(warned)?.warnings).toEqual(['dataVersionDiffers']);
        const engine = await k.open({ load: 'engine', reseed: false });
        expect(k.saves.lastLoad(engine)?.warnings).toEqual(['engineDiffers']);
        const listed = await k.saves.list();
        expect(listed.find((s) => s.name === 'newer')).toMatchObject({ compatible: false, problems: ['versionTooNew'] });
        expect(listed.find((s) => s.name === 'source')).toMatchObject({ compatible: false, problems: ['contentMismatch'] });
        await expect(k.saves.loadInto(session, '../base')).rejects.toMatchObject({ problem: 'invalidName' });
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'validates uploads, hands out downloads and lists native saves read only',
    async () => {
      const nativeDir = await mkdtemp(join(tmpdir(), 'ja2-native-'));
      await writeFile(join(nativeDir, 'SaveGame05.sav'), syntheticSaveHeaderBytes('Synthetic native'));
      try {
        await withKit(
          async (k) => {
            const session = await k.open({ seed: 5 });
            expect(await k.saves.save(session, { name: 'base' })).toMatchObject({ ok: true });
            const bytes = await k.saves.download('base');
            expect(await k.saves.upload('copy', bytes)).toMatchObject({ ok: true, name: 'copy', warnings: [] });
            await expect(k.saves.upload('junk', new TextEncoder().encode('junk'))).rejects.toMatchObject({ problem: 'notASave' });
            await expect(k.saves.upload('huge', new Uint8Array(MAX_UPLOAD_BYTES + 1))).rejects.toMatchObject({ problem: 'tooLarge' });
            await expect(k.saves.upload('QuickSave', bytes)).rejects.toMatchObject({ problem: 'invalidName' });
            const listed = await k.saves.list();
            expect(
              listed
                .filter((s) => !s.native)
                .map((s) => s.name)
                .sort(),
            ).toEqual(['base', 'copy']);
            expect(listed.find((s) => s.native)).toMatchObject({
              name: 'SaveGame05',
              native: true,
              header: { description: 'Synthetic native', world: { day: 2, hour: 3, minute: 4 }, mercs: 1 },
              compatible: false,
              problems: ['needsOriginalData'],
            });
            expect(await k.saves.delete('copy')).toBe(true);
            await expect(k.saves.download('copy')).rejects.toMatchObject({ problem: 'notFound' });
          },
          { nativeDir },
        );
      } finally {
        await rm(nativeDir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it('writes the input log as Error.log.jsonl.gz when a command throws', async () => {
    await withKit(async (k) => {
      const sim: SessionSim = {
        tick: 0,
        isIdle: () => true,
        hasPendingDecision: () => false,
        step: () => {},
        drainEvents: () => [],
        dispatch: () => {
          throw new Error('boom');
        },
        view: () => ({ tick: 0, mapPath: null, soldiers: [] }),
      };
      const session = new Session('broken', sim, undefined, { kind: 'sandbox', seed: 1 });
      k.saves.attach(session);
      expect(() => session.dispatch({ type: 'explode' })).toThrow('boom');
      await k.saves.flush();
      const log = decodeInputLog((await k.store.readLog('Error')) ?? new Uint8Array());
      expect(log.entries).toEqual([{ seq: 0, tick: 0, kind: 'cmd', payload: { cmd: { type: 'explode' } } }]);
      expect(k.warnings.join()).toMatch(/Error\.log\.jsonl\.gz/);
      expect(await k.store.read('Error')).toBeNull();
    });
  });
});
