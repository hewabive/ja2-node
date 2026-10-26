import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../tests/support/original-data.ts';
import { dataDecoding } from '../content/text/data-version.ts';
import { type DataVfs, openDataVfs } from '../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import { detectDataVersion } from './data-version.ts';
import { openRulePack } from './rule-pack.ts';
import { createSaveEnvironment, replayStoredSave, type SaveEnvironment } from './save-environment.ts';
import { snapshotText } from './save-file.ts';
import { sessionSnapshot } from './save-service.ts';
import { DEFAULT_SESSION_TEXT, type Session } from './session.ts';
import { createSessionFactory } from './session-factory.ts';
import type { SessionFactory } from './session-registry.ts';

const dataDir = ORIGINAL_DATA_DIR;
const gameRoot = basename(dataDir).toLowerCase() === 'data' ? dirname(dataDir) : dataDir;
const savesDir = process.env.JA2_SAVES_DIR || join(gameRoot, 'SavedGames');
const nativeSaves = dataDir && existsSync(savesDir) ? readdirSync(savesDir).filter((f) => f.toLowerCase().endsWith('.sav')) : [];
const SCENARIO_TIMEOUT_MS = 180_000;
const CONTINUE_TICKS = 300;

describe.skipIf(!ORIGINAL_DATA_DIR)('ja2-node saves with the original data', () => {
  let data: DataVfs;
  let saveDir: string;
  let environment: SaveEnvironment;
  let factory: SessionFactory;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir });
    saveDir = await mkdtemp(join(tmpdir(), 'ja2-original-saves-'));
    const version = detectDataVersion(data.vfs, true, process.env).version;
    const { pack } = await openRulePack({ vfs: data.vfs, source: 'original', cacheDir: null });
    environment = createSaveEnvironment({
      vfs: data.vfs,
      pack,
      dataDir,
      dataVersion: version,
      decoding: dataDecoding(version),
      env: { JA2_SAVE_DIR: saveDir, JA2_SAVES_DIR: savesDir, JA2_COMMIT: 'test' },
    });
    factory = createSessionFactory({ ...environment.sources, text: DEFAULT_SESSION_TEXT, saves: environment.saves });
  });

  afterAll(async () => {
    await environment.saves.flush();
    await data.close();
    await rm(saveDir, { recursive: true, force: true });
  });

  async function saveAndReload(session: Session, name: string): Promise<Session> {
    expect(await environment.saves.save(session, { name })).toMatchObject({ ok: true, header: { content: { source: 'original' } } });
    expect(await replayStoredSave(environment, name)).toMatchObject({ equal: true });
    const loaded = await factory(`${name}-loaded`, { seed: 0, load: { name, reseed: false } });
    expect(environment.saves.lastLoad(loaded)?.warnings).toEqual([]);
    expect(snapshotText(sessionSnapshot(loaded)) === snapshotText(sessionSnapshot(session))).toBe(true);
    return loaded;
  }

  it(
    'saves a new campaign, replays its log and loads it exactly',
    async () => {
      const session = await factory('campaign', { seed: 7, campaign: {} });
      session.advance({ ticks: CONTINUE_TICKS });
      const loaded = await saveAndReload(session, 'campaign');
      session.advance({ ticks: CONTINUE_TICKS });
      loaded.advance({ ticks: CONTINUE_TICKS });
      expect(snapshotText(sessionSnapshot(loaded)) === snapshotText(sessionSnapshot(session))).toBe(true);
    },
    SCENARIO_TIMEOUT_MS,
  );

  it.skipIf(nativeSaves.length === 0)(
    'continues a native save in ja2-node format: import, save, replay from the native file, load',
    async () => {
      const native = (nativeSaves.at(-1) ?? '').replace(/\.sav$/i, '');
      const session = await factory('imported', { seed: 3, save: native });
      session.advance({ ticks: CONTINUE_TICKS });
      const loaded = await saveAndReload(session, 'imported');
      expect((await environment.saves.list()).some((s) => s.native && s.name === native)).toBe(true);
      session.advance({ ticks: CONTINUE_TICKS });
      loaded.advance({ ticks: CONTINUE_TICKS });
      expect(snapshotText(sessionSnapshot(loaded)) === snapshotText(sessionSnapshot(session))).toBe(true);
    },
    SCENARIO_TIMEOUT_MS,
  );
});
