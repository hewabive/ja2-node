import { CampaignSession } from '../../src/server/campaign-session.ts';
import { FACT_OK_USE_HUMMER } from '../../src/sim/strategic/forces/helicopter.ts';
import { setFact } from '../../src/sim/strategic/narrative/facts.ts';
import { createSaveKit } from './saves.ts';
import { loadStubSectorKit } from './sectors.ts';
import { bringSessionToTheHummer, HUMMER_GRIDNO } from './vehicles.ts';

export const HUMMER_SAVE = 'vehicles-hummer';
const SEED = 31;
const MERCS = 2;
const DESCRIPTION = 'Vehicles: the squad beside the stub Hummer in L10, allowed to use it';

export interface HummerSave {
  readonly name: string;
  readonly hummerGridNo: number;
}

export async function writeHummerSave(dir: string): Promise<HummerSave> {
  const kit = await loadStubSectorKit();
  const saves = await createSaveKit(kit, { dir });
  try {
    const session = await saves.open({ seed: SEED, campaign: { mercs: MERCS, land: false } });
    await bringSessionToTheHummer(session);
    if (!(session.sim instanceof CampaignSession)) throw new Error('not a campaign');
    setFact(session.sim.campaign.state.narrative, FACT_OK_USE_HUMMER, true);
    const saved = await saves.saves.save(session, { name: HUMMER_SAVE, description: DESCRIPTION });
    if (!saved.ok) throw new Error(`the Hummer save failed: ${JSON.stringify(saved)}`);
    return { name: saved.name, hummerGridNo: HUMMER_GRIDNO };
  } finally {
    await saves.dispose();
    await kit.dispose();
  }
}
