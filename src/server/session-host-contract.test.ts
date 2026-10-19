import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildStubs } from '../../stubs/build.ts';
import { TEST_ENGINE } from '../../tests/support/saves.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import type { ServerMessage } from '../protocol/messages.ts';
import type { ViewFrame } from '../protocol/view.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { inflateSave, parseSaveText, SAVE_EXTENSION, snapshotOf, snapshotText } from './save-file.ts';
import { SAVE_DIR_ENV, SaveStore } from './save-store.ts';
import { DEFAULT_SESSION_TEXT } from './session.ts';
import { openSessionEnvironment, type SessionEnvironmentConfig } from './session-environment.ts';
import type { HostFactory, SessionHost } from './session-host.ts';
import { workerHostFactory } from './worker-host.ts';

const TEST_TIMEOUT_MS = 240_000;
const BATTLE_SEED = 7;
const SOUTH_STEP = 160 * 3;
const APPROACH_STEPS = 16;
const SETTLE_TICKS = 40;
const QUERY_ADVANCE_TICKS = 400;
const DEAD_IS_DEAD_NAME = 'OneLife';
const UNSTABLE_KEYS = new Set(['savedAt', 'digest']);

type HostKindUnderTest = 'inprocess' | 'worker';

interface Rig {
  readonly dir: string;
  readonly store: SaveStore;
  readonly create: HostFactory;
  close(): Promise<void>;
}

let stubsDir: string;

beforeAll(async () => {
  stubsDir = await mkdtemp(join(tmpdir(), 'ja2-host-stubs-'));
  await buildStubs(stubsDir);
}, TEST_TIMEOUT_MS);

afterAll(async () => {
  await rm(stubsDir, { recursive: true, force: true });
});

async function rig(kind: HostKindUnderTest): Promise<Rig> {
  const dir = await mkdtemp(join(tmpdir(), `ja2-host-saves-${kind}-`));
  const config: SessionEnvironmentConfig = {
    data: { projectDataDir: PROJECT_DATA_DIR, stubsDir },
    text: DEFAULT_SESSION_TEXT,
    engine: TEST_ENGINE,
    env: { [SAVE_DIR_ENV]: dir },
  };
  const warnings: string[] = [];
  const store = new SaveStore(dir);
  const remove = () => rm(dir, { recursive: true, force: true });
  if (kind === 'worker') {
    return { dir, store, create: workerHostFactory(config, { warn: (m) => warnings.push(m) }), close: remove };
  }
  const environment = await openSessionEnvironment(config, (m) => warnings.push(m));
  return {
    dir,
    store,
    create: environment.createHost,
    close: async () => {
      await environment.close();
      await remove();
    },
  };
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, UNSTABLE_KEYS.has(k) ? '*' : stable(v)]));
}

async function ownSoldiers(host: SessionHost): Promise<{ id: number; gridNo: number }[]> {
  return (await host.observe()).view.soldiers.filter((s) => s.team === Team.OUR).map((s) => ({ id: s.id, gridNo: s.gridNo }));
}

async function inCombat(host: SessionHost): Promise<boolean> {
  return Boolean((await host.observe()).view.combat);
}

async function savedSim(store: SaveStore, name: string): Promise<string | null> {
  const bytes = await store.read(name);
  return bytes ? snapshotText(snapshotOf(parseSaveText(inflateSave(bytes).text))) : null;
}

interface Transcript {
  readonly results: unknown[];
  readonly frames: ViewFrame[];
  readonly welcomes: number;
  readonly snapshots: string[];
  readonly log: unknown;
  readonly files: string[];
  readonly autosave: string | null;
}

async function battleScript(r: Rig): Promise<Transcript> {
  const host = await r.create('contract', { seed: BATTLE_SEED });
  const messages: ServerMessage[] = [];
  host.subscribe((m) => messages.push(m));
  const results: unknown[] = [await host.describe()];
  for (let step = 0; step < APPROACH_STEPS && !(await inCombat(host)); step++) {
    for (const s of await ownSoldiers(host))
      results.push(await host.prepareAndDispatch({ type: 'move', soldier: s.id, to: s.gridNo + SOUTH_STEP, mode: 'swat' }));
    results.push(await host.advance({ idle: true, events: ['combatStarted'] }));
  }
  results.push(await host.advance({ idle: true }));
  expect(await inCombat(host)).toBe(true);
  results.push(await host.save({ name: 'contract', description: 'host contract' }));
  const snapshots = [await host.snapshot()];
  results.push(await host.setDriver({ mode: 'instant' }));
  results.push(await host.prepareAndDispatch({ type: 'endTurn' }));
  results.push(await host.describe(), await host.observe());
  snapshots.push(await host.snapshot());
  results.push(await host.load('contract', false));
  results.push(await host.advance({ ticks: SETTLE_TICKS }));
  snapshots.push(await host.snapshot());
  const log = (await host.inputLog()).entries;
  await host.close();
  return {
    results: results.map(stable),
    frames: messages.flatMap((m) => (m.t === 'frames' ? m.frames : [])),
    welcomes: messages.filter((m) => m.t === 'welcome').length,
    snapshots,
    log: stable(log),
    files: (await readdir(r.dir)).filter((f) => !f.startsWith('.')).sort(),
    autosave: await savedSim(r.store, 'Auto01'),
  };
}

async function concurrentScript(r: Rig): Promise<{ order: string[]; results: unknown[]; log: unknown }> {
  const host = await r.create('concurrent', { seed: BATTLE_SEED });
  const soldiers = await ownSoldiers(host);
  const order: string[] = [];
  const noted = <T>(name: string, p: Promise<T>) =>
    p.then((v) => {
      order.push(name);
      return v;
    });
  const pending: Promise<unknown>[] = [];
  soldiers.forEach((s, i) => {
    pending.push(noted(`move${i}`, host.dispatch({ type: 'move', soldier: s.id, to: s.gridNo + SOUTH_STEP, mode: 'walk' })));
  });
  pending.push(noted('advance', host.advance({ ticks: 300 })));
  pending.push(noted('describe', host.describe()));
  pending.push(noted('instant', host.setDriver({ mode: 'instant' })));
  pending.push(noted('stance', host.dispatch({ type: 'stance', soldier: soldiers[0]?.id ?? 0, stance: 'crouch' })));
  pending.push(noted('manual', host.setDriver({ mode: 'manual' })));
  pending.push(noted('ticks', host.advance({ ticks: 25 })));
  const results = (await Promise.all(pending)).map(stable);
  const log = stable((await host.inputLog()).entries);
  await host.close();
  return { order: order.filter((name) => name !== 'describe'), results: results.filter((_, i) => i !== soldiers.length + 1), log };
}

async function deadIsDeadScript(r: Rig): Promise<{ results: unknown[]; written: string | null }> {
  const host = await r.create('dead', { seed: 8, campaign: { saveMode: 'deadIsDead', deadIsDeadName: DEAD_IS_DEAD_NAME } });
  const results = [
    stable(await host.save({ description: 'mine' })),
    stable(await host.save({ name: 'quick' })),
    stable(await host.describe()),
  ];
  await r.store.delete(DEAD_IS_DEAD_NAME);
  await host.close();
  return { results, written: await savedSim(r.store, DEAD_IS_DEAD_NAME) };
}

async function queryScript(r: Rig): Promise<{ order: string[]; during: unknown; answers: unknown[]; logged: string[] }> {
  const host = await r.create('queries', { seed: BATTLE_SEED });
  const [merc] = await ownSoldiers(host);
  if (!merc) throw new Error('no merc');
  const order: string[] = [];
  const move = { type: 'previewMove', soldier: merc.id, to: merc.gridNo + SOUTH_STEP };
  const start = (await host.observe()).view.tick;
  const running = host.advance({ ticks: QUERY_ADVANCE_TICKS }).then(() => order.push('advance'));
  const first = await host.query(move);
  order.push('query');
  const during = { ok: first.ok, withinAdvance: first.tick >= start && first.tick <= start + QUERY_ADVANCE_TICKS };
  await running;
  const answers: unknown[] = [await host.query(move)];
  answers.push(await host.prepareAndDispatch({ type: 'estimateAttack', soldier: merc.id, target: merc.gridNo + SOUTH_STEP }));
  answers.push(await host.dispatch({ type: 'exitSector', soldier: merc.id, direction: 'south', dryRun: true }));
  const logged = (await host.inputLog()).entries.map((e) => e.kind);
  await host.close();
  return { order, during, answers: answers.map(stable), logged };
}

async function both<T>(script: (r: Rig) => Promise<T>): Promise<[T, T]> {
  const results: T[] = [];
  for (const kind of ['inprocess', 'worker'] as const) {
    const r = await rig(kind);
    try {
      results.push(await script(r));
    } finally {
      await r.close();
    }
  }
  return results as [T, T];
}

describe('the session host contract, in process and in a worker thread', () => {
  it(
    'gives the same results, frames, snapshots, input log and save files for a scripted battle with a save, an autosave and a load',
    async () => {
      const [inProcess, worker] = await both(battleScript);
      expect(inProcess.files).toEqual(expect.arrayContaining([`contract${SAVE_EXTENSION}`, `Auto01${SAVE_EXTENSION}`]));
      expect(inProcess.autosave).not.toBeNull();
      expect(inProcess.welcomes).toBe(2);
      expect(inProcess.frames.length).toBeGreaterThan(0);
      expect(worker.results).toEqual(inProcess.results);
      expect(worker.frames).toEqual(inProcess.frames);
      expect(worker.welcomes).toBe(inProcess.welcomes);
      expect(worker.snapshots).toEqual(inProcess.snapshots);
      expect(worker.log).toEqual(inProcess.log);
      expect(worker.files).toEqual(inProcess.files);
      expect(worker.autosave).toEqual(inProcess.autosave);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'runs calls made without waiting strictly in arrival order',
    async () => {
      const [inProcess, worker] = await both(concurrentScript);
      const moves = inProcess.order.filter((name) => name.startsWith('move'));
      expect(inProcess.order).toEqual([...moves, 'advance', 'instant', 'stance', 'manual', 'ticks']);
      expect(worker).toEqual(inProcess);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'answers queries between ticks, outside the input queue and the input log',
    async () => {
      const [inProcess, worker] = await both(queryScript);
      expect(inProcess.order).toEqual(['query', 'advance']);
      expect(inProcess.during).toEqual({ ok: true, withinAdvance: true });
      expect(inProcess.answers[0]).toMatchObject({ ok: true, data: { destination: 'ok' } });
      expect(inProcess.answers[1]).toHaveProperty('tick');
      expect(inProcess.logged).toEqual(['advance']);
      expect(worker).toEqual(inProcess);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'keeps Dead is Dead: explicit saves refused, quick save and the save point on close write the one file',
    async () => {
      const [inProcess, worker] = await both(deadIsDeadScript);
      expect(inProcess.results[0]).toMatchObject({ ok: false, refused: 'deadIsDead' });
      expect(inProcess.results[1]).toMatchObject({ ok: true, name: DEAD_IS_DEAD_NAME, kind: 'deadIsDead' });
      expect(inProcess.written).not.toBeNull();
      expect(worker).toEqual(inProcess);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'reports a failed creation as the load problem it is',
    async () => {
      for (const kind of ['inprocess', 'worker'] as const) {
        const r = await rig(kind);
        try {
          await expect(r.create('missing', { seed: 1, load: { name: 'nothing', reseed: false } })).rejects.toMatchObject({
            problem: 'notFound',
          });
        } finally {
          await r.close();
        }
      }
    },
    TEST_TIMEOUT_MS,
  );
});
