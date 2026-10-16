import { beforeAll, describe, expect, it } from 'vitest';
import { awakeFixture, loadArmyTestContent } from '../../../../tests/support/queen.ts';
import { loadStrategicTestContent } from '../../../../tests/support/strategic.ts';
import type { ArmyContent } from '../../../content/strategic/army.ts';
import { parseSectorString, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { SoldierClass } from '../../tactical/soldier.ts';
import { Town } from './constants.ts';
import {
  calcDifficultyModifier,
  calcImportantSectorControl,
  currentPlayerProgressPercentage,
  difficultyModifierAt,
  hourlyProgressUpdate,
  locationModifier,
  pythDistanceFromPalace,
} from './difficulty.ts';
import { createStrategicStatus } from './queen-state.ts';
import { EnemyKilled, trackEnemiesKilled } from './status.ts';

let content: StrategicContent;
let army: ArmyContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
  army = await loadArmyTestContent();
});

describe('CalcDifficultyModifier (docs/17 §11)', () => {
  it('rounds the palace distance exactly and maps it to the location modifier', () => {
    const at = (s: string) => parseSectorString(s);
    expect(pythDistanceFromPalace(at('A9'))).toBe(16);
    expect(pythDistanceFromPalace(at('D13'))).toBe(16);
    expect(pythDistanceFromPalace(at('G9'))).toBe(11);
    expect(pythDistanceFromPalace(at('N4'))).toBe(2);
    expect(locationModifier(Town.BLANK_SECTOR, at('A9'))).toBe(6);
    expect(locationModifier(Town.BLANK_SECTOR, at('G9'))).toBe(13);
    expect(locationModifier(Town.ALMA, at('I14'))).toBe(15);
    expect(locationModifier(Town.ORTA, at('K4'))).toBe(24);
    expect(locationModifier(Town.BLANK_SECTOR, at('N4'))).toBe(27);
    expect(locationModifier(Town.BLANK_SECTOR, at('P3'))).toBe(30);
    expect(locationModifier(Town.BLANK_SECTOR, at('A1'))).toBe(7);
    expect(locationModifier(Town.BLANK_SECTOR, at('A16'))).toBe(0);
  });

  it('gives A9 at game start 1, 11 and 21 and only helps militia on easy', () => {
    const a9 = { highestProgress: 0, predictedMineIncome: 0, battleSector: parseSectorString('A9'), battleSectorTownId: Town.OMERTA };
    expect(calcDifficultyModifier({ ...a9, difficulty: 1 }, SoldierClass.ARMY)).toBe(1);
    expect(calcDifficultyModifier({ ...a9, difficulty: 1 }, SoldierClass.GREEN_MILITIA)).toBe(21);
    expect(calcDifficultyModifier({ ...a9, difficulty: 2 }, SoldierClass.ARMY)).toBe(11);
    expect(calcDifficultyModifier({ ...a9, difficulty: 3 }, SoldierClass.ELITE)).toBe(21);
    const late = {
      ...a9,
      difficulty: 3,
      highestProgress: 100,
      predictedMineIncome: 5000,
      battleSector: parseSectorString('P3'),
      battleSectorTownId: 0,
    };
    expect(calcDifficultyModifier(late, SoldierClass.ELITE)).toBe(100);
    expect(calcDifficultyModifier({ ...late, highestProgress: 9 }, SoldierClass.ELITE)).toBe(20 + 5 + 4 + 30);
  });

  it('reads progress from mines, kills and important sectors held, and records the highest', () => {
    const mines = { predictIncomeFromPlayerMines: () => 3000, maxPlayerIncomeFromMines: () => 10000 };
    const { q } = awakeFixture({ content, army, difficulty: 2, mines }, []);
    q.state.status.playerKills = 87;
    for (const s of ['D13', 'D15', 'C13']) {
      const e = q.state.map.elements[strategicIndex(parseSectorString(s))];
      if (e) e.enemyControlled = false;
    }
    expect(calcImportantSectorControl(q)).toBe(4);
    expect(currentPlayerProgressPercentage(q, army.progress, mines)).toBe(15 + 8 + 4);
    expect(hourlyProgressUpdate(q)).toEqual({ madlab: false, mike: false, iggy: false });
    expect(q.state.status.highestProgress).toBe(27);
    expect(difficultyModifierAt(q, SoldierClass.ARMY, parseSectorString('D13'))).toBe(10 + 5 + 13 + 6);
  });

  it('tracks kills by rank with the total row and ignores profiled enemies', () => {
    const status = createStrategicStatus();
    trackEnemiesKilled(status, EnemyKilled.IN_AUTO_RESOLVE, SoldierClass.ELITE);
    trackEnemiesKilled(status, EnemyKilled.TOTAL, SoldierClass.ADMINISTRATOR);
    trackEnemiesKilled(status, EnemyKilled.IN_TACTICAL, SoldierClass.NONE);
    expect(status.enemiesKilled).toEqual([
      [0, 0, 0],
      [0, 0, 1],
      [1, 0, 1],
    ]);
  });
});
