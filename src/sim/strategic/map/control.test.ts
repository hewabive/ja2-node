import { beforeAll, describe, expect, it } from 'vitest';
import { FakeMercs, loadStrategicTestContent, testContext } from '../../../../tests/support/strategic.ts';
import { parseSectorString, type Sector, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { addPlayerToGroup, createNewPlayerGroupDepartingFromSector, removePlayerFromGroup } from '../forces/groups.ts';
import { setThisSectorAsEnemyControlled, setThisSectorAsPlayerControlled } from './control.ts';

let content: StrategicContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
});

const C9 = parseSectorString('C9');

describe('losing a sector (Player_Command.cc SetThisSectorAsEnemyControlled)', () => {
  it('hands the sector to the enemy while our mercs are still there, so the loss itself never counts once they leave (quirk Q29)', () => {
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

describe('taking a sector (Player_Command.cc SetThisSectorAsPlayerControlled)', () => {
  it('raises no liberation effects for an enemy sector taken without a fight, only for one won in battle', () => {
    const liberated: Sector[] = [];
    const ctx = testContext({ content, world: { sectorLiberated: (event) => liberated.push(event.sector) } });
    const element = ctx.state.map.elements[strategicIndex(C9)];
    if (!element) throw new Error('no map element');
    element.enemyControlled = true;
    expect(setThisSectorAsPlayerControlled(ctx, C9, false)).toBe(true);
    expect(element.enemyControlled).toBe(false);
    expect(liberated).toEqual([]);
    element.enemyControlled = true;
    expect(setThisSectorAsPlayerControlled(ctx, C9, true)).toBe(true);
    expect(liberated).toEqual([C9]);
  });
});
