import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ClientSide, clientSide, expectHintsAgree, type HintSources, serialisedView, withQueries } from '../../tests/support/hints.ts';
import { sampleStrategicHints } from '../../tests/support/hints-strategic.ts';
import { withGraphicFacts } from '../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../content/vfs/vfs.ts';
import { buildTacticalWorldFromInputs, loadTacticalWorldInputs, type TacticalWorldInputs } from '../content/world/tactical-world.ts';
import { type DataVfs, openDataVfs } from '../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import { createCampaignSession } from './campaign-factory.ts';
import { createSaveSession } from './save-session.ts';
import { Session } from './session.ts';

const dataDir = process.env.JA2_DATA_DIR ?? '';
const gameRoot = basename(dataDir).toLowerCase() === 'data' ? dirname(dataDir) : dataDir;
const SAVES = ['SaveGame01.sav', 'SaveGame02.sav', 'SaveGame07.sav', 'SaveGame10.sav'].map((name) => join(gameRoot, 'SavedGames', name));
const TIMEOUT_MS = 300_000;
const SAMPLE_STEP = 4;

describe.skipIf(!process.env.JA2_DATA_DIR)(
  'strategic cursor hints on the original data, client against server',
  { timeout: TIMEOUT_MS },
  () => {
    let data: DataVfs;
    let sources: HintSources;
    let client: ClientSide;
    const inputs = new Map<string, TacticalWorldInputs>();
    const read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));
    const exists = (path: string) => data.vfs.stat(path) !== undefined;

    async function prepared(session: Session): Promise<void> {
      const path = session.sim.view().mapPath;
      if (path && !inputs.has(path)) inputs.set(path, await loadTacticalWorldInputs(read, path));
    }

    beforeAll(async () => {
      data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir });
      sources = {
        read,
        exists,
        world: (path) => {
          const i = inputs.get(path);
          return i ? buildTacticalWorldFromInputs(i) : null;
        },
      };
      client = await clientSide(sources);
    });

    afterAll(async () => {
      await data.close();
    });

    it('agree on a new campaign after the landing', async () => {
      const sim = await createCampaignSession(read, exists, 41, { land: false });
      const land = { type: 'compressTime', mode: 2 };
      await sim.prepare(land);
      expect(sim.dispatch(land).ok).toBe(true);
      const session = withQueries(new Session('strategic-hints', sim), sources);
      await prepared(session);
      const report = await expectHintsAgree(session, client, sampleStrategicHints(serialisedView(session), SAMPLE_STEP));
      expect(report.answered).toBeGreaterThan(20);
    });

    for (const path of SAVES)
      it.skipIf(!existsSync(path))(`agree on the imported ${basename(path)}`, async () => {
        const { session: sim } = await createSaveSession(read, new Uint8Array(readFileSync(path)), 1, exists);
        const session = withQueries(new Session('strategic-hints', sim), sources);
        await prepared(session);
        const report = await expectHintsAgree(session, client, sampleStrategicHints(serialisedView(session), SAMPLE_STEP));
        expect(report.compared).toBeGreaterThan(0);
      });
  },
);
