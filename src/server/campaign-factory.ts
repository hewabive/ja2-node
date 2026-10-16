import type { MercProfile } from '../content/formats/prof.ts';
import { loadStubProfiles } from '../content/formats/stub-profiles.ts';
import { loadArmyContent } from '../content/strategic/army.ts';
import { loadEconomyContent } from '../content/strategic/economy-content.ts';
import { loadMerchantContent } from '../content/strategic/merchant-content.ts';
import { loadStrategicContent } from '../content/strategic/strategic-content.ts';
import type { ReadFile } from '../content/world/tileset-loader.ts';
import { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import { AIM_WEEK_CONTRACT, type HireTerms, hireMerc, profileRecruit, type Recruit } from '../sim/campaign/hiring.ts';
import { initNewGame } from '../sim/campaign/new-game.ts';
import { campaignCombatContext } from '../sim/campaign/off-map-combat.ts';
import { mercKindForProfileType } from '../sim/campaign/profiles.ts';
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
export const STUB_SQUAD_PROFILES: readonly number[] = [0, 1, 2, 3, 4, 5];
export const MAX_SQUAD = 6;

interface SquadHire {
  readonly recruit: (id: number) => Recruit;
  readonly terms: HireTerms;
}

function squadHires(
  content: TacticalContent,
  request: CampaignRequest,
  gunNut: boolean,
  types: ReadonlyMap<number, number>,
  stubbed: boolean,
): SquadHire[] {
  if (content.profiles.length === 0) {
    const size = request.mercs ?? DEFAULT_STUB_SQUAD_SIZE;
    return Array.from({ length: size }, () => ({
      recruit: (id: number) => ({ soldier: stubMerc(content, id), profile: null }),
      terms: AIM_WEEK_CONTRACT,
    }));
  }
  const ids = request.profiles ?? (stubbed ? STUB_SQUAD_PROFILES.slice(0, request.mercs ?? DEFAULT_STUB_SQUAD_SIZE) : DEFAULT_AIM_SQUAD);
  return ids.map((p) => ({
    recruit: profileRecruit(hireableProfile(content, p, stubbed), { content, gunNut }),
    terms: { ...AIM_WEEK_CONTRACT, kind: mercKindForProfileType(types.get(p)) },
  }));
}

function hireableProfile(content: TacticalContent, id: number, stubbed: boolean): MercProfile {
  const inAimRange = id >= FIRST_AIM_PROFILE && id <= LAST_AIM_PROFILE;
  const profile = stubbed || inAimRange ? content.profiles[id] : undefined;
  if (!profile) throw new Error(`profile ${id} is not an A.I.M. merc`);
  return profile;
}

async function withStubProfiles(read: ReadFile, content: TacticalContent): Promise<TacticalContent> {
  if (content.profiles.length > 0) return content;
  const profiles = await loadStubProfiles(read, (name) => content.items.byName.get(name)?.index);
  return profiles.length > 0 ? { ...content, profiles } : content;
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
  const [baseContent, strategicContent, army] = await Promise.all([
    loadTacticalContent(read),
    loadStrategicContent(read),
    loadArmyContent(read),
  ]);
  const content = await withStubProfiles(read, baseContent);
  const stubbed = content !== baseContent;
  const economyContent = await loadEconomyContent(read, strategicContent.towns);
  const merchantContent = await loadMerchantContent(read, content.items);
  const state = createStrategicState({
    seed,
    ...(request.difficulty !== undefined ? { options: { difficulty: request.difficulty } } : {}),
  });
  let campaign: CampaignSim | null = null;
  const roster = new Roster({ content, combat: campaignCombatContext(() => campaign, state, content), profiles: state.profiles });
  const worlds = new WorldCache(read, exists);
  campaign = new CampaignSim(state, null, {
    strategic: { content: strategicContent, mercs: roster },
    economy: { economy: economyContent, items: content.items, crew: roster },
    queen: { army },
    sectors: { worlds, content, roster },
    merchants: { content: merchantContent, items: content.items },
  });
  initNewGame(campaign);
  for (const { recruit, terms } of squadHires(content, request, state.options.gunNut, economyContent.mercTypes, stubbed)) {
    const hired = hireMerc(campaign, roster, recruit, content, terms);
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
