import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { spawnCreature } from '../../../../tests/support/creatures.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { PreRandom, Rng } from '../../../core/rng.ts';
import { createItem } from '../../items/object.ts';
import { animName } from '../anim-states.ts';
import { states } from '../animation.ts';
import { minAPsToAttack } from '../combat/ap.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { getNewSoldierPath } from '../movement.ts';
import { Opp } from '../perception/opp.ts';
import { distanceVisible } from '../perception/sight.ts';
import { AlertStatus, Body, NOBODY, NOWHERE, type Soldier, Team } from '../soldier.ts';
import { AiAction } from './actions.ts';
import { decideNpcAction } from './control.ts';
import { CreatureCallKind, creatureCall, Mobility, trackScent } from './creature-decide.ts';
import { decideAlertStatus } from './decide.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const HUMAN_SMELL = 10;
const REGENERATED_LIFE = 10;

function merc(sim: ReturnType<typeof newCombatSim>, id: number, at: number): Soldier {
  const s = spawnSoldier(sim, id, Team.OUR, at, Direction.NORTH);
  s.normalSmell = HUMAN_SMELL;
  return s;
}

function sees(viewer: Soldier, target: Soldier): void {
  viewer.oppList[target.id] = Opp.SEEN_CURRENTLY;
  viewer.lastKnownOpp[target.id] = target.gridNo;
  viewer.ai.oppCount = 1;
}

describe('creature alert status', () => {
  it('sets the mobility by body, keeps larvae green and turns black on sight without changing orders', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const prey = merc(sim, 0, gridNo(80, 80));
    const larva = spawnCreature(sim, 52, Body.LARVAE_MONSTER, gridNo(80, 84), Direction.NORTH);
    const queen = spawnCreature(sim, 53, Body.QUEENMONSTER, gridNo(70, 70), Direction.SOUTH);
    const female = spawnCreature(sim, 54, Body.ADULTFEMALEMONSTER, gridNo(84, 80), Direction.WEST);
    for (const c of [larva, queen, female]) sees(c, prey);
    for (const c of [larva, queen, female]) decideAlertStatus(t, c, sim.ai.hooks);
    expect([larva.ai.mobility, queen.ai.mobility, female.ai.mobility]).toEqual([Mobility.CRAWLER, Mobility.IMMOBILE, Mobility.MOBILE]);
    expect(larva.ai.alertStatus).toBe(AlertStatus.GREEN);
    expect(female.ai.alertStatus).toBe(AlertStatus.BLACK);
    expect(female.ai.newSituation).not.toBe(0);
  });
});

describe('CreatureCall', () => {
  it('raises hearing creatures to RED with a priority that falls with distance and frenzies close females', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const queen = spawnCreature(sim, 52, Body.QUEENMONSTER, gridNo(80, 80), Direction.SOUTH);
    const near = spawnCreature(sim, 53, Body.ADULTFEMALEMONSTER, gridNo(80, 90), Direction.NORTH);
    const far = spawnCreature(sim, 54, Body.YAM_MONSTER, gridNo(80, 140), Direction.NORTH);
    const infant = spawnCreature(sim, 55, Body.INFANT_MONSTER, gridNo(82, 82), Direction.NORTH);
    queen.ai.actionData = CreatureCallKind.ATTACKED;
    creatureCall(t, queen);
    expect(t.perception.awareOfOpposition[Team.CREATURE]).toBe(true);
    expect(animName(content, queen.state)).toBe('QUEEN_CALL');
    expect(near).toMatchObject({ ai: { callPriority: 12, alertStatus: AlertStatus.RED, caller: queen.id, frenzied: true } });
    expect(near.ai.callerGridNo).toBe(queen.gridNo);
    expect(far.ai).toMatchObject({ callPriority: 10, alertStatus: AlertStatus.RED, frenzied: false });
    expect(infant.ai).toMatchObject({ callPriority: 0, caller: NOBODY });
  });
});

describe('CreatureDecideActionBlack', () => {
  it('lets an adult female claw the merc next to her', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const prey = merc(sim, 0, gridNo(80, 80));
    const female = spawnCreature(sim, 52, Body.ADULTFEMALEMONSTER, gridNo(80, 81), Direction.NORTH, { alert: AlertStatus.BLACK });
    sees(female, prey);
    t.perception.awareOfOpposition[Team.CREATURE] = true;
    expect(decideNpcAction(t, female, sim.ai)).toBe(AiAction.KNIFE_MOVE);
    expect(female.ai.actionData).toBe(prey.gridNo);
    expect(female.inv[InvSlot.HAND]?.item).toBe(content.items.byName.get('CREATURE_OLD_FEMALE_CLAWS')?.index);
  });

  it('spits from range and keeps the claws in hand when the walk is too long', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const prey = merc(sim, 0, gridNo(80, 80));
    const male = spawnCreature(sim, 52, Body.YAM_MONSTER, gridNo(80, 96), Direction.NORTH, { alert: AlertStatus.BLACK });
    sees(male, prey);
    t.perception.awareOfOpposition[Team.CREATURE] = true;
    const action = decideNpcAction(t, male, sim.ai);
    expect(action).toBe(AiAction.FIRE_GUN);
    expect(male.ai.actionData).toBe(prey.gridNo);
    expect(male.inv[InvSlot.HAND]?.item).toBe(content.items.byName.get('CREATURE_YOUNG_MALE_SPIT')?.index);
  });

  it('draws the bloodcat bite one time in three and leaves it in hand when the cat cannot afford it', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const prey = merc(sim, 0, gridNo(80, 80));
    const cat = spawnCreature(sim, 52, Body.BLOODCAT, gridNo(80, 84), Direction.NORTH, { alert: AlertStatus.BLACK });
    sees(cat, prey);
    t.perception.awareOfOpposition[Team.CREATURE] = true;
    const claws = content.items.byName.get('BLOODCAT_CLAW_ATTACK')?.index ?? 0;
    const bite = content.items.byName.get('BLOODCAT_BITE')?.index ?? 0;
    const rolls: number[] = [];
    for (let k = 0; k < 12; k++) {
      cat.inv[InvSlot.HAND] = createItem(content.items, claws, 100);
      cat.inv[InvSlot.SECOND_HAND] = createItem(content.items, bite, 100);
      cat.actionPoints = 3;
      cat.ai.alertStatus = AlertStatus.BLACK;
      expect(minAPsToAttack(t, cat, cat.lastTarget, false)).toBeGreaterThan(cat.actionPoints);
      const roll = PreRandom.fromState(t.pre.state(), Rng.fromState(t.rng.state())).int(3);
      rolls.push(roll);
      decideNpcAction(t, cat, sim.ai);
      expect(cat.inv[InvSlot.HAND]?.item).toBe(roll === 0 ? bite : claws);
    }
    expect(rolls).toContain(0);
  });
});

function playCreatureTurn(sim: ReturnType<typeof newCombatSim>) {
  sim.lookAround();
  const events = runUntilIdle(sim);
  if (sim.state.inCombat && sim.state.turn.currentTeam === Team.OUR) {
    expect(sim.dispatch({ type: 'endTurn' }).ok).toBe(true);
    events.push(...runUntilIdle(sim));
  }
  return events;
}

describe('creature turn', () => {
  it('claws the merc on the creature turn and settles the attack', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const prey = merc(sim, 0, gridNo(80, 80));
    const female = spawnCreature(sim, 52, Body.ADULTFEMALEMONSTER, gridNo(80, 81), Direction.NORTH);
    const events = playCreatureTurn(sim);
    expect(female.oppList[prey.id]).toBe(Opp.SEEN_CURRENTLY);
    expect(events.some((e) => e.type === 'meleeStrike' && e.soldier === female.id && e.target === prey.gridNo)).toBe(true);
    expect(t.turn.attackBusyCount).toBe(0);
  });

  it('lets a bloodcat strike the merc next to it with claws or teeth', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const prey = merc(sim, 0, gridNo(80, 80));
    const cat = spawnCreature(sim, 52, Body.BLOODCAT, gridNo(80, 81), Direction.NORTH);
    const events = playCreatureTurn(sim);
    const strikes = events.filter((e) => e.type === 'meleeStrike' && e.soldier === cat.id && e.target === prey.gridNo);
    expect(strikes.length).toBeGreaterThan(0);
    expect(t.turn.attackBusyCount).toBe(0);
  });

  it('lets the queen spit at a merc in range', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    merc(sim, 0, gridNo(80, 80));
    const queen = spawnCreature(sim, 52, Body.QUEENMONSTER, gridNo(80, 87), Direction.NORTH);
    const events = playCreatureTurn(sim);
    expect(events.some((e) => e.type === 'shotFired' && e.soldier === queen.id)).toBe(true);
    expect(t.turn.attackBusyCount).toBe(0);
  });

  it('bites the head of a dying merc and regenerates on its next turn', () => {
    const sim = newCombatSim(content);
    const prey = merc(sim, 0, gridNo(80, 80));
    const female = spawnCreature(sim, 52, Body.ADULTFEMALEMONSTER, gridNo(80, 81), Direction.NORTH);
    prey.life = 10;
    female.life = 40;
    const events = playCreatureTurn(sim);
    expect(events.some((e) => e.type === 'soldierHit' && e.attacker === female.id && e.location === 'head')).toBe(true);
    expect(events.some((e) => e.type === 'soldierDied' && e.soldier === prey.id)).toBe(true);
    expect(female.life).toBe(40 + REGENERATED_LIFE);
  });

  it('spits creature gas at the merc', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    merc(sim, 0, gridNo(80, 80));
    const infant = spawnCreature(sim, 52, Body.INFANT_MONSTER, gridNo(80, 88), Direction.NORTH);
    const events = playCreatureTurn(sim);
    expect(events.some((e) => e.type === 'shotFired' && e.soldier === infant.id)).toBe(true);
    expect(t.explosives.smokeClouds.some((c) => c !== null)).toBe(true);
    expect(t.turn.attackBusyCount).toBe(0);
  });
});

describe('creature senses', () => {
  it('smells a merc in the dark at the full range and cannot smell an empty tile', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const prey = merc(sim, 0, gridNo(80, 80));
    const female = spawnCreature(sim, 52, Body.ADULTFEMALEMONSTER, gridNo(80, 100), Direction.NORTH);
    expect(distanceVisible(t, female, -1, -1, prey.gridNo, 0)).toBe(26);
    expect(distanceVisible(t, female, -1, -1, gridNo(90, 90), 0)).toBe(0);
    prey.monsterSmell = 5;
    expect(distanceVisible(t, female, -1, -1, prey.gridNo, 0)).toBe(13);
  });

  it('runs a creature with the adult monster walking state', () => {
    const sim = newCombatSim(content);
    const female = spawnCreature(sim, 52, Body.ADULTFEMALEMONSTER, gridNo(80, 81), Direction.NORTH);
    expect(getNewSoldierPath(sim.state, female, gridNo(80, 90), states(content.animations).RUNNING)).toBe(true);
    expect(animName(content, female.state)).toBe('ADULTMONSTER_WALKING');
  });
});

describe('TrackScent', () => {
  it('only follows a human trail when the stale action data is a legal destination', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const female = spawnCreature(sim, 52, Body.ADULTFEMALEMONSTER, gridNo(80, 80), Direction.NORTH);
    const trail = gridNo(80, 77);
    t.smell.smell[trail] = 12 << 2;
    female.ai.actionData = NOWHERE;
    expect(trackScent(t, female)).toBe(0);
    female.ai.actionData = gridNo(82, 82);
    expect(trackScent(t, female)).toBe(trail);
    expect(female.ai.actionData).toBe(trail);
  });

  it('draws a coin only when two equally strong trails are equally far off the facing', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const female = spawnCreature(sim, 52, Body.ADULTFEMALEMONSTER, gridNo(80, 80), Direction.NORTH);
    t.smell.smell[gridNo(77, 77)] = 9 << 2;
    t.smell.smell[gridNo(83, 77)] = 9 << 2;
    female.ai.actionData = gridNo(82, 82);
    const before = t.rng.state();
    const clone = Rng.fromState(before);
    trackScent(t, female);
    clone.int(2);
    expect(t.rng.state()).toEqual(clone.state());
  });
});
