import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MercProfile } from '../../src/content/formats/prof.ts';
import { parseStubProfiles } from '../../src/content/formats/stub-profiles.ts';
import type { ItemTable } from '../../src/content/items/items.ts';
import { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import type { ContractFlow } from '../../src/sim/campaign/contracts/contract-flow.ts';
import { hireMerc, profileRecruit } from '../../src/sim/campaign/hiring.ts';
import { initNewGame } from '../../src/sim/campaign/new-game.ts';
import { campaignCombatContext } from '../../src/sim/campaign/off-map-combat.ts';
import { MercKind, Roster } from '../../src/sim/campaign/roster.ts';
import { sectorInfo } from '../../src/sim/strategic/map/sectors.ts';
import { createStrategicState } from '../../src/sim/strategic/state.ts';
import type { TacticalContent } from '../../src/sim/tactical/content.ts';
import type { CampaignKit } from './campaign.ts';

export const STUB_PROFILES_FILE = join(import.meta.dirname, '../../stubs/profiles.json');

export function stubProfiles(items: ItemTable): MercProfile[] {
  return parseStubProfiles(JSON.parse(readFileSync(STUB_PROFILES_FILE, 'utf8')), (name) => items.byName.get(name)?.index);
}

export interface ContractHire {
  readonly profile: number;
  readonly asProfile?: number;
  readonly kind?: number;
  readonly length?: number;
}

export interface ContractCampaign {
  readonly campaign: CampaignSim;
  readonly roster: Roster;
  readonly content: TacticalContent;
  readonly flow: ContractFlow;
}

export interface ContractCampaignOptions {
  readonly seed: number;
  readonly hires: readonly ContractHire[];
}

export function createContractCampaign(kit: CampaignKit, options: ContractCampaignOptions): ContractCampaign {
  const state = createStrategicState({ seed: options.seed });
  const base = kit.sectors.content;
  const profiles = stubProfiles(base.items);
  for (const hire of options.hires) {
    const source = profiles[hire.profile];
    if (hire.asProfile !== undefined && source) profiles[hire.asProfile] = { ...source, id: hire.asProfile };
  }
  const content: TacticalContent = { ...base, profiles };
  let campaign: CampaignSim | null = null;
  const roster = new Roster({
    state: state.roster,
    content,
    combat: campaignCombatContext(() => campaign, state, content),
    profiles: state.profiles,
  });
  const c = new CampaignSim(state, null, {
    strategic: { content: kit.economy.strategic, mercs: roster },
    economy: { economy: kit.economy.economy, items: kit.economy.items, crew: roster },
    queen: { army: kit.army },
    sectors: { worlds: kit.sectors.worlds, content, roster },
  });
  campaign = c;
  initNewGame(c);
  const a9 = sectorInfo(c.state.map, { x: 9, y: 1 });
  a9.numAdmins = 0;
  a9.numTroops = 0;
  a9.numElites = 0;
  for (const hire of options.hires) {
    const profile = content.profiles[hire.asProfile ?? hire.profile];
    if (!profile) throw new Error(`no stub profile ${hire.profile}`);
    const recruit = profileRecruit(profile, { content, gunNut: false });
    const terms = { kind: hire.kind ?? MercKind.AIM_MERC, length: hire.length ?? 7 };
    const hired = hireMerc(c, roster, recruit, content, terms);
    if (typeof hired === 'string') throw new Error(`cannot hire: ${hired}`);
  }
  const flow = c.contracts;
  if (!flow) throw new Error('the campaign has no contract flow');
  return { campaign: c, roster, content, flow };
}
