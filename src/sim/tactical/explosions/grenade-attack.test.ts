import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { createItem } from '../../items/object.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot, itemIn } from '../inventory.ts';
import { Team } from '../soldier.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

describe('grenade attacks through the attack command', () => {
  it('throws a hand grenade at an enemy, pays the throw APs and blows him up', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 87), Direction.NORTH, { life: 30 });
    const grenade = t.content.items.byName.get('HAND_GRENADE')?.index ?? -1;
    merc.inv[InvSlot.HAND] = createItem(t.content.items, grenade, 100);
    sim.lookAround();
    expect(t.inCombat).toBe(true);
    const estimate = sim.dispatch({ type: 'estimateAttack', soldier: 0, target: enemy.gridNo });
    expect(estimate.ok).toBe(true);
    const { apCost, pathClear } = estimate.data as { apCost: number; pathClear: boolean };
    expect(pathClear).toBe(true);
    const before = merc.actionPoints;
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo })).toEqual({ ok: true });
    expect(itemIn(merc.inv, InvSlot.HAND)).not.toBe(grenade);
    const events = runUntilIdle(sim);
    expect(events.some((e) => e.type === 'explosion')).toBe(true);
    expect(before - merc.actionPoints).toBeGreaterThan(0);
    expect(before - merc.actionPoints).toBeLessThanOrEqual(apCost);
    expect(enemy.life).toBeLessThan(30);
    expect(t.turn.attackBusyCount).toBe(0);
  });

  it('refuses to aim a throw', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.HAND] = createItem(t.content.items, t.content.items.byName.get('HAND_GRENADE')?.index ?? -1, 100);
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: gridNo(80, 86), aimTime: 2 })).toEqual({
      ok: false,
      reason: 'throws cannot be aimed',
    });
  });
});

describe('AI grenade throws', () => {
  it('lets an enemy with a grenade throw it at two mercs standing together', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const a = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const b = spawnSoldier(sim, 1, Team.OUR, gridNo(81, 80), Direction.SOUTH);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 88), Direction.NORTH);
    enemy.inv[InvSlot.HAND] = createItem(t.content.items, t.content.items.byName.get('HAND_GRENADE')?.index ?? -1, 100);
    sim.lookAround();
    expect(t.inCombat).toBe(true);
    sim.drainEvents();
    expect(sim.dispatch({ type: 'endTurn' }).ok).toBe(true);
    const events = runUntilIdle(sim);
    expect(events.some((e) => e.type === 'explosion')).toBe(true);
    expect(a.life < 80 || b.life < 80).toBe(true);
  });
});

describe('LAW', () => {
  it('fires a rocket that explodes at the target and leaves a discarded tube', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { marksmanship: 90 });
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 88), Direction.NORTH, { life: 40 });
    merc.inv[InvSlot.HAND] = createItem(t.content.items, t.content.items.byName.get('ROCKET_LAUNCHER')?.index ?? -1, 100);
    sim.lookAround();
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo, aimTime: 2 })).toEqual({ ok: true });
    const events = runUntilIdle(sim);
    expect(events.some((e) => e.type === 'explosion')).toBe(true);
    expect(t.content.items.byIndex.get(itemIn(merc.inv, InvSlot.HAND))?.name).toBe('DISCARDED_LAW');
    expect(enemy.life).toBeLessThan(40);
    expect(t.turn.attackBusyCount).toBe(0);
  });
});
