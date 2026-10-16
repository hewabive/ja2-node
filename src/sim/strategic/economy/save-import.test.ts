import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { type EconomyTestContent, economyTestContext, loadEconomyTestContent } from '../../../../tests/support/economy.ts';
import { parseSaveGame } from '../../../content/formats/savegame.ts';
import { readSavedEconomy, readSoldierAssignments } from '../../../content/formats/savegame-economy.ts';
import { parseSaveEncryptionTable } from '../../../content/formats/savegame-header.ts';
import { importStrategicMap } from '../map/save-import.ts';
import { importStrategicTime } from '../time/save-import.ts';
import { Town } from './constants.ts';
import { predictIncomeFromPlayerMines } from './mines.ts';
import { importEconomy } from './save-import.ts';

const dataDir = process.env.JA2_DATA_DIR ?? '';
const savesDir = join(dirname(dataDir), 'SavedGames');
const saveFiles = dataDir && existsSync(savesDir) ? readdirSync(savesDir).filter((f) => f.toLowerCase().endsWith('.sav')) : [];

let content: EconomyTestContent;
beforeAll(async () => {
  content = await loadEconomyTestContent();
});

describe.skipIf(!process.env.JA2_DATA_DIR)('economy import from the native saves', () => {
  const encryption = parseSaveEncryptionTable(
    JSON.parse(readFileSync(join(import.meta.dirname, '../../../../data/tables/save-encryption.json'), 'utf8')),
  );

  it.each(saveFiles)('%s', (file) => {
    const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
    const save = parseSaveGame(bytes, encryption);
    const saved = readSavedEconomy(bytes, save.sections);
    const { ctx } = economyTestContext({ content });
    importStrategicTime(ctx.state, save);
    importStrategicMap(ctx, save);
    importEconomy(ctx.state, saved, save.laptop.currentBalance);
    expect(saved.mines).toHaveLength(content.economy.mines.length);
    expect(saved.mines[0]).toMatchObject({ empty: true, maxRemovalRate: 0 });
    expect(saved.mines.map((m) => m.mineType)).toEqual(content.economy.mines.map((m) => m.mineType));
    expect(saved.towns[Town.DRASSEN]?.started).toBe(true);
    expect(saved.towns[0]).toEqual({ rating: 0, change: 0, started: false, liberatedAlready: false });
    expect(saved.finances?.balance).toBe(save.laptop.currentBalance);
    expect(saved.finances?.records.at(-1)?.balanceAfter).toBe(save.laptop.currentBalance);
    expect(ctx.state.finances.balance).toBe(save.laptop.currentBalance);
    expect(predictIncomeFromPlayerMines(ctx)).toBeGreaterThanOrEqual(0);
    const assignments = readSoldierAssignments(bytes, save, encryption);
    expect(assignments.map((a) => a.id)).toEqual(save.soldiers.map((e) => e.soldier.id));
    for (const a of assignments) {
      expect(a.trainStat).toBeGreaterThanOrEqual(-1);
      expect(a.lastAssignmentChangeMin).toBeLessThanOrEqual(Math.trunc(save.clock.gameClock / 60));
    }
  });
});
