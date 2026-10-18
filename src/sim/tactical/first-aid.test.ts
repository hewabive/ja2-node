import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { createItem } from '../items/object.ts';
import { animName } from './anim-states.ts';
import type { TacticalContent } from './content.ts';
import { soldierDressWound } from './first-aid.ts';
import { InvSlot } from './inventory.ts';
import { AP } from './points.ts';
import { NOBODY, Team } from './soldier.ts';
import type { TacticalSim } from './tactical-sim.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const item = (name: string) => content.items.byName.get(name)?.index ?? -1;

function bleedingSquad(sim: TacticalSim) {
  const medic = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
  const patient = spawnSoldier(sim, 1, Team.OUR, gridNo(80, 81), Direction.NORTH);
  medic.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('FIRSTAIDKIT'), 100);
  patient.life = 60;
  patient.bleeding = 12;
  return { medic, patient };
}

function stepTicks(sim: TacticalSim, ticks: number): void {
  for (let k = 0; k < ticks; k++) sim.step();
}

describe('first aid in tactical', () => {
  it('refuses without a kit in the hand and names the patient checks in order', () => {
    const sim = newCombatSim(content);
    const { patient } = bleedingSquad(sim);
    expect(sim.dispatch({ type: 'bandage', soldier: 0, target: 1 })).toMatchObject({ ok: false, data: { refusal: 'noKit' } });
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket1', to: 'hand' })).toMatchObject({ ok: true });
    patient.bleeding = 0;
    expect(sim.dispatch({ type: 'bandage', soldier: 0, target: 1 })).toMatchObject({ ok: false, data: { refusal: 'notBleeding' } });
    patient.life = patient.lifeMax;
    expect(sim.dispatch({ type: 'bandage', soldier: 0, target: 1 })).toMatchObject({ ok: false, data: { refusal: 'noNeed' } });
  });

  it('stops the bleeding of an adjacent merc in real time, spending kit points and ending with END_AID', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const { medic, patient } = bleedingSquad(sim);
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket1', to: 'hand' })).toMatchObject({ ok: true });
    runUntilIdle(sim);
    expect(sim.dispatch({ type: 'bandage', soldier: 0, target: 1 })).toEqual({ ok: true, data: { started: true } });
    expect(animName(t.content, medic.state)).toBe('KNEEL_DOWN');
    expect(medic.servicePartner).toBe(1);
    expect(patient.serviceCount).toBe(1);
    const events = [];
    for (let k = 0; k < 40 && patient.bleeding > 0; k++) {
      stepTicks(sim, 1000);
      events.push(...sim.drainEvents());
    }
    expect(patient.bleeding).toBe(0);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['firstAidStarted', 'bandaged', 'firstAidDone', 'firstAidEnded']));
    expect(medic.servicePartner).toBe(NOBODY);
    expect(patient.serviceCount).toBe(0);
    expect(medic.inv[InvSlot.HAND]?.status[0]).toBeLessThan(100);
  });

  it('charges the crouch and AP_START_FIRST_AID in turn-based combat and dresses the wound with the APs left at the end of the round', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const { medic, patient } = bleedingSquad(sim);
    spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 95), Direction.NORTH);
    sim.lookAround();
    expect(t.inCombat).toBe(true);
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket1', to: 'hand' })).toMatchObject({ ok: true });
    const before = medic.actionPoints;
    expect(sim.dispatch({ type: 'bandage', soldier: 0, target: 1 })).toMatchObject({ ok: true });
    runUntilIdle(sim);
    expect(before - medic.actionPoints).toBe(AP.CROUCH + AP.START_FIRST_AID);
    expect(animName(t.content, medic.state)).toBe('GIVING_AID');
    const bleeding = patient.bleeding;
    expect(sim.dispatch({ type: 'endTurn' })).toEqual({ ok: true });
    runUntilIdle(sim);
    expect(patient.bleeding).toBeLessThan(bleeding);
  });

  it('dresses wounds with the original formula: a medical kit gives half again and costs half the points', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const { medic, patient } = bleedingSquad(sim);
    medic.inv[InvSlot.HAND] = createItem(content.items, item('MEDICKIT'), 100);
    const cost = soldierDressWound(t, medic, patient, 100, 100);
    expect(patient.bleeding).toBe(0);
    expect(cost).toBe(6);
  });

  it('a moving patient or a hand item change ends the service', () => {
    const sim = newCombatSim(content);
    const { medic, patient } = bleedingSquad(sim);
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket1', to: 'hand' })).toMatchObject({ ok: true });
    runUntilIdle(sim);
    expect(sim.dispatch({ type: 'bandage', soldier: 0, target: 1 })).toMatchObject({ ok: true });
    stepTicks(sim, 200);
    expect(sim.dispatch({ type: 'move', soldier: 1, to: gridNo(84, 84) })).toMatchObject({ ok: true });
    stepTicks(sim, 50);
    expect(patient.serviceCount).toBe(0);
    expect(medic.servicePartner).toBe(NOBODY);
  });
});
