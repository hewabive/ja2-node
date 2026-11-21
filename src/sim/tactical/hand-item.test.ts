import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { NOTHING } from '../../content/items/items.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { WeaponMode } from './combat/types.ts';
import type { TacticalContent } from './content.ts';
import { reloadSoldierAnimationDueToHandItemChange } from './hand-item.ts';
import { Team } from './soldier.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function burstAfterChangingTo(newItem: string | number): [number, number] {
  const sim = newCombatSim(content);
  const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.EAST, { gun: 'MP5K' });
  s.doBurst = 1;
  s.weaponMode = WeaponMode.BURST;
  const item = typeof newItem === 'number' ? newItem : (content.items.byName.get(newItem)?.index ?? -1);
  reloadSoldierAnimationDueToHandItemChange(sim.state, s, s.inv[0]?.item ?? NOTHING, item);
  return [s.doBurst, s.weaponMode];
}

describe('a hand item change (Soldier_Control.cc:7436-7440)', () => {
  it('switches burst off for a weapon without burst, but not for bare hands or a punch weapon, which are no weapons by class', () => {
    expect(burstAfterChangingTo('COMBAT_KNIFE')).toEqual([0, WeaponMode.NORMAL]);
    expect(burstAfterChangingTo(NOTHING)).toEqual([1, WeaponMode.BURST]);
    expect(burstAfterChangingTo('BRASS_KNUCKLES')).toEqual([1, WeaponMode.BURST]);
  });
});
