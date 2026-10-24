import { beforeAll, describe, expect, it } from 'vitest';
import { arEnv, arSoldier, arState, enemySoldier, itemIndex, scripted } from '../../../../../tests/support/autoresolve.ts';
import { loadTestContent } from '../../../../../tests/support/tactical.ts';
import { createItem } from '../../../items/object.ts';
import type { TacticalContent } from '../../../tactical/content.ts';
import { InvSlot } from '../../../tactical/inventory.ts';
import { Body } from '../../../tactical/soldier.ts';
import { EncounterCode } from '../constants.ts';
import { attackTarget } from './attack.ts';
import { BandageRefusal, bandageRefusal } from './bandage.ts';
import { targetHit } from './landing.ts';
import { type ArCell, type ArEvent, BattleStatus } from './state.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function cell(cells: readonly ArCell[], i: number): ArCell {
  const c = cells[i];
  if (!c) throw new Error(`no cell ${i}`);
  return c;
}

function duel(attackerGun: string | null, magazines = 0) {
  const ar = arState({
    mercs: [{ soldier: arSoldier(content, { gun: null }) }],
    enemies: [{ soldier: enemySoldier(content, { gun: attackerGun, magazines }) }],
  });
  const attacker = cell(ar.enemies, 0);
  const target = cell(ar.mercs, 0);
  attacker.attack = 500;
  target.defence = 500;
  ar.playerDefence = 500;
  ar.enemyDefence = 500;
  return { ar, attacker, target };
}

function events<T extends ArEvent['type']>(all: readonly ArEvent[], type: T): Extract<ArEvent, { type: T }>[] {
  return all.filter((e): e is Extract<ArEvent, { type: T }> => e.type === type);
}

describe('the autoresolve events the screen plays', () => {
  it('names the weapon of a shot and marks a shot after a reload', () => {
    const loaded = duel('GLOCK_17');
    attackTarget(arEnv(content, { pre: scripted([0, 499, 0], 0) }), loaded.ar, loaded.attacker, loaded.target);
    expect(events(loaded.ar.events, 'arAttack')).toEqual([
      expect.objectContaining({ kind: 'shot', weapon: itemIndex(content, 'GLOCK_17') }),
    ]);
    expect(events(loaded.ar.events, 'arAttack')[0]).not.toHaveProperty('reloaded');
    const empty = duel('GLOCK_17', 2);
    const hand = empty.attacker.soldier.inv[InvSlot.HAND];
    if (!hand) throw new Error('no gun');
    hand.gunShotsLeft = 0;
    attackTarget(arEnv(content, { pre: scripted([0, 499, 0], 0) }), empty.ar, empty.attacker, empty.target);
    expect(events(empty.ar.events, 'arAttack')[0]).toMatchObject({ kind: 'shot', reloaded: true });
  });

  it('gives a punch neither weapon nor reload and marks melee hits', () => {
    const { ar, attacker, target } = duel(null);
    attackTarget(arEnv(content, { pre: scripted([499, 0], 0), main: scripted([], 0) }), ar, attacker, target);
    const attack = events(ar.events, 'arAttack')[0];
    expect(attack).toMatchObject({ kind: 'punch' });
    expect(attack).not.toHaveProperty('weapon');
    expect(events(ar.events, 'arHit')[0]).toMatchObject({ melee: true });
  });

  it('marks a bullet death below -60 life as a splat, never for creatures', () => {
    const ar = arState({
      encounter: EncounterCode.ENEMY_INVASION,
      mercs: [{ soldier: arSoldier(content) }],
      enemies: [{ soldier: enemySoldier(content, { life: 20 }) }, { soldier: enemySoldier(content, { life: 20 }) }],
    });
    const overkill = cell(ar.enemies, 0);
    overkill.attackers[0] = { side: 'merc', index: 0 };
    overkill.hitDamage[0] = 90;
    targetHit(arEnv(content, { pre: scripted([], 99) }), ar, overkill, 0);
    const plain = cell(ar.enemies, 1);
    plain.attackers[0] = { side: 'merc', index: 0 };
    plain.hitDamage[0] = 30;
    targetHit(arEnv(content, { pre: scripted([], 99) }), ar, plain, 0);
    expect(events(ar.events, 'arDied').map((e) => e.splat === true)).toEqual([true, false]);
    const creatures = arState({
      encounter: EncounterCode.CREATURE_ATTACK,
      mercs: [{ soldier: arSoldier(content) }],
      enemies: [{ soldier: enemySoldier(content, { life: 5, body: Body.YAM_MONSTER, gun: null }) }],
    });
    const creature = cell(creatures.enemies, 0);
    creature.attackers[0] = { side: 'merc', index: 0 };
    creature.hitDamage[0] = 400;
    targetHit(arEnv(content, { pre: scripted([], 99) }), creatures, creature, 0);
    expect(events(creatures.events, 'arDied')[0]).not.toHaveProperty('splat');
  });
});

describe('bandageRefusal', () => {
  function victory() {
    const ar = arState({ mercs: [{ soldier: arSoldier(content, { medical: 40 }) }, { soldier: arSoldier(content) }], enemies: [] });
    ar.status = BattleStatus.VICTORY;
    return ar;
  }

  it('names why nobody can bandage in the order of DetermineBandageButtonState', () => {
    const ar = victory();
    expect(bandageRefusal(arEnv(content), ar)).toBe(BandageRefusal.NOBODY_WOUNDED);
    cell(ar.mercs, 1).soldier.bleeding = 10;
    expect(bandageRefusal(arEnv(content), ar)).toBe(BandageRefusal.NO_KIT);
    for (const c of ar.mercs) c.soldier.stats.medical = 0;
    expect(bandageRefusal(arEnv(content), ar)).toBe(BandageRefusal.NO_DOCTOR);
    cell(ar.mercs, 0).soldier.stats.medical = 40;
    cell(ar.mercs, 0).soldier.inv[InvSlot.BIGPOCK2] = createItem(content.items, itemIndex(content, 'FIRSTAIDKIT'), 100);
    expect(bandageRefusal(arEnv(content), ar)).toBeNull();
  });
});
