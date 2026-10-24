import { CampaignSession } from '../../src/server/campaign-session.ts';
import type { Session } from '../../src/server/session.ts';
import { Meanwhile } from '../../src/sim/strategic/ai/constants.ts';
import { scheduleMeanwhileEvent } from '../../src/sim/strategic/ai/meanwhile.ts';
import { createSaveKit, type SaveKit } from './saves.ts';
import { loadStubSectorKit } from './sectors.ts';
import { landSquad, moveToThePalaceBasement, queenBleedingToDeath } from './story.ts';

export const STORY_MAP_SAVE = 'u13-map';
export const STORY_MEANWHILE_SAVE = 'u13-meanwhile';
export const STORY_PALACE_SAVE = 'u13-palace';
export const STORY_SCENE = Meanwhile.DRASSEN_LIBERATED;
const SEED = 1313;
const MERCS = 2;
const START = 'A9';
const SECONDS_PER_MINUTE = 60;

function campaignOf(session: Session): CampaignSession {
  if (!(session.sim instanceof CampaignSession)) throw new Error('not a campaign');
  return session.sim;
}

async function landedOnTheMap(saves: SaveKit): Promise<Session> {
  const session = await saves.open({ seed: SEED, campaign: { mercs: MERCS, land: false } });
  const sim = campaignOf(session);
  await landSquad(sim, [START]);
  if (!session.dispatch({ type: 'mapScreen' }).ok) throw new Error('the map screen did not open');
  return session;
}

async function save(saves: SaveKit, session: Session, name: string, description: string): Promise<void> {
  const saved = await saves.saves.save(session, { name, description });
  if (!saved.ok) throw new Error(`the save ${name} failed: ${JSON.stringify(saved)}`);
}

export async function writeStorySaves(dir: string): Promise<void> {
  const kit = await loadStubSectorKit();
  const saves = await createSaveKit(kit, { dir });
  try {
    await save(saves, await landedOnTheMap(saves), STORY_MAP_SAVE, 'U13 story: the map screen');
    const meanwhile = await landedOnTheMap(saves);
    const sim = campaignOf(meanwhile);
    const queen = sim.campaign.queen;
    if (!queen) throw new Error('no strategic AI');
    const minute = Math.trunc(sim.campaign.state.clock.seconds / SECONDS_PER_MINUTE) + 1;
    scheduleMeanwhileEvent(queen, STORY_SCENE, minute);
    await save(saves, meanwhile, STORY_MEANWHILE_SAVE, 'U13 story: a meanwhile scene is due');
    const palace = await saves.open({ seed: SEED, campaign: { mercs: MERCS, land: false } });
    const palaceSim = campaignOf(palace);
    await landSquad(palaceSim, [START]);
    await moveToThePalaceBasement(palaceSim);
    queenBleedingToDeath(palaceSim);
    await save(saves, palace, STORY_PALACE_SAVE, 'U13 story: the Queen is dying');
  } finally {
    await saves.dispose();
    await kit.dispose();
  }
}
