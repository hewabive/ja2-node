import { beforeAll, describe, expect, it } from 'vitest';
import { hintAnswer, newCombatSim } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { NOTHING } from '../../content/items/items.ts';
import type { TacticalContent } from '../tactical/content.ts';
import type { CompatibleItems } from './compatible-items.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function item(name: string): number {
  const def = content.items.byName.get(name);
  if (!def) throw new Error(`no item ${name}`);
  return def.index;
}

describe('the items lit for an item under the pointer on the map screen (HandleCompatibleAmmoUIForMapInventory)', () => {
  it('lights the gun’s ammo and attachments, the ammo’s gun, and nothing for an empty slot or other items', () => {
    const sim = newCombatSim(content);
    const candidates = [item('CLIP9_15'), item('SILENCER'), item('KEVLAR_VEST'), NOTHING, item('GLOCK_17')];
    const lit = (test: number) => {
      const answer = hintAnswer(sim, 'compatibleItems', { item: test, items: candidates });
      expect(answer.ok, answer.reason).toBe(true);
      return (answer.data as CompatibleItems).compatible;
    };
    expect(lit(item('GLOCK_17'))).toEqual([true, true, false, false, false]);
    expect(lit(item('CLIP9_15'))).toEqual([false, false, false, false, true]);
    expect(lit(item('KEVLAR_VEST'))).toEqual([false, false, false, false, false]);
  });

  it('refuses an unknown item and a list that is not one of item indices', () => {
    const sim = newCombatSim(content);
    expect(hintAnswer(sim, 'compatibleItems', { item: NOTHING, items: [] })).toMatchObject({ data: { refusal: 'badItem' } });
    expect(hintAnswer(sim, 'compatibleItems', { item: item('GLOCK_17'), items: ['GLOCK_17'] })).toMatchObject({
      data: { refusal: 'badItems' },
    });
  });
});
