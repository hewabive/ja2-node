import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { SlotKind, slotArgument, slotKind, timelineSlot } from '../../../content/anim/timelines.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { createItem } from '../../items/object.ts';
import { anim, animName } from '../anim-states.ts';
import { AnimHeight, changeSoldierState, endHeight } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { createPhysicalObject } from '../explosions/physics.ts';
import { ThrowAction } from '../explosions/state.ts';
import { vec3 } from '../explosions/vec3.ts';
import { type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { AiAction, Situation } from './actions.ts';
import { handleSoldierAI } from './control.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const RELEASE_ATTACK_BUSY_COUNT = 753;
const NO_OPCODE = -1;
const SHOT_TICKS = 3000;
const IDLE_TICKS = 3000;
const APS_FOR_A_CROUCH_BUT_NO_SHOT = 4;
const FRAME_OF_THE_FIRST_ROUND = 4;

function enemyAttackingWithNewSituation(action: number) {
  const sim = newCombatSim(content);
  const t = sim.state;
  spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
  const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 88), Direction.NORTH);
  sim.lookAround();
  expect(t.inCombat).toBe(true);
  t.turn.currentTeam = Team.ENEMY;
  enemy.aiTurnControl = true;
  enemy.ai.action = action;
  enemy.ai.actionInProgress = true;
  enemy.ai.newSituation = Situation.IS_NEW;
  t.turn.attackBusyCount = 2;
  return { sim, t, enemy };
}

function nextCode(t: TacticalState, s: Soldier): number {
  const slot = timelineSlot(s.state, s.pc);
  return slotKind(t.content.timeline, slot) === SlotKind.OP ? slotArgument(t.content.timeline, slot) : NO_OPCODE;
}

function onTheLastFrameOfHisShot(t: TacticalState, s: Soldier): boolean {
  return (
    s.ai.action === AiAction.FIRE_GUN &&
    animName(t.content, s.state) === 'SHOOT_RIFLE_STAND' &&
    nextCode(t, s) === RELEASE_ATTACK_BUSY_COUNT
  );
}

function shooterWithNewSituationOnTheLastFrameOfHisShot() {
  const sim = newCombatSim(content);
  const t = sim.state;
  spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { life: 100 });
  const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 88), Direction.NORTH);
  sim.lookAround();
  expect(sim.dispatch({ type: 'endTurn' }).ok).toBe(true);
  for (let tick = 0; tick < SHOT_TICKS && !onTheLastFrameOfHisShot(t, enemy); tick++) sim.step();
  expect(onTheLastFrameOfHisShot(t, enemy)).toBe(true);
  expect([t.bullets.length, t.turn.attackBusyCount]).toEqual([0, 1]);
  enemy.ai.newSituation = Situation.IS_NEW;
  return { sim, t, enemy };
}

describe('a new situation during an attack', () => {
  it('clears the attack busy count for a tosser once nothing is in the air', () => {
    const { sim, t, enemy } = enemyAttackingWithNewSituation(AiAction.TOSS_PROJECTILE);
    handleSoldierAI(t, enemy, sim.ai);
    expect(t.turn.attackBusyCount).toBe(0);
    expect(enemy.ai.newSituation).not.toBe(Situation.IS_NEW);
  });

  it('waits for the attack while the thrown object is still flying', () => {
    const { sim, t, enemy } = enemyAttackingWithNewSituation(AiAction.TOSS_PROJECTILE);
    const grenade = createItem(content.items, content.items.byName.get('HAND_GRENADE')?.index ?? -1, 100);
    createPhysicalObject(t, grenade, -1, vec3(800, 800, 10), vec3(), enemy, ThrowAction.ARM_ITEM, null);
    handleSoldierAI(t, enemy, sim.ai);
    expect(t.turn.attackBusyCount).toBe(2);
    expect(enemy.ai.action).toBe(AiAction.TOSS_PROJECTILE);
    expect(enemy.ai.newSituation).toBe(Situation.IS_NEW);
  });

  it('waits on the last frame of a shot whose bullet is gone until the shot releases its attack busy count', () => {
    const { sim, t, enemy } = shooterWithNewSituationOnTheLastFrameOfHisShot();
    handleSoldierAI(t, enemy, sim.ai);
    expect([enemy.ai.action, enemy.ai.newSituation, t.turn.attackBusyCount]).toEqual([AiAction.FIRE_GUN, Situation.IS_NEW, 1]);
  });

  it('ends the enemy turn when the action a new situation picks on the last frame of a shot would cut the shot', () => {
    const { sim, t, enemy } = shooterWithNewSituationOnTheLastFrameOfHisShot();
    enemy.actionPoints = APS_FOR_A_CROUCH_BUT_NO_SHOT;
    runUntilIdle(sim, IDLE_TICKS);
    expect([t.turn.currentTeam, t.turn.attackBusyCount]).toEqual([Team.OUR, 0]);
    expect(endHeight(t.content, enemy.state)).toBe(AnimHeight.CROUCH);
  });

  it('waits between the rounds of a burst until the burst releases its attack busy count', () => {
    const { sim, t, enemy } = enemyAttackingWithNewSituation(AiAction.FIRE_GUN);
    changeSoldierState(t, enemy, anim(content, 'STANDING_BURST'), FRAME_OF_THE_FIRST_ROUND);
    handleSoldierAI(t, enemy, sim.ai);
    expect([enemy.ai.action, enemy.ai.newSituation]).toEqual([AiAction.FIRE_GUN, Situation.IS_NEW]);
  });
});
