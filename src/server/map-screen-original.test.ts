import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../tests/support/original-data.ts';
import { withGraphicFacts } from '../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../content/vfs/vfs.ts';
import { type DataVfs, openDataVfs } from '../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import type { StrategicView } from '../protocol/view.ts';
import { createCampaignSession } from './campaign-factory.ts';
import { createSaveSession } from './save-session.ts';

const dataDir = ORIGINAL_DATA_DIR;
const gameRoot = basename(dataDir).toLowerCase() === 'data' ? dirname(dataDir) : dataDir;
const SAVE = join(gameRoot, 'SavedGames', 'SaveGame01.sav');
const TIMEOUT_MS = 300_000;
const TOWNS_WITH_SECTORS = 12;
const MINES = 6;
const SECRETS = new Set(['J9', 'K4', 'D2', 'D15', 'I8', 'N4']);

function expectConsistentEconomy(s: StrategicView): void {
  expect(s.townControl).toHaveLength(TOWNS_WITH_SECTORS);
  for (const t of s.townControl ?? []) expect(t.control).toBeGreaterThanOrEqual(0);
  expect(s.mines).toHaveLength(MINES);
  const predicted = (s.mines ?? []).reduce((sum, m) => sum + m.predictedDailyIncome, 0);
  expect(s.projectedDailyIncome).toBe(predicted);
  for (const m of s.mines ?? []) {
    if (!m.playerControls) expect(m.predictedDailyIncome).toBe(0);
    expect(m.predictedDailyIncome).toBeLessThanOrEqual(Math.max(m.maxDailyRemoval, 0));
  }
  for (const sector of s.secretsFound ?? []) expect(SECRETS.has(sector)).toBe(true);
}

describe.skipIf(!ORIGINAL_DATA_DIR)('map-screen view fields on the original data', { timeout: TIMEOUT_MS }, () => {
  let data: DataVfs;
  const read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));
  const exists = (path: string) => data.vfs.stat(path) !== undefined;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir });
  });

  afterAll(async () => {
    await data.close();
  });

  it('shows the economy, the towns and the clock of a new campaign after the landing', async () => {
    const sim = await createCampaignSession(read, exists, 51, { land: false });
    const land = { type: 'compressTime', mode: 2 };
    await sim.prepare(land);
    expect(sim.dispatch(land).ok).toBe(true);
    const view = sim.view();
    const s = view.strategic;
    if (!s) throw new Error('no strategic view');
    expectConsistentEconomy(s);
    expect(s.mines?.every((m) => !m.playerControls)).toBe(true);
    expect(view.clock?.canCompress).toBe(false);
    expect(view.clock?.compressRefusal).toBe('enemiesPresent');
    for (const m of s.mercs) expect(m.salary).toBeGreaterThan(0);
  });

  it.skipIf(!existsSync(SAVE))('imports the map-screen fields of SaveGame01', async () => {
    const { session } = await createSaveSession(read, new Uint8Array(readFileSync(SAVE)), 1, exists);
    const view = session.view();
    const s = view.strategic;
    if (!s) throw new Error('no strategic view');
    expectConsistentEconomy(s);
    expect(view.clock).toMatchObject({ mode: expect.any(Number), paused: expect.any(Boolean), canCompress: expect.any(Boolean) });
    const drassen = s.sectors.filter((x) => x.town === 2);
    expect(drassen.length).toBeGreaterThan(0);
    for (const sector of drassen) {
      expect(sector.playerControlled).not.toBeNull();
      expect(sector.militiaTraining).toBeGreaterThanOrEqual(0);
    }
    for (const m of s.mercs) {
      expect(typeof m.idle).toBe('boolean');
      expect(typeof m.canChangeSleep).toBe('boolean');
    }
  });
});
