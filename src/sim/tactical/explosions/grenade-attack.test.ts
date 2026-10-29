import { beforeAll, describe, expect, it } from 'vitest';
import { estimateAttack, newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { createItem, type ItemObject } from '../../items/object.ts';
import { animName } from '../anim-states.ts';
import { minAPsToThrow } from '../combat/ap.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot, itemIn } from '../inventory.ts';
import { calcActionPoints } from '../points.ts';
import { Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { enterCombatMode } from '../turns/turns.ts';

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
    const estimate = estimateAttack(sim, { soldier: 0, target: enemy.gridNo });
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

  it('stands a prone thrower up to turn and throw without lying down again in between', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 87), Direction.NORTH);
    merc.inv[InvSlot.HAND] = createItem(t.content.items, t.content.items.byName.get('HAND_GRENADE')?.index ?? -1, 100);
    sim.lookAround();
    expect(sim.dispatch({ type: 'stance', soldier: 0, stance: 'prone' }).ok).toBe(true);
    runUntilIdle(sim);
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: gridNo(80, 72) })).toEqual({ ok: true });
    const seen: string[] = [];
    let exploded = false;
    for (let tick = 0; tick < 20_000 && !(exploded && sim.isIdle()); tick++) {
      sim.step();
      const name = animName(t.content, merc.state);
      if (seen.at(-1) !== name) seen.push(name);
      exploded ||= sim.drainEvents().some((e) => e.type === 'explosion');
    }
    expect(exploded).toBe(true);
    const thrown = seen.indexOf('THROW_ITEM');
    expect(thrown).toBeGreaterThan(0);
    expect(seen.slice(0, thrown)).not.toContain('PRONE_DOWN');
    expect(merc.tempObject).toBeNull();
    expect(t.turn.attackBusyCount).toBe(0);
  });

  it('charges a second throw at the same tile for a new target: the throw animation forgets the last target', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const grenades = createItem(t.content.items, t.content.items.byName.get('HAND_GRENADE')?.index ?? -1, 100);
    grenades.count = 2;
    grenades.status = [100, 100];
    merc.inv[InvSlot.HAND] = grenades;
    spawnSoldier(sim, 20, Team.ENEMY, gridNo(70, 100), Direction.NORTH);
    sim.lookAround();
    expect(t.inCombat).toBe(true);
    const target = gridNo(80, 88);
    const throwAt = () => {
      merc.actionPoints = calcActionPoints(merc);
      const before = merc.actionPoints;
      expect(sim.dispatch({ type: 'attack', soldier: 0, target })).toEqual({ ok: true });
      runUntilIdle(sim);
      return before - merc.actionPoints;
    };
    const first = throwAt();
    expect(merc.lastTarget).toBe(target);
    const sameTargetCost = minAPsToThrow(t, merc, target);
    expect(sameTargetCost).toBeLessThan(first);
    expect(throwAt()).toBe(first);
  });

  it('refuses to aim a throw', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.HAND] = createItem(t.content.items, t.content.items.byName.get('HAND_GRENADE')?.index ?? -1, 100);
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: gridNo(80, 86), aimTime: 2 })).toEqual({
      ok: false,
      reason: 'throws cannot be aimed',
      data: { refusal: 'throwNoAim' },
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

describe('launchers through the attack command', () => {
  function launcherWithRound(sim: TacticalSim, launcher: string, round: string): ItemObject {
    const items = sim.state.content.items;
    const loaded = createItem(items, items.byName.get(launcher)?.index ?? -1, 100);
    const slot = loaded.attachments[0];
    if (!slot) throw new Error('no attachment slot');
    slot.item = items.byName.get(round)?.index ?? -1;
    slot.status = 100;
    return loaded;
  }

  function fireMortar(crouchFirst: boolean) {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.HAND] = launcherWithRound(sim, 'MORTAR', 'MORTAR_SHELL');
    spawnSoldier(sim, 20, Team.ENEMY, gridNo(70, 100), Direction.NORTH);
    sim.lookAround();
    enterCombatMode(t, Team.OUR);
    sim.drainEvents();
    if (crouchFirst) {
      expect(sim.dispatch({ type: 'stance', soldier: 0, stance: 'crouch' }).ok).toBe(true);
      runUntilIdle(sim);
    }
    const before = merc.actionPoints;
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: gridNo(80, 100) })).toEqual({ ok: true });
    expect(runUntilIdle(sim).some((e) => e.type === 'explosion')).toBe(true);
    expect(animName(t.content, merc.state)).toBe('CROUCHING');
    return { sim, merc, spent: before - merc.actionPoints };
  }

  it('kneels a standing merc down for the mortar without charging the stance change', () => {
    expect(fireMortar(false).spent).toBe(fireMortar(true).spent);
  });

  it("lets a merc who fired the mortar from a crouch stand up for free: the order's free stance change waits for the next one", () => {
    const { sim, merc } = fireMortar(true);
    const before = merc.actionPoints;
    expect(sim.dispatch({ type: 'stance', soldier: 0, stance: 'stand' }).ok).toBe(true);
    runUntilIdle(sim);
    expect(animName(sim.state.content, merc.state)).toBe('STANDING');
    expect(merc.actionPoints).toBe(before);
  });

  it('refuses a launcher without a round, which the original cursor turns into a reload', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.HAND] = createItem(t.content.items, t.content.items.byName.get('GLAUNCHER')?.index ?? -1, 100);
    spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 95), Direction.NORTH);
    sim.lookAround();
    expect(t.inCombat).toBe(true);
    const before = merc.actionPoints;
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: gridNo(80, 95) })).toMatchObject({ ok: false, data: { refusal: 'noAmmo' } });
    expect(t.turn.attackBusyCount).toBe(0);
    expect(merc.actionPoints).toBe(before);
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
