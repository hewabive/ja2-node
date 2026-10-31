import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad, runTicks } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent, kit as medicalKit } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { assignmentDone } from '../strategic/economy/assignment-done.ts';
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

interface Landed {
  readonly c: CampaignSim;
  readonly roster: Roster;
  readonly id: number;
}

function landed(seed: number): Landed {
  const { campaign: c, roster } = createTestCampaign(kit, { seed, mercs: 2, garrison: { admins: 0, troops: 0, elites: 0 } });
  landFirstSquad(c);
  const id = roster.all()[0]?.id;
  if (id === undefined || !c.tactical) throw new Error('the squad did not land in a loaded sector');
  return { c, roster, id };
}

function merc({ roster, id }: Landed): RosterMerc {
  const m = roster.get(id);
  if (!m) throw new Error(`no merc ${id}`);
  return m;
}

function shown(l: Landed): string {
  const t = l.c.tactical?.state;
  if (!t) throw new Error('no loaded sector');
  return animName(t.content, merc(l).soldier.state);
}

describe('assignments and sleep animate our merc in the loaded sector (Assignments.cc)', () => {
  it('puts him to sleep and wakes him with the tactical animations while the tactical screen is up', () => {
    const l = landed(41);
    merc(l).breathMax = TIRED;
    expect(l.c.dispatch({ type: 'sleep', soldier: l.id })).toEqual({ ok: true });
    expect([merc(l).asleep, shown(l)]).toEqual([true, 'GOTO_SLEEP']);
    runTicks(l.c, TICK_BUDGET, () => shown(l) !== 'GOTO_SLEEP');
    expect(shown(l)).toBe('SLEEPING');
    expect(l.c.dispatch({ type: 'wake', soldier: l.id })).toEqual({ ok: true });
    expect([merc(l).asleep, shown(l)]).toEqual([false, 'WKAEUP_FROM_SLEEP']);
  });

  it('lets a merc woken while he lies down go on lying down awake: GOTO_SLEEP cannot be interrupted', () => {
    const l = landed(44);
    merc(l).breathMax = TIRED;
    expect(l.c.dispatch({ type: 'sleep', soldier: l.id })).toEqual({ ok: true });
    expect(l.c.dispatch({ type: 'wake', soldier: l.id })).toEqual({ ok: true });
    expect([merc(l).asleep, shown(l)]).toEqual([false, 'GOTO_SLEEP']);
    runTicks(l.c, TICK_BUDGET, () => shown(l) !== 'GOTO_SLEEP');
    expect([merc(l).asleep, shown(l)]).toEqual([false, 'SLEEPING']);
  });

  it('lays him down and stands him up at once while the map screen is up', () => {
    const l = landed(42);
    expect(l.c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    merc(l).breathMax = TIRED;
    expect(l.c.dispatch({ type: 'sleep', soldier: l.id })).toEqual({ ok: true });
    expect(shown(l)).toBe('SLEEPING');
    expect(l.c.dispatch({ type: 'wake', soldier: l.id })).toEqual({ ok: true });
    expect(shown(l)).toBe('STANDING');
  });

  it('kneels a new doctor down to doctor and ends his doctoring when he is done', () => {
    const l = landed(43);
    merc(l).soldier.inv[InvSlot.BIGPOCK4] = medicalKit(kit.economy.items, 'MEDICKIT', [100]);
    expect(l.c.dispatch({ type: 'assign', soldiers: [l.id], to: { kind: 'doctor' } })).toMatchObject({ ok: true });
    expect(shown(l)).toBe('BEING_DOCTOR');
    const economy = l.c.economy;
    if (!economy) throw new Error('no economy');
    assignmentDone(economy, merc(l), true, true);
    expect(shown(l)).toBe('END_DOCTOR');
  });
});
