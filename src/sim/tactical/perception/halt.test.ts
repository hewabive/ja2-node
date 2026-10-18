import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { createItem } from '../../items/object.ts';
import { states } from '../animation.ts';
import { eventFireSoldierWeapon, handleItem, ItemHandle } from '../combat/attack.ts';
import { eventSoldierBeginBladeAttack } from '../combat/melee.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { NO_PENDING_ANIMATION, type Soldier, Team } from '../soldier.ts';
import { haltFromSighting } from './wiring.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function itemIndex(name: string): number {
  return content.items.byName.get(name)?.index ?? -1;
}

function carried(s: Soldier, item: number): number {
  return s.inv.reduce((n, o) => (o?.item === item ? n + o.count : n), 0);
}

function enemyFacingMerc(weapon: string) {
  const sim = newCombatSim(content);
  const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
  const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 88), Direction.NORTH);
  enemy.inv[InvSlot.HAND] = createItem(content.items, itemIndex(weapon), 100);
  sim.lookAround();
  expect(sim.state.inCombat).toBe(true);
  return { sim, t: sim.state, merc, enemy };
}

describe('HaultSoldierFromSighting in combat', () => {
  it('puts a grenade that has not left the hand back and frees the attack', () => {
    const { t, merc, enemy } = enemyFacingMerc('HAND_GRENADE');
    const grenade = itemIndex('HAND_GRENADE');
    expect(handleItem(t, enemy, merc.gridNo, 0, grenade)).toBe(ItemHandle.OK);
    expect(enemy.tempObject?.item).toBe(grenade);
    expect(carried(enemy, grenade)).toBe(0);
    expect(t.turn.attackBusyCount).toBe(1);
    haltFromSighting(t, enemy, true);
    expect(enemy.tempObject).toBeNull();
    expect(enemy.pendingAnimation).toBe(NO_PENDING_ANIMATION);
    expect(carried(enemy, grenade)).toBe(1);
    expect(t.turn.attackBusyCount).toBe(0);
    expect(enemy.noAPToFinishMove).toBe(true);
  });

  it('keeps a grenade throw going when only an item was sighted', () => {
    const { t, merc, enemy } = enemyFacingMerc('HAND_GRENADE');
    expect(handleItem(t, enemy, merc.gridNo, 0, itemIndex('HAND_GRENADE'))).toBe(ItemHandle.OK);
    haltFromSighting(t, enemy, false);
    expect(enemy.tempObject).not.toBeNull();
    expect(t.turn.attackBusyCount).toBe(1);
  });

  it('frees a stab that waits for the stance change', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 81), Direction.NORTH);
    enemy.inv[InvSlot.HAND] = createItem(content.items, itemIndex('COMBAT_KNIFE'), 100);
    sim.lookAround();
    expect(sim.dispatch({ type: 'stance', soldier: merc.id, stance: 'prone' }).ok).toBe(true);
    runUntilIdle(sim);
    expect(merc.state).toBe(states(content.animations).PRONE);
    eventSoldierBeginBladeAttack(t, enemy, merc.gridNo, Direction.NORTH);
    expect(content.animations.controls[enemy.pendingAnimation]?.id).toBe('CROUCH_STAB');
    expect(t.turn.attackBusyCount).toBe(1);
    haltFromSighting(t, enemy, true);
    expect(enemy.pendingAnimation).toBe(NO_PENDING_ANIMATION);
    expect(t.turn.attackBusyCount).toBe(0);
  });

  it('stops a turn to shoot and frees the attack', () => {
    const { t, merc, enemy } = enemyFacingMerc('GLOCK_17');
    enemy.direction = Direction.SOUTH;
    enemy.desiredDirection = Direction.SOUTH;
    eventFireSoldierWeapon(t, enemy, merc.gridNo);
    expect(enemy.turningToShoot).toBe(true);
    expect(t.turn.attackBusyCount).toBe(1);
    haltFromSighting(t, enemy, true);
    expect(enemy.turningToShoot).toBe(false);
    expect(t.turn.attackBusyCount).toBe(0);
  });
});
