import { parseSectorString } from '../../src/content/strategic/sector-ids.ts';
import { gridNo } from '../../src/content/world/grid.ts';
import { CampaignSession } from '../../src/server/campaign-session.ts';
import type { Session } from '../../src/server/session.ts';
import type { RosterMerc } from '../../src/sim/campaign/roster.ts';
import { removeGroup } from '../../src/sim/strategic/forces/groups.ts';
import { sectorInfo } from '../../src/sim/strategic/map/sectors.ts';
import { createSaveKit } from './saves.ts';
import { loadStubSectorKit } from './sectors.ts';

export const AUTO_BANDAGE_SAVE = 'auto-bandage';
const SEED = 65;
const KESTREL = 0;
const VANT = 1;
const MORAGA = 2;
const LANDING = 'A9';
const WOUNDED = { life: 60, bleeding: 8 };
const FAR_FROM_THE_SQUAD = gridNo(120, 80);

function campaignOf(session: Session): CampaignSession {
  if (!(session.sim instanceof CampaignSession)) throw new Error('not a campaign');
  return session.sim;
}

async function order(session: Session, cmd: { readonly type: string; readonly [key: string]: unknown }): Promise<void> {
  await campaignOf(session).prepare(cmd);
  const result = session.dispatch(cmd);
  if (!result.ok) throw new Error(`${cmd.type} refused: ${result.reason ?? ''}`);
}

function merc(session: Session, profile: number): RosterMerc {
  const found = campaignOf(session)
    .campaign.battle?.roster.all()
    .find((m) => m.profile === profile);
  if (!found) throw new Error(`no merc with profile ${profile}`);
  return found;
}

function clearOfEnemies(session: Session): void {
  const campaign = campaignOf(session).campaign;
  Object.assign(sectorInfo(campaign.state.map, parseSectorString(LANDING)), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const ctx = campaign.strategic;
  if (!ctx) throw new Error('no strategic layer');
  for (const g of ctx.state.forces.groups.filter((group) => !group.player)) removeGroup(ctx, g, true);
}

export async function writeAutoBandageSave(dir: string): Promise<void> {
  const kit = await loadStubSectorKit();
  const saves = await createSaveKit(kit, { dir });
  try {
    const session = await saves.open({ seed: SEED, campaign: { profiles: [KESTREL, VANT, MORAGA], land: false } });
    clearOfEnemies(session);
    await order(session, { type: 'compressTime', mode: 2 });
    await order(session, { type: 'skipHelicopterDrop' });
    await order(session, { type: 'enterSector', sector: LANDING });
    session.advance({ idle: true });
    await order(session, { type: 'move', soldier: merc(session, VANT).id, to: FAR_FROM_THE_SQUAD, mode: 'run' });
    session.advance({ idle: true });
    Object.assign(merc(session, VANT).soldier, WOUNDED);
    const saved = await saves.saves.save(session, { name: AUTO_BANDAGE_SAVE, description: 'auto-bandage: a merc bleeds in a cleared A9' });
    if (!saved.ok) throw new Error(`the save ${AUTO_BANDAGE_SAVE} failed: ${JSON.stringify(saved)}`);
  } finally {
    await saves.dispose();
    await kit.dispose();
  }
}
