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

  it('refuses an unknown item, a list that is not one of item indices and an unknown rule', () => {
    const sim = newCombatSim(content);
    expect(hintAnswer(sim, 'compatibleItems', { item: NOTHING, items: [] })).toMatchObject({ data: { refusal: 'badItem' } });
    expect(hintAnswer(sim, 'compatibleItems', { item: item('GLOCK_17'), items: ['GLOCK_17'] })).toMatchObject({
      data: { refusal: 'badItems' },
    });
    expect(hintAnswer(sim, 'compatibleItems', { item: item('GLOCK_17'), items: [], rule: 'toString' })).toMatchObject({
      data: { refusal: 'badRule' },
    });
  });
});

describe('the items outlined for the item under the pointer on the shop screen (IsGunOrAmmoOfSameTypeSelected)', () => {
  const lit = (sim: ReturnType<typeof newCombatSim>, test: number, candidates: readonly number[], rule?: string) => {
    const answer = hintAnswer(sim, 'compatibleItems', { item: test, items: candidates, ...(rule ? { rule } : {}) });
    expect(answer.ok, answer.reason).toBe(true);
    return (answer.data as CompatibleItems).compatible;
  };

  it('outlines a gun’s ammo and attachments and every valid attachment either way: a detonator and TNT, plates and a vest', () => {
    const sim = newCombatSim(content);
    const candidates = ['CLIP9_15', 'SILENCER', 'DETONATOR', 'TNT', 'CERAMIC_PLATES', 'KEVLAR_VEST', 'GLOCK_17'].map(item);
    expect(lit(sim, item('GLOCK_17'), candidates, 'shop')).toEqual([true, true, false, false, false, false, false]);
    expect(lit(sim, item('CLIP9_15'), candidates, 'shop')).toEqual([false, false, false, false, false, false, true]);
    expect(lit(sim, item('TNT'), candidates, 'shop')).toEqual([false, false, true, false, false, false, false]);
    expect(lit(sim, item('DETONATOR'), candidates, 'shop')).toEqual([false, false, false, true, false, false, false]);
    expect(lit(sim, item('KEVLAR_VEST'), candidates, 'shop')).toEqual([false, false, false, false, true, false, false]);
    expect(lit(sim, item('CERAMIC_PLATES'), candidates, 'shop')).toEqual([false, false, false, false, false, true, false]);
  });

  it('leaves out the grenades of a launcher, which the map screen lights', () => {
    const sim = newCombatSim(content);
    const candidates = [item('GL_HE_GRENADE'), item('GLAUNCHER')];
    expect(lit(sim, item('GLAUNCHER'), candidates)).toEqual([true, false]);
    expect(lit(sim, item('GLAUNCHER'), candidates, 'shop')).toEqual([false, false]);
    expect(lit(sim, item('GL_HE_GRENADE'), candidates, 'shop')).toEqual([false, false]);
  });
});
