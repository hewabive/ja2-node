import { parseSectorString } from '../../src/content/strategic/sector-ids.ts';
import { createCampaignSession } from '../../src/server/campaign-factory.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import { Session } from '../../src/server/session.ts';
import { sectorInfo } from '../../src/sim/strategic/map/sectors.ts';
import type { StubSectorKit } from './sectors.ts';

const ROUTE_BUDGET = 10;
const ROUTE_SLICE_SECONDS = 6 * 3600;
const START = 'A9';
const TARGET = 'A10';

export const STUB_NPC = 94;
export const STUB_DEALER = 91;
export const STUB_RPC = 65;

export interface A10Campaign {
  readonly campaign: CampaignSession;
  readonly session: Session;
  readonly mercs: readonly number[];
}

export async function campaignInA10(kit: StubSectorKit, seed: number, mercs = 2): Promise<A10Campaign> {
  const campaign = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs, land: false });
  const start = sectorInfo(campaign.campaign.state.map, parseSectorString(START));
  start.numAdmins = 0;
  start.numTroops = 0;
  start.numElites = 0;
  const land = { type: 'compressTime', mode: 2 };
  await campaign.prepare(land);
  if (!campaign.dispatch(land).ok) throw new Error('cannot land');
  campaign.dispatch({ type: 'mapScreen' });
  const first = campaign.view().strategic?.mercs[0];
  if (!first) throw new Error('no merc');
  campaign.dispatch({ type: 'route', soldier: first.id, to: TARGET });
  const session = new Session('a10', campaign);
  const arrived = () => campaign.view().strategic?.mercs.every((m) => m.sector === TARGET && !m.betweenSectors) ?? false;
  for (let k = 0; k < ROUTE_BUDGET && !arrived(); k++) session.advance({ worldSeconds: ROUTE_SLICE_SECONDS });
  const enter = { type: 'enterSector', sector: TARGET };
  await campaign.prepare(enter);
  if (!campaign.dispatch(enter).ok) throw new Error('cannot enter A10');
  session.advance({ idle: true });
  return {
    campaign,
    session,
    mercs: campaign
      .view()
      .soldiers.filter((s) => s.team === 0)
      .map((s) => s.id),
  };
}
