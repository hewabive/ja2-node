import type { ItemTable } from '../content/items/items.ts';
import {
  MAP_SIDE,
  type Sector,
  sectorFromStrategicIndex,
  sectorId,
  sectorShortString,
  strategicIndex,
} from '../content/strategic/sector-ids.ts';
import type { StrategicGroupView, StrategicMercView, StrategicSectorView, StrategicTownView, StrategicView } from '../protocol/view.ts';
import type { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import { campaignStatus } from '../sim/campaign/ending-state.ts';
import { storyFlow } from '../sim/campaign/story-refusals.ts';
import { meanwhileSceneName } from '../sim/strategic/ai/meanwhile.ts';
import { militiaTrainingAllowedInSector } from '../sim/strategic/economy/militia-rules.ts';
import { Assignment, SectorFlag } from '../sim/strategic/forces/constants.ts';
import { type Group, isSurfaceMapSector, numEnemiesInEverySurfaceSector } from '../sim/strategic/forces/groups.ts';
import type { StrategicContext, StrategicMerc } from '../sim/strategic/forces/ports.ts';
import { isSecretFoundAt, isThisSectorASamSector } from '../sim/strategic/map/control.ts';
import { EnemyKnowledge, surfaceKnowledgeOfEnemies } from '../sim/strategic/map/knowledge.ts';
import { getSectorFlagStatus, sectorInfo } from '../sim/strategic/map/sectors.ts';
import { calculateTravelTimeOfGroup } from '../sim/strategic/map/travel.ts';
import { worldTotalMinutes } from '../sim/strategic/time/world-clock.ts';
import { armourPercent, type MaxArmour, maxArmourPerClass } from '../sim/tactical/combat/armour.ts';
import { inventoryView } from '../sim/tactical/inventory-view.ts';
import type { Soldier } from '../sim/tactical/soldier.ts';
import { statsView } from '../sim/tactical/soldier-view.ts';
import { mercAccountStatusView, mercContractFields, mercSalary } from './contract-view.ts';
import { helicopterView, vehicleViews } from './helicopter-view.ts';
import { arrivalTime, laptopSummary } from './laptop-view.ts';
import { mercMapFields, mineViews, projectedDailyIncome, secretsFound, townControlViews, undergroundViews } from './map-screen-view.ts';
import { questLog } from './quest-view.ts';

const sectorName = (s: Sector) => (s.z ? `${sectorShortString(s)}-${s.z}` : sectorShortString(s));

interface SurfaceScan {
  readonly enemies: Uint8Array;
  readonly knowledge: (s: Sector) => number;
  readonly mercSectors: ReadonlySet<number>;
}

function surfaceScan(ctx: StrategicContext): SurfaceScan {
  const mercSectors = new Set<number>();
  for (const m of ctx.mercs.all()) if (isSurfaceMapSector(m.sector)) mercSectors.add(sectorId(m.sector));
  return { enemies: numEnemiesInEverySurfaceSector(ctx), knowledge: surfaceKnowledgeOfEnemies(ctx), mercSectors };
}

function knownEnemies(ctx: StrategicContext, s: Sector, scan: SurfaceScan): number | '?' | null {
  if (ctx.state.didGameJustStart || s.z !== 0) return null;
  const count = scan.enemies[sectorId(s)] ?? 0;
  if (count === 0) return null;
  switch (scan.knowledge(s)) {
    case EnemyKnowledge.THEYRE_THERE:
      return '?';
    case EnemyKnowledge.HOW_MANY:
      return count;
    default:
      return null;
  }
}

function sameMilitia(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameSectorView(a: StrategicSectorView, b: StrategicSectorView): boolean {
  return (
    a.visited === b.visited &&
    a.town === b.town &&
    a.playerControlled === b.playerControlled &&
    a.enemies === b.enemies &&
    sameMilitia(a.militia, b.militia) &&
    a.items === b.items &&
    a.militiaTraining === b.militiaTraining &&
    a.enemiesKnown === b.enemiesKnown &&
    a.facilities === b.facilities
  );
}

function showsTownBoxDetails(ctx: StrategicContext, s: Sector, town: number): boolean {
  if (!militiaTrainingAllowedInSector(ctx, s)) return false;
  return town !== 0 || (isThisSectorASamSector(ctx, s) && isSecretFoundAt(ctx, sectorId(s)));
}

function sectorView(ctx: StrategicContext, s: Sector, scan: SurfaceScan, previous: StrategicSectorView | undefined): StrategicSectorView {
  const map = ctx.state.map;
  const info = sectorInfo(map, s);
  const element = map.elements[strategicIndex(s)];
  const visited = getSectorFlagStatus(map, s, SectorFlag.ALREADY_VISITED);
  const town = element?.nameId ?? 0;
  const details = showsTownBoxDetails(ctx, s, town);
  const playerControlled = (visited || details) && element ? !element.enemyControlled : null;
  const enemies = knownEnemies(ctx, s, scan);
  const view: StrategicSectorView = {
    sector: sectorName(s),
    visited,
    town,
    playerControlled,
    enemies,
    militia: [...info.militia],
    ...(info.visibleItems > 0 ? { items: info.visibleItems } : {}),
    ...(details ? { militiaTraining: info.militiaTrainingPercentDone } : {}),
    ...(scan.knowledge(s) !== EnemyKnowledge.NOTHING ? { enemiesKnown: true } : {}),
    ...(town !== 0 && info.facilities !== 0 ? { facilities: info.facilities } : {}),
  };
  return previous && sameSectorView(previous, view) ? previous : view;
}

function interestingSector(view: StrategicSectorView, s: Sector, scan: SurfaceScan): boolean {
  return (
    view.visited ||
    view.town !== 0 ||
    view.enemies !== null ||
    view.playerControlled !== null ||
    view.enemiesKnown === true ||
    view.items !== undefined ||
    scan.mercSectors.has(sectorId(s))
  );
}

interface SectorViews {
  readonly bySector: (StrategicSectorView | undefined)[];
  listed: readonly StrategicSectorView[];
}

const sectorViewsOfMap = new WeakMap<object, SectorViews>();

function sameViews(a: readonly StrategicSectorView[], b: readonly StrategicSectorView[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sectorViews(ctx: StrategicContext, scan: SurfaceScan): readonly StrategicSectorView[] {
  const known = sectorViewsOfMap.get(ctx.state.map) ?? { bySector: [], listed: [] };
  sectorViewsOfMap.set(ctx.state.map, known);
  const sectors: StrategicSectorView[] = [];
  for (let y = 1; y <= MAP_SIDE; y++)
    for (let x = 1; x <= MAP_SIDE; x++) {
      const s = { x, y, z: 0 };
      const id = sectorId(s);
      const view = sectorView(ctx, s, scan, known.bySector[id]);
      known.bySector[id] = view;
      if (interestingSector(view, s, scan)) sectors.push(view);
    }
  if (!sameViews(known.listed, sectors)) known.listed = sectors;
  return known.listed;
}

type ViewedMerc = StrategicMerc & { readonly soldier?: Soldier };

const maxArmourOfItems = new WeakMap<ItemTable, MaxArmour>();

function maxArmourOf(items: ItemTable): MaxArmour {
  const known = maxArmourOfItems.get(items);
  if (known) return known;
  const max = maxArmourPerClass(items);
  maxArmourOfItems.set(items, max);
  return max;
}

function mercInventoryFields(ctx: StrategicContext, items: ItemTable | null, m: ViewedMerc): Partial<StrategicMercView> {
  const s = m.soldier;
  if (!s || !items) return {};
  return {
    profile: m.profile,
    stats: statsView(s),
    inventory: inventoryView(items, s.inv),
    weight: ctx.mercs.carriedWeightPercent(m.id),
    armour: armourPercent(items, maxArmourOf(items), s),
    camo: s.camo,
  };
}

function mercView(m: ViewedMerc): StrategicMercView {
  return {
    id: m.id,
    name: m.soldier?.name ?? `#${m.id}`,
    sector: sectorName(m.sector),
    betweenSectors: m.betweenSectors,
    squad: m.assignment < Assignment.ON_DUTY ? m.assignment : null,
    assignment: m.assignment,
    life: m.life,
    lifeMax: m.lifeMax,
    breath: m.soldier?.breath ?? 0,
    breathMax: m.soldier?.breathMax ?? 0,
    asleep: m.asleep,
    ...(m.assignment === Assignment.VEHICLE ? { vehicle: m.vehicleId } : {}),
  };
}

function robotControl(campaign: CampaignSim, m: StrategicMerc): { controlled?: boolean } {
  const roster = campaign.battle?.roster;
  return m.isRobot && roster ? { controlled: roster.canRobotBeControlled(m.id) } : {};
}

function nextArrivalMinutes(ctx: StrategicContext, g: Group): number | null {
  if (!g.betweenSectors) return null;
  return Math.max(0, g.arrivalTime - worldTotalMinutes(ctx.state.clock));
}

function groupViews(ctx: StrategicContext): StrategicGroupView[] {
  return ctx.state.forces.groups
    .filter((g) => g.player && g.members.length > 0)
    .map((g) => {
      const leader = ctx.mercs.get(g.members[0] ?? -1);
      return {
        id: g.id,
        sector: sectorName(g.sector),
        next: g.betweenSectors ? sectorName(g.next) : null,
        betweenSectors: g.betweenSectors,
        members: [...g.members],
        etaMinutes: calculateTravelTimeOfGroup(ctx, g),
        path: (leader?.path ?? []).map((i) => sectorName(sectorFromStrategicIndex(i))),
        nextArrivalMinutes: nextArrivalMinutes(ctx, g),
        traverseMinutes: g.betweenSectors ? g.traverseTime : null,
      };
    });
}

function enemyAirspace(ctx: StrategicContext): string[] {
  const sectors: string[] = [];
  for (let y = 1; y <= MAP_SIDE; y++)
    for (let x = 1; x <= MAP_SIDE; x++) {
      const s = { x, y, z: 0 };
      if (ctx.state.map.elements[strategicIndex(s)]?.enemyAirControlled) sectors.push(sectorName(s));
    }
  return sectors;
}

function townLoyalties(campaign: CampaignSim): StrategicTownView[] {
  return campaign.state.economy.towns.flatMap((t, town) => (t.started ? [{ town, loyalty: t.rating }] : []));
}

function economyViews(campaign: CampaignSim): Pick<StrategicView, 'townControl' | 'mines' | 'projectedDailyIncome'> {
  const economy = campaign.economy;
  const townControl = townControlViews(economy);
  const mines = mineViews(economy);
  const income = projectedDailyIncome(economy);
  return {
    ...(townControl ? { townControl } : {}),
    ...(mines ? { mines } : {}),
    ...(income === null ? {} : { projectedDailyIncome: income }),
  };
}

export function strategicView(campaign: CampaignSim): StrategicView | undefined {
  const ctx = campaign.strategic;
  if (!ctx) return undefined;
  const sectors = sectorViews(ctx, surfaceScan(ctx));
  const world = campaign.state.worldSector;
  const vehicles = vehicleViews(campaign);
  const helicopter = helicopterView(campaign);
  const items = campaign.battle?.content.items ?? null;
  return {
    balance: campaign.state.finances.balance,
    worldSector: world ? sectorName(world) : null,
    flow: storyFlow(campaign) ?? campaign.state.flow,
    campaign: campaignStatus(campaign.state.ending),
    ...(campaign.noUsableMercs() ? { noUsableMercs: true } : {}),
    meanwhiles: campaign.state.meanwhile.log.map((e) => ({ seq: e.seq, scene: meanwhileSceneName(e.id), at: e.at })),
    sectors,
    mercs: ctx.mercs.all().map((m) => {
      const arrival = arrivalTime(campaign, m.id);
      return {
        ...mercView(m),
        ...mercContractFields(campaign, m.id),
        ...robotControl(campaign, m),
        ...(arrival ? { arrival } : {}),
        ...mercInventoryFields(ctx, items, m),
        ...mercMapFields(campaign.economy, m.id, mercSalary(campaign, m.id)),
      };
    }),
    groups: groupViews(ctx),
    ...(vehicles ? { vehicles } : {}),
    ...(helicopter ? { helicopter } : {}),
    enemyAirspace: enemyAirspace(ctx),
    towns: townLoyalties(campaign),
    ...economyViews(campaign),
    secretsFound: secretsFound(ctx),
    underground: undergroundViews(ctx),
    ...mercAccountStatusView(campaign),
    ...laptopSummary(campaign),
    quests: questLog(campaign),
    ...battleLocator(campaign),
  };
}

function battleLocator(campaign: CampaignSim): Pick<StrategicView, 'battleLocator'> {
  const battle = campaign.state.battle;
  return battle.locator && battle.sector ? { battleLocator: sectorName(battle.sector) } : {};
}
