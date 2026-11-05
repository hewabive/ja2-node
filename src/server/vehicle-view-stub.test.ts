import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { stubCampaignWithOurHummer } from '../../tests/support/vehicles.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import { SKYRIDER, setUpHelicopterForPlayer } from '../sim/strategic/forces/helicopter.ts';
import { progressFromProfile } from '../sim/tactical/profiles.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const SEED = 47;
const FULL = 100;

describe('the condition and fuel of a vehicle in the strategic view (Map_Screen_Interface.cc UpdateCharRegionHelpText)', () => {
  it('shows them for a vehicle of ours, on its entry and on its character line, which names the vehicle it is', async () => {
    const session = await stubCampaignWithOurHummer(kit, SEED);
    const hummer = session.campaign.battle?.roster.all().find((m) => m.isVehicle);
    if (!hummer) throw new Error('no vehicle of ours');
    Object.assign(hummer.soldier, { life: 70, breathRed: 4321, breath: 44 });
    const view = session.view().strategic;
    expect(view?.vehicles?.find((v) => v.id === hummer.vehicleId)).toMatchObject({ life: 70, lifeMax: FULL, fuel: 44 });
    expect(view?.mercs.find((m) => m.id === hummer.id)).toMatchObject({
      kind: 'vehicle',
      vehicle: hummer.vehicleId,
      life: 70,
      lifeMax: FULL,
      breath: 44,
      breathMax: FULL,
    });
  });

  it('shows neither for the helicopter, which has no soldier', async () => {
    const session = await stubCampaignWithOurHummer(kit, SEED);
    const campaign = session.campaign;
    const ctx = campaign.strategic;
    if (!ctx) throw new Error('no strategic layer');
    const skyrider = kit.content.profiles[SKYRIDER];
    if (skyrider) campaign.state.profiles.set(SKYRIDER, progressFromProfile(skyrider));
    setUpHelicopterForPlayer(ctx, parseSectorString('A9'));
    const heli = session.view().strategic?.vehicles?.find((v) => v.id === ctx.state.forces.helicopterVehicleId);
    expect(heli).toBeDefined();
    expect(heli).not.toHaveProperty('life');
    expect(heli).not.toHaveProperty('fuel');
  });
});
