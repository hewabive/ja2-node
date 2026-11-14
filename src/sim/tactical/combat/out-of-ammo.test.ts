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

describe('the click of the bad reload cursor (Turn_Based_Input.cc HandleUIReloading)', () => {
  function withPicks(s: Scene, rolls: number[]): number[] {
    const picks: number[] = [];
    s.sim.state.narrative = {
      ...s.sim.state.narrative,
      cosmeticPick: (n) => {
        picks.push(n);
        return rolls.shift() ?? n - 1;
      },
    };
    return picks;
  }

  function loaded(s: Scene, bulletsLeft: number): Scene {
    const gun = s.merc.inv[InvSlot.HAND];
    if (!gun) throw new Error('the merc has no gun');
    gun.gunShotsLeft = bulletsLeft;
    return s;
  }

  it('is taken without a reload, the merc saying he is out of ammo on Random(3) == 0 drawn on the talk session', () => {
    const said = loaded(scene(), 0);
    const picks = withPicks(said, [0]);
    const before = said.merc.actionPoints;
    expect(said.sim.dispatch({ type: 'reload', soldier: said.merc.id, cursor: true })).toEqual({ ok: true, data: { reloaded: false } });
    expect([picks, said.said, said.merc.actionPoints]).toEqual([[3], [[said.merc.id, MercQuote.OUT_OF_AMMO]], before]);
    const silent = loaded(scene(), 0);
    withPicks(silent, [1]);
    expect(silent.sim.dispatch({ type: 'reload', soldier: silent.merc.id, cursor: true }).ok).toBe(true);
    expect(silent.said).toEqual([]);
  });

  it('leaves a plain reload refused with noAmmo and undrawn, and a gun with rounds left to the plain reload', () => {
    const plain = loaded(scene(), 0);
    const picks = withPicks(plain, [0]);
    expect(plain.sim.dispatch({ type: 'reload', soldier: plain.merc.id })).toMatchObject({ ok: false, data: { refusal: 'noAmmo' } });
    const notEmpty = loaded(scene(), 5);
    const notEmptyPicks = withPicks(notEmpty, [0]);
    const cursor = { type: 'reload', soldier: notEmpty.merc.id, cursor: true };
    expect(notEmpty.sim.dispatch(cursor)).toMatchObject({ ok: false, data: { refusal: 'noAmmo' } });
    expect([picks, plain.said, notEmptyPicks, notEmpty.said]).toEqual([[], [], [], []]);
  });

  it('reloads as the plain reload does when ammunition is carried (the good reload cursor)', () => {
    const s = loaded(scene(), 0);
    const picks = withPicks(s, [0]);
    s.merc.inv[InvSlot.BIGPOCK1] = createItem(content.items, content.items.byName.get('CLIP9_15')?.index ?? -1, 100);
    expect(s.sim.dispatch({ type: 'reload', soldier: s.merc.id, cursor: true })).toMatchObject({ ok: true, data: { shots: 15 } });
    expect([picks, s.said]).toEqual([[], []]);
  });
});
