import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { advance } from '../advance.ts';
import { CompressMode } from '../strategic/time/constants.ts';
import type { CampaignSim } from './campaign-sim.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const ONE_HOUR = 3600;

function landed(troops: number): CampaignSim {
  const { campaign } = createTestCampaign(kit, { seed: 8, mercs: 2, garrison: { admins: 0, troops, elites: 0 } });
  landFirstSquad(campaign);
  return campaign;
}

describe('map and tactical screens', () => {
  it('compresses time only on the map and never with enemies in the loaded sector', () => {
    const c = landed(3);
    expect(c.state.flow).toBe('tactical');
    expect(advance(c, { compressionStopped: true })).toMatchObject({
      reason: 'refused',
      refusal: 'time compression works on the strategic map only',
    });
    expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    expect(c.state.flow).toBe('strategic');
    expect(c.tactical).not.toBeNull();
    expect(c.dispatch({ type: 'compressTime', mode: CompressMode.MIN30 })).toEqual({
      ok: false,
      reason: 'enemies are present in the loaded sector',
    });
    expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
    expect(c.state.flow).toBe('tactical');
  });

  it('lets a cleared sector wait on the map while the tactical world stays frozen', () => {
    const c = landed(0);
    const tacticalClock = c.tactical?.state.clockMs;
    expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    const start = c.state.clock.seconds;
    const report = advance(c, { worldSeconds: ONE_HOUR, mode: CompressMode.MIN60 });
    expect(report.reason).toBe('worldTime');
    expect(c.state.clock.seconds - start).toBeGreaterThanOrEqual(ONE_HOUR);
    expect(c.tactical?.state.clockMs).toBe(tacticalClock);
    expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
    expect(c.state.clock.mode).toBe(CompressMode.X1);
  });
});
