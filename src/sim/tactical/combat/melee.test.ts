import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { PreRandom, Rng } from '../../../core/rng.ts';
import type { SimEvent } from '../../events.ts';
import { emptyObject } from '../../items/object.ts';
import { animName } from '../anim-states.ts';
import { AnimHeight, initNewSoldierAnim, states } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { Opp } from '../perception/opp.ts';
import { effectiveExpLevel, effectiveStrength } from '../skills.ts';
import { type Soldier, Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { calcChanceToStab, hthImpact, useBlade } from './melee.ts';
import { AiMorale, AimShot } from './types.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

type EventOf<K extends SimEvent['type']> = Extract<SimEvent, { type: K }>;

const KNIFE = 'COMBAT_KNIFE';
const KNIFE_IMPACT = 18;

function master(s: Soldier): void {
  Object.assign(s.stats, { agility: 100, dexterity: 100, strength: 100, experience: 10 });
}

function novice(s: Soldier): void {
  Object.assign(s.stats, { agility: 1, dexterity: 1, strength: 1, experience: 1 });
}

function duel(attackerHand: string | null, targetAt: number, attackerFacing: number): { sim: TacticalSim; merc: Soldier; enemy: Soldier } {
  const sim = newCombatSim(content);
  const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), attackerFacing, { gun: attackerHand ?? KNIFE });
  if (attackerHand === null) merc.inv[InvSlot.HAND] = emptyObject();
  const enemy = spawnSoldier(sim, 20, Team.ENEMY, targetAt, Direction.NORTH);
  sim.lookAround();
  sim.drainEvents();
  return { sim, merc, enemy };
}

function first<K extends SimEvent['type']>(events: readonly SimEvent[], type: K): EventOf<K> | undefined {
  return events.find((e): e is EventOf<K> => e.type === type);
}

describe('melee chance and impact', () => {
  it('compares close-combat ratings like CalcChanceHTH', () => {
    const { sim, merc, enemy } = duel(KNIFE, gridNo(80, 81), Direction.SOUTH);
    const t = sim.state;
    enemy.ai.morale = AiMorale.NORMAL;
    merc.attackingWeapon = merc.inv[InvSlot.HAND]?.item ?? 0;
    merc.aimShotLocation = AimShot.TORSO;
    expect(calcChanceToStab(t, merc, enemy, 0)).toBe(67);
    expect(calcChanceToStab(t, merc, enemy, 2)).toBe(70);
    merc.aimShotLocation = AimShot.HEAD;
    expect(calcChanceToStab(t, merc, enemy, 0)).toBe(47);
    merc.aimShotLocation = AimShot.TORSO;
    enemy.ai.morale = AiMorale.HOPELESS;
    expect(calcChanceToStab(t, merc, enemy, 0)).toBe(72);
    enemy.breath = 5;
    expect(calcChanceToStab(t, merc, enemy, 0)).toBe(100);
  });

  it('adds strength, level and the knife impact, then a fluke from PreRandom(51)', () => {
    const { sim, merc, enemy } = duel(KNIFE, gridNo(80, 81), Direction.SOUTH);
    const t = sim.state;
    merc.attackingWeapon = merc.inv[InvSlot.HAND]?.item ?? 0;
    const clone = PreRandom.fromState(t.pre.state(), Rng.fromState(t.rng.state()));
    const fluke = clone.int(51) - 25;
    const base = Math.trunc(effectiveExpLevel(merc) / 2) + Math.trunc(effectiveStrength(merc) / 20) + KNIFE_IMPACT;
    expect(hthImpact(t, merc, enemy, 30, true)).toBe(Math.trunc((base * (100 + fluke + 15)) / 100));
  });
});

describe('knife attacks', () => {
  it('stabs an adjacent enemy, charges the estimated APs and delivers the hit 25 ms later', () => {
    const { sim, merc, enemy } = duel(KNIFE, gridNo(80, 81), Direction.SOUTH);
    const t = sim.state;
    master(merc);
    novice(enemy);
    const estimate = sim.dispatch({ type: 'estimateAttack', soldier: 0, target: enemy.gridNo });
    expect(estimate.ok).toBe(true);
    const { apCost, chanceToHit, inReach } = estimate.data as { apCost: number; chanceToHit: number; inReach: boolean };
    expect(inReach).toBe(true);
    expect(chanceToHit).toBe(99);
    const before = merc.actionPoints;
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo })).toEqual({ ok: true });
    const events = runUntilIdle(sim);
    const strike = first(events, 'meleeStrike');
    const hit = first(events, 'soldierHit');
    expect(strike).toMatchObject({ soldier: 0, target: enemy.gridNo, weapon: 'blade', chance: 99, hit: true });
    expect(hit).toMatchObject({ soldier: enemy.id, attacker: 0, breathLoss: 200 });
    expect((hit?.tick ?? 0) - (strike?.tick ?? 0)).toBe(5);
    expect(enemy.life).toBe(80 - (hit?.damage ?? 0));
    expect(before - merc.actionPoints).toBe(apCost);
    expect(merc.inv[InvSlot.HAND]?.status[0]).toBeGreaterThanOrEqual(90);
    expect(events.at(-1)?.type).toBe('attackResolved');
    expect(t.turn.attackBusyCount).toBe(0);
    expect(t.gameEvents).toEqual([]);
    expect(animName(t.content, merc.state)).toBe('KNIFE_BREATH');
  });

  it('cannot stab a diagonal neighbour or anyone further away without walking', () => {
    const { sim, merc } = duel(KNIFE, gridNo(81, 81), Direction.SOUTHEAST);
    const before = merc.actionPoints;
    const estimate = sim.dispatch({ type: 'estimateAttack', soldier: 0, target: gridNo(81, 81) });
    expect(estimate.data).toMatchObject({ apCost: 0, inReach: false });
    const refused = sim.dispatch({ type: 'attack', soldier: 0, target: gridNo(81, 81) });
    expect(refused.ok).toBe(false);
    expect(merc.actionPoints).toBe(before);
    expect(sim.state.turn.attackBusyCount).toBe(0);
  });

  it('frees the attacker at once when the stab misses', () => {
    const { sim, merc, enemy } = duel(KNIFE, gridNo(80, 81), Direction.SOUTH);
    const t = sim.state;
    novice(merc);
    master(enemy);
    merc.attackingWeapon = merc.inv[InvSlot.HAND]?.item ?? 0;
    merc.aimShotLocation = AimShot.HEAD;
    merc.targetLevel = 0;
    merc.actionPoints = 100;
    let missed = false;
    for (let attempt = 0; attempt < 20 && !missed; attempt++) {
      t.turn.attackBusyCount = 1;
      t.gameEvents.length = 0;
      useBlade(t, merc, enemy.gridNo);
      const strike = t.events.filter((e) => e.type === 'meleeStrike').at(-1);
      missed = strike?.type === 'meleeStrike' && !strike.hit;
      if (missed) {
        expect(t.turn.attackBusyCount).toBe(0);
        expect(t.gameEvents).toEqual([]);
      } else expect(t.gameEvents).toMatchObject([{ kind: 'weaponHit', soldier: enemy.id, attacker: merc.id, delay: 20 }]);
    }
    expect(missed).toBe(true);
  });

  it('stabs a prone enemy from a crouch', () => {
    const { sim, merc, enemy } = duel(KNIFE, gridNo(80, 81), Direction.SOUTH);
    const t = sim.state;
    enemy.state = states(t.content.animations).PRONE;
    initNewSoldierAnim(t, enemy, enemy.state, 0, true);
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo }).ok).toBe(true);
    const seen: string[] = [];
    for (let i = 0; i < 400 && !sim.isIdle(); i++) {
      sim.step();
      seen.push(animName(t.content, merc.state));
    }
    expect(seen).toContain('CROUCH_STAB');
    expect(t.content.animations.controls[merc.state]?.endHeight).toBe(AnimHeight.CROUCH);
    runUntilIdle(sim);
    expect(t.turn.attackBusyCount).toBe(0);
  });
});

describe('punches', () => {
  it('punches a diagonal neighbour and turns the damage into breath loss', () => {
    const { sim, merc, enemy } = duel(null, gridNo(81, 81), Direction.SOUTHEAST);
    const t = sim.state;
    master(merc);
    novice(enemy);
    const estimate = sim.dispatch({ type: 'estimateAttack', soldier: 0, target: enemy.gridNo });
    const { apCost, chanceToHit } = estimate.data as { apCost: number; chanceToHit: number };
    expect(apCost).toBe(4);
    expect(chanceToHit).toBe(99);
    const before = merc.actionPoints;
    const breathBefore = enemy.breath;
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo })).toEqual({ ok: true });
    const events = runUntilIdle(sim);
    expect(first(events, 'meleeStrike')).toMatchObject({ weapon: 'punch', hit: true });
    const hit = first(events, 'soldierHit');
    expect(hit).toBeDefined();
    const breathLoss = hit?.breathLoss ?? 0;
    expect(breathLoss % 100).toBe(0);
    expect(hit?.damage).toBe(Math.trunc(breathLoss / 100 / 4));
    expect(enemy.life).toBe(80 - (hit?.damage ?? 0));
    expect(enemy.breath).toBeLessThan(breathBefore);
    expect(before - merc.actionPoints).toBe(apCost);
    expect(t.turn.attackBusyCount).toBe(0);
    expect(animName(t.content, merc.state)).toBe('PUNCH_BREATH');
  });

  it('makes a target who sees the attacker dodge', () => {
    const { sim, enemy } = duel(null, gridNo(80, 81), Direction.SOUTH);
    const t = sim.state;
    expect(enemy.oppList[0]).toBe(Opp.SEEN_CURRENTLY);
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo }).ok).toBe(true);
    const seen = new Set<string>();
    for (let i = 0; i < 400 && !sim.isIdle(); i++) {
      sim.step();
      seen.add(animName(t.content, enemy.state));
    }
    expect(seen.has('DODGE_ONE')).toBe(true);
  });

  it('refuses a punch at someone two tiles away', () => {
    const { sim } = duel(null, gridNo(80, 82), Direction.SOUTH);
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: gridNo(80, 82) }).ok).toBe(false);
  });
});
