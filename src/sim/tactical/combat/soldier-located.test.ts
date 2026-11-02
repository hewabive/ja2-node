import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import type { SimEvent } from '../../events.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { type Soldier, Team, Visible } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { eventFireSoldierWeapon } from './attack.ts';
import { eventSoldierGotHit } from './hit.ts';
import { Special } from './types.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const MERC_AT = gridNo(80, 80);
const ENEMY_AT = gridNo(80, 88);
const GRAZE = 5;

interface Duel {
  readonly sim: TacticalSim;
  readonly merc: Soldier;
  readonly enemy: Soldier;
}

function duel(gun = 'GLOCK_17'): Duel {
  const sim = newCombatSim(content);
  const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH);
  const enemy = spawnSoldier(sim, 20, Team.ENEMY, ENEMY_AT, Direction.NORTH, { gun });
  sim.lookAround();
  sim.drainEvents();
  return { sim, merc, enemy };
}

function located(sim: TacticalSim): SimEvent[] {
  return sim.drainEvents().filter((e) => e.type === 'soldierLocated');
}

function turnToShoot(sim: TacticalSim, s: Soldier, target: Soldier): void {
  s.direction = Direction.EAST;
  s.desiredDirection = Direction.EAST;
  eventFireSoldierWeapon(sim.state, s, target.gridNo);
}

function hit(sim: TacticalSim, victim: Soldier, attacker: Soldier): void {
  const gun = attacker.inv[InvSlot.HAND]?.item ?? 0;
  eventSoldierGotHit(sim.state, victim, gun, GRAZE, 0, Direction.NORTH, 1, attacker, Special.NONE, 0);
}

describe('the soldiers the view moves to in a fight (LocateSoldier)', () => {
  it('moves the view to a seen enemy who turns to shoot, without a locator (EVENT_FireSoldierWeapon)', () => {
    const { sim, merc, enemy } = duel();
    expect(enemy.visible).not.toBe(Visible.HIDDEN);
    turnToShoot(sim, enemy, merc);
    expect(enemy.turningToShoot).toBe(true);
    expect(located(sim)).toMatchObject([{ type: 'soldierLocated', soldier: enemy.id, locator: 'none' }]);
  });

  it('moves it to a seen militia soldier turning to shoot out of combat too: every team but ours counts', () => {
    const { sim, merc, enemy } = duel();
    const militia = spawnSoldier(sim, 40, Team.MILITIA, gridNo(80, 76), Direction.SOUTH);
    militia.visible = Visible.SEEN;
    sim.state.inCombat = false;
    turnToShoot(sim, militia, enemy);
    expect(located(sim)).toMatchObject([{ type: 'soldierLocated', soldier: militia.id, locator: 'none' }]);
    expect(merc.turningToShoot).toBe(false);
  });

  it('does not move it to our merc turning to shoot, to an unseen enemy, or to a launcher fired at once', () => {
    const ours = duel();
    turnToShoot(ours.sim, ours.merc, ours.enemy);
    expect([ours.merc.turningToShoot, located(ours.sim)]).toEqual([true, []]);
    const unseen = duel();
    unseen.enemy.visible = Visible.HIDDEN;
    turnToShoot(unseen.sim, unseen.enemy, unseen.merc);
    expect([unseen.enemy.turningToShoot, located(unseen.sim)]).toEqual([true, []]);
    const launcher = duel('ROCKET_LAUNCHER');
    turnToShoot(launcher.sim, launcher.enemy, launcher.merc);
    expect([launcher.enemy.turningToShoot, located(launcher.sim)]).toEqual([false, []]);
  });

  it('moves the view to our merc hit in combat, without a locator, but not out of combat or to a hit enemy (EVENT_SoldierGotHit)', () => {
    const { sim, merc, enemy } = duel();
    expect(sim.state.inCombat).toBe(true);
    hit(sim, merc, enemy);
    expect(located(sim)).toMatchObject([{ type: 'soldierLocated', soldier: merc.id, locator: 'none' }]);
    hit(sim, enemy, merc);
    expect(located(sim)).toEqual([]);
    sim.state.inCombat = false;
    hit(sim, merc, enemy);
    expect(located(sim)).toEqual([]);
  });
});
