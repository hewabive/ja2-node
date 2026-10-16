import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseSaveGame } from '../content/formats/savegame.ts';
import { parseSaveEncryptionTable, SAVE_ENCRYPTION_PATH } from '../content/formats/savegame-header.ts';
import { readStrategicAiSections } from '../content/formats/savegame-strategic-ai.ts';
import { loadNpcRecordContent, meanwhileKey } from '../content/narrative/npc-records.ts';
import { type DataVfs, openDataVfs } from '../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import { MEANWHILE_FLAGS, Meanwhile } from '../sim/strategic/ai/constants.ts';
import { Npc } from '../sim/strategic/narrative/npc-ids.ts';
import { loadTacticalContent } from '../sim/tactical/load-content.ts';
import { NpcActionCode } from '../sim/tactical/narrative/npc-actions/codes.ts';
import { createSaveSession } from './save-session.ts';

const dataDir = process.env.JA2_DATA_DIR ?? '';
const gameRoot = basename(dataDir).toLowerCase() === 'data' ? dirname(dataDir) : dataDir;
const savesDir = join(gameRoot, 'SavedGames');
const saveFiles = dataDir && existsSync(savesDir) ? readdirSync(savesDir).filter((f) => f.toLowerCase().endsWith('.sav')) : [];
const ENDGAME_FLAGS = 0x80000008;
const ELLIOT_MAX_SLAPS = 17;

describe.skipIf(!process.env.JA2_DATA_DIR)('meanwhile scenes and the ending on the original data', () => {
  let data: DataVfs;
  const read = async (p: string) => (data.vfs.stat(p) ? data.vfs.read(p) : null);

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir });
  });
  afterAll(async () => {
    await data.close();
  });

  it('loads the interrogation record sets of the Queen and Elliot with their lie prompt', async () => {
    const content = await loadTacticalContent(read);
    const records = await loadNpcRecordContent({ read, items: content.items, layerCount: (p) => data.vfs.layerCount(p) });
    const queen = records.meanwhiles.get(meanwhileKey(Meanwhile.INTERROGATION, Npc.QUEEN));
    expect(queen).toBeDefined();
    expect(records.meanwhiles.get(meanwhileKey(Meanwhile.INTERROGATION, Npc.ELLIOT))).toBeDefined();
    expect(queen?.some((r) => r.actionData === NpcActionCode.PROMPT_PLAYER_TO_LIE)).toBe(true);
  });

  for (const file of saveFiles) {
    it(`imports the meanwhile state of ${file}`, async () => {
      const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
      const table = parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode((await read(SAVE_ENCRYPTION_PATH)) ?? new Uint8Array())));
      const save = parseSaveGame(bytes, table);
      expect(save.generalInfo.meanwhile.inScene).toBe(false);
      expect(save.tactical.flags & ENDGAME_FLAGS).toBe(0);
      expect(save.meanwhileDefinitions).toHaveLength(MEANWHILE_FLAGS.length);
      const sai = readStrategicAiSections(bytes, save);
      const { session } = await createSaveSession(read, bytes, undefined, (p) => data.vfs.stat(p) !== undefined);
      const state = session.campaign.state;
      expect(state.meanwhile.flags).toBe(sai.meanwhileFlags);
      expect(state.economy.firstBattleSector).toBe(sai.firstBattleSector);
      MEANWHILE_FLAGS.forEach((flag, id) => {
        if (sai.meanwhileFlags & flag) expect(state.meanwhile.defs[id]).toMatchObject({ id, npc: Npc.QUEEN, trigger: 0 });
      });
      const elliot = session.campaign.narrative.profile(Npc.ELLIOT)?.npcData ?? 0;
      expect(elliot).toBeGreaterThanOrEqual(0);
      expect(elliot).toBeLessThanOrEqual(ELLIOT_MAX_SLAPS);
    });
  }
});
