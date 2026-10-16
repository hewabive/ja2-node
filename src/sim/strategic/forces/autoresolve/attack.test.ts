import { beforeAll, describe, expect, it } from 'vitest';
import { arEnv, arSoldier, arState, enemySoldier, itemIndex, militiaSoldier, scripted } from '../../../../../tests/support/autoresolve.ts';
import { loadTestContent } from '../../../../../tests/support/tactical.ts';
import { createItem, emptyObject } from '../../../items/object.ts';
import { AUTORESOLVE_IMPACT, type CombatContext, TACTICAL_IMPACT } from '../../../tactical/combat/context.ts';
import { bulletImpact } from '../../../tactical/combat/impact.ts';
import { AimShot, Special } from '../../../tactical/combat/types.ts';
import type { TacticalContent } from '../../../tactical/content.ts';
import { InvSlot } from '../../../tactical/inventory.ts';
import { Body } from '../../../tactical/soldier.ts';
import { EncounterCode } from '../constants.ts';
import { attackTarget, calcHitAccuracy, chooseTarget, fireAShot } from './attack.ts';
import { type ArCell, CellFlag, combatContext } from './state.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function cell(cells: readonly ArCell[], i: number): ArCell {
  const c = cells[i];
  if (!c) throw new Error(`no cell ${i}`);
  return c;
}

function duel(
  attackerGun: string | null = 'GLOCK_17',
  targetGun: string | null = 'GLOCK_17',
  encounter: number = EncounterCode.ENEMY_INVASION,
) {
  const ar = arState({
    encounter,
    mercs: [{ soldier: arSoldier(content, { gun: targetGun }) }],
    enemies: [{ soldier: enemySoldier(content, { gun: attackerGun }) }],
  });
  const attacker = cell(ar.enemies, 0);
  const target = cell(ar.mercs, 0);
  attacker.attack = 500;
  target.defence = 500;
  ar.playerDefence = 500;
  ar.enemyDefence = 500;
  return { ar, attacker, target };
}

describe('chooseTarget', () => {
  function targets() {
    const ar = arState({
      mercs: [{ soldier: arSoldier(content) }, { soldier: arSoldier(content) }],
      enemies: [{ soldier: enemySoldier(content) }],
    });
    cell(ar.mercs, 0).defence = 300;
    cell(ar.mercs, 1).defence = 700;
    ar.playerDefence = 1000;
    return ar;
  }

  it('picks targets in proportion to their defence along the cell order', () => {
    const ar = targets();
    const pre = scripted([299]);
    expect(chooseTarget(arEnv(content, { pre }), ar, cell(ar.enemies, 0))).toBe(ar.mercs[0]);
    expect(ar.playerDefence).toBe(1000);
    const second = scripted([300, 699]);
    expect(chooseTarget(arEnv(content, { pre: second }), ar, cell(ar.enemies, 0))).toBe(ar.mercs[1]);
    expect(second.requested).toEqual([1000, 700]);
    expect(ar.playerDefence).toBe(1000);
  });

  it('skips dead and retreated candidates without a draw but draws for unconscious ones', () => {
    const ar = targets();
    cell(ar.mercs, 0).soldier.life = 0;
    ar.playerDefence = 700;
    const pre = scripted([0]);
    expect(chooseTarget(arEnv(content, { pre }), ar, cell(ar.enemies, 0))).toBe(ar.mercs[1]);
    expect(pre.requested).toEqual([700]);
    const retreated = targets();
    cell(retreated.mercs, 0).flags |= CellFlag.RETREATED;
    const pre2 = scripted([0]);
    chooseTarget(arEnv(content, { pre: pre2 }), retreated, cell(retreated.enemies, 0));
    expect(pre2.requested).toEqual([1000]);
    const unconscious = targets();
    cell(unconscious.mercs, 0).soldier.life = 5;
    const pre3 = scripted([299]);
    expect(chooseTarget(arEnv(content, { pre: pre3 }), unconscious, cell(unconscious.enemies, 0))).toBe(unconscious.mercs[0]);
  });

  it('asserts when the sums promise a target that does not exist (deviation D8)', () => {
    const ar = targets();
    for (const c of ar.mercs) c.soldier.life = 0;
    expect(() => chooseTarget(arEnv(content), ar, cell(ar.enemies, 0))).toThrow(/no target/);
  });
});

describe('attackTarget', () => {
  it('rolls attack and defence from the ratings, capped at 950 + pre(50)', () => {
    const { ar, attacker, target } = duel();
    attacker.attack = 960;
    target.defence = 980;
    const pre = scripted([49, 0, 10], 0);
    attackTarget(arEnv(content, { pre }), ar, attacker, target);
    expect(pre.requested.slice(0, 3)).toEqual([50, 50, 400]);
    expect(target.nextHit[0]).toBe(60);
  });

  it('cuts the attack against a retreating target to 7/10, except for female creatures', () => {
    const hit = duel();
    const preHit = scripted([400, 200, 0], 0);
    attackTarget(arEnv(content, { pre: preHit }), hit.ar, hit.attacker, hit.target);
    expect(preHit.requested.slice(0, 4)).toEqual([500, 500, 400, 100]);
    const retreat = duel();
    retreat.target.flags |= CellFlag.RETREATING;
    const preMiss = scripted([400, 200, 0], 0);
    attackTarget(arEnv(content, { pre: preMiss }), retreat.ar, retreat.attacker, retreat.target);
    expect(preMiss.requested).toEqual([500, 500, 400]);
  });

  it('weakens melee against a target with a loaded gun: knife 6/10, fists 4/10', () => {
    const knife = duel(null);
    knife.attacker.soldier.inv[InvSlot.HAND] = createItem(content.items, itemIndex(content, 'COMBAT_KNIFE'), 100);
    const preKnife = scripted([400, 199], 0);
    attackTarget(arEnv(content, { pre: preKnife }), knife.ar, knife.attacker, knife.target);
    expect(preKnife.requested).toEqual([500, 500]);
    const unarmed = duel(null, null);
    unarmed.attacker.soldier.inv[InvSlot.HAND] = createItem(content.items, itemIndex(content, 'COMBAT_KNIFE'), 100);
    const preUnarmed = scripted([400, 199], 0);
    attackTarget(arEnv(content, { pre: preUnarmed }), unarmed.ar, unarmed.attacker, unarmed.target);
    expect(preUnarmed.requested.slice(0, 2)).toEqual([500, 500]);
    expect(preUnarmed.requested.length).toBeGreaterThan(2);
    const fists = duel(null);
    const preFists = scripted([499, 0], 0);
    attackTarget(arEnv(content, { pre: preFists }), fists.ar, fists.attacker, fists.target);
    expect(preFists.requested).toEqual([500, 500]);
  });

  it('reserves bullet slots and adds a fourth bullet to slot 2', () => {
    const { ar, attacker, target } = duel();
    target.nextHit[0] = 100;
    target.nextHit[1] = 100;
    target.nextHit[2] = 100;
    target.hitDamage[2] = 7;
    const pre = scripted([400, 0, 0, 0], 0);
    attackTarget(arEnv(content, { pre, main: scripted([], 0) }), ar, attacker, target);
    expect(pre.requested.slice(0, 3)).toEqual([500, 500, 100]);
    expect(target.hitDamage[2]).toBeGreaterThan(7);
  });

  it('misses a conscious target without pre(5) and hits an unconscious one 4 times in 5', () => {
    const miss = duel();
    const preMiss = scripted([0, 499, 0], 0);
    attackTarget(arEnv(content, { pre: preMiss }), miss.ar, miss.attacker, miss.target);
    expect(preMiss.requested).toEqual([500, 500, 400]);
    expect(miss.target.hitDamage[0]).toBe(0);
    const forced = duel();
    forced.target.soldier.life = 10;
    const preForced = scripted([0, 499, 0, 1, 50], 0);
    attackTarget(arEnv(content, { pre: preForced, main: scripted([], 0) }), forced.ar, forced.attacker, forced.target);
    expect(preForced.requested.slice(0, 5)).toEqual([500, 500, 400, 5, 100]);
    const spared = duel();
    spared.target.soldier.life = 10;
    const preSpared = scripted([0, 499, 0, 0], 0);
    attackTarget(arEnv(content, { pre: preSpared }), spared.ar, spared.attacker, spared.target);
    expect(preSpared.requested).toEqual([500, 500, 400, 5]);
  });

  it('fires the first gun in slot order and counts shots for mercs', () => {
    const ar = arState({ mercs: [{ soldier: arSoldier(content, { gun: null }) }], enemies: [{ soldier: enemySoldier(content) }] });
    const merc = cell(ar.mercs, 0);
    merc.soldier.inv[InvSlot.SMALLPOCK3] = createItem(content.items, itemIndex(content, 'GLOCK_17'), 100);
    const shots = merc.soldier.inv[InvSlot.SMALLPOCK3]?.gunShotsLeft ?? 0;
    expect(fireAShot(arEnv(content), ar, merc)).toBe(true);
    expect(merc.weaponSlot).toBe(InvSlot.SMALLPOCK3);
    expect(merc.soldier.inv[InvSlot.SMALLPOCK3]?.gunShotsLeft).toBe(shots - 1);
  });

  it('reloads only the gun in the hand (quirk Q9)', () => {
    const ar = arState({
      mercs: [{ soldier: arSoldier(content, { gun: 'GLOCK_17', magazines: 2 }) }],
      enemies: [{ soldier: enemySoldier(content) }],
    });
    const merc = cell(ar.mercs, 0);
    const hand = merc.soldier.inv[InvSlot.HAND];
    if (!hand) throw new Error('no gun');
    hand.gunShotsLeft = 0;
    expect(fireAShot(arEnv(content), ar, merc)).toBe(true);
    expect(hand.gunShotsLeft).toBeGreaterThan(0);
    const pocket = arState({ mercs: [{ soldier: arSoldier(content, { gun: 'GLOCK_17', magazines: 2 }) }], enemies: [] });
    const m = cell(pocket.mercs, 0);
    m.soldier.inv[InvSlot.SMALLPOCK1] = m.soldier.inv[InvSlot.HAND] ?? emptyObject();
    m.soldier.inv[InvSlot.HAND] = emptyObject();
    const gun = m.soldier.inv[InvSlot.SMALLPOCK1];
    if (!gun) throw new Error('no gun');
    gun.gunShotsLeft = 0;
    expect(fireAShot(arEnv(content), pocket, m)).toBe(false);
    expect(m.weaponSlot).toBe(-1);
  });

  it('lets male creatures spit and female creatures claw', () => {
    const ar = arState({
      encounter: EncounterCode.CREATURE_ATTACK,
      mercs: [{ soldier: arSoldier(content) }],
      enemies: [{ soldier: enemySoldier(content, { body: Body.AM_MONSTER, gun: null }) }],
    });
    expect(fireAShot(arEnv(content), ar, cell(ar.enemies, 0))).toBe(true);
    expect(cell(ar.enemies, 0).weaponSlot).toBe(InvSlot.SECOND_HAND);
  });
});

describe('calcHitAccuracy', () => {
  it('adds pre(rolled − rated defence) only when the roll exceeds the rating, and clamps at 0', () => {
    const { target } = duel();
    target.defence = 600;
    const none = scripted([]);
    expect(calcHitAccuracy(arEnv(content, { pre: none }), 700, 600, target)).toBe(10);
    expect(none.requested).toEqual([]);
    const some = scripted([49]);
    expect(calcHitAccuracy(arEnv(content, { pre: some }), 700, 650, target)).toBe(9);
    expect(some.requested).toEqual([50]);
    expect(calcHitAccuracy(arEnv(content, { pre: scripted([0]) }), 300, 700, target)).toBe(0);
  });
});

describe('autoresolve impact mode', () => {
  function context(
    pre: number[],
    main: number[],
  ): { ctx: CombatContext; pre: ReturnType<typeof scripted>; main: ReturnType<typeof scripted> } {
    const p = scripted(pre, 0);
    const m = scripted(main, 0);
    const ar = arState({ mercs: [] });
    return { ctx: combatContext(arEnv(content, { pre: p, main: m }), ar), pre: p, main: m };
  }

  it('skips criticals and specials but keeps the close-range instant kill', () => {
    const firer = enemySoldier(content);
    const target = militiaSoldier(content, { life: 100, gun: null });
    const ar = context([25], [3]);
    const r = bulletImpact(ar.ctx, firer, target, AimShot.TORSO, 60, 0, 0, AUTORESOLVE_IMPACT);
    expect(r.damage).toBe(103);
    expect(r.special).toBe(Special.NONE);
    expect(ar.pre.requested).toEqual([51]);
    expect(ar.main.requested).toEqual([10]);
    const crit = context([25], []);
    bulletImpact(crit.ctx, firer, militiaSoldier(content, { life: 100, gun: null }), AimShot.TORSO, 30, 0, 0, TACTICAL_IMPACT);
    expect(crit.pre.requested.length).toBeGreaterThan(1);
    const noCrit = context([25], []);
    bulletImpact(noCrit.ctx, firer, militiaSoldier(content, { life: 100, gun: null }), AimShot.TORSO, 30, 0, 0, AUTORESOLVE_IMPACT);
    expect(noCrit.pre.requested).toEqual([51]);
    const head = context([25], [0]);
    const killed = bulletImpact(
      head.ctx,
      firer,
      militiaSoldier(content, { life: 50, gun: null }),
      AimShot.HEAD,
      40,
      0,
      0,
      AUTORESOLVE_IMPACT,
    );
    expect(killed.special).toBe(Special.NONE);
    expect(head.pre.requested).toEqual([51]);
    const legs = context([25], []);
    const target2 = militiaSoldier(content, { life: 100, gun: null });
    const leg = bulletImpact(legs.ctx, firer, target2, AimShot.LEGS, 90, 0, 0, AUTORESOLVE_IMPACT);
    expect(leg.special).toBe(Special.NONE);
    expect(legs.pre.requested).toEqual([51]);
  });
});
