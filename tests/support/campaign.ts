import type { ArmyContent } from '../../src/content/strategic/army.ts';
import type { MerchantContent } from '../../src/content/strategic/merchant-content.ts';
import { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import { hireMerc } from '../../src/sim/campaign/hiring.ts';
import { initNewGame } from '../../src/sim/campaign/new-game.ts';
import { campaignCombatContext } from '../../src/sim/campaign/off-map-combat.ts';
import { Roster } from '../../src/sim/campaign/roster.ts';
import { createItem, createItems } from '../../src/sim/items/object.ts';
import type { MerchantHooks } from '../../src/sim/strategic/economy/merchants/context.ts';
import { sectorInfo } from '../../src/sim/strategic/map/sectors.ts';
import { createStrategicState } from '../../src/sim/strategic/state.ts';
import { CompressMode } from '../../src/sim/strategic/time/constants.ts';
import { InvSlot } from '../../src/sim/tactical/inventory.ts';
import { createSoldier, type Soldier, Team } from '../../src/sim/tactical/soldier.ts';
import { teamMembers } from '../../src/sim/tactical/state.ts';
import type { EconomyTestContent } from './economy.ts';
import type { StubSectorKit } from './sectors.ts';

const STATS = {
  agility: 80,
  dexterity: 80,
  strength: 80,
  wisdom: 80,
  leadership: 50,
  marksmanship: 80,
  mechanical: 30,
  explosives: 30,
  medical: 30,
  experience: 3,
};

export interface CampaignKit {
  readonly sectors: StubSectorKit;
  readonly economy: EconomyTestContent;
  readonly army: ArmyContent;
}

export interface CampaignOptions {
  readonly seed: number;
  readonly mercs?: number;
  readonly garrison?: { readonly admins: number; readonly troops: number; readonly elites: number };
  readonly merchants?: MerchantContent;
  readonly merchantHooks?: Partial<MerchantHooks>;
}

export interface TestCampaign {
  readonly campaign: CampaignSim;
  readonly roster: Roster;
}

function recruit(kit: CampaignKit) {
  const items = kit.sectors.content.items;
  return (id: number) => {
    const palettes = { hair: 'BROWNHEAD', skin: 'TANSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' };
    const soldier = createSoldier({
      id,
      team: Team.OUR,
      name: `Merc ${id}`,
      bodyType: 0,
      palettes,
      stats: STATS,
      life: 80,
      gridNo: -1,
      direction: 4,
      state: 0,
    });
    const gun = items.byName.get('GLOCK_17');
    const clip = items.byName.get('CLIP9_15');
    if (gun) soldier.inv[InvSlot.HAND] = createItem(items, gun.index, 100);
    if (clip) soldier.inv[InvSlot.BIGPOCK1] = createItems(items, clip.index, 100, 3);
    return { soldier, profile: null };
  };
}

export function createTestCampaign(kit: CampaignKit, options: CampaignOptions): TestCampaign {
  const state = createStrategicState({ seed: options.seed });
  let campaign: CampaignSim | null = null;
  const content = kit.sectors.content;
  const roster = new Roster({ content, combat: campaignCombatContext(() => campaign, state, content) });
  const c = new CampaignSim(state, null, {
    strategic: { content: kit.economy.strategic, mercs: roster },
    economy: { economy: kit.economy.economy, items: kit.economy.items, crew: roster },
    queen: { army: kit.army },
    sectors: { worlds: kit.sectors.worlds, content, roster },
    ...(options.merchants
      ? {
          merchants: {
            content: options.merchants,
            items: kit.economy.items,
            ...(options.merchantHooks ? { hooks: options.merchantHooks } : {}),
          },
        }
      : {}),
  });
  campaign = c;
  initNewGame(c);
  if (options.garrison) {
    const a9 = sectorInfo(c.state.map, { x: 9, y: 1 });
    a9.numAdmins = options.garrison.admins;
    a9.numTroops = options.garrison.troops;
    a9.numElites = options.garrison.elites;
  }
  for (let k = 0; k < (options.mercs ?? 4); k++) hireMerc(c, roster, recruit(kit), content);
  return { campaign: c, roster };
}

export function landFirstSquad(c: CampaignSim): void {
  const r = c.dispatch({ type: 'compressTime', mode: CompressMode.MIN5 });
  if (!r.ok) throw new Error(`cannot land: ${r.reason}`);
}

export function runTicks(c: CampaignSim, ticks: number, until: () => boolean = () => false): number {
  for (let i = 0; i < ticks; i++) {
    if (until()) return i;
    c.step();
  }
  return ticks;
}

export function runUntilIdle(c: CampaignSim, budget = 40_000): number {
  let i = 0;
  for (; i < budget; i++) {
    c.step();
    if (i > 2 && c.isIdle()) break;
  }
  return i;
}

export function ourSoldiers(c: CampaignSim): Soldier[] {
  const t = c.tactical?.state;
  return t ? teamMembers(t, Team.OUR).sort((a, b) => a.id - b.id) : [];
}

export const EAST_EDGE_ROW = 75;
export const EAST_EDGE_COLUMN = 150;

export function eastEdgeTile(k: number): number {
  return (EAST_EDGE_ROW + k) * 160 + EAST_EDGE_COLUMN + k;
}

export function walkSquadToEastEdge(c: CampaignSim): void {
  for (const s of ourSoldiers(c)) {
    const r = c.dispatch({ type: 'move', soldier: s.id, to: eastEdgeTile(s.id), mode: 'run' });
    if (!r.ok) throw new Error(`move refused: ${r.reason}`);
  }
  runUntilIdle(c);
}
