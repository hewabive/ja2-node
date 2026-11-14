import { parseSectorString, sectorId } from '../../src/content/strategic/sector-ids.ts';
import { CampaignSession } from '../../src/server/campaign-session.ts';
import type { Session } from '../../src/server/session.ts';
import { emptyObject } from '../../src/sim/items/object.ts';
import { createNewEnemyGroupDepartingFromSector } from '../../src/sim/strategic/forces/groups.ts';
import { sectorInfo } from '../../src/sim/strategic/map/sectors.ts';
import { EventKind } from '../../src/sim/strategic/time/constants.ts';
import { addStrategicEvent } from '../../src/sim/strategic/time/event-queue.ts';
import { worldTotalMinutes } from '../../src/sim/strategic/time/world-clock.ts';
import { InvSlot } from '../../src/sim/tactical/inventory.ts';
import { buildMapScreenCampaign } from './e2e-campaign-saves.ts';
import { createSaveKit, type SaveKit } from './saves.ts';
import { loadStubSectorKit } from './sectors.ts';

export const BATTLE_SECTOR = 'D13';
export const ENEMY_APPROACH = 'D14';
export const ARRIVAL_MINUTES = 1;
export const ARRIVAL_WAIT_SECONDS = 180;

export interface EnemyForce {
  readonly admins: number;
  readonly troops: number;
  readonly elites: number;
}

export const BattleVariant = {
  VICTORY: 'victory',
  DEFEAT: 'defeat',
  RETREAT: 'retreat',
} as const;
export type BattleVariant = (typeof BattleVariant)[keyof typeof BattleVariant];

export const BATTLE_FORCES: Readonly<Record<BattleVariant, EnemyForce>> = {
  victory: { admins: 0, troops: 6, elites: 0 },
  defeat: { admins: 0, troops: 0, elites: 10 },
  retreat: { admins: 0, troops: 12, elites: 0 },
};

const WEAK_LIFE = 15;

export function campaignOf(session: Session): CampaignSession {
  if (!(session.sim instanceof CampaignSession)) throw new Error('not a campaign');
  return session.sim;
}

export function arrangeEnemyArrival(
  session: Session,
  force: EnemyForce,
  minutes = ARRIVAL_MINUTES,
  route: { readonly from: string; readonly to: string } = { from: ENEMY_APPROACH, to: BATTLE_SECTOR },
): void {
  const campaign = campaignOf(session).campaign;
  const ctx = campaign.strategic;
  if (!ctx) throw new Error('no strategic layer');
  const g = createNewEnemyGroupDepartingFromSector(ctx, sectorId(parseSectorString(route.from)), force.admins, force.troops, force.elites);
  g.next = { ...parseSectorString(route.to), z: 0 };
  g.betweenSectors = true;
  g.arrivalTime = worldTotalMinutes(campaign.state.clock) + minutes;
  addStrategicEvent(campaign.state.queue, EventKind.GROUP_ARRIVAL, g.arrivalTime, g.id);
}

export function weakenSquad(session: Session): void {
  const campaign = campaignOf(session).campaign;
  for (const m of campaign.battle?.roster.all() ?? []) {
    m.soldier.life = WEAK_LIFE;
    m.soldier.inv[InvSlot.HAND] = emptyObject();
  }
}

export function clearMilitia(session: Session): void {
  const info = sectorInfo(campaignOf(session).campaign.state.map, parseSectorString(BATTLE_SECTOR));
  info.militia.splice(0, info.militia.length, ...info.militia.map(() => 0));
}

export function arrangeBattle(session: Session, variant: BattleVariant): void {
  clearMilitia(session);
  if (variant === BattleVariant.DEFEAT) weakenSquad(session);
  arrangeEnemyArrival(session, BATTLE_FORCES[variant]);
}

export function battleSaveName(variant: BattleVariant): string {
  return `u9-battle-${variant}`;
}

export interface PlacementSave {
  readonly name: string;
  readonly arrivalSeconds: number;
}

export interface BattleEntrySaves {
  readonly names: Readonly<Record<BattleVariant, string>>;
  readonly sector: string;
  readonly placement: PlacementSave;
}

const DESCRIPTION = 'U9 battle entry: an enemy group one minute from Drassen';
export const BATTLE_BASE_SAVE = 'u9-battle-base';

async function saveVariant(saves: SaveKit, variant: BattleVariant): Promise<string> {
  const session = await saves.open({ load: BATTLE_BASE_SAVE, reseed: false });
  arrangeBattle(session, variant);
  const saved = await saves.saves.save(session, { name: battleSaveName(variant), description: `${DESCRIPTION} (${variant})` });
  if (!saved.ok) throw new Error(`the ${variant} save failed: ${JSON.stringify(saved)}`);
  return saved.name;
}

const PLACEMENT_SAVE = 'u9-placement';
const PLACEMENT_DESCRIPTION = 'U9 placement: the squad two hours from an enemy-held D14';
const PLACEMENT_TROOPS = 2;
const SECONDS_PER_MINUTE = 60;
const ARRIVAL_MARGIN_SECONDS = 600;

async function savePlacement(saves: SaveKit): Promise<PlacementSave> {
  const session = await saves.open({ load: BATTLE_BASE_SAVE, reseed: false });
  const campaign = campaignOf(session).campaign;
  Object.assign(sectorInfo(campaign.state.map, parseSectorString(ENEMY_APPROACH)), {
    numAdmins: 0,
    numTroops: PLACEMENT_TROOPS,
    numElites: 0,
  });
  const [merc] = campaign.battle?.roster.all() ?? [];
  if (!merc) throw new Error('no merc to route');
  const routed = session.dispatch({ type: 'route', soldier: merc.id, to: ENEMY_APPROACH });
  const eta = (routed.data as { readonly etaMinutes?: number } | undefined)?.etaMinutes;
  if (!routed.ok || eta === undefined) throw new Error(`the route to ${ENEMY_APPROACH} was refused: ${routed.reason ?? ''}`);
  const saved = await saves.saves.save(session, { name: PLACEMENT_SAVE, description: PLACEMENT_DESCRIPTION });
  if (!saved.ok) throw new Error(`the placement save failed: ${JSON.stringify(saved)}`);
  return { name: saved.name, arrivalSeconds: eta * SECONDS_PER_MINUTE + ARRIVAL_MARGIN_SECONDS };
}

export async function writeBattleEntrySaves(dir: string): Promise<BattleEntrySaves> {
  const kit = await loadStubSectorKit();
  const saves = await createSaveKit(kit, { dir });
  try {
    const { session } = await buildMapScreenCampaign(saves, kit);
    const base = await saves.saves.save(session, { name: BATTLE_BASE_SAVE, description: 'U9 base: the U8 map-screen campaign' });
    if (!base.ok) throw new Error(`the base save failed: ${JSON.stringify(base)}`);
    const names = {
      victory: await saveVariant(saves, BattleVariant.VICTORY),
      defeat: await saveVariant(saves, BattleVariant.DEFEAT),
      retreat: await saveVariant(saves, BattleVariant.RETREAT),
    };
    return { names, sector: BATTLE_SECTOR, placement: await savePlacement(saves) };
  } finally {
    await saves.dispose();
    await kit.dispose();
  }
}
