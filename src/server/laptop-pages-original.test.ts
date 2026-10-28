import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../tests/support/original-data.ts';
import { withGraphicFacts } from '../content/rules/graphic-facts.ts';
import { FLORIST_BOUQUETS } from '../content/strategic/laptop-content.ts';
import { loadUiStrings } from '../content/text/strings.ts';
import { vfsFileReader } from '../content/vfs/vfs.ts';
import { type DataVfs, openDataVfs } from '../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import { addHistory, ENRICO_BACKGROUND_FILE } from '../sim/campaign/laptop/records.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';
import { HistoryCode } from './history-labels.ts';

const dataDir = ORIGINAL_DATA_DIR;
const SEED = 7;
const OMERTA = { x: 9, y: 1, z: 0 };

describe.skipIf(!dataDir)('the U12 laptop pages on the original data', () => {
  let data: DataVfs;
  let session: CampaignSession;
  const read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir });
    session = await createCampaignSession(read, (p) => data.vfs.stat(p) !== undefined, SEED, { hire: [] });
    session.useLabels(await loadUiStrings(read, 'eng'));
  });
  afterAll(async () => {
    await data.close();
  });

  it('reads the ten bouquet prices from the gallery text and charges the bouquet with the delivery', () => {
    const laptop = session.view().laptop;
    const prices = laptop?.florist.bouquetPrices ?? [];
    expect(prices).toHaveLength(FLORIST_BOUQUETS);
    expect(prices.every((p) => Number.isInteger(p) && p > 0)).toBe(true);
    const destination = laptop?.bobbyRay.destinations[0];
    const balance = laptop?.balance ?? 0;
    const visited = session.dispatch({ type: 'visitSite', site: 'floristOrderForm' });
    expect(visited.ok).toBe(true);
    const ordered = session.dispatch({ type: 'orderFlowers', bouquet: 3, destination: 0, nextDay: false, extras: [] });
    const price = (prices[3] ?? 0) + (destination?.flowers.whenItGetsThere ?? 0);
    expect(ordered).toMatchObject({ ok: true, data: { price } });
    expect(session.view().laptop?.balance).toBe(balance - price);
  });

  it('renders the history rows from the quest texts and the sector labels', () => {
    const laptop = session.view().laptop;
    const accepted = laptop?.history.find((h) => h.code === HistoryCode.ACCEPTED_ASSIGNMENT_FROM_ENRICO);
    expect(accepted?.text.length).toBeGreaterThan(0);
    const quest = laptop?.history.find((h) => h.code === HistoryCode.QUEST_STARTED);
    expect(quest?.text.length).toBeGreaterThan(0);
    expect(quest?.questInProgress).toBe(true);
    addHistory(session.campaign.state.laptop, HistoryCode.WONBATTLE, 0, 60, OMERTA);
    const won = session.view().laptop?.history.at(-1);
    expect(won?.location).toMatch(/^A9: Omerta/);
    expect(won?.text).toBe('Battle won');
  });

  it('marks the background file read and lists the hired merc with his personnel block', () => {
    expect(session.dispatch({ type: 'readFile', code: ENRICO_BACKGROUND_FILE })).toMatchObject({ ok: true });
    expect(session.view().laptop?.files[0]?.read).toBe(true);
    const profile = session.view().laptop?.aim.find((a) => a.face === 'available')?.profile ?? -1;
    const hired = session.dispatch({ type: 'aimHire', profile, contract: 7, gear: false });
    expect(hired.ok).toBe(true);
    const merc = session.view().laptop?.personnel.current.find((m) => m.profile === profile);
    expect(merc?.employment).toMatchObject({ kind: 'aim', totalDays: 7 });
    expect(merc?.inventory.length).toBeGreaterThan(0);
    expect(merc?.fullName.length).toBeGreaterThan(0);
    const offer = session.view().laptop?.insurance.find((o) => o.profile === profile);
    expect(offer).toMatchObject({ dead: false, contractLength: 7 });
  });
});
