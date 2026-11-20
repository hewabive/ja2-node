import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad, runTicks } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent, kit as medicalKit } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import type { StrategicState } from '../strategic/state.ts';
import { worldHour } from '../strategic/time/world-clock.ts';
import { InvSlot } from '../tactical/inventory.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { flagNothingToDoAfterItemMove } from './nothing-to-do.ts';
import type { Roster, RosterMerc } from './roster.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const WOUND = 20;
const ONE_REAL_SECOND_OF_TICKS = 200;
const ONE_HOUR_OF_TICKS = 3600 * ONE_REAL_SECOND_OF_TICKS;

function merc(roster: Roster, id: number): RosterMerc {
  const m = roster.get(id);
  if (!m) throw new Error(`no merc ${id}`);
  return m;
}

function doctorWithPatient(seed: number): { c: CampaignSim; roster: Roster; doctor: number; patient: number } {
  const { campaign: c, roster } = createTestCampaign(kit, { seed, mercs: 2, garrison: { admins: 0, troops: 0, elites: 0 } });
  landFirstSquad(c);
  expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  const [doctor, patient] = roster.all().map((m) => m.id);
  if (doctor === undefined || patient === undefined) throw new Error('two mercs');
  merc(roster, doctor).soldier.inv[InvSlot.BIGPOCK4] = medicalKit(kit.economy.items, 'MEDICKIT', [100]);
  merc(roster, patient).life -= WOUND;
  expect(c.dispatch({ type: 'assign', soldiers: [doctor], to: { kind: 'doctor' } })).toMatchObject({ ok: true });
  expect(c.dispatch({ type: 'assign', soldiers: [patient], to: { kind: 'patient' } })).toMatchObject({ ok: true });
  expect(merc(roster, doctor).nothingToDo).toBe(false);
  return { c, roster, doctor, patient };
}

describe('nothing-to-do triggers', () => {
  it('re-evaluates at the end of an item move: a doctor who hands his kit away has nothing to do at once', () => {
    const { c, roster, doctor, patient } = doctorWithPatient(8);
    const moved = c.dispatch({ type: 'moveItem', soldier: doctor, from: InvSlot.HAND, toSoldier: patient, to: InvSlot.BIGPOCK1 });
    expect(moved).toMatchObject({ ok: true });
    expect(merc(roster, doctor).nothingToDo).toBe(true);
    expect(c.state.economy.reEvaluateNothingToDo).toBe(false);
  });

  it('leaves the flags stale after a hand swap in tactical, which moves no item through the cursor', () => {
    const { c, roster, doctor, patient } = doctorWithPatient(8);
    merc(roster, patient).life += WOUND;
    expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
    expect(c.dispatch({ type: 'swapHands', soldier: doctor })).toMatchObject({ ok: true });
    expect(merc(roster, doctor).nothingToDo).toBe(false);
  });

  it('raises the flag after a key moved in or out of the key ring, whose cursor ends', () => {
    const state = { economy: { reEvaluateNothingToDo: false } } as StrategicState;
    flagNothingToDoAfterItemMove(state, { type: 'moveKey', soldier: 0, from: { ring: 0 }, to: InvSlot.BIGPOCK1 }, { ok: true });
    expect(state.economy.reEvaluateNothingToDo).toBe(true);
  });

  it('leaves a flag raised on the tactical screen stale until the map screen opens, whose frame acts on it (MapScreen.cc:6541)', () => {
    const { c, roster, doctor, patient } = doctorWithPatient(8);
    expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
    const moved = c.dispatch({ type: 'moveItem', soldier: doctor, from: InvSlot.HAND, toSoldier: patient, to: InvSlot.BIGPOCK1 });
    expect(moved).toMatchObject({ ok: true });
    runTicks(c, ONE_REAL_SECOND_OF_TICKS);
    expect([merc(roster, doctor).nothingToDo, c.state.economy.reEvaluateNothingToDo]).toEqual([false, true]);
    expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    expect([merc(roster, doctor).nothingToDo, c.state.economy.reEvaluateNothingToDo]).toEqual([true, false]);
  });

  it('leaves a flag raised on the tactical screen stale until the hourly update ends with its re-evaluation (Assignments.cc:976)', () => {
    const { c, roster, doctor, patient } = doctorWithPatient(8);
    expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
    const moved = c.dispatch({ type: 'moveItem', soldier: doctor, from: InvSlot.HAND, toSoldier: patient, to: InvSlot.BIGPOCK1 });
    expect(moved).toMatchObject({ ok: true });
    const hour = worldHour(c.state.clock);
    runTicks(c, ONE_HOUR_OF_TICKS, () => worldHour(c.state.clock) !== hour || merc(roster, doctor).nothingToDo);
    expect([worldHour(c.state.clock) !== hour, merc(roster, doctor).nothingToDo, c.state.flow]).toEqual([true, true, 'tactical']);
  });

  it('leaves the flags stale after an assign on the tactical screen, whose list returns at once (Assignments.cc:6459), until the map screen opens', () => {
    const { c, roster, doctor, patient } = doctorWithPatient(8);
    expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
    expect(c.dispatch({ type: 'assign', soldiers: [patient], to: { kind: 'squad', squad: 0 } })).toMatchObject({ ok: true });
    expect([merc(roster, doctor).nothingToDo, c.state.economy.reEvaluateNothingToDo]).toEqual([false, true]);
    expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    expect([merc(roster, doctor).nothingToDo, c.state.economy.reEvaluateNothingToDo]).toEqual([true, false]);
  });

  it('raises nothing at a tactical assign that changes no assignment, where the map screen re-evaluates after its list (Assignments.cc:6629)', () => {
    const { c, roster, doctor, patient } = doctorWithPatient(8);
    merc(roster, patient).life += WOUND;
    expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
    expect(c.dispatch({ type: 'assign', soldiers: [doctor], to: { kind: 'doctor' } })).toMatchObject({ ok: true });
    expect([merc(roster, doctor).nothingToDo, c.state.economy.reEvaluateNothingToDo]).toEqual([false, false]);
    expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    expect(merc(roster, doctor).nothingToDo).toBe(false);
    expect(c.dispatch({ type: 'assign', soldiers: [doctor], to: { kind: 'doctor' } })).toMatchObject({ ok: true });
    expect([merc(roster, doctor).nothingToDo, c.state.economy.reEvaluateNothingToDo]).toEqual([true, false]);
  });

  it('refuses an assign of more than one merc on the tactical screen, whose menu changes its own merc only', () => {
    const { c, roster, doctor, patient } = doctorWithPatient(8);
    expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
    const listed = c.dispatch({ type: 'assign', soldiers: [patient, doctor], to: { kind: 'squad', squad: 0 } });
    expect(listed).toMatchObject({ ok: false, data: { refusal: 'listOnMapScreenOnly' } });
    expect([merc(roster, patient).assignment, merc(roster, doctor).assignment]).toEqual([Assignment.PATIENT, Assignment.DOCTOR]);
  });

  it('acts on a raised flag at the end of the next tick', () => {
    const { c, roster, doctor, patient } = doctorWithPatient(9);
    merc(roster, patient).life += WOUND;
    c.state.economy.reEvaluateNothingToDo = true;
    expect(merc(roster, doctor).nothingToDo).toBe(false);
    c.step();
    expect(merc(roster, doctor).nothingToDo).toBe(true);
    expect(c.state.economy.reEvaluateNothingToDo).toBe(false);
  });
});
