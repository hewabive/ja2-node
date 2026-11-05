import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kit } from '../../../tests/support/economy.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { ReloadingSession } from '../../../tests/support/session-reload.ts';
import { PROF_HUMMER, stubCampaignAtTheHummer } from '../../../tests/support/vehicles.ts';
import type { CampaignSession } from '../../server/campaign-session.ts';
import type { SimEvent } from '../events.ts';
import { Assignment } from '../strategic/forces/constants.ts';
import { FACT_OK_USE_HUMMER } from '../strategic/forces/helicopter.ts';
import { setFact } from '../strategic/narrative/facts.ts';
import { animName } from '../tactical/anim-states.ts';
import { InvSlot } from '../tactical/inventory.ts';
import { type Soldier, Team } from '../tactical/soldier.ts';
import type { RosterMerc } from './roster.ts';

let stubs: StubSectorKit;

beforeAll(async () => {
  stubs = await loadStubSectorKit();
});

afterAll(async () => {
  await stubs.dispose();
});

const SEED = 47;
const DAMAGED = 60;
const WALK_BUDGET = 20_000;
const HOURS = 4 * 3600;

function civilianHummer(session: CampaignSession): Soldier {
  const s = session.campaign.tactical?.state.soldiers.find((x) => x?.placed && x.profile === PROF_HUMMER && x.team !== Team.OUR);
  if (!s) throw new Error('no civilian Hummer in the sector');
  return s;
}

function merc(session: CampaignSession, id: number): RosterMerc {
  const m = session.campaign.battle?.roster.get(id);
  if (!m) throw new Error(`no merc ${id}`);
  return m;
}

function equippedMechanic(session: CampaignSession): number {
  const mechanic = session.campaign.battle?.roster.all().find((m) => !m.isVehicle);
  if (!mechanic) throw new Error('no merc');
  mechanic.soldier.inv[InvSlot.HAND] = kit(stubs.content.items, 'TOOLKIT', [100]);
  Object.assign(mechanic.soldier.stats, { mechanical: 90, dexterity: 90, experience: 5 });
  return mechanic.id;
}

function squadsHolding(session: CampaignSession, id: number): number[] {
  return session.campaign.state.forces.squads.flatMap((members, squad) => (members.includes(id) ? [squad] : []));
}

function doneFor(events: readonly SimEvent[], id: number): SimEvent[] {
  return events.filter((e) => e.type === 'assignmentDone' && e.soldier === id);
}

describe('the toolkit on a vehicle in a campaign (Soldier_Control.cc EVENT_SoldierBeginRepair, Assignments.cc SetSoldierAssignmentRepair)', () => {
  it('puts the mechanic on REPAIR under the car soldier id, off his squad, and he finishes at the next hourly check without repairing anything: no vehicle has that id (decision 4)', async () => {
    const session = await stubCampaignAtTheHummer(stubs, SEED);
    setFact(session.campaign.state.narrative, FACT_OK_USE_HUMMER, true);
    civilianHummer(session).life = DAMAGED;
    const mechanic = equippedMechanic(session);
    expect(squadsHolding(session, mechanic)).toHaveLength(1);
    expect(session.dispatch({ type: 'repair', soldier: mechanic, gridNo: civilianHummer(session).gridNo })).toEqual({ ok: true });
    new ReloadingSession('toolkit-walk', session).advance({ idle: true }, WALK_BUDGET);
    const hummer = civilianHummer(session);
    const repairing = merc(session, mechanic);
    expect([repairing.assignment, repairing.vehicleUnderRepair, repairing.fixingRobot]).toEqual([Assignment.REPAIR, hummer.id, false]);
    expect(hummer.id).not.toBe(hummer.vehicleId);
    expect(squadsHolding(session, mechanic)).toEqual([]);
    expect(session.view().strategic?.mercs.find((m) => m.id === mechanic)?.repairVehicle).toBe(hummer.id);
    expect(session.dispatch({ type: 'mapScreen' })).toMatchObject({ ok: true });
    const events = new ReloadingSession('toolkit-hours', session).advance({ worldSeconds: HOURS, compressionStopped: false }).events;
    expect(doneFor(events, mechanic)).toHaveLength(1);
    expect(civilianHummer(session).life).toBe(DAMAGED);
  });

  it('changes nothing when there is nothing to repair: the mechanic crouches into the repair animation and keeps his squad', async () => {
    const session = await stubCampaignAtTheHummer(stubs, SEED);
    setFact(session.campaign.state.narrative, FACT_OK_USE_HUMMER, true);
    const mechanic = equippedMechanic(session);
    const squad = merc(session, mechanic).assignment;
    expect(session.dispatch({ type: 'repair', soldier: mechanic, gridNo: civilianHummer(session).gridNo })).toEqual({ ok: true });
    new ReloadingSession('toolkit-walk', session).advance({ idle: true }, WALK_BUDGET);
    const kept = merc(session, mechanic);
    expect([kept.assignment, squadsHolding(session, mechanic), animName(stubs.content, kept.soldier.state)]).toEqual([
      squad,
      [squad],
      'BEING_REPAIRMAN',
    ]);
  });
});
