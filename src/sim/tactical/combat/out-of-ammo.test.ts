import { beforeAll, describe, expect, it } from 'vitest';
import { estimateAttack, newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { createItem } from '../../items/object.ts';
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

describe('the attack refusal of an empty gun (noAmmo), where the original cursor turns into a reload', () => {
  function emptyGunAttack(s: Scene) {
    const gun = s.merc.inv[InvSlot.HAND];
    if (!gun) throw new Error('the merc has no gun');
    gun.gunShotsLeft = 0;
    const estimate = estimateAttack(s.sim, { soldier: s.merc.id, target: s.enemy.gridNo });
    const before = s.merc.actionPoints;
    const refused = s.sim.dispatch({ type: 'attack', soldier: s.merc.id, target: s.enemy.gridNo });
    expect(s.merc.actionPoints).toBe(before);
    return { estimate: (estimate.data as { ammo: { empty: boolean; canReload: boolean; reloadAp: number } }).ammo, refused };
  }

  it("carries the reload cursor's check and AP cost that estimateAttack gives, so the next step is a reload", () => {
    const s = scene();
    s.merc.inv[InvSlot.BIGPOCK1] = createItem(content.items, content.items.byName.get('CLIP9_15')?.index ?? -1, 100);
    const { estimate, refused } = emptyGunAttack(s);
    expect(estimate).toMatchObject({ empty: true, canReload: true });
    expect(estimate.reloadAp).toBeGreaterThan(0);
    expect(refused).toEqual({
      ok: false,
      reason: 'out of ammo',
      data: { refusal: 'noAmmo', canReload: true, reloadAp: estimate.reloadAp },
    });
    expect(s.sim.dispatch({ type: 'reload', soldier: s.merc.id }).ok).toBe(true);
  });

  it('says when no matching ammunition is in the inventory', () => {
    const { estimate, refused } = emptyGunAttack(scene());
    expect(estimate).toEqual({ empty: true, canReload: false, reloadAp: 0 });
    expect(refused).toMatchObject({ ok: false, data: { refusal: 'noAmmo', canReload: false, reloadAp: 0 } });
  });
});
