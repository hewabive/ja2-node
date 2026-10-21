import { parseSectorString, type Sector, strategicIndex } from '../../src/content/strategic/sector-ids.ts';
import { CampaignSession } from '../../src/server/campaign-session.ts';
import type { Session } from '../../src/server/session.ts';
import { getGroup, setGroupSectorValue } from '../../src/sim/strategic/forces/groups.ts';
import { SKYRIDER, setUpHelicopterForPlayer } from '../../src/sim/strategic/forces/helicopter.ts';
import { sectorInfo } from '../../src/sim/strategic/map/sectors.ts';
import { progressFromProfile } from '../../src/sim/tactical/profiles.ts';
import { createSaveKit, type SaveKit } from './saves.ts';
import { loadStubSectorKit, type StubSectorKit } from './sectors.ts';

export const MAP_SCREEN_SAVE = 'u8-map-screen';
const SEED = 808;
const MERCS = 4;
const START = 'A9';
const APPROACH = 'C13';
const TOWN_SECTOR = 'D13';
const DRASSEN = ['B13', 'C13', 'D13'];
const DRASSEN_TOWN = 2;
const LOYALTY = 50;
const QUIET = [START, 'A10', 'B9', 'B10', ...DRASSEN];
const ROUTE_STEP_SECONDS = 2 * 3600;
const ROUTE_STEPS = 20;
const DESCRIPTION = 'U8 map screen: Drassen and the helicopter';

export interface MapScreenSave {
  readonly name: string;
  readonly sector: string;
  readonly helicopter: string;
  readonly town: number;
  readonly mercs: readonly number[];
  readonly trainer: number;
}

function campaignOf(session: Session): CampaignSession {
  if (!(session.sim instanceof CampaignSession)) throw new Error('not a campaign');
  return session.sim;
}

function quietSector(sim: CampaignSession, name: string): void {
  Object.assign(sectorInfo(sim.campaign.state.map, parseSectorString(name)), { numAdmins: 0, numTroops: 0, numElites: 0 });
}

function teleportSquad(sim: CampaignSession, sector: Sector): void {
  const campaign = sim.campaign;
  const ctx = campaign.strategic;
  if (!ctx || !campaign.battle) throw new Error('no strategic layer');
  for (const m of campaign.battle.roster.all()) {
    const group = getGroup(ctx, m.groupId);
    if (group) setGroupSectorValue(ctx, sector, group);
    m.sector = { ...sector };
  }
}

function liberateDrassen(sim: CampaignSession): void {
  const state = sim.campaign.state;
  for (const name of DRASSEN) {
    const element = state.map.elements[strategicIndex(parseSectorString(name))];
    if (element) element.enemyControlled = false;
  }
  const town = state.economy.towns[DRASSEN_TOWN];
  if (town) Object.assign(town, { started: true, rating: LOYALTY });
}

function hireSkyrider(sim: CampaignSession, kit: StubSectorKit, at: string): void {
  const campaign = sim.campaign;
  const ctx = campaign.strategic;
  if (!ctx) throw new Error('no strategic layer');
  const skyrider = kit.content.profiles[SKYRIDER];
  if (skyrider) campaign.state.profiles.set(SKYRIDER, progressFromProfile(skyrider));
  setUpHelicopterForPlayer(ctx, parseSectorString(at));
}

async function walkSquadTo(session: Session, name: string): Promise<void> {
  const first = session.sim.view().strategic?.mercs[0];
  if (!first) throw new Error('no merc');
  const routed = session.dispatch({ type: 'route', soldier: first.id, to: name });
  if (!routed.ok) throw new Error(`route to ${name} refused: ${routed.reason}`);
  const there = () => session.sim.view().strategic?.mercs.every((m) => m.sector === name && !m.betweenSectors) === true;
  for (let k = 0; k < ROUTE_STEPS && !there(); k++) session.advance({ worldSeconds: ROUTE_STEP_SECONDS });
  if (!there()) throw new Error(`the squad did not reach ${name}`);
}

function bestTrainer(sim: CampaignSession, ids: readonly number[]): number {
  const crew = sim.campaign.economy?.crew;
  return [...ids].sort((a, b) => (crew?.get(b)?.stats.leadership ?? 0) - (crew?.get(a)?.stats.leadership ?? 0))[0] ?? -1;
}

export interface MapScreenCampaign {
  readonly session: Session;
  readonly mercs: readonly number[];
  readonly trainer: number;
}

export async function buildMapScreenCampaign(saves: SaveKit, kit: StubSectorKit): Promise<MapScreenCampaign> {
  const session = await saves.open({ seed: SEED, campaign: { mercs: MERCS, land: false } });
  const sim = campaignOf(session);
  for (const name of QUIET) quietSector(sim, name);
  const landed = await session.prepareAndDispatch({ type: 'compressTime', mode: 2 });
  if (!landed.ok) throw new Error(`landing refused: ${landed.reason}`);
  if (!session.dispatch({ type: 'mapScreen' }).ok) throw new Error('the map screen did not open');
  teleportSquad(sim, parseSectorString(APPROACH));
  liberateDrassen(sim);
  await walkSquadTo(session, TOWN_SECTOR);
  hireSkyrider(sim, kit, TOWN_SECTOR);
  const mercs = session.sim.view().strategic?.mercs.map((m) => m.id) ?? [];
  return { session, mercs, trainer: bestTrainer(sim, mercs) };
}

export async function writeMapScreenSave(dir: string): Promise<MapScreenSave> {
  const kit = await loadStubSectorKit();
  const saves = await createSaveKit(kit, { dir });
  try {
    const { session, mercs, trainer } = await buildMapScreenCampaign(saves, kit);
    const saved = await saves.saves.save(session, { name: MAP_SCREEN_SAVE, description: DESCRIPTION });
    if (!saved.ok) throw new Error(`the save failed: ${JSON.stringify(saved)}`);
    return { name: saved.name, sector: TOWN_SECTOR, helicopter: TOWN_SECTOR, town: DRASSEN_TOWN, mercs, trainer };
  } finally {
    await saves.dispose();
    await kit.dispose();
  }
}
