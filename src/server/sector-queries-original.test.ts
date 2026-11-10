import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ClientSide, clientSide, expectHintsAgree, type HintSources, withQueries } from '../../tests/support/hints.ts';
import { ORIGINAL_DATA_DIR } from '../../tests/support/original-data.ts';
import { withGraphicFacts } from '../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../content/vfs/vfs.ts';
import { buildTacticalWorldFromInputs, loadTacticalWorldInputs, type TacticalWorldInputs } from '../content/world/tactical-world.ts';
import { type DataVfs, openDataVfs } from '../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import type { SectorExits } from '../sim/hints/sector-exits.ts';
import type { SectorLayout } from '../sim/hints/sector-layout.ts';
import { createCampaignSession } from './campaign-factory.ts';
import { createSaveSession } from './save-session.ts';
import { Session } from './session.ts';

const dataDir = ORIGINAL_DATA_DIR;
const gameRoot = basename(dataDir).toLowerCase() === 'data' ? dirname(dataDir) : dataDir;
const SAVES = ['SaveGame01.sav', 'SaveGame02.sav', 'SaveGame07.sav', 'SaveGame10.sav'].map((name) => join(gameRoot, 'SavedGames', name));
const MAX_EXITS_CHARS = 1500;
const MAX_LAYOUT_CHARS = 2500;

describe.skipIf(!ORIGINAL_DATA_DIR)('sectorExits and sectorLayout on the original data', () => {
  let data: DataVfs;
  let sources: HintSources;
  let client: ClientSide;
  const inputs = new Map<string, TacticalWorldInputs>();
  const read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));
  const exists = (path: string) => data.vfs.stat(path) !== undefined;

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

  async function expectCompactAgreement(session: Session): Promise<void> {
    const path = session.sim.view().mapPath;
    if (path && !inputs.has(path)) inputs.set(path, await loadTacticalWorldInputs(read, path));
    await expectHintsAgree(session, client, [{ type: 'sectorExits' }, { type: 'sectorLayout' }, { type: 'sectorLayout', level: 1 }]);
    const exits = await session.query({ type: 'sectorExits' });
    expect(exits.ok, exits.reason).toBe(true);
    expect(JSON.stringify(exits).length).toBeLessThan(MAX_EXITS_CHARS);
    const edges = (exits.data as SectorExits).edges;
    expect(edges.some((e) => e.minutes !== null && Object.keys(e.walkTo).length + e.inBand.length > 0)).toBe(true);
    const layout = await session.query({ type: 'sectorLayout' });
    expect(layout.ok, layout.reason).toBe(true);
    expect(JSON.stringify(layout).length).toBeLessThan(MAX_LAYOUT_CHARS);
    const rows = (layout.data as SectorLayout).rows.join('');
    for (const kind of ['.', 'R', '@']) expect(rows).toContain(kind);
  }

  it('answer compactly on a new campaign after the landing, the client as the server', async () => {
    const sim = await createCampaignSession(read, exists, 41, { land: false });
    const land = { type: 'compressTime', mode: 2 };
    await sim.prepare(land);
    expect(sim.dispatch(land).ok).toBe(true);
    expect(sim.dispatch({ type: 'skipHelicopterDrop' }).ok).toBe(true);
    await expectCompactAgreement(withQueries(new Session('sector-exits', sim), sources));
  });

  for (const path of SAVES)
    it.skipIf(!existsSync(path))(`answer compactly on the imported ${basename(path)}, the client as the server`, async () => {
      const { session: sim } = await createSaveSession(read, new Uint8Array(readFileSync(path)), 1, exists);
      await expectCompactAgreement(withQueries(new Session('sector-exits', sim), sources));
    });
});
