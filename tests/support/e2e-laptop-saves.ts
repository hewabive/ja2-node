import { parseSectorString, strategicIndex } from '../../src/content/strategic/sector-ids.ts';
import { CampaignSession } from '../../src/server/campaign-session.ts';
import type { Session } from '../../src/server/session.ts';
import { Bookmark } from '../../src/sim/campaign/laptop/laptop-state.ts';
import { sectorInfo } from '../../src/sim/strategic/map/sectors.ts';
import { createSaveKit } from './saves.ts';
import { loadStubSectorKit } from './sectors.ts';

export const LAPTOP_SITES_SAVE = 'u11-laptop-sites';
const SEED = 1101;
const MERCS = 2;
const DRASSEN = ['B13', 'C13', 'D13'];
const QUIET = ['A9', 'A10', 'B9', 'B10', ...DRASSEN];
const DRASSEN_TOWN = 2;
const LOYALTY = 50;
const BOOKMARKS = [Bookmark.BOBBYR, Bookmark.MERC, Bookmark.IMP];
const DESCRIPTION = "U11 laptop sites: Bobby Ray's open, Drassen held, the M.E.R.C. and I.M.P. bookmarks";

export interface LaptopSitesSave {
  readonly name: string;
  readonly bookmarks: readonly number[];
}

function campaignOf(session: Session): CampaignSession {
  if (!(session.sim instanceof CampaignSession)) throw new Error('not a campaign');
  return session.sim;
}

function holdDrassen(sim: CampaignSession): void {
  const state = sim.campaign.state;
  for (const name of DRASSEN) {
    const element = state.map.elements[strategicIndex(parseSectorString(name))];
    if (element) element.enemyControlled = false;
  }
  const town = state.economy.towns[DRASSEN_TOWN];
  if (town) Object.assign(town, { started: true, rating: LOYALTY });
  sim.campaign.laptop?.surfaceSectorTaken(parseSectorString('B13'));
}

export async function writeLaptopSitesSave(dir: string): Promise<LaptopSitesSave> {
  const kit = await loadStubSectorKit();
  const saves = await createSaveKit(kit, { dir });
  try {
    const session = await saves.open({ seed: SEED, campaign: { mercs: MERCS, land: false } });
    const sim = campaignOf(session);
    for (const name of QUIET)
      Object.assign(sectorInfo(sim.campaign.state.map, parseSectorString(name)), { numAdmins: 0, numTroops: 0, numElites: 0 });
    const landed = await session.prepareAndDispatch({ type: 'compressTime', mode: 2 });
    if (!landed.ok) throw new Error(`landing refused: ${landed.reason}`);
    if (!session.dispatch({ type: 'mapScreen' }).ok) throw new Error('the map screen did not open');
    const opened = session.dispatch({ type: 'openLaptop' });
    if (!opened.ok) throw new Error(`the laptop did not open: ${opened.reason}`);
    holdDrassen(sim);
    if (!sim.view().laptop?.bobbyRay.open) throw new Error("Bobby Ray's is not open");
    const bookmarks = sim.campaign.state.laptop.bookmarks;
    for (const bookmark of BOOKMARKS) if (!bookmarks.includes(bookmark)) bookmarks.push(bookmark);
    const saved = await saves.saves.save(session, { name: LAPTOP_SITES_SAVE, description: DESCRIPTION });
    if (!saved.ok) throw new Error(`the save failed: ${JSON.stringify(saved)}`);
    return { name: saved.name, bookmarks: [...bookmarks] };
  } finally {
    await saves.dispose();
    await kit.dispose();
  }
}
