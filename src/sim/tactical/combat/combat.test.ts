import { beforeAll, describe, expect, it } from 'vitest';
import { estimateAttack, newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { testProfile } from '../../../../tests/support/profiles.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { AnimFlags } from '../../../content/anim/tables.ts';
import { CELL_X_SIZE, Direction, gridNo } from '../../../content/world/grid.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import type { SimEvent } from '../../events.ts';
import { createItem } from '../../items/object.ts';
import { ProfileFlag } from '../../narrative/narrative-ids.ts';
import { Fact } from '../../strategic/narrative/fact-ids.ts';
import { Npc } from '../../strategic/narrative/npc-ids.ts';
import { adjustNoAPToFinishMove, hasAnimFlag, states } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot, itemIn } from '../inventory.ts';
import { Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { handleItem, ItemHandle } from './attack.ts';
import { chanceOfBulletHittingStructure, soldierToSoldierChanceToGetThrough } from './bullets.ts';
import { gunRange } from './chance.ts';
import { soldierTakeDamage } from './hit.ts';
import { adjustImpactByHitLocation } from './impact.ts';
import { AimShot, DamageReason } from './types.ts';

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

describe('an NPC hurt by a soldier (Soldier_Control.cc SoldierTakeDamage)', () => {
  function hurtPacos(attackerTeam: number) {
    const sim = newSim();
    const facts: number[] = [];
    sim.state.narrative = {
      ...sim.state.narrative,
      isNpcOrRpcProfile: (profile) => profile === Npc.PACOS,
      setFactTrue: (id) => facts.push(id),
    };
    const profile = testProfile(Npc.PACOS);
    sim.state.profiles.set(Npc.PACOS, profile);
    const attacker = spawn(sim, attackerTeam === Team.OUR ? 0 : 20, attackerTeam, gridNo(80, 80), Direction.SOUTH);
    const pacos = spawnSoldier(sim, 60, Team.CIV, gridNo(80, 84), Direction.NORTH, { profile: Npc.PACOS });
    soldierTakeDamage(sim.state, pacos, 5, 0, DamageReason.GUNFIRE, attacker);
    return { pacos, facts, flags: profile.miscFlags };
  }

  it('marks the profile wounded by the player when ours hurt him, and a mere wound sets "Pacos killed"', () => {
    const { pacos, facts, flags } = hurtPacos(Team.OUR);
    expect(pacos.life).toBeGreaterThan(0);
    expect(flags & ProfileFlag.WOUNDEDBYPLAYER).toBe(ProfileFlag.WOUNDEDBYPLAYER);
    expect(facts).toEqual([Fact.PACOS_KILLED]);
  });

  it('leaves the profile alone when someone else hurts him', () => {
    const { facts, flags } = hurtPacos(Team.ENEMY);
    expect(flags & ProfileFlag.WOUNDEDBYPLAYER).toBe(0);
    expect(facts).toEqual([]);
  });
});

describe('gun range', () => {
  const item = (name: string) => createItem(content.items, content.items.byName.get(name)?.index ?? -1, 100);

  it('is one tile for a non-weapon and the weapon range for any weapon class, as GunRange', () => {
    expect(gunRange(content.items, item('FIRSTAIDKIT'))).toBe(CELL_X_SIZE);
    for (const name of ['GLOCK_17', 'THROWING_KNIFE', 'COMBAT_KNIFE'])
      expect(gunRange(content.items, item(name))).toBe(content.items.byName.get(name)?.weapon?.range);
  });

  it('gives a shooter holding no gun the one-tile range: through at two tiles, falling short at six', () => {
    const sim = newSim();
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { gun: 'FIRSTAIDKIT' });
    const near = spawn(sim, 20, Team.ENEMY, gridNo(80, 82), Direction.NORTH);
    const far = spawn(sim, 21, Team.ENEMY, gridNo(82, 86), Direction.NORTH);
    expect(soldierToSoldierChanceToGetThrough(t, merc, near)).toBe(100);
    expect(soldierToSoldierChanceToGetThrough(t, merc, far)).toBe(0);
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
    const estimate = estimateAttack(sim, { soldier: 0, target: enemy.gridNo, aimTime: 2 });
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
    expect(t.world.structures.find(enemy.gridNo, StructureFlags.CORPSE)).not.toBeNull();
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
    expect(sim.dispatch({ type: 'move', soldier: 1, to: gridNo(84, 80) })).toEqual({
      ok: false,
      reason: 'an attack is still resolving',
      data: { refusal: 'attackResolving' },
    });
    run(sim);
    expect(sim.dispatch({ type: 'move', soldier: 1, to: gridNo(84, 80) }).ok).toBe(true);
  });

  it('refuses an attack without APs and leaves a halted merc as he was', () => {
    const sim = newSim();
    const merc = spawn(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawn(sim, 20, Team.ENEMY, gridNo(80, 86), Direction.NORTH);
    sim.lookAround();
    expect(sim.dispatch({ type: 'move', soldier: 0, to: gridNo(84, 80) }).ok).toBe(true);
    for (let i = 0; i < 200 && !hasAnimFlag(content, merc.state, AnimFlags.MOVING); i++) sim.step();
    expect(hasAnimFlag(content, merc.state, AnimFlags.MOVING)).toBe(true);
    adjustNoAPToFinishMove(merc, true);
    merc.actionPoints = 0;
    merc.breathCollapsed = true;
    const halted = merc.state;
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo })).toEqual({
      ok: false,
      reason: 'not enough APs for this attack',
      data: { refusal: 'notEnoughAP' },
    });
    expect(merc.state).toBe(halted);
    expect(merc.collapsed).toBe(false);
    expect(sim.isBusy(merc)).toBe(false);
  });

  it('takes no orders from a merc out of breath and waits for his collapse', () => {
    const sim = newSim();
    const t = sim.state;
    const merc = spawn(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    spawn(sim, 1, Team.OUR, gridNo(82, 80), Direction.SOUTH);
    const enemy = spawn(sim, 20, Team.ENEMY, gridNo(80, 86), Direction.NORTH);
    sim.lookAround();
    soldierTakeDamage(t, merc, 0, merc.breath * 100, DamageReason.GAS, null);
    expect(merc.breath).toBe(0);
    expect(merc.collapsed).toBe(false);
    const outOfBreath = { ok: false, reason: 'soldier is out of breath', data: { refusal: 'outOfBreath' } };
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo })).toEqual(outOfBreath);
    expect(sim.dispatch({ type: 'move', soldier: 1, to: gridNo(84, 80) })).toEqual({
      ok: false,
      reason: 'soldier 0 is still acting',
      data: { refusal: 'mercActing' },
    });
    run(sim);
    expect(merc.collapsed).toBe(true);
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo })).toEqual(outOfBreath);
    expect(t.turn.attackBusyCount).toBe(0);
    expect(sim.dispatch({ type: 'move', soldier: 1, to: gridNo(84, 80) }).ok).toBe(true);
  });

  it('drops a pending action but keeps the pending animation when an attack starts', () => {
    const sim = newSim();
    const t = sim.state;
    const merc = spawn(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawn(sim, 20, Team.ENEMY, gridNo(80, 86), Direction.NORTH);
    sim.lookAround();
    const crouch = states(content.animations).CROUCHING;
    merc.pendingTalk = enemy.id;
    merc.pendingAnimation = crouch;
    expect(handleItem(t, merc, enemy.gridNo, 0, itemIn(merc.inv, InvSlot.HAND))).toBe(ItemHandle.OK);
    expect(merc.pendingTalk).toBeNull();
    expect(merc.pendingAnimation).toBe(crouch);
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
    const estimate = estimateAttack(sim, { soldier: 0, target: enemy.gridNo });
    expect((estimate.data as { chanceToGetThrough: number }).chanceToGetThrough).toBe(0);
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo }).ok).toBe(true);
    const events = run(sim);
    expect(events.find((e) => e.type === 'bulletStopped')).toMatchObject({ reason: 'structure' });
    expect(events.some((e) => e.type === 'soldierHit')).toBe(false);
    expect(enemy.life).toBe(80);
  });
});
