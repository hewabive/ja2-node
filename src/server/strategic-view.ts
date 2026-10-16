import {
  MAP_SIDE,
  type Sector,
  sameSector,
  sectorFromStrategicIndex,
  sectorShortString,
  strategicIndex,
} from '../content/strategic/sector-ids.ts';
import type { StrategicGroupView, StrategicMercView, StrategicSectorView, StrategicView } from '../protocol/view.ts';
import type { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import { Assignment, SectorFlag } from '../sim/strategic/forces/constants.ts';
import type { StrategicContext, StrategicMerc } from '../sim/strategic/forces/ports.ts';
import { canMercsScoutThisSector, canNearbyMilitiaScoutThisSector } from '../sim/strategic/map/knowledge.ts';
import { getSectorFlagStatus, sectorInfo } from '../sim/strategic/map/sectors.ts';
import { calculateTravelTimeOfGroup } from '../sim/strategic/map/travel.ts';

const sectorName = (s: Sector) => (s.z ? `${sectorShortString(s)}-${s.z}` : sectorShortString(s));

function knownEnemies(ctx: StrategicContext, s: Sector): number | '?' | null {
  const info = sectorInfo(ctx.state.map, s);
  const scouted =
    canMercsScoutThisSector(ctx, s) ||
    canNearbyMilitiaScoutThisSector(ctx, s) ||
    (info.flags & SectorFlag.PLAYER_KNOWS_ENEMIES_ARE_HERE) !== 0;
  if (scouted)
    return (
      info.numAdmins +
      info.numTroops +
      info.numElites +
      ctx.state.forces.groups.filter((g) => !g.player && !g.vehicle && sameSector(g.sector, s)).reduce((n, g) => n + g.size, 0)
    );
  return getSectorFlagStatus(ctx.state.map, s, SectorFlag.ALREADY_VISITED) ? '?' : null;
}

function sectorView(ctx: StrategicContext, s: Sector): StrategicSectorView {
  const map = ctx.state.map;
  const info = sectorInfo(map, s);
  const element = map.elements[strategicIndex(s)];
  const visited = getSectorFlagStatus(map, s, SectorFlag.ALREADY_VISITED);
  return {
    sector: sectorName(s),
    visited,
    town: element?.nameId ?? 0,
    playerControlled: visited && element ? !element.enemyControlled : null,
    enemies: knownEnemies(ctx, s),
    militia: [...info.militia],
  };
}

function mercView(
  m: StrategicMerc & { readonly soldier?: { readonly name: string; readonly breath: number; readonly breathMax: number } },
): StrategicMercView {
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
  };
}

function groupViews(ctx: StrategicContext): StrategicGroupView[] {
  return ctx.state.forces.groups
    .filter((g) => g.player)
    .map((g) => {
      const leader = ctx.mercs.get(g.members[0] ?? -1);
      return {
        id: g.id,
        sector: sectorName(g.sector),
        next: sectorName(g.next),
        betweenSectors: g.betweenSectors,
        members: [...g.members],
        etaMinutes: calculateTravelTimeOfGroup(ctx, g),
        path: (leader?.path ?? []).map((i) => sectorName(sectorFromStrategicIndex(i))),
      };
    });
}

function interestingSector(ctx: StrategicContext, view: StrategicSectorView, s: Sector): boolean {
  return view.visited || view.town !== 0 || view.enemies !== null || ctx.mercs.all().some((m) => sameSector(m.sector, s));
}

export function strategicView(campaign: CampaignSim): StrategicView | undefined {
  const ctx = campaign.strategic;
  if (!ctx) return undefined;
  const sectors: StrategicSectorView[] = [];
  for (let y = 1; y <= MAP_SIDE; y++)
    for (let x = 1; x <= MAP_SIDE; x++) {
      const s = { x, y, z: 0 };
      const view = sectorView(ctx, s);
      if (interestingSector(ctx, view, s)) sectors.push(view);
    }
  const world = campaign.state.worldSector;
  return {
    balance: campaign.state.finances.balance,
    worldSector: world ? sectorName(world) : null,
    flow: campaign.state.flow,
    sectors,
    mercs: ctx.mercs.all().map((m) => mercView(m)),
    groups: groupViews(ctx),
  };
}
