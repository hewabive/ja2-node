import { createSaveSession, type SaveSession } from '../../src/server/save-session.ts';
import { openTacticalScreen } from '../../src/sim/campaign/screens.ts';

export async function createTacticalSaveSession(...args: Parameters<typeof createSaveSession>): Promise<SaveSession> {
  const imported = await createSaveSession(...args);
  const campaign = imported.session.campaign;
  if (campaign.tactical && campaign.state.flow === 'strategic') {
    const entered = openTacticalScreen(campaign);
    if (!entered.ok) throw new Error(`cannot enter the loaded sector of the save: ${entered.reason}`);
  }
  return imported;
}
