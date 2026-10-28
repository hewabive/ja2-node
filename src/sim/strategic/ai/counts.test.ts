import { beforeAll, describe, expect, it } from 'vitest';
import { loadArmyTestContent, queenTestContext, useGarrisons } from '../../../../tests/support/queen.ts';
import { loadStrategicTestContent } from '../../../../tests/support/strategic.ts';
import type { ArmyContent } from '../../../content/strategic/army.ts';
import { parseSectorId, parseSectorString } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { createNewEnemyGroupDepartingFromSector, numEnemiesInSector } from '../forces/groups.ts';
import { sectorInfo } from '../map/sectors.ts';
import { Composition } from './constants.ts';
import { getNumberOfEnemiesInSector, numMobileEnemiesInSector, numStationaryEnemiesInSector, playerSectorDefended } from './counts.ts';

let content: StrategicContent;
let army: ArmyContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
  army = await loadArmyTestContent();
});

function garrisonsWithH1AtIndex25() {
  const q = queenTestContext({ content, army });
  const filler = Array.from({ length: 25 }, (_, k) => ({
    sector: `${'IJKL'[Math.trunc(k / 8)]}${9 + (k % 8)}`,
    composition: Composition.LEVEL1_DEFENCE,
  }));
  useGarrisons(q, [
    ...filler,
    { sector: 'H1', composition: Composition.WEST_GRUMM_DEFENCE, admins: 6 },
    { sector: 'G7', composition: Composition.ROADBLOCK, troops: 5 },
  ]);
  return q;
}

describe('enemy counting helpers', () => {
  it('counts the H1 garrison twice because garrison index 25 equals ROADBLOCK', () => {
    const q = garrisonsWithH1AtIndex25();
    const h1 = parseSectorString('H1');
    expect(sectorInfo(q.state.map, h1).garrisonId).toBe(Composition.ROADBLOCK);
    expect(getNumberOfEnemiesInSector(q, h1)).toEqual({ admins: 12, troops: 0, elites: 0 });
    expect(numMobileEnemiesInSector(q, h1)).toBe(6);
    expect(numStationaryEnemiesInSector(q, h1)).toBe(6);
  });

  it('treats real roadblocks as neither stationary nor mobile garrisons', () => {
    const q = garrisonsWithH1AtIndex25();
    const g7 = parseSectorString('G7');
    expect(numStationaryEnemiesInSector(q, g7)).toBe(0);
    expect(numMobileEnemiesInSector(q, g7)).toBe(0);
    expect(getNumberOfEnemiesInSector(q, g7)).toEqual({ admins: 0, troops: 5, elites: 0 });
  });

  it('counts groups between sectors in the sector they left', () => {
    const q = garrisonsWithH1AtIndex25();
    const g = createNewEnemyGroupDepartingFromSector(q, parseSectorId('C9'), 1, 4, 2);
    g.betweenSectors = true;
    g.next = parseSectorString('C10');
    expect(numMobileEnemiesInSector(q, parseSectorString('C9'))).toBe(6);
    expect(getNumberOfEnemiesInSector(q, parseSectorString('C9'))).toEqual({ admins: 1, troops: 4, elites: 2 });
    expect(numEnemiesInSector(q, parseSectorString('C10'))).toBe(0);
  });

  it('defends a player sector with militia or a stopped player group', () => {
    const q = garrisonsWithH1AtIndex25();
    const id = parseSectorId('D13');
    expect(playerSectorDefended(q, id)).toBe(false);
    const militia = sectorInfo(q.state.map, parseSectorString('D13')).militia;
    militia[1] = 2;
    expect(playerSectorDefended(q, id)).toBe(true);
  });
});
