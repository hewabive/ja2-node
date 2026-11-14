import type { ArmyContent } from '../../src/content/strategic/army.ts';
import type { MerchantContent } from '../../src/content/strategic/merchant-content.ts';
import { type CampaignHooks, CampaignSim, type SimConstruction } from '../../src/sim/campaign/campaign-sim.ts';
import { helicopterDropUnderWay } from '../../src/sim/campaign/helicopter-drop-flow.ts';
import { hireMerc } from '../../src/sim/campaign/hiring.ts';
import { initNewGame } from '../../src/sim/campaign/new-game.ts';
import { campaignCombatContext } from '../../src/sim/campaign/off-map-combat.ts';
import { Roster } from '../../src/sim/campaign/roster.ts';
import { createItem, createItems } from '../../src/sim/items/object.ts';
import type { ContentRoots } from '../../src/sim/snapshot/refs.ts';
import { restoreCampaign, snapshotCampaign } from '../../src/sim/snapshot/session.ts';
import type { MerchantHooks } from '../../src/sim/strategic/economy/merchants/context.ts';
import { sectorInfo } from '../../src/sim/strategic/map/sectors.ts';
import { createStrategicState, type StrategicState } from '../../src/sim/strategic/state.ts';
import { CompressMode } from '../../src/sim/strategic/time/constants.ts';
import { InvSlot } from '../../src/sim/tactical/inventory.ts';
import { createSoldier, type Soldier, Team } from '../../src/sim/tactical/soldier.ts';
import { teamMembers } from '../../src/sim/tactical/state.ts';
import type { TacticalSim } from '../../src/sim/tactical/tactical-sim.ts';
import type { EconomyTestContent } from './economy.ts';
import { defaultRunMode, driven, follow, type ReloadAdapter, type RunMode, reloadPoint, worldContentOnce } from './reload.ts';
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

const HELICOPTER_DROP_BUDGET = 40_000;

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
  readonly mode?: RunMode;
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

export function testCampaignContent(kit: CampaignKit, options: CampaignOptions): ContentRoots {
  return {
    content: kit.sectors.content,
    strategic: kit.economy.strategic,
    economy: kit.economy.economy,
    items: kit.economy.items,
    army: kit.army,
    ...(options.merchants ? { merchants: options.merchants } : {}),
  };
}

export function assembleTestCampaign(
  kit: CampaignKit,
  options: CampaignOptions,
  state: StrategicState,
  construction: SimConstruction = 'create',
  tactical: TacticalSim | null = null,
): TestCampaign {
  let campaign: CampaignSim | null = null;
  const content = kit.sectors.content;
  const roster = new Roster({
    state: state.roster,
    content,
    combat: campaignCombatContext(() => campaign, state, content),
    profiles: state.profiles,
  });
  const hooks: CampaignHooks = {
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
  };
  const c = construction === 'restore' ? CampaignSim.restore(state, tactical, hooks) : new CampaignSim(state, null, hooks);
  campaign = c;
  return { campaign: c, roster };
}

export function testCampaignAdapter(kit: CampaignKit, options: CampaignOptions): ReloadAdapter<CampaignSim> {
  const content = testCampaignContent(kit, options);
  const world = worldContentOnce((path) => kit.sectors.world(path));
  return {
    drainBeforeReload: () => true,
    snapshot: (c) => snapshotCampaign(c, content),
    restore: (snapshot, previous) => {
      const restored = restoreCampaign(snapshot, {
        content,
        world,
        assemble: (state, tactical) => assembleTestCampaign(kit, options, state, 'restore', tactical).campaign,
      });
      restored.meanwhile.useInstallation(previous.meanwhile.installation);
      return restored;
    },
  };
}

function drivenTestCampaign(kit: CampaignKit, options: CampaignOptions, created: TestCampaign, mode: RunMode): TestCampaign {
  const campaign = driven(created.campaign, testCampaignAdapter(kit, options), mode);
  return { campaign, roster: follow(campaign, (c: CampaignSim) => c.battle?.roster ?? created.roster) };
}

export function createTestCampaign(kit: CampaignKit, options: CampaignOptions): TestCampaign {
  const state = createStrategicState({ seed: options.seed });
  const created = assembleTestCampaign(kit, options, state);
  const { campaign: c, roster } = created;
  initNewGame(c);
  if (options.garrison) {
    const a9 = sectorInfo(c.state.map, { x: 9, y: 1 });
    a9.numAdmins = options.garrison.admins;
    a9.numTroops = options.garrison.troops;
    a9.numElites = options.garrison.elites;
  }
  for (let k = 0; k < (options.mercs ?? 4); k++) hireMerc(c, roster, recruit(kit), kit.sectors.content);
  const mode = options.mode ?? defaultRunMode();
  return mode ? drivenTestCampaign(kit, options, created, mode) : created;
}

export function startFirstSquadsDrop(c: CampaignSim): void {
  const r = c.dispatch({ type: 'compressTime', mode: CompressMode.MIN5 });
  if (!r.ok) throw new Error(`cannot land: ${r.reason}`);
}

export function landFirstSquad(c: CampaignSim): void {
  startFirstSquadsDrop(c);
  const r = c.dispatch({ type: 'skipHelicopterDrop' });
  if (!r.ok) throw new Error(`cannot skip the drop: ${r.reason}`);
}

export function runTheHelicopterDrop(c: CampaignSim, budget = HELICOPTER_DROP_BUDGET): number {
  let ticks = 0;
  for (; helicopterDropUnderWay(c); ticks++) {
    if (ticks >= budget) throw new Error('the helicopter drop did not end');
    c.step();
  }
  reloadPoint(c);
  return ticks;
}

export function dropFirstSquad(c: CampaignSim): number {
  startFirstSquadsDrop(c);
  return runTheHelicopterDrop(c);
}

export function runTicks(c: CampaignSim, ticks: number, until: () => boolean = () => false): number {
  for (let i = 0; i < ticks; i++) {
    if (until()) {
      reloadPoint(c);
      return i;
    }
    c.step();
  }
  reloadPoint(c);
  return ticks;
}

export function runUntilIdle(c: CampaignSim, budget = 40_000): number {
  let i = 0;
  for (; i < budget; i++) {
    c.step();
    if (i > 2 && c.isIdle()) break;
  }
  reloadPoint(c);
  return i;
}

const B9 = { x: 9, y: 2, z: 0 };

export function ourGroupAtPreBattleInB9(kit: CampaignKit, mode?: RunMode): TestCampaign {
  const created = createTestCampaign(kit, { seed: 31, garrison: { admins: 0, troops: 0, elites: 0 }, ...(mode ? { mode } : {}) });
  const c = created.campaign;
  const b9 = sectorInfo(c.state.map, B9);
  b9.numAdmins = 0;
  b9.numTroops = 2;
  b9.numElites = 0;
  landFirstSquad(c);
  for (let i = 0; i < 10_000 && !c.isIdle(); i++) c.step();
  if (!c.dispatch({ type: 'route', soldier: 0, to: 'B9' }).ok) throw new Error('route refused');
  for (let i = 0; i < 10_000 && c.tactical !== null; i++) c.step();
  if (!c.dispatch({ type: 'compressTime', mode: CompressMode.MIN30 }).ok) throw new Error('cannot compress');
  for (let i = 0; i < 200_000 && !c.hasPendingDecision(); i++) c.step();
  if (c.state.battle.prompt?.kind !== 'preBattle') throw new Error('no pre-battle panel');
  return created;
}

export function spreadAndPlace(c: CampaignSim): void {
  for (const choice of ['spread', 'done']) {
    const prompt = c.state.battle.prompt;
    if (prompt?.kind !== 'tacticalPlacement') throw new Error(`no placement prompt for ${choice}`);
    const r = c.dispatch({ type: 'answer', prompt: prompt.id, choice });
    if (!r.ok) throw new Error(`${choice} refused: ${r.reason}`);
  }
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
