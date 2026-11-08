import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../../tests/support/original-data.ts';
import { parseSaveGame, type SaveGame } from '../../../content/formats/savegame.ts';
import { parseSaveEncryptionTable, SAVE_ENCRYPTION_PATH } from '../../../content/formats/savegame-header.ts';
import { withGraphicFacts } from '../../../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../../../content/vfs/vfs.ts';
import { type DataVfs, openDataVfs } from '../../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../../node/repo.ts';
import { questLog } from '../../../server/quest-view.ts';
import { createSaveSession } from '../../../server/save-session.ts';
import { createStrategicState } from '../state.ts';
import { checkFact } from './check-fact.ts';
import { NUM_FACTS } from './facts.ts';
import { Npc } from './npc-ids.ts';
import { QuestHistory } from './quests.ts';
import { importNarrativeSave } from './save-import.ts';

const dataDir = ORIGINAL_DATA_DIR;
const gameRoot = basename(dataDir).toLowerCase() === 'data' ? dirname(dataDir) : dataDir;
const savesDir = join(gameRoot, 'SavedGames');
const saveFiles = dataDir && existsSync(savesDir) ? readdirSync(savesDir).filter((f) => f.toLowerCase().endsWith('.sav')) : [];

describe.skipIf(!ORIGINAL_DATA_DIR)('facts, quests and NPC profiles of the native savegames', () => {
  let data: DataVfs;
  const read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir });
  });
  afterAll(async () => {
    await data.close();
  });

  for (const file of saveFiles) {
    it(`imports ${file}`, async () => {
      const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
      const table = parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode((await read(SAVE_ENCRYPTION_PATH)) ?? new Uint8Array())));
      const save = parseSaveGame(bytes, table);
      const { session } = await createSaveSession(read, bytes, undefined, (p) => data.vfs.stat(p) !== undefined);
      const c = session.campaign;
      const n = c.state.narrative;
      expect([...n.facts]).toEqual(save.facts);
      expect([...n.quests]).toEqual(save.quests);
      const g = save.generalInfo.narrative;
      expect(n.boxing).toMatchObject({ matchesWon: g.boxingMatchesWon, rests: g.boxersRests, resting: g.boxersResting });
      expect(n.cambriaMedicalObjects).toBe(g.cambriaMedicalObjects);
      expect(c.state.terrorists.count).toBe(g.numTerrorists);
      expect(c.state.talk.dialogue.mercArrivingQuoteBeingUsed).toBe(save.tactical.mercArrivingQuoteBeingUsed);
      const carmen = save.profiles[Npc.CARMEN];
      expect(c.narrative.profile(Npc.CARMEN)).toMatchObject({
        sectorX: carmen?.sectorX,
        sectorY: carmen?.sectorY,
        sectorZ: carmen?.sectorZ,
        npcData: carmen?.npcData,
        money: carmen?.money,
      });
      const ctx = c.narrative.factContext();
      for (let id = 0; id < NUM_FACTS; id++) checkFact(ctx, id, 0);
      const logged = c.state.laptop.history.filter((h) => h.code === QuestHistory.QUEST_STARTED).map((h) => h.secondCode);
      expect(questLog(c).map((q) => q.id)).toEqual(expect.arrayContaining(logged));
    });
  }
});

const NO_GUIDE = { counting: false, countdown: 0, quote: 0, sectorX: 0, sectorY: 0 };
const NO_GLOBALS = {
  boxingMatchesWon: 0,
  boxersRests: 0,
  boxersResting: false,
  lastBoxingMatchWonByPlayer: false,
  boxerFought: [],
  cambriaMedicalObjects: 0,
  hospitalPriceModifier: 0,
  hospitalTempBalance: 0,
  hospitalRefund: 0,
  playerTeamSawJoey: false,
  mikeShouldSayHi: 0,
  numTerrorists: 0,
};

function saveWithArrivalLineTaken(taken: boolean): SaveGame {
  return {
    facts: [],
    quests: [],
    generalInfo: { narrative: NO_GLOBALS },
    tactical: { boxingState: 0, guideDescription: NO_GUIDE, mercArrivingQuoteBeingUsed: taken },
  } as unknown as SaveGame;
}

describe('the tactical status of a native save', () => {
  it('keeps the arrival line taken when the save was made with one queued, whose release the emptied queue then never runs (bMercArrivingQuoteBeingUsed, LoadSaveTacticalStatusType.cc:121, SaveLoadGame.cc:689)', () => {
    for (const taken of [true, false]) {
      const state = createStrategicState();
      state.talk.dialogue.mercArrivingQuoteBeingUsed = !taken;
      importNarrativeSave(state, saveWithArrivalLineTaken(taken));
      expect(state.talk.dialogue.mercArrivingQuoteBeingUsed).toBe(taken);
    }
  });
});
