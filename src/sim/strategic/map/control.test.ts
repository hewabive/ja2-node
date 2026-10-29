import { beforeAll, describe, expect, it } from 'vitest';
import { FakeMercs, loadStrategicTestContent, testContext } from '../../../../tests/support/strategic.ts';
import { parseSectorString, type Sector, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { addPlayerToGroup, createNewPlayerGroupDepartingFromSector, removePlayerFromGroup } from '../forces/groups.ts';
import { setThisSectorAsEnemyControlled } from './control.ts';

let content: StrategicContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
});

const C9 = parseSectorString('C9');

describe('losing a sector (Player_Command.cc SetThisSectorAsEnemyControlled)', () => {
  it('hands the sector to the enemy while our mercs are still there, so the loss itself never counts once they leave', () => {
    const mercs = new FakeMercs();
    const taken: { sector: Sector; wasPlayerControlled: boolean }[] = [];
    let airspaceUpdates = 0;
    const ctx = testContext({
      content,
      mercs,
      world: {
        sectorTakenByEnemy: (sector, wasPlayerControlled) => taken.push({ sector, wasPlayerControlled }),
        airspaceControlUpdated: () => airspaceUpdates++,
      },
    });
    const element = ctx.state.map.elements[strategicIndex(C9)];
    if (!element) throw new Error('no map element');
    element.enemyControlled = false;
    const g = createNewPlayerGroupDepartingFromSector(ctx, C9);
    mercs.add({ id: 0, sector: C9 });
    addPlayerToGroup(ctx, g, 0);

    expect(setThisSectorAsEnemyControlled(ctx, C9)).toBe(false);
    expect(element.enemyControlled).toBe(true);
    expect(taken).toEqual([]);
    expect(airspaceUpdates).toBe(0);

    removePlayerFromGroup(ctx, 0);
    expect(setThisSectorAsEnemyControlled(ctx, C9)).toBe(false);
    expect(taken).toEqual([{ sector: C9, wasPlayerControlled: false }]);
    expect(airspaceUpdates).toBe(1);
  });
});
