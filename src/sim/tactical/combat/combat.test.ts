import { beforeAll, describe, expect, it } from 'vitest';
import { estimateAttack, newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { testProfile } from '../../../../tests/support/profiles.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { AnimFlags } from '../../../content/anim/tables.ts';
import { CELL_X_SIZE, CELL_Y_SIZE, Direction, gridNo } from '../../../content/world/grid.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { syntheticStructure } from '../../../content/world/synthetic.ts';
import type { SimEvent } from '../../events.ts';
import { createItem, type ItemObject } from '../../items/object.ts';
import { ProfileFlag } from '../../narrative/narrative-ids.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import { Fact } from '../../strategic/narrative/fact-ids.ts';
import { Npc } from '../../strategic/narrative/npc-ids.ts';
import { adjustNoAPToFinishMove, hasAnimFlag, states } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot, itemIn } from '../inventory.ts';
import { landHeightUnits, ZPos } from '../perception/los.ts';
import { Opp } from '../perception/opp.ts';
import { Body, SoldierClass, Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { checkForGunJam, FireResult, handleItem, ItemHandle } from './attack.ts';
import { chanceOfBulletHittingStructure, fireBulletGivenTarget, soldierToSoldierChanceToGetThrough } from './bullets.ts';
import { calcChanceToHitGun, ENEMY_TO_HIT_MOD, gunRange, soldierDifficultyLevel } from './chance.ts';
import { soldierTakeDamage } from './hit.ts';
import { adjustImpactByHitLocation } from './impact.ts';
import { calculateSoldierZPos, losWorldOf } from './positions.ts';
import { AimShot, DamageReason } from './types.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const newSim = (walls: readonly number[] = []) => newCombatSim(content, walls);
const spawn = (sim: TacticalSim, id: number, team: number, at: number, direction: number, marksmanship = 70, life = 80) =>
  spawnSoldier(sim, id, team, at, direction, { marksmanship, life });
const run = runUntilIdle;
const HARD_DIFFICULTY = 3;
const AVERAGE_DIFFICULTY_MODIFIER = 50;
const TOP_DIFFICULTY_MODIFIER = 100;
const ATTACK_TICKS = 2000;

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

describe('bullet flight (LOS.cc MoveBullet)', () => {
  const COLUMN = 80;
  const RISE_ROW = 85;
  const RISEN_LAND_PIXELS = 23;
  const tileCentre = (cell: number, size: number) => cell * size + size / 2;

  it('a level bullet into rising ground stops at the ground and hits it', () => {
    const sim = newCombatSim(content, [], 3, new Set(), (world) => {
      for (let row = RISE_ROW; row < RISE_ROW + 10; row++) world.level.heights[gridNo(COLUMN, row)] = RISEN_LAND_PIXELS;
    });
    const t = sim.state;
    const kid = spawn(sim, 0, Team.CIV, gridNo(COLUMN, 80), Direction.SOUTH);
    kid.bodyType = Body.KIDCIV;
    kid.attackingWeapon = itemIn(kid.inv, InvSlot.HAND);
    const aim = calculateSoldierZPos(t, kid, ZPos.FIRING);
    const risenLand = landHeightUnits(losWorldOf(t), gridNo(COLUMN, RISE_ROW));
    expect(aim).toBeGreaterThan(risenLand - 1);
    expect(aim).toBeLessThan(risenLand);
    const targetX = tileCentre(COLUMN, CELL_X_SIZE);
    const targetY = tileCentre(RISE_ROW + 5, CELL_Y_SIZE);
    fireBulletGivenTarget(t, kid, targetX, targetY, aim, kid.attackingWeapon, 10, false, false);
    const events: SimEvent[] = [];
    for (let tick = 0; tick < 100 && t.bullets.length > 0; tick++) {
      sim.step();
      events.push(...sim.drainEvents());
    }
    expect(t.bullets).toEqual([]);
    expect(events.find((e) => e.type === 'bulletStopped')).toMatchObject({ reason: 'ground', gridNo: gridNo(COLUMN, RISE_ROW) });
    const impactRows = events.flatMap((e) => (e.type === 'bulletImpact' ? [Math.trunc(e.y / CELL_Y_SIZE)] : []));
    expect(impactRows).toEqual([RISE_ROW + 1]);
  });
});

describe('bullet speed (LOS.cc FireBulletGivenTarget)', () => {
  function stepTimes(weapon: string): number[] {
    const sim = newSim();
    const t = sim.state;
    const firer = spawn(sim, 0, Team.CREATURE, gridNo(80, 80), Direction.SOUTH);
    firer.inv[InvSlot.HAND] = createItem(content.items, content.items.byName.get(weapon)?.index ?? 0, 100);
    firer.attackingWeapon = itemIn(firer.inv, InvSlot.HAND);
    const aim = calculateSoldierZPos(t, firer, ZPos.FIRING);
    fireBulletGivenTarget(t, firer, 80 * CELL_X_SIZE + 5, 95 * CELL_Y_SIZE + 5, aim, firer.attackingWeapon, 10, false, false);
    const [bullet] = t.bullets;
    if (!bullet) throw new Error('no bullet in flight');
    const times: number[] = [];
    for (let tick = 0; tick < 40 && t.bullets.includes(bullet); tick++) {
      const before = bullet.y;
      sim.step();
      if (bullet.y !== before) times.push(t.clockMs);
    }
    return times.slice(1).map((ms, k) => ms - (times[k] ?? 0));
  }

  it('steps a creature spit every 25 ms: its weapon model sets the bullet speed of 250 that weapons.json leaves out', () => {
    const gaps = stepTimes('CREATURE_QUEEN_SPIT');
    expect(gaps.length).toBeGreaterThan(2);
    expect(new Set(gaps)).toEqual(new Set([25]));
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

describe('the chance to get through of the LAW and the tank cannon (LOS.cc CalcChanceToGetThrough)', () => {
  function chanceThrough(gun: string, cover: readonly number[]) {
    const sim = newCombatSim(content, [], 3, new Set(), (world) => {
      for (const g of cover) world.structures.add(g, 0, syntheticStructure(StructureFlags.GENERIC));
    });
    const shooter = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { gun });
    shooter.attackingWeapon = content.items.byName.get(gun)?.index ?? -1;
    const target = spawn(sim, 20, Team.ENEMY, gridNo(80, 88), Direction.NORTH);
    return soldierToSoldierChanceToGetThrough(sim.state, shooter, target);
  }

  it('divides by the impact of 80 their weapon models set: all of it reaches a target in the open', () => {
    for (const gun of ['ROCKET_LAUNCHER', 'TANK_CANNON']) expect(chanceThrough(gun, [])).toBe(100);
  });

  it('lets cover take its chance to be hit as a share of that impact, truncating the rest', () => {
    const coverBeforeTarget = [gridNo(80, 86)];
    for (const gun of ['ROCKET_LAUNCHER', 'TANK_CANNON']) expect(chanceThrough(gun, coverBeforeTarget)).toBe(93);
    expect(chanceThrough('GLOCK_17', coverBeforeTarget)).toBe(100);
  });
});

describe('chance to hit (Weapons.cc CalcChanceToHitGun)', () => {
  function aimedAt(shooterTeam: number) {
    const sim = newSim();
    const shooter = spawn(sim, 0, shooterTeam, gridNo(80, 80), Direction.SOUTH);
    const target = spawn(sim, 20, shooterTeam === Team.OUR ? Team.ENEMY : Team.OUR, gridNo(80, 86), Direction.NORTH);
    shooter.attackingHand = InvSlot.HAND;
    shooter.attackingWeapon = itemIn(shooter.inv, InvSlot.HAND);
    const chance = () => calcChanceToHitGun(sim.state, shooter, target.gridNo, 0, AimShot.TORSO, false);
    return { sim, shooter, target, chance };
  }

  it('lets a target who sees the shooter dodge only a shot of the creature queen: the original tests !(body != QUEENMONSTER)', () => {
    const { shooter, target, chance } = aimedAt(Team.ENEMY);
    target.stats.agility = 100;
    const chanceWhenTargetSees = (sees: boolean) => {
      target.oppList[shooter.id] = sees ? Opp.SEEN_CURRENTLY : Opp.NOT_HEARD_OR_SEEN;
      return chance();
    };
    expect(chanceWhenTargetSees(true)).toBe(chanceWhenTargetSees(false));
    shooter.bodyType = Body.QUEENMONSTER;
    expect(chanceWhenTargetSees(true)).toBeLessThan(chanceWhenTargetSees(false));
  });

  it('gives an enemy only the penalties of the difficulty table, never its bonuses: the original takes min(0, mod)', () => {
    const { sim, shooter, chance } = aimedAt(Team.ENEMY);
    Object.assign(sim.state, { options: { ...sim.state.options, difficulty: HARD_DIFFICULTY } });
    const chanceAtLevel = (soldierClass: number, difficultyModifier: number, level: number) => {
      sim.state.campaign.difficultyModifier = difficultyModifier;
      Object.assign(shooter, { soldierClass });
      expect(soldierDifficultyLevel(sim.state, shooter)).toBe(level);
      return chance();
    };
    const average = chanceAtLevel(SoldierClass.ARMY, AVERAGE_DIFFICULTY_MODIFIER, 2);
    expect(chanceAtLevel(SoldierClass.ELITE, TOP_DIFFICULTY_MODIFIER, 4)).toBe(average);
    expect(chanceAtLevel(SoldierClass.ADMINISTRATOR, 0, 0)).toBe(average + (ENEMY_TO_HIT_MOD[0] ?? 0));
  });
});

describe('the barrel extender (Weapons.cc CalcChanceToHitGun)', () => {
  const EXTENDER_STATUS = 30;
  const NO_WEAR = 0;

  function shootWithExtender(fallRolls: readonly [number, number]) {
    const sim = newSim();
    const t = sim.state;
    const merc = spawn(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawn(sim, 20, Team.ENEMY, gridNo(80, 86), Direction.NORTH);
    const extender = content.items.byName.get('GUN_BARREL_EXTENDER')?.index ?? -1;
    const gun = merc.inv[InvSlot.HAND] as ItemObject;
    gun.attachments[0] = { item: extender, status: EXTENDER_STATUS };
    merc.attackingWeapon = gun.item;
    const rng = new ScriptedStream([NO_WEAR, ...fallRolls]);
    Object.assign(t, { rng });
    const chance = calcChanceToHitGun(t, merc, enemy.gridNo, 0, AimShot.TORSO, true);
    const dropped = t.worldItems.filter((i) => i.object.item === extender);
    return { gun, extender, chance, dropped, merc, rng };
  }

  it('falls off only when its status less two Random(35) is 0 to 9: the original subtracts unsigned, so larger rolls wrap and it holds', () => {
    const holds = shootWithExtender([34, 34]);
    expect(holds.rng.requested).toEqual([2, 35, 35]);
    expect(holds.gun.attachments[0]).toEqual({ item: holds.extender, status: EXTENDER_STATUS });
    expect(holds.dropped).toEqual([]);
    const fallsOff = shootWithExtender([12, 10]);
    expect(fallsOff.gun.attachments[0]?.item).toBe(0);
    expect(fallsOff.chance).toBeLessThan(holds.chance);
  });

  it('drops a fallen extender at the feet of the shooter with its status', () => {
    const { dropped, merc } = shootWithExtender([12, 10]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ gridNo: merc.gridNo, level: merc.level, object: { status: [EXTENDER_STATUS] } });
  });
});

describe('gun attacks', () => {
  it('rolls PreRandom twice in the jam check even for a gun above 80 %, which can never jam', () => {
    const sim = newSim();
    const merc = spawn(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.attackingHand = InvSlot.HAND;
    merc.attackingWeapon = itemIn(merc.inv, InvSlot.HAND);
    expect(merc.inv[InvSlot.HAND]?.status[0]).toBe(100);
    const pre = new ScriptedStream([], 0);
    Object.assign(sim.state, { pre });
    expect(checkForGunJam(sim.state, merc)).toBe(FireResult.FIREABLE);
    expect(pre.requested).toEqual([100, 100]);
  });

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

  it('lets a bullet strike a bystander in its path only if the player sees him: MoveBullet tests bVisible', () => {
    const hitSoldiers = (bystanderVisible: number) => {
      const sim = newSim();
      spawn(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, 100);
      const bystander = spawn(sim, 21, Team.ENEMY, gridNo(80, 84), Direction.NORTH);
      const enemy = spawn(sim, 20, Team.ENEMY, gridNo(80, 88), Direction.NORTH);
      sim.lookAround();
      sim.drainEvents();
      bystander.visible = bystanderVisible;
      expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo, aimTime: 4 }).ok).toBe(true);
      const events: SimEvent[] = [];
      for (let tick = 0; tick < ATTACK_TICKS && !sim.isIdle(); tick++) {
        sim.step();
        events.push(...sim.drainEvents());
      }
      return events.flatMap((e) => (e.type === 'soldierHit' ? [e.soldier] : []));
    };
    expect(hitSoldiers(1)).toEqual([21]);
    expect(hitSoldiers(0)).toEqual([20]);
  });
});
