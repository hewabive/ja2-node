import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad, ourSoldiers } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { advance } from '../../../tests/support/reload.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { idiv } from '../../core/int.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import { calcManThreatValue } from '../tactical/ai/morale.ts';
import { animName } from '../tactical/anim-states.ts';
import { InvSlot, itemIn } from '../tactical/inventory.ts';
import { heldPrisoner, onSquad } from '../tactical/narrative/assignment.ts';
import { QuoteSaidExtFlag } from '../tactical/narrative/merc-quotes.ts';
import { calcInterruptDuelPts, seenOpponent } from '../tactical/perception/duel.ts';
import { NOWHERE, type Soldier, Team } from '../tactical/soldier.ts';
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
    const sleeper = roster.all()[1];
    if (!sleeper) throw new Error('two mercs');
    sleeper.asleep = true;
    landFirstSquad(c);
    const t = c.tactical?.state;
    if (!t) throw new Error('A9 is not loaded');
    const merc = rosterRecord(roster, sleeper.soldier);
    expect(animName(t.content, merc.soldier.state)).toBe('SLEEPING');
    enterCombatMode(t, Team.OUR);
    expect(t.inCombat).toBe(true);
    expect(animName(t.content, merc.soldier.state)).toBe('WKAEUP_FROM_SLEEP');
    expect(merc.asleep).toBe(true);
  });
});
