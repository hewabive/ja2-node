import type { MercProfile } from '../content/formats/prof.ts';
import { loadArmyContent } from '../content/strategic/army.ts';
import { loadEconomyContent } from '../content/strategic/economy-content.ts';
import { loadMerchantContent } from '../content/strategic/merchant-content.ts';
import { loadStrategicContent } from '../content/strategic/strategic-content.ts';
import type { ReadFile } from '../content/world/tileset-loader.ts';
import { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import { hireMerc, profileRecruit, type Recruit } from '../sim/campaign/hiring.ts';
import { initNewGame } from '../sim/campaign/new-game.ts';
import { campaignCombatContext } from '../sim/campaign/off-map-combat.ts';
import { Roster } from '../sim/campaign/roster.ts';
import { Difficulty } from '../sim/strategic/forces/constants.ts';
import { createStrategicState } from '../sim/strategic/state.ts';
import { CompressMode } from '../sim/strategic/time/constants.ts';
import type { TacticalContent } from '../sim/tactical/content.ts';
import { loadTacticalContent } from '../sim/tactical/load-content.ts';
import { CampaignSession } from './campaign-session.ts';
import { stubMerc } from './stub-mercs.ts';
import { type FileExists, WorldCache } from './world-cache.ts';

export interface CampaignRequest {
  readonly difficulty?: number | undefined;
  readonly profiles?: readonly number[] | undefined;
  readonly mercs?: number | undefined;
  readonly land?: boolean | undefined;
}

export const CAMPAIGN_DIFFICULTIES: readonly number[] = Object.values(Difficulty);
export const FIRST_AIM_PROFILE = 0;
export const LAST_AIM_PROFILE = 39;
export const DEFAULT_AIM_SQUAD: readonly number[] = [0, 3, 4, 7, 14, 16];
export const DEFAULT_STUB_SQUAD_SIZE = 4;
export const MAX_SQUAD = 6;

function squadRecruits(content: TacticalContent, request: CampaignRequest, gunNut: boolean): ((id: number) => Recruit)[] {
  if (content.profiles.length === 0) {
    const size = request.mercs ?? DEFAULT_STUB_SQUAD_SIZE;
    return Array.from({ length: size }, () => (id: number) => ({ soldier: stubMerc(content, id), profile: null }));
  }
  return (request.profiles ?? DEFAULT_AIM_SQUAD).map((p) => {
    const profile = aimProfile(content, p);
    return profileRecruit(profile, { content, gunNut });
  });
}

function aimProfile(content: TacticalContent, id: number): MercProfile {
  const profile = id >= FIRST_AIM_PROFILE && id <= LAST_AIM_PROFILE ? content.profiles[id] : undefined;
  if (!profile) throw new Error(`profile ${id} is not an A.I.M. merc`);
  return profile;
}

function validate(request: CampaignRequest): void {
  if (request.difficulty !== undefined && !CAMPAIGN_DIFFICULTIES.includes(request.difficulty))
    throw new Error(`difficulty must be one of ${CAMPAIGN_DIFFICULTIES.join(', ')}`);
  const size = request.profiles?.length ?? request.mercs;
  if (size !== undefined && (size < 1 || size > MAX_SQUAD)) throw new Error(`the squad needs 1 to ${MAX_SQUAD} mercs`);
  if (request.profiles && new Set(request.profiles).size !== request.profiles.length) throw new Error('a merc can be hired once');
}

export async function createCampaignSession(
  read: ReadFile,
  exists: FileExists,
  seed: number,
  request: CampaignRequest = {},
): Promise<CampaignSession> {
  validate(request);
  const [content, strategicContent, army] = await Promise.all([
    loadTacticalContent(read),
    loadStrategicContent(read),
    loadArmyContent(read),
  ]);
  const economyContent = await loadEconomyContent(read, strategicContent.towns);
  const merchantContent = await loadMerchantContent(read, content.items);
  const state = createStrategicState({
    seed,
    ...(request.difficulty !== undefined ? { options: { difficulty: request.difficulty } } : {}),
  });
  let campaign: CampaignSim | null = null;
  const roster = new Roster({ content, combat: campaignCombatContext(() => campaign, state, content) });
  const worlds = new WorldCache(read, exists);
  campaign = new CampaignSim(state, null, {
    strategic: { content: strategicContent, mercs: roster },
    economy: { economy: economyContent, items: content.items, crew: roster },
    queen: { army },
    sectors: { worlds, content, roster },
    merchants: { content: merchantContent, items: content.items },
  });
  initNewGame(campaign);
  for (const recruit of squadRecruits(content, request, state.options.gunNut)) {
    const hired = hireMerc(campaign, roster, recruit, content);
    if (typeof hired === 'string') throw new Error(`cannot hire: ${hired}`);
  }
  const session = new CampaignSession(campaign, roster, worlds);
  if (request.land !== false) await land(session);
  return session;
}

async function land(session: CampaignSession): Promise<void> {
  const command = { type: 'compressTime', mode: CompressMode.MIN5 };
  await session.prepare(command);
  const result = session.dispatch(command);
  if (!result.ok) throw new Error(`the squad cannot land: ${result.reason ?? 'refused'}`);
}
