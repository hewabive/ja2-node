import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { parseSaveGame, type SaveGame } from './savegame.ts';
import { parseSaveEncryptionTable } from './savegame-header.ts';
import { layoutBytes, layoutOffsets } from './savegame-layout.ts';
import { readStrategicAiSections } from './savegame-strategic-ai.ts';
import { GENERAL_INFO_LAYOUT } from './savegame-tactical.ts';

const SAI_HEADER = 144;
const COMPOSITIONS = 60 * 20;
const PATROLS = 50 * 20;
const GARRISONS = 100 * 14;
const STATUS = 192;

function syntheticSave(): { bytes: Uint8Array; save: SaveGame } {
  const generalInfo = layoutBytes(GENERAL_INFO_LAYOUT, false);
  const ai = SAI_HEADER + COMPOSITIONS + PATROLS + GARRISONS + 2 + 3;
  const bytes = new Uint8Array(STATUS + ai + generalInfo);
  const v = new DataView(bytes.buffer);
  v.setUint8(5, 37);
  v.setUint16(98, 321, true);
  v.setUint16(100 + 2 * 4, 9, true);
  const a = STATUS;
  v.setUint8(a + 3, 1);
  v.setInt32(a + 4, 3, true);
  v.setInt32(a + 8, 2, true);
  v.setInt32(a + 12, -7, true);
  v.setUint8(a + 28, 1);
  v.setInt32(a + 33, 44, true);
  v.setUint8(a + 38, 29);
  v.setUint16(a + 44, 3, true);
  v.setInt32(a + SAI_HEADER + 20, 1, true);
  v.setInt8(a + SAI_HEADER + 20 + 4, 95);
  v.setInt8(a + SAI_HEADER + 20 + 8, 16);
  const patrol1 = a + SAI_HEADER + COMPOSITIONS + 20;
  v.setInt8(patrol1, 6);
  v.setUint8(patrol1 + 2, 16);
  v.setInt8(patrol1 + 6, -1);
  v.setUint8(patrol1 + 7, 4);
  const garrison2 = a + SAI_HEADER + COMPOSITIONS + PATROLS + 2 * 14;
  v.setUint8(garrison2, 242);
  v.setInt8(garrison2 + 2, -5);
  v.setUint8(garrison2 + 3, 9);
  v.setUint8(a + SAI_HEADER + COMPOSITIONS + PATROLS + GARRISONS + 2 + 2, 250);
  const g = STATUS + ai;
  const offsets = layoutOffsets(GENERAL_INFO_LAYOUT, false);
  v.setUint32(g + (offsets.get('sSelMapZ') ?? 0) + 4 + 24, 0x10001, true);
  v.setInt16(g + (offsets.get('sWorldSectorLocationOfFirstBattle') ?? 0), 27, true);
  const save = {
    header: { version: 99 },
    sections: [
      { name: 'strategic status', offset: 0, size: STATUS },
      { name: 'strategic ai', offset: STATUS, size: ai },
      { name: 'general info', offset: STATUS + ai, size: generalInfo },
    ],
  } as unknown as SaveGame;
  return { bytes, save };
}

describe('strategic AI save sections (docs/14 §4, docs/17 §1.4)', () => {
  it('decodes the header, the records, the denials, the status and the meanwhile flags', () => {
    const { bytes, save } = syntheticSave();
    const s = readStrategicAiSections(bytes, save);
    expect(s.ai).toMatchObject({
      extraElites: true,
      reinforcementPool: -7,
      awake: true,
      requestPoints: 44,
      saiVersion: 29,
      playerBattleVictories: 3,
    });
    expect(s.ai.compositions).toHaveLength(60);
    expect(s.ai.compositions[1]).toMatchObject({ id: 1, priority: 95, desired: 16 });
    expect(s.ai.patrols).toHaveLength(2);
    expect(s.ai.patrols[1]).toEqual({
      size: 6,
      priority: 0,
      points: [16, 0, 0, 0],
      fillDayMod100: -1,
      group: 4,
      weight: 0,
      pendingGroup: 0,
    });
    expect(s.ai.garrisons).toHaveLength(3);
    expect(s.ai.garrisons[2]).toEqual({ sector: 242, composition: 0, weight: -5, pendingGroup: 9 });
    expect(s.ai.garrisonDenied).toEqual([0, 0, 250]);
    expect(s.status).toMatchObject({ highestProgress: 37, playerKills: 321 });
    expect(s.status.enemiesKilled[1]).toEqual([0, 9, 0]);
    expect(s.meanwhileFlags).toBe(0x10001);
    expect(s.firstBattleSector).toBe(27);
  });
});

const dataDir = ORIGINAL_DATA_DIR;
const savesDir = join(dirname(dataDir), 'SavedGames');
const saveFiles = dataDir && existsSync(savesDir) ? readdirSync(savesDir).filter((f) => f.toLowerCase().endsWith('.sav')) : [];

describe.skipIf(!ORIGINAL_DATA_DIR)('strategic AI sections of the native saves', () => {
  const encryption = parseSaveEncryptionTable(
    JSON.parse(readFileSync(join(import.meta.dirname, '../../../data/tables/save-encryption.json'), 'utf8')),
  );
  for (const file of saveFiles) {
    it(`decodes ${file}`, () => {
      const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
      const save = parseSaveGame(bytes, encryption);
      const s = readStrategicAiSections(bytes, save);
      expect(s.ai.saiVersion).toBe(29);
      expect(s.ai.garrisons).toHaveLength(57);
      expect(s.ai.patrols).toHaveLength(29);
      expect(s.ai.compositions.slice(0, 27).map((c) => c.id)).toEqual(Array.from({ length: 27 }, (_, k) => k));
      const difficulty = save.generalInfo.gameOptions.difficulty;
      expect(s.ai.minGroupSize).toBe([3, 4, 6][difficulty - 1]);
      s.ai.garrisons.forEach((g, gi) => {
        expect(save.strategicInfo.sectors[g.sector]?.garrisonId).toBe(gi);
      });
      for (const p of s.ai.patrols) if (p.group) expect(save.groups.some((g) => g.id === p.group && !g.player)).toBe(true);
    });
  }
});
