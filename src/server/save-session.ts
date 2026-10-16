import { parseSaveGame } from '../content/formats/savegame.ts';
import { readSavedEconomy, readSoldierAssignments } from '../content/formats/savegame-economy.ts';
import { parseSaveEncryptionTable, SAVE_ENCRYPTION_PATH } from '../content/formats/savegame-header.ts';
import { readStrategicAiSections } from '../content/formats/savegame-strategic-ai.ts';
import { loadArmyContent } from '../content/strategic/army.ts';
import { loadEconomyContent } from '../content/strategic/economy-content.ts';
import { loadStrategicContent } from '../content/strategic/strategic-content.ts';
import { loadTacticalWorld } from '../content/world/tactical-world.ts';
import type { ReadFile } from '../content/world/tileset-loader.ts';
import { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import { NO_ROSTER_HOOKS, Roster } from '../sim/campaign/roster.ts';
import { addSavedMercsToRoster } from '../sim/campaign/save-roster.ts';
import { importStrategicAi } from '../sim/strategic/ai/save-import.ts';
import { applySavedAssignment, importEconomy } from '../sim/strategic/economy/save-import.ts';
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
  const encryption = parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode(table)));
  const save = parseSaveGame(saveBytes, encryption);
  const [world, content, strategicContent, army] = await Promise.all([
    loadTacticalWorld(read, saveMapPath(save)),
    loadTacticalContent(read),
    loadStrategicContent(read),
    loadArmyContent(read),
  ]);
  const economyContent = await loadEconomyContent(read, strategicContent.towns);
  const sim = new TacticalSim(worldWithSavedDoors(world, save), content, seed);
  const report = importSave(sim, save);
  const strategic = createStrategicState({ streams: { rng: sim.state.rng, pre: sim.state.pre }, profiles: sim.state.profiles });
  importStrategicTime(strategic, save);
  strategic.worldSector = save.tactical.worldSector;
  strategic.realMs = sim.state.clockMs;
  strategic.clock.driver.lastSecondMs = strategic.realMs;
  strategic.clock.paused = false;
  strategic.clock.pauseLocked = false;
  const roster = new Roster({
    content,
    combat: () => sim.state,
    hooks: { ...NO_ROSTER_HOOKS, removeFromTacticalSector: (merc) => removeSoldierFromTacticalSector(sim.state, merc.soldier) },
  });
  addSavedMercsToRoster(roster, save, sim.state);
  const campaign = new CampaignSim(strategic, sim, {
    strategic: { content: strategicContent, mercs: roster },
    economy: { economy: economyContent, items: content.items, crew: roster },
    queen: { army },
  });
  if (campaign.strategic) importStrategicMap(campaign.strategic, save);
  if (campaign.queen) importStrategicAi(campaign.queen, readStrategicAiSections(saveBytes, save), { runLoadHooks: true });
  importEconomy(strategic, readSavedEconomy(saveBytes, save.sections), save.laptop.currentBalance);
  for (const saved of readSoldierAssignments(saveBytes, save, encryption)) {
    const merc = roster.get(saved.id);
    if (merc) applySavedAssignment(merc, saved);
  }
  return { session: new CampaignSession(campaign, roster), report };
}
