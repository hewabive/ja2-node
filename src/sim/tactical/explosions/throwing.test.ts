import { beforeAll, describe, expect, it } from 'vitest';
import { progressFor } from '../../../../tests/support/autoresolve.ts';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { countDraws, itemId, objectOf, runExplosivesUntilIdle } from '../../../../tests/support/explosives.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { DIRECTION_INCREMENT, Direction, gridNo, newGridNo } from '../../../content/world/grid.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import { anim } from '../anim-states.ts';
import { minAPsToThrow } from '../combat/ap.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { returnThrownObject } from '../perception/wiring.ts';
import { type ProfileProgress, StatKind } from '../profiles.ts';
import { type Soldier, Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { ThrowAction } from './state.ts';
import { calcThrownChanceToHit, cancelPendingThrow, releaseThrow, throwOpcode, useLauncher, useThrown } from './throwing.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

describe('UseThrown', () => {
  it('rolls at the order, readies the throw animation and takes one grenade from the stack', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const target = gridNo(80, 88);
    const stack = objectOf(t, 'HAND_GRENADE');
    stack.count = 2;
    stack.status = [100, 90];
    s.inv[InvSlot.HAND] = stack;
    s.targetGridNo = target;
    s.targetLevel = 0;
    t.inCombat = true;
    t.turn.attackBusyCount++;
    const draws = countDraws(t, () => {
      const roll = useThrown(t, s, target);
      expect(roll.chance).toBe(83);
    });
    expect(draws).toEqual({ pre: 1, main: 0 });
    expect(s.pendingAnimation).toBe(anim(t.content, 'THROW_ITEM'));
    expect(s.target).toBeNull();
    expect(s.inv[InvSlot.HAND]?.count).toBe(1);
    expect(s.tempObject?.item).toBe(itemId(t, 'HAND_GRENADE'));
    expect(t.explosives.throwParams.get(s.id)?.action).toBe(ThrowAction.ARM_ITEM);
    const before = s.actionPoints;
    expect(throwOpcode(t, s, 460)).toBe('continue');
    expect(before - s.actionPoints).toBe(13);
    expect(s.tempObject).toBeNull();
    const events = runExplosivesUntilIdle(sim);
    expect(events.find((e) => e.type === 'explosion')).toMatchObject({ item: itemId(t, 'HAND_GRENADE') });
    expect(t.turn.attackBusyCount).toBe(0);
  });

  it('lobs at close range and hands back the object when the throw is called off', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    s.inv[InvSlot.HAND] = objectOf(t, 'HAND_GRENADE');
    s.targetGridNo = gridNo(80, 83);
    useThrown(t, s, gridNo(80, 83));
    expect(s.pendingAnimation).toBe(anim(t.content, 'LOB_ITEM'));
    expect(s.inv[InvSlot.HAND]?.count).toBe(0);
    expect(cancelPendingThrow(s)?.item).toBe(itemId(t, 'HAND_GRENADE'));
    expect(releaseThrow(t, s)).toBeNull();
  });
});

describe("the original's throw quirks", () => {
  const MERC_PROFILE = 5;
  const TARGET = gridNo(80, 88);

  function thrower(sim: TacticalSim, profile?: number): Soldier {
    const t = sim.state;
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, profile === undefined ? {} : { profile });
    s.inv[InvSlot.HAND] = objectOf(t, 'HAND_GRENADE');
    s.targetGridNo = TARGET;
    s.targetLevel = 0;
    t.inCombat = true;
    t.turn.attackBusyCount++;
    return s;
  }

  function withProgress(sim: TacticalSim): ProfileProgress {
    const progress = progressFor(MERC_PROFILE);
    sim.state.profiles.set(MERC_PROFILE, progress);
    return progress;
  }

  it('takes a teammate northwest of an empty target for a victim: the neighbour search keeps the last tile it looked at', () => {
    const strengthChancesWithMateAt = (direction: number) => {
      const sim = newCombatSim(content);
      const s = thrower(sim, MERC_PROFILE);
      const progress = withProgress(sim);
      spawnSoldier(sim, 1, Team.OUR, newGridNo(TARGET, DIRECTION_INCREMENT[direction] ?? 0), Direction.NORTH);
      useThrown(sim.state, s, TARGET);
      return progress.statChangeChances[StatKind.STRENGTH];
    };
    expect(strengthChancesWithMateAt(Direction.NORTH)).toBe(0);
    expect(strengthChancesWithMateAt(Direction.NORTHWEST)).toBe(5);
  });

  it('lands a roll equal to the chance on the target, yet grants the experience of a miss', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = thrower(sim, MERC_PROFILE);
    const progress = withProgress(sim);
    spawnSoldier(sim, 20, Team.ENEMY, TARGET, Direction.NORTH);
    const chance = calcThrownChanceToHit(t, s, TARGET, 0);
    const failedStatRoll = 99;
    const pre = new ScriptedStream([chance], failedStatRoll);
    Object.assign(t, { pre });
    useThrown(t, s, TARGET);
    const hitRoll = 1;
    const statRolls = 5 + 2 + 2;
    expect(pre.requested).toEqual(new Array(hitRoll + statRolls).fill(100));
    expect(progress.statChangeChances[StatKind.DEXTERITY]).toBe(2);
    expect(progress.statChangeChances[StatKind.MARKSMANSHIP]).toBe(2);
  });

  it('adds the aim to the chance of a throw but never charges it', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = thrower(sim);
    const unaimed = calcThrownChanceToHit(t, s, TARGET, 0);
    const throwCost = minAPsToThrow(t, s, TARGET);
    s.aimTime = 2;
    expect(useThrown(t, s, TARGET).chance).toBeGreaterThan(unaimed);
    const before = s.actionPoints;
    throwOpcode(t, s, 460);
    expect(before - s.actionPoints).toBe(throwCost);
  });

  it('hands back the copy of the whole stack when a sighting calls the throw off, one grenade more than it took', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = thrower(sim);
    const stack = objectOf(t, 'HAND_GRENADE');
    stack.count = 2;
    stack.status = [100, 100];
    s.inv[InvSlot.HAND] = stack;
    useThrown(t, s, TARGET);
    expect(s.inv[InvSlot.HAND]?.count).toBe(1);
    returnThrownObject(t, s);
    const grenades = s.inv.reduce((n, o) => n + (o?.item === itemId(t, 'HAND_GRENADE') ? o.count : 0), 0);
    expect(grenades).toBe(3);
  });
});

describe('UseLauncher', () => {
  it('fires the attached grenade at once after the misfire dice and pays the launcher APs', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const launcher = objectOf(t, 'GLAUNCHER');
    const slot = launcher.attachments[0];
    if (!slot) throw new Error('no attachment slot');
    slot.item = itemId(t, 'GL_HE_GRENADE');
    slot.status = 100;
    s.inv[InvSlot.HAND] = launcher;
    s.attackingWeapon = launcher.item;
    s.targetGridNo = gridNo(80, 100);
    s.targetLevel = 0;
    t.inCombat = true;
    t.turn.attackBusyCount++;
    const before = s.actionPoints;
    const o = useLauncher(t, s, s.targetGridNo);
    expect(o?.object.item).toBe(itemId(t, 'GL_HE_GRENADE'));
    expect(launcher.attachments[0]?.item).toBe(0);
    expect(before).toBeGreaterThan(s.actionPoints);
    const events = runExplosivesUntilIdle(sim);
    const blast = events.find((e) => e.type === 'explosion');
    expect(blast).toMatchObject({ item: itemId(t, 'GL_HE_GRENADE'), owner: 0 });
    expect(t.turn.attackBusyCount).toBe(0);
  });
});
