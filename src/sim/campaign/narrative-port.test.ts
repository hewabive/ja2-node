import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad, ourSoldiers, runTicks } from '../../../tests/support/campaign.ts';
import { spawnSoldier } from '../../../tests/support/combat.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { testProfile } from '../../../tests/support/profiles.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { advance } from '../../../tests/support/reload.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { Direction, WORLD_COLS } from '../../content/world/grid.ts';
import { idiv } from '../../core/int.ts';
import { createItem, emptyObject } from '../items/object.ts';
import { Assignment, Town } from '../strategic/economy/constants.ts';
import { putMercInAsleepState } from '../strategic/economy/rest.ts';
import { Npc } from '../strategic/narrative/npc-ids.ts';
import { calcManThreatValue } from '../tactical/ai/morale.ts';
import { animName } from '../tactical/anim-states.ts';
import { InvSlot, itemIn } from '../tactical/inventory.ts';
import { heldPrisoner, onSquad } from '../tactical/narrative/assignment.ts';
import { QuoteSaidExtFlag } from '../tactical/narrative/merc-quotes.ts';
import { calcInterruptDuelPts, seenOpponent } from '../tactical/perception/duel.ts';
import { NOWHERE, type Soldier, TEAM_FIRST_ID, Team } from '../tactical/soldier.ts';
import { type TacticalState, teamMembers } from '../tactical/state.ts';
import { enterCombatMode } from '../tactical/turns/turns.ts';
import { MercKind, type Roster, type RosterMerc } from './roster.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const ON_ASSIGNMENT_DUEL_POINTS = -10;
const SETTLE_TICKS = 2_000;

interface Battle {
  readonly t: TacticalState;
  readonly doctor: RosterMerc;
  readonly squadmate: Soldier;
  readonly enemy: Soldier;
}

function battleInOmerta(seed: number): Battle {
  const { campaign: c, roster } = createTestCampaign(kit, { seed, mercs: 2, garrison: { admins: 0, troops: 2, elites: 0 } });
  landFirstSquad(c);
  advance(c, { idle: true }, 20_000);
  const t = c.tactical?.state;
  if (!t) throw new Error('A9 is not loaded');
  const [first, squadmate] = ourSoldiers(c);
  const enemy = teamMembers(t, Team.ENEMY)[0];
  const doctor = first && rosterRecord(roster, first);
  if (!doctor || !squadmate || !enemy) throw new Error('the battle lacks a side');
  return { t, doctor, squadmate, enemy };
}

function rosterMerc(roster: Roster, id: number): RosterMerc {
  const merc = roster.get(id);
  if (!merc) throw new Error(`merc ${id} is not on the roster`);
  return merc;
}

function rosterRecord(roster: Roster, s: Soldier): RosterMerc {
  const merc = roster.get(s.id);
  if (!merc) throw new Error(`soldier ${s.id} is not on the roster`);
  return merc;
}

describe("a soldier's assignment as tactical asks it of the campaign (NarrativePort.assignment)", () => {
  it('answers the roster assignment of our merc and nothing for a soldier the roster does not hold', () => {
    const { t, doctor, squadmate, enemy } = battleInOmerta(31);
    const squad = doctor.assignment;
    expect(squad).toBeLessThan(Assignment.ON_DUTY);
    doctor.assignment = Assignment.DOCTOR;
    expect([t.narrative.assignment(doctor.soldier), t.narrative.assignment(squadmate), t.narrative.assignment(enemy)]).toEqual([
      Assignment.DOCTOR,
      squad,
      null,
    ]);
    expect([onSquad(t, doctor.soldier), onSquad(t, squadmate), onSquad(t, enemy)]).toEqual([false, true, true]);
    doctor.assignment = Assignment.ASSIGNMENT_POW;
    expect([heldPrisoner(t, doctor.soldier), heldPrisoner(t, squadmate), heldPrisoner(t, enemy)]).toEqual([true, false, false]);
  });

  it('takes the armed threat and the interrupt points from our merc the roster has on another assignment', () => {
    const { t, doctor, enemy } = battleInOmerta(32);
    const merc = doctor.soldier;
    const gun = t.content.items.byIndex.get(itemIn(merc.inv, InvSlot.HAND))?.weapon?.deadliness ?? 0;
    expect(gun).toBeGreaterThan(0);
    const onSquadThreat = calcManThreatValue(t, merc, NOWHERE, false, enemy);
    doctor.assignment = Assignment.DOCTOR;
    expect(calcManThreatValue(t, merc, NOWHERE, false, enemy)).toBe(onSquadThreat - idiv(merc.stats.marksmanship, 5) - gun);
    const seenBefore = seenOpponent(t, merc.id, enemy.id) === 1 ? 1 : 0;
    expect(calcInterruptDuelPts(t, merc, enemy, false)).toBe(ON_ASSIGNMENT_DUEL_POINTS + seenBefore);
  });
});

describe("a merc's sleep, kind and quote flags as tactical asks them of the campaign (NarrativePort)", () => {
  it('answers from the roster record, and the quote flags it hands out are that record', () => {
    const { t, doctor, squadmate, enemy } = battleInOmerta(33);
    doctor.asleep = true;
    expect([t.narrative.mercAsleep(doctor.soldier), t.narrative.mercAsleep(squadmate), t.narrative.mercAsleep(enemy)]).toEqual([
      true,
      false,
      false,
    ]);
    expect(doctor.kind).toBe(MercKind.AIM_MERC);
    expect([t.narrative.isAimMerc(doctor.soldier), t.narrative.isAimMerc(enemy)]).toEqual([true, false]);
    const flags = t.narrative.quoteSaidFlags(doctor.soldier);
    if (!flags) throw new Error('no quote flags for our merc');
    flags.quoteSaidExtFlags |= QuoteSaidExtFlag.BUDDY_2_WITNESSED;
    expect(doctor.quoteSaidExtFlags & QuoteSaidExtFlag.BUDDY_2_WITNESSED).toBe(QuoteSaidExtFlag.BUDDY_2_WITNESSED);
    expect(t.narrative.quoteSaidFlags(enemy)).toBeNull();
  });

  it('stands a merc asleep in the sector up when combat starts and leaves him asleep (CommonEnterCombatModeCode)', () => {
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 31, mercs: 2, garrison: { admins: 0, troops: 2, elites: 0 } });
    landFirstSquad(c);
    const sleeperId = roster.all()[1]?.id;
    const economy = c.economy;
    if (sleeperId === undefined || !economy) throw new Error('two mercs and the economy');
    putMercInAsleepState(economy, rosterMerc(roster, sleeperId));
    const lying = () => animName(kit.sectors.content, rosterMerc(roster, sleeperId).soldier.state);
    runTicks(c, SETTLE_TICKS, () => lying() !== 'GOTO_SLEEP');
    expect(lying()).toBe('SLEEPING');
    const t = c.tactical?.state;
    if (!t) throw new Error('A9 is not loaded');
    enterCombatMode(t, Team.OUR);
    expect(t.inCombat).toBe(true);
    expect([lying(), rosterMerc(roster, sleeperId).asleep]).toEqual(['WKAEUP_FROM_SLEEP', true]);
  });
});

describe('a doctor for a bleeding patient as tactical asks it of the campaign (NarrativePort.anyDoctorWhoCanHeal)', () => {
  const PATIENT_LIFE = 50;
  const PATIENT_BLEEDING = 25;
  const DOCTOR_MEDICAL = 40;
  const KIT_STATUS = 100;
  const BLEEDS_AT_NEXT_REALTIME_TURN = 0.5;
  const REALTIME_TURN_TICKS = 2_000;

  function patientAndDoctor(seed: number) {
    const { campaign: c, roster } = createTestCampaign(kit, { seed, mercs: 2, garrison: { admins: 0, troops: 0, elites: 0 } });
    landFirstSquad(c);
    advance(c, { idle: true }, 20_000);
    const [patientId, doctorId] = roster.all().map((m) => m.id);
    if (patientId === undefined || doctorId === undefined) throw new Error('two mercs');
    const patient = () => rosterMerc(roster, patientId);
    const doctor = () => rosterMerc(roster, doctorId);
    const tactical = () => c.tactical?.state ?? never();
    const medicKit = () => tactical().content.items.byName.get('MEDICKIT')?.index ?? never();
    const takeKits = () => {
      const inv = doctor().soldier.inv;
      for (let slot = 0; slot < inv.length; slot++) if (inv[slot]?.item === medicKit()) inv[slot] = emptyObject();
    };
    const giveKit = () => {
      takeKits();
      doctor().soldier.inv[InvSlot.BIGPOCK1] = createItem(tactical().content.items, medicKit(), KIT_STATUS);
    };
    const s = patient().soldier;
    s.life = PATIENT_LIFE;
    s.bleeding = PATIENT_BLEEDING;
    doctor().soldier.stats.medical = DOCTOR_MEDICAL;
    takeKits();
    return { c, patient, doctor, tactical, giveKit, takeKits };
  }

  function never(): never {
    throw new Error('A9 is not loaded');
  }

  it('finds a doctor of the sector with a medical kit for our merc on the patient assignment only', () => {
    const { patient, doctor, tactical, giveKit, takeKits } = patientAndDoctor(37);
    const asks = () => tactical().narrative.anyDoctorWhoCanHeal(patient().soldier);
    giveKit();
    doctor().assignment = Assignment.DOCTOR;
    expect(asks()).toBe(false);
    patient().assignment = Assignment.PATIENT;
    expect(asks()).toBe(true);
    takeKits();
    expect(asks()).toBe(false);
    giveKit();
    doctor().assignment = Assignment.PATIENT;
    expect(asks()).toBe(false);
  });

  it('keeps a patient whom a doctor can heal from bleeding at the real-time turns, and he bleeds once the kit is gone', () => {
    const { c, patient, doctor, giveKit, takeKits } = patientAndDoctor(38);
    giveKit();
    patient().assignment = Assignment.PATIENT;
    doctor().assignment = Assignment.DOCTOR;
    const lastTurn = () => c.state.sectorFlow.realtimeClock.lastTurnMs;
    const nextRealtimeTurn = () => {
      patient().soldier.nextBleed = BLEEDS_AT_NEXT_REALTIME_TURN;
      const before = lastTurn();
      runTicks(c, REALTIME_TURN_TICKS, () => lastTurn() !== before);
      expect(lastTurn()).not.toBe(before);
    };
    nextRealtimeTurn();
    expect([patient().life, patient().soldier.bleeding, patient().soldier.nextBleed]).toEqual([
      PATIENT_LIFE,
      PATIENT_BLEEDING,
      BLEEDS_AT_NEXT_REALTIME_TURN,
    ]);
    takeKits();
    nextRealtimeTurn();
    expect(patient().life).toBe(PATIENT_LIFE - 1);
  });
});

describe('our attack on a head miner in tactical reaches his mine (NarrativePort.playerAttackedHeadMiner)', () => {
  const NO_GARRISON = { admins: 0, troops: 0, elites: 0 };
  const MINER_DISTANCE = 4 * WORLD_COLS;
  const STARTING_RATING = 60;
  const ATTACK_BUDGET = 40_000;

  it('shuts the mine for good and costs the town loyalty once, also when he is attacked again', () => {
    const { campaign: c } = createTestCampaign(kit, { seed: 37, mercs: 1, garrison: NO_GARRISON });
    landFirstSquad(c);
    advance(c, { idle: true }, ATTACK_BUDGET);
    c.state.profiles.set(Npc.FRED, testProfile(Npc.FRED, { town: Town.DRASSEN }));
    const drassen = c.state.economy.towns[Town.DRASSEN];
    const sim = c.tactical;
    const [merc] = ourSoldiers(c);
    if (!drassen || !sim || !merc) throw new Error('Drassen and A9 with our merc');
    Object.assign(drassen, { started: true, rating: STARTING_RATING });
    const fred = spawnSoldier(sim, TEAM_FIRST_ID[Team.CIV], Team.CIV, merc.gridNo + MINER_DISTANCE, Direction.NORTH, {
      profile: Npc.FRED,
    });
    fred.neutral = false;
    const shoot = () => {
      const target = c.tactical?.state.soldiers[TEAM_FIRST_ID[Team.CIV]]?.gridNo;
      expect(c.dispatch({ type: 'attack', soldier: merc.id, target })).toEqual({ ok: true });
      advance(c, { idle: true }, ATTACK_BUDGET);
    };
    shoot();
    const mine = kit.economy.economy.mines.find((m) => m.associatedTownId === Town.DRASSEN)?.mineId ?? -1;
    const status = () => c.state.economy.mines[mine];
    const rating = c.state.economy.towns[Town.DRASSEN]?.rating;
    expect(status()).toMatchObject({ shutDown: true, shutDownIsPermanent: true, attackedHeadMiner: true });
    expect(rating).toBeLessThan(STARTING_RATING);
    shoot();
    expect([status()?.shutDown, c.state.economy.towns[Town.DRASSEN]?.rating]).toEqual([true, rating]);
  });
});

describe('the selection of a sleeping merc through the roster (Overhead.cc SelectSoldier, PutMercInAwakeState)', () => {
  function sleeperInOmerta(seed: number) {
    const { campaign: c, roster } = createTestCampaign(kit, { seed, mercs: 2 });
    landFirstSquad(c);
    const id = roster.all()[1]?.id;
    const economy = c.economy;
    if (id === undefined || !economy) throw new Error('two mercs and the economy');
    putMercInAsleepState(economy, rosterMerc(roster, id));
    const lying = () => animName(kit.sectors.content, rosterMerc(roster, id).soldier.state);
    runTicks(c, SETTLE_TICKS, () => lying() !== 'GOTO_SLEEP');
    expect(lying()).toBe('SLEEPING');
    return { c, roster, id, lying };
  }

  it('wakes the merc select picks, also a collapsed one the wake command refuses, with the wake-up animation', () => {
    const { c, roster, id, lying } = sleeperInOmerta(34);
    rosterMerc(roster, id).collapsed = true;
    expect(c.dispatch({ type: 'wake', soldier: id })).toMatchObject({ ok: false, data: { refusal: 'collapsed' } });
    expect(c.dispatch({ type: 'select', soldier: id })).toEqual({ ok: true, data: { woke: [id] } });
    expect([rosterMerc(roster, id).asleep, lying(), c.state.forces.currentSquad]).toEqual([
      false,
      'WKAEUP_FROM_SLEEP',
      rosterMerc(roster, id).assignment,
    ]);
  });

  it('wakes a sleeper an order addresses before the order is checked, and he stays awake when it is refused', () => {
    const { c, roster, id, lying } = sleeperInOmerta(35);
    expect(c.dispatch({ type: 'turn', soldier: id, direction: 9 })).toMatchObject({ ok: false, data: { refusal: 'badDirection' } });
    expect([rosterMerc(roster, id).asleep, lying()]).toEqual([false, 'WKAEUP_FROM_SLEEP']);
  });

  it('refuses select on the map screen, where SelectSoldier returns at once', () => {
    const { c, roster, id } = sleeperInOmerta(36);
    expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
    expect(c.dispatch({ type: 'select', soldier: id })).toMatchObject({ ok: false, data: { refusal: 'notInTactical' } });
    expect(rosterMerc(roster, id).asleep).toBe(true);
  });
});
