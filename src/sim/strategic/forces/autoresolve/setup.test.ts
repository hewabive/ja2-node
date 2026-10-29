import { beforeAll, describe, expect, it } from 'vitest';
import { arSoldier, arState, enemySoldier } from '../../../../../tests/support/autoresolve.ts';
import { loadTestContent } from '../../../../../tests/support/tactical.ts';
import type { TacticalContent } from '../../../tactical/content.ts';
import { associateEnemiesWithStrategicGroups } from './setup.ts';
import { CellFlag } from './state.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const NO_ENEMIES = { admins: 0, troops: 0, elites: 0 };
const TROOP_GROUP = 1;
const ELITE_GROUP = 2;

describe('associateEnemiesWithStrategicGroups', () => {
  it('fills the stationary garrison by class first', () => {
    const ar = arState({
      mercs: [{ soldier: arSoldier(content) }],
      enemies: [
        { soldier: enemySoldier(content), cellFlags: CellFlag.TROOP },
        { soldier: enemySoldier(content), cellFlags: CellFlag.TROOP },
      ],
    });
    const totals = { ...NO_ENEMIES, troops: 2 };
    associateEnemiesWithStrategicGroups(ar.enemies, totals, { ...NO_ENEMIES, troops: 1 }, [{ id: TROOP_GROUP, ...NO_ENEMIES, troops: 1 }]);
    expect(ar.enemies.map((c) => c.groupId)).toEqual([0, TROOP_GROUP]);
    expect(ar.enemies.every((c) => (c.flags & CellFlag.ASSIGNED) !== 0)).toBe(true);
  });

  it('hands out the mobile groups’ slots in cell order whatever the cell’s class (quirk Q16)', () => {
    const ar = arState({
      mercs: [{ soldier: arSoldier(content) }],
      enemies: [
        { soldier: enemySoldier(content), cellFlags: CellFlag.ELITE },
        { soldier: enemySoldier(content), cellFlags: CellFlag.TROOP },
        { soldier: enemySoldier(content), cellFlags: CellFlag.TROOP },
      ],
    });
    const groups = [
      { id: TROOP_GROUP, ...NO_ENEMIES, troops: 2 },
      { id: ELITE_GROUP, ...NO_ENEMIES, elites: 1 },
    ];
    associateEnemiesWithStrategicGroups(ar.enemies, { ...NO_ENEMIES, troops: 2, elites: 1 }, NO_ENEMIES, groups);
    expect(ar.enemies.map((c) => c.groupId)).toEqual([TROOP_GROUP, TROOP_GROUP, ELITE_GROUP]);
  });
});
