import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { countDraws, itemId, objectOf, runExplosivesUntilIdle } from '../../../../tests/support/explosives.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { anim } from '../anim-states.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { Team } from '../soldier.ts';
import { ThrowAction } from './state.ts';
import { cancelPendingThrow, releaseThrow, throwOpcode, useLauncher, useThrown } from './throwing.ts';

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
