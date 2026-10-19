import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { AmmoType } from '../../../content/items/items.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import type { SimEvent } from '../../events.ts';
import { createItem } from '../../items/object.ts';
import { animName } from '../anim-states.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { type Soldier, Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

type ShotFired = Extract<SimEvent, { type: 'shotFired' }>;

function standoff(gun: string, distance: number, marksmanship: number): { sim: TacticalSim; merc: Soldier; enemy: Soldier } {
  const sim = newCombatSim(content);
  const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { gun, marksmanship });
  const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 80 + distance), Direction.NORTH);
  sim.lookAround();
  sim.drainEvents();
  return { sim, merc, enemy };
}

function apCostOf(sim: TacticalSim, cmd: Record<string, unknown>): number {
  const estimate = sim.dispatch({ type: 'estimateAttack', soldier: 0, ...cmd });
  expect(estimate.ok).toBe(true);
  return (estimate.data as { apCost: number }).apCost;
}

function stepRecording(sim: TacticalSim, s: Soldier, maxTicks = 20_000): Set<string> {
  const seen = new Set<string>();
  for (let i = 0; i < maxTicks && !sim.isIdle(); i++) {
    sim.step();
    seen.add(animName(sim.state.content, s.state));
  }
  return seen;
}

describe('bursts', () => {
  it('fires shotsPerBurst rounds, pays the burst APs once and adds the burst penalty from round 2', () => {
    const { sim, merc, enemy } = standoff('MP5K', 15, 60);
    const t = sim.state;
    const apCost = apCostOf(sim, { target: enemy.gridNo, burst: true });
    const before = merc.actionPoints;
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo, burst: true })).toEqual({ ok: true });
    const events = runUntilIdle(sim);
    const shots = events.filter((e): e is ShotFired => e.type === 'shotFired');
    expect(shots).toHaveLength(5);
    const [round1, round2] = shots;
    expect((round1?.chance ?? 0) - (round2?.chance ?? 0)).toBe(8);
    expect(before - merc.actionPoints).toBe(apCost);
    expect(merc.inv[InvSlot.HAND]?.gunShotsLeft).toBe(25);
    expect(merc.bulletsLeft).toBe(0);
    expect(merc.doBurst).toBe(1);
    expect(t.turn.attackBusyCount).toBe(0);
    expect(events.at(-1)?.type).toBe('attackResolved');
  });

  it('makes a standing target hit by a burst play STANDING_BURST_HIT', () => {
    const { sim, enemy } = standoff('MP5K', 4, 100);
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo, burst: true, bodyPart: 'torso' }).ok).toBe(true);
    expect(stepRecording(sim, enemy)).toContain('STANDING_BURST_HIT');
    runUntilIdle(sim);
    expect(sim.state.turn.attackBusyCount).toBe(0);
  });

  it('refuses a burst with a gun that has no burst mode', () => {
    const { sim, enemy } = standoff('GLOCK_17', 5, 70);
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo, burst: true })).toEqual({
      ok: false,
      reason: 'this weapon cannot fire bursts',
      data: { refusal: 'noBurst' },
    });
  });
});

describe('buckshot and two pistols', () => {
  it('fires nine buckshot pellets for one shell', () => {
    const { sim, merc, enemy } = standoff('M870', 6, 70);
    const t = sim.state;
    const gun = merc.inv[InvSlot.HAND];
    if (gun) gun.gunAmmoType = AmmoType.BUCKSHOT;
    const shellsBefore = gun?.gunShotsLeft ?? 0;
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo })).toEqual({ ok: true });
    let pellets = 0;
    for (let i = 0; i < 2_000 && pellets === 0; i++) {
      sim.step();
      if (sim.drainEvents().some((e) => e.type === 'shotFired')) pellets = t.bullets.filter((b) => b.firer === merc).length;
    }
    expect(pellets).toBe(9);
    runUntilIdle(sim);
    expect(gun?.gunShotsLeft).toBe(shellsBefore - 1);
    expect(merc.bulletsLeft).toBe(0);
    expect(t.turn.attackBusyCount).toBe(0);
  });

  it('fires both pistols, the main hand first, and pays only for the main hand', () => {
    const { sim, merc, enemy } = standoff('GLOCK_17', 8, 70);
    const glock = content.items.byName.get('GLOCK_17')?.index ?? 0;
    merc.inv[InvSlot.SECOND_HAND] = createItem(content.items, glock, 100);
    const apCost = apCostOf(sim, { target: enemy.gridNo });
    const before = merc.actionPoints;
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo })).toEqual({ ok: true });
    const seen = stepRecording(sim, merc);
    expect(seen).toContain('SHOOT_DUAL_STAND');
    runUntilIdle(sim);
    expect(before - merc.actionPoints).toBe(apCost);
    expect(merc.inv[InvSlot.HAND]?.gunShotsLeft).toBe(14);
    expect(merc.inv[InvSlot.SECOND_HAND]?.gunShotsLeft).toBe(14);
    expect(merc.attackingHand).toBe(InvSlot.HAND);
  });
});
