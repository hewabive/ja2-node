import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../tests/support/original-data.ts';
import { expectReloadsInvisible, type RunMode } from '../../tests/support/reload.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { withGraphicFacts } from '../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../content/vfs/vfs.ts';
import { type DataVfs, openDataVfs } from '../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import { advance } from '../sim/advance.ts';
import { DEFAULT_AIM_CONTRACT } from '../sim/campaign/laptop/aim.ts';
import { CompressMode } from '../sim/strategic/time/constants.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';
import { createSandboxSession } from './sandbox.ts';
import { createSaveSession } from './save-session.ts';
import type { SessionSim } from './session.ts';
import { restoreSession, snapshotSession } from './session-snapshot.ts';

const STEP_EAST = 2;
const SIX_HOURS = 6 * 3600;
const SANDBOX_TICKS = 400;

describe('session snapshots on the stub pack', () => {
  let kit: StubSectorKit;
  const exists = (path: string) => kit.worlds.exists(path);

  beforeAll(async () => {
    kit = await loadStubSectorKit();
  });

  afterAll(async () => {
    await kit.dispose();
  });

  async function sandbox(mode: RunMode): Promise<SessionSim> {
    const session = drivenSession(await createSandboxSession(kit.read, false, 11), stubSessionSources(kit), mode);
    const live = new ReloadingSession('sandbox', session);
    live.advance({ ticks: SANDBOX_TICKS });
    for (const merc of session.view().soldiers.filter((s) => s.team === Team.OUR))
      live.dispatch({ type: 'move', soldier: merc.id, to: merc.gridNo + STEP_EAST * (merc.id + 1), mode: 'run' });
    live.advance({ idle: true });
    live.advance({ ticks: SANDBOX_TICKS });
    return session;
  }

  async function laptopToLanding(mode: RunMode): Promise<CampaignSession> {
    const created = await createCampaignSession(kit.read, exists, 13, { hire: [] });
    const session = drivenSession(created, stubSessionSources(kit), mode);
    expect(session.view().laptop).toBeDefined();
    const live = new ReloadingSession('laptop', session);
    for (const profile of [0, 1, 2]) live.dispatch({ type: 'aimHire', profile, contract: DEFAULT_AIM_CONTRACT });
    live.dispatch({ type: 'closeLaptop' });
    live.advance({ ticks: 50 });
    const land = { type: 'compressTime', mode: CompressMode.MIN5 };
    await session.prepare(land);
    live.dispatch(land);
    live.advance({ idle: true });
    return session;
  }

  async function landedSquad(mode: RunMode): Promise<CampaignSession> {
    const session = drivenSession(await createCampaignSession(kit.read, exists, 17, {}), stubSessionSources(kit), mode);
    const live = new ReloadingSession('landed', session);
    const merc = session.view().strategic?.mercs[0];
    const soldier = session.view().soldiers.find((s) => s.id === merc?.id);
    if (!merc || !soldier) throw new Error('the squad did not land');
    live.dispatch({ type: 'move', soldier: merc.id, to: soldier.gridNo + STEP_EAST, mode: 'walk' });
    live.advance({ idle: true });
    live.dispatch({ type: 'mapScreen' });
    live.dispatch({ type: 'route', soldier: merc.id, to: 'A10' });
    live.advance({ worldSeconds: SIX_HOURS });
    const enter = { type: 'enterSector', sector: 'A10' };
    await session.prepare(enter);
    live.dispatch(enter);
    live.advance({ idle: true });
    return session;
  }

  it('continues the sandbox exactly after a reload at every input', async () => {
    await expectReloadsInvisible(sandbox);
  });

  it('continues a new campaign from the laptop to the landing exactly after a reload at every input', async () => {
    await expectReloadsInvisible(laptopToLanding);
  });

  it('continues a landed squad through a sector change exactly after a reload at every input', async () => {
    await expectReloadsInvisible(landedSquad);
  });

  it('restores a campaign through the asynchronous path with freshly loaded content and prepared maps', async () => {
    const session = await createCampaignSession(kit.read, exists, 19, {});
    session.drainEvents();
    const json = JSON.stringify(snapshotSession(session));
    const restored = await restoreSession(JSON.parse(json), kit.read, exists);
    expect(JSON.stringify(snapshotSession(restored))).toBe(json);
    expect(JSON.stringify(restored.view())).toBe(JSON.stringify(session.view()));
    expect(JSON.stringify(advance(restored, { ticks: SANDBOX_TICKS }))).toBe(JSON.stringify(advance(session, { ticks: SANDBOX_TICKS })));
    expect(JSON.stringify(snapshotSession(restored))).toBe(JSON.stringify(snapshotSession(session)));
  });

  it('refuses snapshots of other files and sessions it did not build', async () => {
    await expect(restoreSession({ session: 'campaign', preparedMaps: [], sim: { format: 'x' } }, kit.read, exists)).rejects.toThrow(
      /not a ja2-node snapshot/,
    );
    await expect(restoreSession({ session: 'other' }, kit.read, exists)).rejects.toThrow(/not a session snapshot/);
  });
});

const dataDir = ORIGINAL_DATA_DIR;
const gameRoot = basename(dataDir).toLowerCase() === 'data' ? dirname(dataDir) : dataDir;
const savesDir = join(gameRoot, 'SavedGames');
const saveFiles = dataDir && existsSync(savesDir) ? readdirSync(savesDir).filter((f) => f.toLowerCase().endsWith('.sav')) : [];
const CONTINUE_TICKS = 300;

describe.skipIf(!ORIGINAL_DATA_DIR)('snapshots of native save imports', () => {
  let data: DataVfs;
  const read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));
  const exists = (p: string) => data.vfs.stat(p) !== undefined;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir });
  });

  afterAll(async () => {
    await data.close();
  });

  it('round-trips a new campaign landed in Omerta with the original data and continues exactly', async () => {
    const session = await createCampaignSession(read, exists, 7, {});
    session.drainEvents();
    const json = JSON.stringify(snapshotSession(session));
    const restored = await restoreSession(JSON.parse(json), read, exists);
    expect(JSON.stringify(snapshotSession(restored)) === json).toBe(true);
    const ahead = JSON.stringify(advance(session, { ticks: CONTINUE_TICKS }));
    expect(JSON.stringify(advance(restored, { ticks: CONTINUE_TICKS })) === ahead).toBe(true);
    expect(JSON.stringify(snapshotSession(restored)) === JSON.stringify(snapshotSession(session))).toBe(true);
  });

  it('round-trips the original-data sandbox and continues exactly', async () => {
    const session = await createSandboxSession(read, true, 5);
    const json = JSON.stringify(snapshotSession(session));
    const restored = await restoreSession(JSON.parse(json), read, exists);
    expect(JSON.stringify(snapshotSession(restored)) === json).toBe(true);
    const ahead = JSON.stringify(advance(session, { ticks: CONTINUE_TICKS }));
    expect(JSON.stringify(advance(restored, { ticks: CONTINUE_TICKS })) === ahead).toBe(true);
    expect(JSON.stringify(snapshotSession(restored)) === JSON.stringify(snapshotSession(session))).toBe(true);
  });

  it.skipIf(saveFiles.length === 0)('round-trips an import without a world cache, as the tactical oracle builds it', async () => {
    const { session } = await createSaveSession(read, new Uint8Array(readFileSync(join(savesDir, saveFiles[0] ?? ''))));
    session.drainEvents();
    const json = JSON.stringify(snapshotSession(session));
    const restored = await restoreSession(JSON.parse(json), read, null);
    expect(JSON.stringify(snapshotSession(restored)) === json).toBe(true);
    const ahead = JSON.stringify(advance(session, { ticks: CONTINUE_TICKS }));
    expect(JSON.stringify(advance(restored, { ticks: CONTINUE_TICKS })) === ahead).toBe(true);
  });

  for (const file of saveFiles) {
    it(`round-trips the import of ${file} against freshly loaded content and continues exactly`, async () => {
      const { session } = await createSaveSession(read, new Uint8Array(readFileSync(join(savesDir, file))), undefined, exists);
      session.drainEvents();
      const json = JSON.stringify(snapshotSession(session));
      const restored = await restoreSession(JSON.parse(json), read, exists);
      expect(JSON.stringify(snapshotSession(restored)) === json).toBe(true);
      const ahead = JSON.stringify(advance(session, { ticks: CONTINUE_TICKS }));
      expect(JSON.stringify(advance(restored, { ticks: CONTINUE_TICKS })) === ahead).toBe(true);
      expect(JSON.stringify(snapshotSession(restored)) === JSON.stringify(snapshotSession(session))).toBe(true);
    });
  }
});
