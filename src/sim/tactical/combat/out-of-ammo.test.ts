import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { MercQuote } from '../narrative/merc-quotes.ts';
import { type Soldier, Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { enterCombatMode } from '../turns/turns.ts';
import { reduceAttackBusyCount } from './barrier.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

interface Scene {
  readonly sim: TacticalSim;
  readonly merc: Soldier;
  readonly enemy: Soldier;
  readonly said: [number, number][];
}

function scene(): Scene {
  const sim = newCombatSim(content);
  const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { profile: 4 });
  const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 86), Direction.NORTH, { life: 100 });
  const t = sim.state;
  const said: [number, number][] = [];
  t.narrative = { ...t.narrative, sayQuote: (s, quote) => said.push([s.id, quote]) };
  enterCombatMode(t, Team.OUR);
  return { sim, merc, enemy, said };
}

function shoot(s: Scene, bulletsLeft: number): [number, number][] {
  const gun = s.merc.inv[InvSlot.HAND];
  if (!gun) throw new Error('the merc has no gun');
  gun.gunShotsLeft = bulletsLeft;
  expect(s.sim.dispatch({ type: 'attack', soldier: s.merc.id, target: s.enemy.gridNo, aimTime: 0 }).ok).toBe(true);
  runUntilIdle(s.sim);
  return s.said.filter(([, quote]) => quote === MercQuote.OUT_OF_AMMO);
}

describe('the out-of-ammo quote (Weapons.cc UseGun, Overhead.cc InternalReduceAttackBusyCount)', () => {
  it('has our merc who fired his last bullet say so once the attack is over', () => {
    const s = scene();
    expect(shoot(s, 1)).toEqual([[s.merc.id, MercQuote.OUT_OF_AMMO]]);
    expect(s.merc.sayAmmoQuotePending).toBe(false);
    expect(shoot(scene(), 2)).toEqual([]);
  });

  it('waits while another attack keeps the busy count up', () => {
    const s = scene();
    s.merc.sayAmmoQuotePending = true;
    s.sim.state.turn.attackBusyCount = 2;
    reduceAttackBusyCount(s.sim.state, s.merc, false);
    expect([s.said, s.merc.sayAmmoQuotePending]).toEqual([[], true]);
    reduceAttackBusyCount(s.sim.state, s.merc, false);
    expect(s.said).toEqual([[s.merc.id, MercQuote.OUT_OF_AMMO]]);
  });
});
