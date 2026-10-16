import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import type { SimEvent } from '../../events.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { chanceOfBulletHittingStructure } from './bullets.ts';
import { adjustImpactByHitLocation } from './impact.ts';
import { AimShot } from './types.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const newSim = (walls: readonly number[] = []) => newCombatSim(content, walls);
const spawn = (sim: TacticalSim, id: number, team: number, at: number, direction: number, marksmanship = 70, life = 80) =>
  spawnSoldier(sim, id, team, at, direction, { marksmanship, life });
const run = runUntilIdle;

describe('damage and structure rules', () => {
  it('scales head and leg hits like the original float maths', () => {
    expect(adjustImpactByHitLocation(21, AimShot.HEAD)).toEqual({ impact: 31, crits: 31 });
    expect(adjustImpactByHitLocation(21, AimShot.LEGS)).toEqual({ impact: 5, crits: 10 });
    expect(adjustImpactByHitLocation(21, AimShot.TORSO)).toEqual({ impact: 21, crits: 21 });
  });

  it('makes cover near the target likelier to stop a bullet than cover near the shooter', () => {
    expect(chanceOfBulletHittingStructure(30, 200, 10)).toBe(2);
    expect(chanceOfBulletHittingStructure(180, 200, 10)).toBe(76);
    expect(chanceOfBulletHittingStructure(100, 200, -5)).toBe(40);
    expect(chanceOfBulletHittingStructure(260, 300, 10)).toBe(90);
  });
});

describe('gun attacks', () => {
  it('charges the estimated APs, fires one bullet and releases the attack barrier', () => {
    const sim = newSim();
    const t = sim.state;
    const merc = spawn(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawn(sim, 20, Team.ENEMY, gridNo(80, 86), Direction.NORTH);
    sim.lookAround();
    expect(t.inCombat).toBe(true);
    sim.drainEvents();
    const estimate = sim.dispatch({ type: 'estimateAttack', soldier: 0, target: enemy.gridNo, aimTime: 2 });
    expect(estimate.ok).toBe(true);
    const { apCost, chanceToHit, chanceToGetThrough } = estimate.data as {
      apCost: number;
      chanceToHit: number;
      chanceToGetThrough: number;
    };
    expect(chanceToGetThrough).toBe(100);
    expect(chanceToHit).toBeGreaterThan(0);
    const before = merc.actionPoints;
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo, aimTime: 2 })).toEqual({ ok: true });
    const events = run(sim);
    const shot = events.find((e) => e.type === 'shotFired');
    expect(shot).toMatchObject({ soldier: 0, target: enemy.gridNo, chance: chanceToHit });
    expect(events.at(-1)?.type).toBe('attackResolved');
    expect(before - merc.actionPoints).toBe(apCost);
    expect(t.turn.attackBusyCount).toBe(0);
    expect(merc.bulletsLeft).toBe(0);
    expect(t.bullets).toEqual([]);
    expect(merc.inv[InvSlot.HAND]?.gunShotsLeft).toBe(14);
  });

  it('kills a weakened enemy, drops his gear and wins the battle', () => {
    const sim = newSim();
    const t = sim.state;
    spawn(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, 100);
    const enemy = spawn(sim, 20, Team.ENEMY, gridNo(80, 83), Direction.NORTH, 70, 3);
    sim.lookAround();
    sim.drainEvents();
    const all: SimEvent[] = [];
    for (let shot = 0; shot < 3 && enemy.placed; shot++) {
      expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo, aimTime: 4 }).ok).toBe(true);
      all.push(...run(sim));
    }
    expect(all.some((e) => e.type === 'soldierHit' && e.soldier === enemy.id)).toBe(true);
    expect(all.find((e) => e.type === 'soldierDied')).toMatchObject({ soldier: enemy.id, killer: 0 });
    expect(enemy.placed).toBe(false);
    expect(t.corpses).toHaveLength(1);
    expect(t.worldItems.some((i) => i.gridNo === enemy.gridNo)).toBe(true);
    expect(all.some((e) => e.type === 'combatEnded')).toBe(true);
    expect(t.inCombat).toBe(false);
  });

  it('refuses new orders while an attack resolves', () => {
    const sim = newSim();
    spawn(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    spawn(sim, 1, Team.OUR, gridNo(82, 80), Direction.SOUTH);
    const enemy = spawn(sim, 20, Team.ENEMY, gridNo(80, 90), Direction.NORTH);
    sim.lookAround();
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo }).ok).toBe(true);
    for (let i = 0; i < 20; i++) sim.step();
    expect(sim.state.turn.attackBusyCount).toBeGreaterThan(0);
    expect(sim.dispatch({ type: 'move', soldier: 1, to: gridNo(84, 80) })).toEqual({ ok: false, reason: 'an attack is still resolving' });
    run(sim);
    expect(sim.dispatch({ type: 'move', soldier: 1, to: gridNo(84, 80) }).ok).toBe(true);
  });

  it('stops bullets in a wall between shooter and target', () => {
    const wallRow = 84;
    const walls = Array.from({ length: 9 }, (_, k) => gridNo(76 + k, wallRow));
    const sim = newSim(walls);
    const t = sim.state;
    const merc = spawn(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawn(sim, 20, Team.ENEMY, gridNo(80, 88), Direction.NORTH);
    t.inCombat = true;
    merc.oppList[enemy.id] = 1;
    const estimate = sim.dispatch({ type: 'estimateAttack', soldier: 0, target: enemy.gridNo });
    expect((estimate.data as { chanceToGetThrough: number }).chanceToGetThrough).toBe(0);
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo }).ok).toBe(true);
    const events = run(sim);
    expect(events.find((e) => e.type === 'bulletStopped')).toMatchObject({ reason: 'structure' });
    expect(events.some((e) => e.type === 'soldierHit')).toBe(false);
    expect(enemy.life).toBe(80);
  });
});
