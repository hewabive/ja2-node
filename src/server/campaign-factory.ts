import { loadStubProfiles } from '../content/formats/stub-profiles.ts';
import type { DialogueTexts } from '../content/narrative/dialogue-text.ts';
import type { LayerCount } from '../content/narrative/npc-records.ts';
import { type ArmyContent, loadArmyContent } from '../content/strategic/army.ts';
import { type EconomyContent, loadEconomyContent } from '../content/strategic/economy-content.ts';
import { dialogueProfiles, type LaptopContent, loadLaptopContent } from '../content/strategic/laptop-content.ts';
import { loadMerchantContent, type MerchantContent } from '../content/strategic/merchant-content.ts';
import { loadStrategicContent, type StrategicContent } from '../content/strategic/strategic-content.ts';
import { type DataDecoding, DEFAULT_DATA_DECODING } from '../content/text/data-version.ts';
import type { ReadFile } from '../content/world/tileset-loader.ts';
import { type CampaignHooks, CampaignSim, type SimConstruction } from '../sim/campaign/campaign-sim.ts';
import { DEFAULT_AIM_CONTRACT } from '../sim/campaign/laptop/aim.ts';
import { initNewGame } from '../sim/campaign/new-game.ts';
import { campaignCombatContext } from '../sim/campaign/off-map-combat.ts';
import { Roster } from '../sim/campaign/roster.ts';
import type { NarrativeSetup } from '../sim/campaign/talk-flow.ts';
import type { CommandResult } from '../sim/command.ts';
import { DIFFICULTY_LEVELS, type GameOptions, type GameOptionsRequest, gameOptions, type SaveMode } from '../sim/options.ts';
import { createStrategicState, type StrategicState } from '../sim/strategic/state.ts';
import { CompressMode } from '../sim/strategic/time/constants.ts';
import type { TacticalContent } from '../sim/tactical/content.ts';
import { loadTacticalContent } from '../sim/tactical/load-content.ts';
import type { TacticalSim } from '../sim/tactical/tactical-sim.ts';
import { CampaignSession } from './campaign-session.ts';
import { narrativeSetup } from './narrative-content.ts';
import { type FileExists, WorldCache } from './world-cache.ts';

export interface CampaignHire {
  readonly profile: number;
  readonly contract?: number | undefined;
  readonly gear?: boolean | undefined;
}

export interface CampaignRequest {
  readonly options?: GameOptionsRequest | undefined;
  readonly difficulty?: number | undefined;
  readonly profiles?: readonly number[] | undefined;
  readonly hire?: readonly CampaignHire[] | undefined;
  readonly mercs?: number | undefined;
  readonly imp?: Readonly<Record<string, unknown>> | undefined;
  readonly land?: boolean | undefined;
  readonly saveMode?: SaveMode | undefined;
  readonly deadIsDeadName?: string | undefined;
}

export const CAMPAIGN_DIFFICULTIES: readonly number[] = DIFFICULTY_LEVELS;
export const FIRST_AIM_PROFILE = 0;
export const LAST_AIM_PROFILE = 39;
export const DEFAULT_AIM_SQUAD: readonly number[] = [0, 3, 4, 7, 14, 16];
export const DEFAULT_STUB_SQUAD_SIZE = 4;
export const STUB_SQUAD_PROFILES: readonly number[] = [0, 1, 2, 3, 4, 5];
export const MAX_SQUAD = 6;
const IMP_INTRO_MAIL = 'IMP_EMAIL_INTRO';

async function withStubProfiles(read: ReadFile, content: TacticalContent): Promise<TacticalContent> {
  if (content.profiles.length > 0) return content;
  const profiles = await loadStubProfiles(read, (name) => content.items.byName.get(name)?.index);
  return profiles.length > 0 ? { ...content, profiles } : content;
}

function validate(request: CampaignRequest): void {
  requestedOptions(request);
  const explicit = request.hire?.map((h) => h.profile) ?? request.profiles;
  const size = explicit?.length ?? request.mercs;
  if (size !== undefined && (size < (request.hire ? 0 : 1) || size > MAX_SQUAD)) throw new Error(`the squad needs 1 to ${MAX_SQUAD} mercs`);
  if (explicit && new Set(explicit).size !== explicit.length) throw new Error('a merc can be hired once');
  if (explicit?.some((p) => p < FIRST_AIM_PROFILE || p > LAST_AIM_PROFILE)) throw new Error('profile ids are A.I.M. mercs 0-39');
}

function aliased<K extends 'difficulty' | 'saveMode'>(request: CampaignRequest, key: K): GameOptionsRequest[K] {
  const alias = request[key];
  const option = request.options?.[key];
  if (alias !== undefined && option !== undefined && alias !== option)
    throw new Error(`campaign.${key} and campaign.options.${key} disagree; pass campaign.options.${key} only`);
  return (option ?? alias) as GameOptionsRequest[K];
}

export function requestedOptions(request: CampaignRequest): GameOptions {
  const difficulty = aliased(request, 'difficulty');
  const saveMode = aliased(request, 'saveMode');
  return gameOptions({
    ...request.options,
    ...(difficulty !== undefined ? { difficulty } : {}),
    ...(saveMode !== undefined ? { saveMode } : {}),
  });
}

function explicitHires(request: CampaignRequest): CampaignHire[] | null {
  if (request.hire) return [...request.hire];
  if (request.profiles) return request.profiles.map((profile) => ({ profile }));
  return null;
}

function defaultSquadSize(stubbed: boolean, request: CampaignRequest): number {
  return request.mercs ?? (stubbed ? DEFAULT_STUB_SQUAD_SIZE : DEFAULT_AIM_SQUAD.length);
}

function aimHire(campaign: CampaignSim, hire: CampaignHire): CommandResult {
  return campaign.dispatch({
    type: 'aimHire',
    profile: hire.profile,
    contract: hire.contract ?? DEFAULT_AIM_CONTRACT,
    ...(hire.gear !== undefined ? { gear: hire.gear } : {}),
  });
}

function hireSquad(campaign: CampaignSim, request: CampaignRequest, stubbed: boolean): void {
  const explicit = explicitHires(request);
  if (explicit) {
    for (const hire of explicit) {
      const result = aimHire(campaign, hire);
      if (!result.ok) throw new Error(`cannot hire profile ${hire.profile}: ${result.reason ?? 'refused'}`);
    }
    return;
  }
  const wanted = defaultSquadSize(stubbed, request);
  let hired = 0;
  for (const profile of stubbed ? STUB_SQUAD_PROFILES : DEFAULT_AIM_SQUAD) {
    if (hired === wanted) break;
    if (aimHire(campaign, { profile }).ok) hired++;
  }
}

function createImp(campaign: CampaignSim, content: LaptopContent, imp: Readonly<Record<string, unknown>>): void {
  const offset = content.mail[IMP_INTRO_MAIL];
  const mail = campaign.state.laptop.emails.find((m) => m.offset === offset);
  if (mail) campaign.dispatch({ type: 'readEmail', id: mail.id });
  const code = imp.code ?? content.imp.codes[0];
  const result = campaign.dispatch({ ...imp, code, type: 'impCreate' });
  if (!result.ok) throw new Error(`cannot create the I.M.P. character: ${result.reason ?? 'refused'}`);
}

export interface CampaignParts {
  readonly content: TacticalContent;
  readonly strategic: StrategicContent;
  readonly army: ArmyContent;
  readonly economy: EconomyContent;
  readonly merchants: MerchantContent;
  readonly laptop: LaptopContent;
  readonly dialogueProfiles: ReadonlySet<number>;
  readonly narrative: NarrativeSetup & { readonly texts: DialogueTexts };
}

export interface AssembledCampaign {
  readonly campaign: CampaignSim;
  readonly roster: Roster;
  readonly worlds: WorldCache;
}

export interface LoadedCampaignParts {
  readonly parts: CampaignParts;
  readonly stubbed: boolean;
}

export interface NewCampaign extends AssembledCampaign {
  readonly parts: CampaignParts;
  readonly laptopContent: LaptopContent;
  readonly stubbed: boolean;
  readonly texts: DialogueTexts;
}

export interface CampaignAssembly {
  readonly construction?: SimConstruction;
  readonly tactical?: TacticalSim | null;
  readonly worlds?: WorldCache;
}

export function assembleCampaign(
  read: ReadFile,
  exists: FileExists,
  parts: CampaignParts,
  state: StrategicState,
  assembly: CampaignAssembly = {},
): AssembledCampaign {
  const { content } = parts;
  let campaign: CampaignSim | null = null;
  const roster = new Roster({
    state: state.roster,
    content,
    combat: campaignCombatContext(() => campaign, state, content),
    profiles: state.profiles,
  });
  const worlds = assembly.worlds ?? new WorldCache(read, exists);
  const tactical = assembly.tactical ?? null;
  const hooks: CampaignHooks = {
    strategic: { content: parts.strategic, mercs: roster },
    economy: { economy: parts.economy, items: content.items, crew: roster },
    queen: { army: parts.army },
    sectors: { worlds, content, roster },
    merchants: { content: parts.merchants, items: content.items },
    laptop: { content: parts.laptop, merchants: parts.merchants, dialogueProfiles: parts.dialogueProfiles },
    narrative: parts.narrative,
  };
  campaign = assembly.construction === 'restore' ? CampaignSim.restore(state, tactical, hooks) : new CampaignSim(state, tactical, hooks);
  return { campaign, roster, worlds };
}

export async function loadCampaignParts(
  read: ReadFile,
  exists: FileExists,
  layers?: LayerCount,
  decoding: DataDecoding = DEFAULT_DATA_DECODING,
): Promise<LoadedCampaignParts> {
  const [baseContent, strategicContent, army] = await Promise.all([
    loadTacticalContent(read, decoding),
    loadStrategicContent(read),
    loadArmyContent(read),
  ]);
  const content = await withStubProfiles(read, baseContent);
  if (content.profiles.length === 0) throw new Error('no merc profiles: neither prof.dat nor the stub profiles were found');
  const economyContent = await loadEconomyContent(read, strategicContent.towns);
  const merchantContent = await loadMerchantContent(read, content.items);
  const laptopContent = await loadLaptopContent(read, content.items);
  const narrative = await narrativeSetup(read, content.items, content.profiles, layers, decoding);
  const stubbed = content !== baseContent;
  const parts: CampaignParts = {
    content,
    strategic: strategicContent,
    army,
    economy: economyContent,
    merchants: merchantContent,
    laptop: laptopContent,
    dialogueProfiles: dialogueProfiles(exists, economyContent.mercTypes, laptopContent, stubbed),
    narrative,
  };
  return { parts, stubbed };
}

export async function buildNewCampaign(
  read: ReadFile,
  exists: FileExists,
  createState: () => StrategicState,
  layers?: LayerCount,
  decoding: DataDecoding = DEFAULT_DATA_DECODING,
): Promise<NewCampaign> {
  const { parts, stubbed } = await loadCampaignParts(read, exists, layers, decoding);
  const { campaign, roster, worlds } = assembleCampaign(read, exists, parts, createState());
  initNewGame(campaign);
  return { campaign, roster, worlds, parts, laptopContent: parts.laptop, stubbed, texts: parts.narrative.texts };
}

export async function createCampaignSession(
  read: ReadFile,
  exists: FileExists,
  seed: number,
  request: CampaignRequest = {},
  layers?: LayerCount,
  decoding: DataDecoding = DEFAULT_DATA_DECODING,
): Promise<CampaignSession> {
  validate(request);
  const { campaign, roster, worlds, parts, laptopContent, stubbed, texts } = await buildNewCampaign(
    read,
    exists,
    () => createStrategicState({ seed, options: requestedOptions(request) }),
    layers,
    decoding,
  );
  hireSquad(campaign, request, stubbed);
  if (request.imp) createImp(campaign, laptopContent, request.imp);
  const session = new CampaignSession(campaign, roster, worlds, texts, { kind: 'campaign', parts });
  if (request.hire?.length === 0 && !request.imp) return session;
  const closed = campaign.dispatch({ type: 'closeLaptop' });
  if (!closed.ok) throw new Error(`cannot close the laptop: ${closed.reason ?? 'refused'}`);
  if (request.land !== false) await land(session);
  return session;
}

async function land(session: CampaignSession): Promise<void> {
  const command = { type: 'compressTime', mode: CompressMode.MIN5 };
  await session.prepare(command);
  const result = session.dispatch(command);
  if (!result.ok) throw new Error(`the squad cannot land: ${result.reason ?? 'refused'}`);
}
