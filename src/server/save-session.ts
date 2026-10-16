import { parseSaveGame } from '../content/formats/savegame.ts';
import { parseSaveEncryptionTable, SAVE_ENCRYPTION_PATH } from '../content/formats/savegame-header.ts';
import { loadTacticalWorld } from '../content/world/tactical-world.ts';
import type { ReadFile } from '../content/world/tileset-loader.ts';
import { loadTacticalContent } from '../sim/tactical/load-content.ts';
import { importSave, type SaveImportReport, saveMapPath, worldWithSavedDoors } from '../sim/tactical/save-import.ts';
import { TacticalSim } from '../sim/tactical/tactical-sim.ts';
import { TacticalSession } from './sandbox.ts';

const DEFAULT_SEED = 1;

export interface SaveSession {
  readonly session: TacticalSession;
  readonly report: SaveImportReport;
}

export async function createSaveSession(read: ReadFile, saveBytes: Uint8Array, seed = DEFAULT_SEED): Promise<SaveSession> {
  const table = await read(SAVE_ENCRYPTION_PATH);
  if (!table) throw new Error(`missing ${SAVE_ENCRYPTION_PATH}`);
  const save = parseSaveGame(saveBytes, parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode(table))));
  const [world, content] = await Promise.all([loadTacticalWorld(read, saveMapPath(save)), loadTacticalContent(read)]);
  const sim = new TacticalSim(worldWithSavedDoors(world, save), content, seed);
  const report = importSave(sim, save);
  return { session: new TacticalSession(sim), report };
}
