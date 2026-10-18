import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { createItem } from '../../items/object.ts';
import { TurningFromProne, turnSoldier } from '../animation.ts';
import { eventFireSoldierWeapon, handleItem, ItemHandle } from '../combat/attack.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { NO_PENDING_ANIMATION, NO_PENDING_DIRECTION, type Soldier, Team } from '../soldier.ts';
import { Situation } from './actions.ts';
import { handleSystemNewAISituation } from './system-situation.ts';

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

function enemyOnHisTurn(weapon: string) {
  const sim = newCombatSim(content);
  const t = sim.state;
  const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
  const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 88), Direction.NORTH);
  enemy.inv[InvSlot.HAND] = createItem(content.items, itemIndex(weapon), 100);
  sim.lookAround();
  expect(t.inCombat).toBe(true);
  t.turn.currentTeam = Team.ENEMY;
  enemy.aiTurnControl = true;
  return { sim, t, merc, enemy };
}

function turnToShootAway(t: ReturnType<typeof enemyOnHisTurn>['t'], enemy: Soldier, target: number): void {
  enemy.direction = Direction.SOUTH;
  enemy.desiredDirection = Direction.SOUTH;
  eventFireSoldierWeapon(t, enemy, target);
  expect(enemy.turningToShoot).toBe(true);
  expect(t.turn.attackBusyCount).toBe(1);
}

describe('HandleSystemNewAISituation', () => {
  it('drops a turn to shoot at the look of a turning step and frees the attack', () => {
    const { t, merc, enemy } = enemyOnHisTurn('GLOCK_17');
    turnToShootAway(t, enemy, merc.gridNo);
    enemy.ai.newSituation = Situation.IS_NEW;
    enemy.lookOnNextTurn = true;
    turnSoldier(t, enemy);
    expect(enemy.turningToShoot).toBe(false);
    expect(enemy.dontUnsetLastTargetFromTurn).toBe(true);
    expect(t.turn.attackBusyCount).toBe(0);
  });

  it('puts back a grenade that has not left the hand and cancels the pending work', () => {
    const { t, merc, enemy } = enemyOnHisTurn('HAND_GRENADE');
    const grenade = itemIndex('HAND_GRENADE');
    expect(handleItem(t, enemy, merc.gridNo, 0, grenade)).toBe(ItemHandle.OK);
    expect(enemy.tempObject?.item).toBe(grenade);
    enemy.pendingDirection = Direction.EAST;
    enemy.turningFromPronePosition = TurningFromProne.ON;
    enemy.endDoorOpenCode = 1;
    enemy.ai.newSituation = Situation.IS_NEW;
    handleSystemNewAISituation(t, enemy);
    expect(enemy.tempObject).toBeNull();
    expect(carried(enemy, grenade)).toBe(1);
    expect(enemy.pendingAnimation).toBe(NO_PENDING_ANIMATION);
    expect(enemy.pendingDirection).toBe(NO_PENDING_DIRECTION);
    expect(enemy.turningFromPronePosition).toBe(TurningFromProne.OFF);
    expect(enemy.endDoorOpenCode).toBe(0);
    expect(t.turn.attackBusyCount).toBe(0);
  });

  it('keeps the attack of a soldier who is not the one under AI control', () => {
    const { t, merc, enemy } = enemyOnHisTurn('GLOCK_17');
    turnToShootAway(t, enemy, merc.gridNo);
    enemy.aiTurnControl = false;
    enemy.ai.newSituation = Situation.IS_NEW;
    handleSystemNewAISituation(t, enemy);
    expect(enemy.turningToShoot).toBe(true);
    expect(t.turn.attackBusyCount).toBe(1);
  });

  it('does nothing on our turn or without a new situation', () => {
    const { t, merc, enemy } = enemyOnHisTurn('GLOCK_17');
    turnToShootAway(t, enemy, merc.gridNo);
    enemy.ai.newSituation = Situation.WAS_NEW;
    handleSystemNewAISituation(t, enemy);
    expect(enemy.turningToShoot).toBe(true);
    t.turn.currentTeam = Team.OUR;
    enemy.ai.newSituation = Situation.IS_NEW;
    handleSystemNewAISituation(t, enemy);
    expect(enemy.turningToShoot).toBe(true);
    expect(t.turn.attackBusyCount).toBe(1);
  });
});
