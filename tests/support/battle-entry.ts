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
  victory: { admins: 0, troops: 1, elites: 0 },
  defeat: { admins: 0, troops: 0, elites: 10 },
  retreat: { admins: 0, troops: 6, elites: 0 },
};

const WEAK_LIFE = 15;

export function campaignOf(session: Session): CampaignSession {
  if (!(session.sim instanceof CampaignSession)) throw new Error('not a campaign');
  return session.sim;
}

export function arrangeEnemyArrival(session: Session, force: EnemyForce, minutes = ARRIVAL_MINUTES): void {
  const campaign = campaignOf(session).campaign;
  const ctx = campaign.strategic;
  if (!ctx) throw new Error('no strategic layer');
  const g = createNewEnemyGroupDepartingFromSector(
    ctx,
    sectorId(parseSectorString(ENEMY_APPROACH)),
    force.admins,
    force.troops,
    force.elites,
  );
  g.next = { ...parseSectorString(BATTLE_SECTOR), z: 0 };
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

export interface BattleEntrySaves {
  readonly names: Readonly<Record<BattleVariant, string>>;
  readonly sector: string;
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
    return { names, sector: BATTLE_SECTOR };
  } finally {
    await saves.dispose();
    await kit.dispose();
  }
}
