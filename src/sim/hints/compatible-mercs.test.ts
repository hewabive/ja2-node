import { beforeAll, describe, expect, it } from 'vitest';
import { hintAnswer, newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { createItem, emptyObject } from '../items/object.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { InvSlot } from '../tactical/inventory.ts';
import { Team } from '../tactical/soldier.ts';
import type { CompatibleMercs } from './compatible-mercs.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function item(name: string): number {
  const def = content.items.byName.get(name);
  if (!def) throw new Error(`no item ${name}`);
  return def.index;
}

describe('the mercs whose faces an item list lights (HandleAnyMercInSquadHasCompatibleStuff)', () => {
  it('names our mercs carrying ammo for a gun of the list or a gun for its ammo, nothing for other items', () => {
    const sim = newCombatSim(content);
    const gunner = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const loader = spawnSoldier(sim, 1, Team.OUR, gridNo(82, 80), Direction.SOUTH);
    const bare = spawnSoldier(sim, 2, Team.OUR, gridNo(84, 80), Direction.SOUTH);
    gunner.inv[InvSlot.HAND] = createItem(content.items, item('GLOCK_17'), 100);
    loader.inv[InvSlot.HAND] = emptyObject();
    loader.inv[InvSlot.SMALLPOCK1] = createItem(content.items, item('CLIP9_15'), 100);
    bare.inv[InvSlot.HAND] = emptyObject();
    const lit = (items: readonly number[]) => {
      const answer = hintAnswer(sim, 'compatibleMercs', { items });
      expect(answer.ok, answer.reason).toBe(true);
      return (answer.data as CompatibleMercs).mercs;
    };
    expect(lit([item('CLIP9_15')])).toEqual([gunner.id]);
    expect(lit([item('GLOCK_17')])).toEqual([loader.id]);
    expect(lit([item('KEVLAR_VEST'), item('GLOCK_17'), item('CLIP9_15')])).toEqual([gunner.id, loader.id]);
    expect(lit([item('KEVLAR_VEST')])).toEqual([]);
    expect(hintAnswer(sim, 'compatibleMercs', { items: ['GLOCK_17'] }).data).toMatchObject({ refusal: 'badItems' });
  });
});
