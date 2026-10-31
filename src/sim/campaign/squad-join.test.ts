import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad, runTicks } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent, kit as medicalKit } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { Assignment, BREATHMAX_ABSOLUTE_MINIMUM } from '../strategic/economy/constants.ts';
import { worldTotalMinutes } from '../strategic/time/world-clock.ts';
import { animName } from '../tactical/anim-states.ts';
import { InvSlot } from '../tactical/inventory.ts';
import type { CampaignSim } from './campaign-sim.ts';
import type { Roster, RosterMerc } from './roster.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const TIRED = 40;
const TICK_BUDGET = 2_000;
const MINUTES_ON_THE_JOB = 90;
const SQUAD_1 = 0;
const SQUAD_2 = 1;

interface Sleeper {
  readonly c: CampaignSim;
  readonly roster: Roster;
  readonly id: number;
}

function merc({ roster, id }: Sleeper): RosterMerc {
  const m = roster.get(id);
  if (!m) throw new Error(`no merc ${id}`);
  return m;
}

function shown(l: Sleeper): string {
  return animName(kit.sectors.content, merc(l).soldier.state);
}

function doctorAsleep(seed: number): Sleeper {
  const { campaign: c, roster } = createTestCampaign(kit, { seed, mercs: 2, garrison: { admins: 0, troops: 0, elites: 0 } });
  landFirstSquad(c);
  const id = roster.all()[0]?.id;
  if (id === undefined) throw new Error('no merc');
  const l = { c, roster, id };
  merc(l).soldier.inv[InvSlot.BIGPOCK4] = medicalKit(kit.economy.items, 'MEDICKIT', [100]);
  expect(c.dispatch({ type: 'assign', soldiers: [id], to: { kind: 'doctor' } })).toMatchObject({ ok: true });
  merc(l).breathMax = TIRED;
  expect(c.dispatch({ type: 'sleep', soldier: id })).toEqual({ ok: true });
  runTicks(c, TICK_BUDGET, () => shown(l) !== 'GOTO_SLEEP');
  merc(l).lastAssignmentChangeMin -= MINUTES_ON_THE_JOB;
  return l;
}

describe('joining a squad, soldier side (AddCharacterToSquad, Squads.cc:188)', () => {
  it('wakes a sleeping merc from another assignment and stamps the change; the squad menu leaves his wake-up playing', () => {
    const l = doctorAsleep(51);
    expect([merc(l).assignment, merc(l).asleep, shown(l)]).toEqual([Assignment.DOCTOR, true, 'SLEEPING']);
    expect(l.c.dispatch({ type: 'assign', soldiers: [l.id], to: { kind: 'squad', squad: SQUAD_2 } })).toEqual({
      ok: true,
      data: [{ ok: true }],
    });
    expect([merc(l).assignment, merc(l).asleep, shown(l)]).toEqual([SQUAD_2, false, 'WKAEUP_FROM_SLEEP']);
    expect(merc(l).lastAssignmentChangeMin).toBe(worldTotalMinutes(l.c.state.clock));
  });

  it('leaves a collapsed merc asleep on his new squad, and still stamps the change', () => {
    const l = doctorAsleep(52);
    merc(l).breathMax = BREATHMAX_ABSOLUTE_MINIMUM;
    expect(l.c.dispatch({ type: 'assignSquad', soldier: l.id, squad: SQUAD_1 })).toMatchObject({ ok: true });
    expect([merc(l).assignment, merc(l).asleep, merc(l).collapsed]).toEqual([SQUAD_1, true, true]);
    expect(merc(l).lastAssignmentChangeMin).toBe(worldTotalMinutes(l.c.state.clock));
  });
});
