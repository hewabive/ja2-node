import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { createItem } from '../items/object.ts';
import { changeSoldierStance } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { InvSlot, itemIn } from './inventory.ts';
import { adjustGridNoForItemPlacement, apsToPickupItem } from './item-actions.ts';
import { AP } from './points.ts';
import { Team } from './soldier.ts';
import { addItemToPool, Visibility } from './world-items.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const item = (name: string) => content.items.byName.get(name)?.index ?? -1;

describe('picking up and dropping items', () => {
  it('picks up every visible item on the tile with the pickup animation and charges AP_PICKUP_ITEM once', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 95), Direction.NORTH);
    sim.lookAround();
    expect(t.inCombat).toBe(true);
    addItemToPool(t, merc.gridNo, createItem(t.content.items, item('CANTEEN'), 100), Visibility.VISIBLE, 0);
    addItemToPool(t, merc.gridNo, createItem(t.content.items, item('CROWBAR'), 90), Visibility.VISIBLE, 0);
    addItemToPool(t, merc.gridNo, createItem(t.content.items, item('WIRECUTTERS'), 90), Visibility.INVISIBLE, 0);
    const before = merc.actionPoints;
    expect(sim.dispatch({ type: 'pickUp', soldier: 0 })).toEqual({ ok: true });
    expect(t.content.animations.controls[merc.state]?.id).toBe('PICKUP_ITEM');
    const events = runUntilIdle(sim);
    expect(events.find((e) => e.type === 'itemsPickedUp')).toMatchObject({ soldier: 0, gridNo: merc.gridNo });
    expect(before - merc.actionPoints).toBe(AP.PICKUP_ITEM);
    expect(merc.inv.some((o) => o.item === item('CANTEEN'))).toBe(true);
    expect(merc.inv.some((o) => o.item === item('CROWBAR'))).toBe(true);
    expect(t.worldItems.map((wi) => wi.object.item)).toEqual([item('WIRECUTTERS')]);
  });

  it('picks up a chosen item at once when crouched', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    changeSoldierStance(t, merc, 3);
    runUntilIdle(sim);
    addItemToPool(t, merc.gridNo, createItem(t.content.items, item('CANTEEN'), 100), Visibility.VISIBLE, 0);
    addItemToPool(t, merc.gridNo, createItem(t.content.items, item('CROWBAR'), 90), Visibility.VISIBLE, 0);
    expect(sim.dispatch({ type: 'pickUp', soldier: 0, items: [1] })).toEqual({ ok: true });
    expect(merc.inv.some((o) => o.item === item('CROWBAR'))).toBe(true);
    expect(merc.inv.some((o) => o.item === item('CANTEEN'))).toBe(false);
    expect(t.worldItems).toHaveLength(1);
  });

  it('walks to an item elsewhere and picks it up on arrival', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    addItemToPool(t, gridNo(83, 80), createItem(t.content.items, item('CROWBAR'), 90), Visibility.VISIBLE, 0);
    expect(sim.dispatch({ type: 'pickUp', soldier: 0, gridNo: gridNo(83, 80) })).toEqual({ ok: true });
    const events = runUntilIdle(sim);
    expect(merc.gridNo).toBe(gridNo(83, 80));
    expect(events.some((e) => e.type === 'itemsPickedUp')).toBe(true);
    expect(merc.inv.some((o) => o.item === item('CROWBAR'))).toBe(true);
    expect(t.worldItems).toHaveLength(0);
  });

  it('approaches a pile under another soldier from a side tile, never from a diagonal one', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const pile = gridNo(80, 80);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(81, 79), Direction.SOUTH);
    spawnSoldier(sim, 1, Team.OUR, pile, Direction.SOUTH);
    addItemToPool(t, pile, createItem(t.content.items, item('CROWBAR'), 90), Visibility.VISIBLE, 0);
    expect(adjustGridNoForItemPlacement(t, merc, pile)).toBe(gridNo(80, 79));
    expect(sim.dispatch({ type: 'pickUp', soldier: 0, gridNo: pile })).toEqual({ ok: true });
    runUntilIdle(sim);
    expect(merc.gridNo).toBe(gridNo(80, 79));
    expect(merc.inv.some((o) => o.item === item('CROWBAR'))).toBe(true);
  });

  it('refuses a pickup in combat whose walk and pickup together cost more APs than he has', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 95), Direction.NORTH);
    sim.lookAround();
    expect(t.inCombat).toBe(true);
    const pile = gridNo(83, 80);
    addItemToPool(t, pile, createItem(t.content.items, item('CROWBAR'), 90), Visibility.VISIBLE, 0);
    const cost = apsToPickupItem(t, merc, pile);
    expect(cost).toBeGreaterThan(AP.PICKUP_ITEM);
    merc.actionPoints = cost - 1;
    expect(sim.dispatch({ type: 'pickUp', soldier: 0, gridNo: pile })).toMatchObject({ ok: false, data: { refusal: 'notEnoughAP' } });
    merc.actionPoints = cost;
    expect(sim.dispatch({ type: 'pickUp', soldier: 0, gridNo: pile })).toEqual({ ok: true });
  });

  it('drops the hand item at the drop animation code and shows it to the squad', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const gun = itemIn(merc.inv, InvSlot.HAND);
    expect(sim.dispatch({ type: 'drop', soldier: 0 })).toEqual({ ok: true });
    expect(t.worldItems).toHaveLength(0);
    const events = runUntilIdle(sim);
    expect(events.find((e) => e.type === 'itemDropped')).toMatchObject({ soldier: 0, gridNo: merc.gridNo });
    expect(itemIn(merc.inv, InvSlot.HAND)).toBe(0);
    expect(sim.visibleItems()).toEqual([
      { gridNo: merc.gridNo, level: 0, item: t.content.items.byIndex.get(gun)?.name, count: 1, status: 100 },
    ]);
  });

  it('reveals items our mercs see and leaves unseen ones hidden', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    addItemToPool(t, gridNo(80, 84), createItem(t.content.items, item('CANTEEN'), 100), Visibility.INVISIBLE, 0);
    addItemToPool(t, gridNo(80, 70), createItem(t.content.items, item('CROWBAR'), 100), Visibility.INVISIBLE, 0);
    addItemToPool(t, gridNo(80, 85), createItem(t.content.items, item('WIRECUTTERS'), 100), Visibility.HIDDEN_ITEM, 0);
    sim.lookAround();
    expect(sim.visibleItems().map((i) => i.item)).toEqual(['CANTEEN']);
  });
});
