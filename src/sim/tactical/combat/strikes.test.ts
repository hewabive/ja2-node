import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { emptyObject } from '../../items/object.ts';
import { anim, animName } from '../anim-states.ts';
import { initNewSoldierAnim, scriptReachesOpcode, states } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { type Soldier, Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { eventSoldierGotHit } from './hit.ts';
import { eventSoldierBeginBladeAttack, eventSoldierBeginPunchAttack } from './melee.ts';
import { Special } from './types.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const FIRE_WEAPON = 430;
const GRAZE = 3;
const BLOW_TICKS = 400;
const HOLDS_OF_A_STAB_UNDER_WAY = 2;

function puncherBesideAKnifeMan(prone: boolean): { sim: TacticalSim; puncher: Soldier; knifeMan: Soldier } {
  const sim = newCombatSim(content);
  const t = sim.state;
  const puncher = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { life: 100 });
  puncher.inv[InvSlot.HAND] = emptyObject();
  const knifeMan = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 81), Direction.NORTH, { gun: 'COMBAT_KNIFE', life: 100 });
  sim.lookAround();
  expect(t.inCombat).toBe(true);
  if (prone) initNewSoldierAnim(t, puncher, states(t.content.animations).PRONE, 0, true);
  puncher.targetGridNo = knifeMan.gridNo;
  eventSoldierBeginPunchAttack(t, puncher, knifeMan.gridNo, Direction.SOUTH);
  return { sim, puncher, knifeMan };
}

function hitByTheKnifeMan(sim: TacticalSim, puncher: Soldier, knifeMan: Soldier): number {
  const t = sim.state;
  t.turn.attackBusyCount++;
  const before = t.turn.attackBusyCount;
  eventSoldierGotHit(t, puncher, knifeMan.inv[InvSlot.HAND]?.item ?? 0, GRAZE, 0, Direction.NORTH, 1, knifeMan, Special.NONE, 0);
  return before - t.turn.attackBusyCount;
}

describe('a strike cut before it releases its attack busy count', () => {
  it('gives back the hold of a punch pending while the puncher gets up when a stab at the puncher stops him', () => {
    const { sim, puncher, knifeMan } = puncherBesideAKnifeMan(true);
    const t = sim.state;
    expect([animName(content, puncher.pendingAnimation), t.turn.attackBusyCount]).toEqual(['PUNCH', 1]);
    eventSoldierBeginBladeAttack(t, knifeMan, puncher.gridNo, Direction.NORTH);
    expect([puncher.pendingAnimation, t.turn.attackBusyCount]).toEqual([-1, HOLDS_OF_A_STAB_UNDER_WAY]);
    runUntilIdle(sim);
    expect(t.turn.attackBusyCount).toBe(0);
  });

  it('gives back the punch and its animation hold when a hit cuts the punch before its blow', () => {
    const { sim, puncher, knifeMan } = puncherBesideAKnifeMan(false);
    const t = sim.state;
    expect([animName(content, puncher.state), t.turn.attackBusyCount]).toEqual(['PUNCH', 2]);
    expect(hitByTheKnifeMan(sim, puncher, knifeMan)).toBe(2);
    expect(animName(content, puncher.state)).not.toBe('PUNCH');
    runUntilIdle(sim);
    expect(t.turn.attackBusyCount).toBe(0);
  });

  it('gives back only the animation hold of a punch whose blow is already out', () => {
    const { sim, puncher, knifeMan } = puncherBesideAKnifeMan(false);
    const t = sim.state;
    const punch = anim(content, 'PUNCH');
    for (let tick = 0; tick < BLOW_TICKS && scriptReachesOpcode(t, puncher.state, puncher.pc, FIRE_WEAPON); tick++) sim.step();
    expect(puncher.state).toBe(punch);
    expect(scriptReachesOpcode(t, puncher.state, puncher.pc, FIRE_WEAPON)).toBe(false);
    expect(hitByTheKnifeMan(sim, puncher, knifeMan)).toBe(1);
    runUntilIdle(sim);
    expect(t.turn.attackBusyCount).toBe(0);
  });
});
