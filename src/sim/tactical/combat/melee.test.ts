import { beforeAll, describe, expect, it } from 'vitest';
import { estimateAttack, newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { countDraws } from '../../../../tests/support/explosives.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { PreRandom, Rng } from '../../../core/rng.ts';
import type { SimEvent } from '../../events.ts';
import { createItem, emptyObject } from '../../items/object.ts';
import { anim, animName } from '../anim-states.ts';
import { AnimHeight, initNewSoldierAnim, states } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { Opp } from '../perception/opp.ts';
import { AP } from '../points.ts';
import { effectiveExpLevel, effectiveStrength } from '../skills.ts';
import { NO_PROFILE, SkillTrait, type Soldier, SoldierClass, Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { calcTotalAPsToAttack } from './ap.ts';
import { soldierDifficultyLevel } from './chance.ts';
import { addCorpseStructure } from './death.ts';
import { calcChanceToStab, eventSoldierBeginBladeAttack, eventSoldierBeginPunchAttack, hthImpact, meleeOpcode, useBlade } from './melee.ts';
import { AiMorale, AimShot, WeaponMode } from './types.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

type EventOf<K extends SimEvent['type']> = Extract<SimEvent, { type: K }>;

const KNIFE = 'COMBAT_KNIFE';
const KNIFE_IMPACT = 18;
const AVERAGE_DIFFICULTY_MODIFIER = 50;
const TOP_DIFFICULTY_MODIFIER = 100;

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

  it('gives an enemy the whole difficulty modifier, bonus included, where his gun takes only its penalties', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 81), Direction.NORTH, { gun: KNIFE });
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    enemy.attackingWeapon = enemy.inv[InvSlot.HAND]?.item ?? 0;
    enemy.aimShotLocation = AimShot.TORSO;
    const chanceAtLevel = (soldierClass: number, difficultyModifier: number, level: number) => {
      t.campaign.difficultyModifier = difficultyModifier;
      Object.assign(enemy, { soldierClass });
      expect(soldierDifficultyLevel(t, enemy)).toBe(level);
      return calcChanceToStab(t, enemy, merc, 0);
    };
    const average = chanceAtLevel(SoldierClass.ARMY, AVERAGE_DIFFICULTY_MODIFIER, 2);
    expect(chanceAtLevel(SoldierClass.ELITE, TOP_DIFFICULTY_MODIFIER, 4)).toBeGreaterThan(average);
  });
});

describe('knife attacks', () => {
  it('stabs an adjacent enemy, charges the estimated APs and delivers the hit 25 ms later', () => {
    const { sim, merc, enemy } = duel(KNIFE, gridNo(80, 81), Direction.SOUTH);
    const t = sim.state;
    master(merc);
    novice(enemy);
    const estimate = estimateAttack(sim, { soldier: 0, target: enemy.gridNo });
    expect(estimate.ok).toBe(true);
    const { apCost, chanceToHit, inReach } = estimate.data as { apCost: number; chanceToHit: number | null; inReach: boolean };
    expect(inReach).toBe(true);
    expect(chanceToHit).toBeNull();
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

  it('prices a diagonal knife target without the walk to the side neighbour it steps to before the stab, as the original does', () => {
    const { sim, merc, enemy } = duel(KNIFE, gridNo(81, 81), Direction.SOUTHEAST);
    const t = sim.state;
    const before = merc.actionPoints;
    const estimate = estimateAttack(sim, { soldier: 0, target: enemy.gridNo });
    expect(estimate.data).toMatchObject({ inReach: false });
    expect(estimate.data).not.toHaveProperty('walkTo');
    const { apCost } = estimate.data as { apCost: number };
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo })).toEqual({ ok: true });
    expect(merc.walkToAttackCost).toBe(0);
    const events = runUntilIdle(sim);
    expect([gridNo(81, 80), gridNo(80, 81)]).toContain(merc.gridNo);
    expect(first(events, 'meleeStrike')).toMatchObject({ soldier: 0, target: enemy.gridNo, weapon: 'blade' });
    expect(before - merc.actionPoints).toBeGreaterThan(apCost);
    expect(merc.pendingMelee).toBeNull();
    expect(t.turn.attackBusyCount).toBe(0);
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
    const estimate = estimateAttack(sim, { soldier: 0, target: enemy.gridNo });
    const { apCost, chanceToHit } = estimate.data as { apCost: number; chanceToHit: number | null };
    expect(apCost).toBe(4);
    expect(chanceToHit).toBeNull();
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

  it('turns a target who did not see the punch coming toward the attacker, where a blade turns one who saw it', () => {
    const turnsTarget = (hand: string | null, targetSees: boolean) => {
      const { sim, merc, enemy } = duel(hand, gridNo(80, 81), Direction.SOUTH);
      const t = sim.state;
      enemy.oppList[merc.id] = targetSees ? Opp.SEEN_CURRENTLY : Opp.NOT_HEARD_OR_SEEN;
      merc.targetGridNo = enemy.gridNo;
      if (hand === null) eventSoldierBeginPunchAttack(t, merc, enemy.gridNo, Direction.SOUTH);
      else eventSoldierBeginBladeAttack(t, merc, enemy.gridNo, Direction.SOUTH);
      return t.gameEvents.some((e) => e.kind === 'desiredDirection' && e.soldier === enemy.id);
    };
    expect(turnsTarget(null, false)).toBe(true);
    expect(turnsTarget(null, true)).toBe(false);
    expect(turnsTarget(KNIFE, true)).toBe(true);
    expect(turnsTarget(KNIFE, false)).toBe(false);
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

  it('walks up to punch someone three tiles away, charging the walk and the punch the estimate showed', () => {
    const { sim, merc, enemy } = duel(null, gridNo(80, 83), Direction.SOUTH);
    const t = sim.state;
    const before = merc.actionPoints;
    const estimate = estimateAttack(sim, { soldier: 0, target: enemy.gridNo });
    const { apCost, walkTo, steps } = estimate.data as { apCost: number; walkTo: number; steps: readonly { gridNo: number }[] };
    expect(estimate.data).toMatchObject({ cursor: 'punch', inReach: false, walkTo: gridNo(80, 82) });
    expect(steps.map((step) => step.gridNo)).toEqual([gridNo(80, 81)]);
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo })).toEqual({ ok: true });
    const events = runUntilIdle(sim);
    expect(merc.gridNo).toBe(walkTo);
    expect(first(events, 'meleeStrike')).toMatchObject({ soldier: 0, target: enemy.gridNo, weapon: 'punch' });
    expect(before - merc.actionPoints).toBe(apCost);
    expect(merc.pendingMelee).toBeNull();
    expect(t.turn.attackBusyCount).toBe(0);
  });

  it('refuses with the NO_PATH message a punch at someone whose every side tile is taken', () => {
    const { sim, merc, enemy } = duel(null, gridNo(80, 84), Direction.SOUTH);
    const guards = [gridNo(80, 83), gridNo(81, 84), gridNo(80, 85), gridNo(79, 84)];
    for (const [k, at] of guards.entries()) spawnSoldier(sim, 21 + k, Team.ENEMY, at, Direction.NORTH);
    sim.lookAround();
    const before = merc.actionPoints;
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo })).toEqual({
      ok: false,
      reason: 'no path to the target',
      data: { refusal: 'noPath' },
    });
    expect(merc.actionPoints).toBe(before);
    expect(merc.gridNo).toBe(gridNo(80, 80));
  });

  it('refuses a punch whose walk the soldier cannot afford', () => {
    const { sim, merc, enemy } = duel(null, gridNo(80, 86), Direction.SOUTH);
    const estimate = estimateAttack(sim, { soldier: 0, target: enemy.gridNo });
    merc.actionPoints = (estimate.data as { apCost: number }).apCost - 1;
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo })).toEqual({
      ok: false,
      reason: 'not enough APs for this attack',
      data: { refusal: 'notEnoughAP' },
    });
    expect(merc.gridNo).toBe(gridNo(80, 80));
  });

  it('estimates the fists of a merc who lost his gun in burst mode, and an empty tile as out of reach', () => {
    const { sim, merc, enemy } = duel(null, gridNo(80, 81), Direction.SOUTH);
    merc.weaponMode = WeaponMode.BURST;
    expect(estimateAttack(sim, { soldier: 0, target: enemy.gridNo })).toMatchObject({
      ok: true,
      data: { cursor: 'punch', weaponMode: 'single', inReach: true },
    });
    expect(merc.weaponMode).toBe(WeaponMode.BURST);
    expect(estimateAttack(sim, { soldier: 0, target: gridNo(81, 80) })).toMatchObject({
      ok: true,
      data: { cursor: 'punch', inReach: false },
    });
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: gridNo(81, 80) })).toMatchObject({ ok: false });
  });
});

describe('martial arts (DoNinjaAttack)', () => {
  const MARTIAL_ARTS_ATTACK = 469;
  const MERC_PROFILE = 4;

  function martialArtsDuel(targetAt = gridNo(80, 81)): { sim: TacticalSim; merc: Soldier; enemy: Soldier } {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { profile: MERC_PROFILE });
    merc.inv[InvSlot.HAND] = emptyObject();
    merc.skillTrait1 = SkillTrait.MARTIALARTS;
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, targetAt, Direction.NORTH);
    sim.lookAround();
    sim.drainEvents();
    return { sim, merc, enemy };
  }

  function statesPlayed(sim: TacticalSim, s: Soldier): string[] {
    const seen: string[] = [];
    for (let i = 0; i < 2000 && !sim.isIdle(); i++) {
      sim.step();
      const name = animName(sim.state.content, s.state);
      if (seen.at(-1) !== name) seen.push(name);
    }
    return seen;
  }

  function strikeFromStance(sim: TacticalSim, merc: Soldier, enemy: Soldier): void {
    merc.targetGridNo = enemy.gridNo;
    initNewSoldierAnim(sim.state, merc, anim(sim.state.content, 'NINJA_GOTOBREATH'), 0, true);
    merc.inNonInterruptibleAnimation = false;
  }

  it('takes the ninja stance, strikes, frees the attack and stays in the stance after the blow', () => {
    const { sim, merc, enemy } = martialArtsDuel();
    const t = sim.state;
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo })).toEqual({ ok: true });
    const played = statesPlayed(sim, merc);
    expect(played[0]).toBe('NINJA_GOTOBREATH');
    expect(['NINJA_LOWKICK', 'NINJA_PUNCH']).toContain(played[1]);
    expect(played.at(-1)).toBe('NINJA_BREATH');
    expect(played).not.toContain('PUNCH');
    expect(t.turn.attackBusyCount).toBe(0);
  });

  it('picks the low kick or the punch with one Random(2) on the gameplay stream', () => {
    const picked = (roll: number) => {
      const { sim, merc, enemy } = martialArtsDuel();
      const t = sim.state;
      strikeFromStance(sim, merc, enemy);
      const real = t.rng.int.bind(t.rng);
      t.rng.int = (n: number) => (n === 2 ? roll : real(n));
      meleeOpcode(t, merc, MARTIAL_ARTS_ATTACK);
      return animName(t.content, merc.state);
    };
    expect(picked(0)).toBe('NINJA_LOWKICK');
    expect(picked(1)).toBe('NINJA_PUNCH');
    const { sim, merc, enemy } = martialArtsDuel();
    strikeFromStance(sim, merc, enemy);
    expect(countDraws(sim.state, () => meleeOpcode(sim.state, merc, MARTIAL_ARTS_ATTACK))).toEqual({ pre: 0, main: 1 });
  });

  it('finishes a target at 30 life or breath with the spin kick, which draws nothing to pick and always lands', () => {
    for (const weaken of [(s: Soldier) => Object.assign(s, { life: 30 }), (s: Soldier) => Object.assign(s, { breath: 30 })]) {
      const { sim, merc, enemy } = martialArtsDuel();
      const t = sim.state;
      weaken(enemy);
      strikeFromStance(sim, merc, enemy);
      expect(countDraws(t, () => meleeOpcode(t, merc, MARTIAL_ARTS_ATTACK))).toEqual({ pre: 0, main: 0 });
      expect(animName(t.content, merc.state)).toBe('NINJA_SPINKICK');
    }
    const { sim, merc, enemy } = martialArtsDuel();
    novice(merc);
    master(enemy);
    enemy.life = 30;
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo })).toEqual({ ok: true });
    const events = runUntilIdle(sim);
    expect(first(events, 'meleeStrike')).toMatchObject({ weapon: 'punch', hit: true });
  });

  it('strikes at once from the ninja stance, and crouches for a low punch at a prone target', () => {
    const { sim, merc, enemy } = martialArtsDuel();
    const t = sim.state;
    initNewSoldierAnim(t, merc, anim(t.content, 'NINJA_BREATH'), 0, true);
    merc.targetGridNo = enemy.gridNo;
    eventSoldierBeginPunchAttack(t, merc, enemy.gridNo, Direction.SOUTH);
    expect(['NINJA_LOWKICK', 'NINJA_PUNCH']).toContain(animName(t.content, merc.state));
    const prone = martialArtsDuel();
    prone.enemy.state = states(content.animations).PRONE;
    initNewSoldierAnim(prone.sim.state, prone.enemy, prone.enemy.state, 0, true);
    prone.merc.targetGridNo = prone.enemy.gridNo;
    eventSoldierBeginPunchAttack(prone.sim.state, prone.merc, prone.enemy.gridNo, Direction.SOUTH);
    expect(animName(content, prone.merc.pendingAnimation)).toBe('PUNCH_LOW');
  });

  it('turns a target who did not see the kick coming without stopping him, and punches plainly with a crowbar', () => {
    const { sim, merc, enemy } = martialArtsDuel();
    const t = sim.state;
    enemy.oppList[merc.id] = Opp.NOT_HEARD_OR_SEEN;
    let cancelled = 0;
    t.turnHooks = { ...t.turnHooks, cancelAIAction: () => cancelled++ };
    strikeFromStance(sim, merc, enemy);
    meleeOpcode(t, merc, MARTIAL_ARTS_ATTACK);
    expect(t.gameEvents).toContainEqual({ kind: 'desiredDirection', soldier: enemy.id, direction: Direction.NORTH });
    expect(cancelled).toBe(0);
    const crowbar = martialArtsDuel();
    crowbar.merc.inv[InvSlot.HAND] = createItem(content.items, content.items.byName.get('CROWBAR')?.index ?? 0, 100);
    crowbar.merc.targetGridNo = crowbar.enemy.gridNo;
    eventSoldierBeginPunchAttack(crowbar.sim.state, crowbar.merc, crowbar.enemy.gridNo, Direction.SOUTH);
    expect(animName(content, crowbar.merc.state)).toBe('CROWBAR_ATTACK');
  });
});

describe('decapitation (EVENT_SoldierBeginBladeAttack, DecapitateCorpse)', () => {
  const DECAPITATE = 752;
  const CORPSE_AT = gridNo(80, 81);
  const corpseType = (name: string) => content.corpses.table.types.indexOf(name);
  const itemIndex = (name: string) => content.items.byName.get(name)?.index ?? -1;

  function besideCorpse(hand: string | null, type = 'SMERC_FWD'): { sim: TacticalSim; merc: Soldier } {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { gun: hand ?? KNIFE });
    if (hand === null) merc.inv[InvSlot.HAND] = emptyObject();
    spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 88), Direction.NORTH);
    sim.lookAround();
    sim.drainEvents();
    const corpse = { gridNo: CORPSE_AT, level: 0, bodyType: 0, direction: Direction.NORTH, state: 0, profile: NO_PROFILE };
    t.corpses.push({ ...corpse, type: corpseType(type), timeOfDeath: 0, headTaken: false });
    addCorpseStructure(t, CORPSE_AT, 0, corpseType(type), Direction.NORTH);
    return { sim, merc };
  }

  function statesPlayed(sim: TacticalSim, s: Soldier): string[] {
    const seen: string[] = [];
    for (let i = 0; i < 2000 && !sim.isIdle(); i++) {
      sim.step();
      const name = animName(sim.state.content, s.state);
      if (seen.at(-1) !== name) seen.push(name);
    }
    return seen;
  }

  it('cuts the head off a merc corpse beside him: a headless corpse and a hidden head on its tile, paying only to kneel', () => {
    const { sim, merc } = besideCorpse(KNIFE);
    const t = sim.state;
    expect(t.inCombat).toBe(true);
    const before = merc.actionPoints;
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: CORPSE_AT })).toEqual({ ok: true });
    expect(statesPlayed(sim, merc)).toContain('DECAPITATE');
    expect(t.corpses).toMatchObject([{ gridNo: CORPSE_AT, type: corpseType('SMERC_JFK'), headTaken: false }]);
    expect(t.worldItems.filter((wi) => wi.object.item === itemIndex('HEAD_1'))).toMatchObject([{ gridNo: CORPSE_AT, level: 0 }]);
    expect(before - merc.actionPoints).toBe(AP.CROUCH);
    expect(t.turn.attackBusyCount).toBe(0);
  });

  it('makes every merc look for items and draws nothing', () => {
    const { sim, merc } = besideCorpse(KNIFE);
    const t = sim.state;
    merc.targetGridNo = CORPSE_AT;
    for (const s of t.mercSlots) if (s) s.lookForItems = false;
    expect(countDraws(t, () => meleeOpcode(t, merc, DECAPITATE))).toEqual({ pre: 0, main: 0 });
    expect(t.mercSlots.filter((s) => s !== null && s !== undefined).every((s) => s.lookForItems)).toBe(true);
  });

  it('stabs the ground at a corpse that cannot lose its head, as at a bare tile', () => {
    const { sim, merc } = besideCorpse(KNIFE, 'BLOODCAT_DEAD');
    const t = sim.state;
    merc.targetLevel = 0;
    eventSoldierBeginBladeAttack(t, merc, CORPSE_AT, Direction.SOUTH);
    expect(animName(t.content, merc.pendingAnimation)).toBe('CROUCH_STAB');
  });

  it('takes a knife at a tile without a soldier, priced as the order checks it, but refuses fists there', () => {
    const { sim, merc } = besideCorpse(KNIFE);
    expect(estimateAttack(sim, { soldier: 0, target: CORPSE_AT }).data).toMatchObject({
      cursor: 'knife',
      apCost: calcTotalAPsToAttack(sim.state, merc, CORPSE_AT, true, 0),
      inReach: true,
    });
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: CORPSE_AT })).toEqual({ ok: true });
    expect(besideCorpse(null).sim.dispatch({ type: 'attack', soldier: 0, target: CORPSE_AT })).toMatchObject({
      ok: false,
      data: { refusal: 'needMeleeTarget' },
    });
  });
});
