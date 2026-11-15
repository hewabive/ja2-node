import { gridNo } from '../../src/content/world/grid.ts';
import type { Session } from '../../src/server/session.ts';
import { buildMapScreenCampaign } from './e2e-campaign-saves.ts';
import { createSaveKit } from './saves.ts';
import { loadStubSectorKit } from './sectors.ts';

export const NIGHT_LIGHTS_SAVE = 'night-lights';
export const NIGHT_LIGHTS_SECTOR = 'D13';
export const NIGHT_HOUR = 22;
export const NIGHT_AMBIENT = 12;
export const BETWEEN_THE_HOUSES = gridNo(78, 65);
export const NORTH_OF_THE_SHAFT_HOUSE = gridNo(82, 62);
export const OFFICE_DOOR = gridNo(74, 66);
export const IN_THE_OFFICE = gridNo(71, 65);
export const SHAFT_HOUSE_LAMP = { x: 83, y: 70 };
const AT_THE_OFFICE_DOOR = gridNo(75, 66);
const HOURS_TO_WAIT = 10;
const DESCRIPTION = 'night lights: the squad by the houses of the stub mine at night';

async function order(session: Session, cmd: { readonly type: string; readonly [key: string]: unknown }): Promise<void> {
  const result = await session.prepareAndDispatch(cmd);
  if (!result.ok) throw new Error(`${cmd.type} refused: ${result.reason ?? ''}`);
  session.advance({ idle: true });
}

function waitForTheNight(session: Session): void {
  const day = session.sim.view().clock?.day;
  if (day === undefined) throw new Error('no clock');
  for (let k = 0; k < HOURS_TO_WAIT; k++) if (session.advance({ worldTime: { day, hour: NIGHT_HOUR } }).reason === 'worldTime') return;
  throw new Error(`the night did not come: ${JSON.stringify(session.sim.view().clock)}`);
}

export async function writeNightLightsSave(dir: string): Promise<void> {
  const kit = await loadStubSectorKit();
  const saves = await createSaveKit(kit, { dir });
  try {
    const { session, mercs } = await buildMapScreenCampaign(saves, kit);
    waitForTheNight(session);
    await order(session, { type: 'enterSector', sector: NIGHT_LIGHTS_SECTOR });
    const [behindTheWall, inTheOffice] = mercs;
    if (behindTheWall === undefined || inTheOffice === undefined) throw new Error('the squad needs two mercs');
    await order(session, { type: 'move', soldier: behindTheWall, to: NORTH_OF_THE_SHAFT_HOUSE });
    await order(session, { type: 'move', soldier: inTheOffice, to: AT_THE_OFFICE_DOOR });
    await order(session, { type: 'door', soldier: inTheOffice, gridNo: OFFICE_DOOR, action: 'open' });
    await order(session, { type: 'move', soldier: inTheOffice, to: IN_THE_OFFICE });
    const saved = await saves.saves.save(session, { name: NIGHT_LIGHTS_SAVE, description: DESCRIPTION });
    if (!saved.ok) throw new Error(`the save ${NIGHT_LIGHTS_SAVE} failed: ${JSON.stringify(saved)}`);
  } finally {
    await saves.dispose();
    await kit.dispose();
  }
}
