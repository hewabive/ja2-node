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
import { Assignment, SectorFlag } from '../sim/strategic/forces/constants.ts';
import { type Group, isSurfaceMapSector, numEnemiesInEverySurfaceSector } from '../sim/strategic/forces/groups.ts';
import type { StrategicContext, StrategicMerc } from '../sim/strategic/forces/ports.ts';
import { EnemyKnowledge, surfaceKnowledgeOfEnemies } from '../sim/strategic/map/knowledge.ts';
import { getSectorFlagStatus, sectorInfo } from '../sim/strategic/map/sectors.ts';
import { calculateTravelTimeOfGroup } from '../sim/strategic/map/travel.ts';
import { worldTotalMinutes } from '../sim/strategic/time/world-clock.ts';
import { inventoryView } from '../sim/tactical/inventory-view.ts';
import type { Soldier } from '../sim/tactical/soldier.ts';
import { statsView } from '../sim/tactical/soldier-view.ts';
import { mercAccountStatusView, mercContractFields } from './contract-view.ts';
import { helicopterView, vehicleViews } from './helicopter-view.ts';
import { arrivalTime, laptopSummary } from './laptop-view.ts';
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

function sectorView(ctx: StrategicContext, s: Sector, scan: SurfaceScan, previous: StrategicSectorView | undefined): StrategicSectorView {
  const map = ctx.state.map;
  const info = sectorInfo(map, s);
  const element = map.elements[strategicIndex(s)];
  const visited = getSectorFlagStatus(map, s, SectorFlag.ALREADY_VISITED);
  const town = element?.nameId ?? 0;
  const playerControlled = visited && element ? !element.enemyControlled : null;
  const enemies = knownEnemies(ctx, s, scan);
  if (
    previous &&
    previous.visited === visited &&
    previous.town === town &&
    previous.playerControlled === playerControlled &&
    previous.enemies === enemies &&
    sameMilitia(previous.militia, info.militia)
  )
    return previous;
  return { sector: sectorName(s), visited, town, playerControlled, enemies, militia: [...info.militia] };
}

function interestingSector(view: StrategicSectorView, s: Sector, scan: SurfaceScan): boolean {
  return view.visited || view.town !== 0 || view.enemies !== null || scan.mercSectors.has(sectorId(s));
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

function mercInventoryFields(ctx: StrategicContext, items: ItemTable | null, m: ViewedMerc): Partial<StrategicMercView> {
  const s = m.soldier;
  if (!s || !items) return {};
  return {
    profile: m.profile,
    stats: statsView(s),
    inventory: inventoryView(items, s.inv),
    weight: ctx.mercs.carriedWeightPercent(m.id),
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
      };
    }),
    groups: groupViews(ctx),
    ...(vehicles ? { vehicles } : {}),
    ...(helicopter ? { helicopter } : {}),
    enemyAirspace: enemyAirspace(ctx),
    towns: townLoyalties(campaign),
    ...mercAccountStatusView(campaign),
    ...laptopSummary(campaign),
    quests: questLog(campaign),
  };
}
