import { beforeAll, describe, expect, it } from 'vitest';
import { BARE_HANDS, newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { createItem } from '../../items/object.ts';
import type { TacticalContent } from '../content.ts';
import { Attitude, Team } from '../soldier.ts';
import { addItemToPool, Visibility } from '../world-items.ts';
import { AiAction } from './actions.ts';
import { ItemSearch, searchForItems } from './item-search.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const SEARCHER_AT = gridNo(80, 80);
const ITEM_AT = gridNo(81, 80);

function search(hand: string, onTheGround: string): number {
  const sim = newCombatSim(content);
  const t = sim.state;
  const s = spawnSoldier(sim, 20, Team.ENEMY, SEARCHER_AT, Direction.EAST, { gun: hand });
  s.ai.attitude = Attitude.AGGRESSIVE;
  const item = content.items.byName.get(onTheGround)?.index ?? -1;
  addItemToPool(t, ITEM_AT, createItem(content.items, item, 100), Visibility.VISIBLE, 0);
  return searchForItems(t, s, ItemSearch.WEAPONS, item).action;
}

describe('the AI weapon search (FindLocations.cc:1623-1639)', () => {
  it('takes no punch weapon or thrown object for a weapon, as isWeapon holds guns, blades, throwing knives, launchers and tentacles', () => {
    expect(search(BARE_HANDS, 'COMBAT_KNIFE')).toBe(AiAction.PICKUP_ITEM);
    expect(search(BARE_HANDS, 'BRASS_KNUCKLES')).toBe(AiAction.NONE);
    expect(search(BARE_HANDS, 'ROCK')).toBe(AiAction.NONE);
  });

  it('counts a punch weapon in hand as no weapon, so a throwing knife as deadly as the crowbar is worth picking up', () => {
    expect(search('CROWBAR', 'THROWING_KNIFE')).toBe(AiAction.PICKUP_ITEM);
    expect(search('MACHETE', 'THROWING_KNIFE')).toBe(AiAction.NONE);
  });
});
