import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kit } from '../../../tests/support/economy.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { ReloadingSession } from '../../../tests/support/session-reload.ts';
import { PROF_HUMMER, stubCampaignAtTheHummer, stubCampaignWithOurHummer } from '../../../tests/support/vehicles.ts';
import type { CampaignSession } from '../../server/campaign-session.ts';
import { FACT_OK_USE_HUMMER } from '../strategic/forces/helicopter.ts';
import { setFact } from '../strategic/narrative/facts.ts';
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

const SEED = 43;
const DAMAGED = 60;
const HOURS = 4 * 3600;

function equippedMechanic(session: CampaignSession): RosterMerc {
  const merc = session.campaign.battle?.roster.all().find((m) => !m.isVehicle);
  if (!merc) throw new Error('no merc');
  merc.soldier.inv[InvSlot.HAND] = kit(stubs.content.items, 'TOOLKIT', [100]);
  Object.assign(merc.soldier.stats, { mechanical: 90, dexterity: 90, experience: 5 });
  return merc;
}

function repairFor(session: CampaignSession, mechanic: number, vehicle: number): void {
  const assigned = session.dispatch({ type: 'assign', soldiers: [mechanic], to: { kind: 'repair', vehicle } });
  expect(assigned).toMatchObject({ ok: true });
  new ReloadingSession('vehicle-repair', session).advance({ worldSeconds: HOURS, compressionStopped: false });
}

describe('a mechanic repairing a vehicle by the hour (Assignments.cc HandleRepairBySoldier, Vehicles.cc RepairVehicle)', () => {
  it('raises the condition of a vehicle of ours', async () => {
    const session = await stubCampaignWithOurHummer(stubs, SEED);
    const hummer = session.campaign.battle?.roster.all().find((m) => m.isVehicle);
    if (!hummer) throw new Error('no vehicle of ours');
    hummer.life = DAMAGED;
    repairFor(session, equippedMechanic(session).id, hummer.vehicleId);
    const after = session.view().strategic?.vehicles?.find((v) => v.id === hummer.vehicleId);
    expect(after?.life).toBeGreaterThan(DAMAGED);
    expect(after?.lifeMax).toBe(100);
  });

  it('raises the condition of a civilian vehicle in the loaded sector the squad may use, read from its soldier there', async () => {
    const session = await stubCampaignAtTheHummer(stubs, SEED);
    setFact(session.campaign.state.narrative, FACT_OK_USE_HUMMER, true);
    const civilian = (): Soldier => {
      const s = session.campaign.tactical?.state.soldiers.find((x) => x?.placed && x.profile === PROF_HUMMER);
      if (!s) throw new Error('the Hummer is not in the sector');
      return s;
    };
    civilian().life = DAMAGED;
    expect(civilian().team).toBe(Team.CIV);
    expect(session.dispatch({ type: 'mapScreen' })).toMatchObject({ ok: true });
    repairFor(session, equippedMechanic(session).id, civilian().vehicleId);
    expect(civilian().life).toBeGreaterThan(DAMAGED);
    expect(session.view().strategic?.vehicles?.find((v) => v.id === civilian().vehicleId)?.life).toBeUndefined();
  });
});
