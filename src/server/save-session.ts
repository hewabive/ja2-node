import { parseSaveGame } from '../content/formats/savegame.ts';
import { parseSaveEncryptionTable, SAVE_ENCRYPTION_PATH } from '../content/formats/savegame-header.ts';
import { loadStrategicContent } from '../content/strategic/strategic-content.ts';
import { loadTacticalWorld } from '../content/world/tactical-world.ts';
import type { ReadFile } from '../content/world/tileset-loader.ts';
import { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import { NO_ROSTER_HOOKS, Roster } from '../sim/campaign/roster.ts';
import { addSavedMercsToRoster } from '../sim/campaign/save-roster.ts';
import { importStrategicMap } from '../sim/strategic/map/save-import.ts';
import { createStrategicState } from '../sim/strategic/state.ts';
import { importStrategicTime } from '../sim/strategic/time/save-import.ts';
import { loadTacticalContent } from '../sim/tactical/load-content.ts';
import { importSave, type SaveImportReport, saveMapPath, worldWithSavedDoors } from '../sim/tactical/save-import.ts';
import { removeSoldierFromTacticalSector } from '../sim/tactical/sector-presence.ts';
import { TacticalSim } from '../sim/tactical/tactical-sim.ts';
import { CampaignSession } from './campaign-session.ts';

const DEFAULT_SEED = 1;

export interface SaveSession {
  readonly session: CampaignSession;
  readonly report: SaveImportReport;
}

export async function createSaveSession(read: ReadFile, saveBytes: Uint8Array, seed = DEFAULT_SEED): Promise<SaveSession> {
  const table = await read(SAVE_ENCRYPTION_PATH);
  if (!table) throw new Error(`missing ${SAVE_ENCRYPTION_PATH}`);
  const save = parseSaveGame(saveBytes, parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode(table))));
  const [world, content, strategicContent] = await Promise.all([
    loadTacticalWorld(read, saveMapPath(save)),
    loadTacticalContent(read),
    loadStrategicContent(read),
  ]);
  const sim = new TacticalSim(worldWithSavedDoors(world, save), content, seed);
  const report = importSave(sim, save);
  const strategic = createStrategicState({ streams: { rng: sim.state.rng, pre: sim.state.pre } });
  importStrategicTime(strategic, save);
  strategic.worldSector = save.tactical.worldSector;
  strategic.realMs = sim.state.clockMs;
  strategic.clock.driver.lastSecondMs = strategic.realMs;
  strategic.clock.paused = false;
  strategic.clock.pauseLocked = false;
  const roster = new Roster(content, {
    ...NO_ROSTER_HOOKS,
    removeFromTacticalSector: (merc) => removeSoldierFromTacticalSector(sim.state, merc.soldier),
  });
  addSavedMercsToRoster(roster, save, sim.state);
  const campaign = new CampaignSim(strategic, sim, { strategic: { content: strategicContent, mercs: roster } });
  if (campaign.strategic) importStrategicMap(campaign.strategic, save);
  return { session: new CampaignSession(campaign, roster), report };
}
