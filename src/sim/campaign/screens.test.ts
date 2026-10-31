import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad, ourSoldiers } from '../../../tests/support/campaign.ts';
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
const ONE_REAL_SECOND_OF_TICKS = 200;
const TEN_REAL_SECONDS_OF_TICKS = 10 * ONE_REAL_SECOND_OF_TICKS;

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
      data: { refusal: 'enemiesPresent' },
    });
    expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
    expect(c.state.flow).toBe('tactical');
  });

  it('enters the loaded sector from the map screen into the tactical screen', () => {
    const c = landed(0);
    expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    expect(c.dispatch({ type: 'compressTime', mode: CompressMode.MIN30 })).toEqual({ ok: true });
    expect(c.dispatch({ type: 'enterSector', sector: 'A9' })).toMatchObject({ ok: true, data: { sector: 'A9' } });
    expect(c.state.flow).toBe('tactical');
    expect(c.state.clock.mode).toBe(CompressMode.X1);
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

  it('runs the world clock at once when the map hands back to the loaded sector', () => {
    const c = landed(0);
    expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    for (let k = 0; k < TEN_REAL_SECONDS_OF_TICKS; k++) c.step();
    expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
    const start = c.state.clock.seconds;
    for (let k = 0; k < ONE_REAL_SECOND_OF_TICKS; k++) c.step();
    expect(c.state.clock.seconds - start).toBe(1);
  });
});

describe('the compression cleanup', () => {
  const FAR_TILE = 75 * 160 + 100;
  const PRIMARY = { kind: 'desiredDirection', soldier: 0, direction: 0 } as const;
  const SECONDARY = {
    kind: 'weaponHit',
    soldier: 0,
    attacker: 0,
    weapon: 0,
    damage: 0,
    breathLoss: 0,
    direction: 0,
    range: 0,
    special: 0,
    delay: 20,
    stamp: 0,
  } as const;

  function walkingOnTheMap(): CampaignSim {
    const c = landed(0);
    const [walker] = ourSoldiers(c);
    if (!walker) throw new Error('no merc');
    expect(c.dispatch({ type: 'move', soldier: walker.id, to: FAR_TILE })).toMatchObject({ ok: true });
    for (let k = 0; k < ONE_REAL_SECOND_OF_TICKS; k++) c.step();
    expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    expect(ourSoldiers(c)[0]?.pathSize).toBeGreaterThan(0);
    return c;
  }

  it('stops every soldier in the loaded sector and drops the primary game events when compression is started', () => {
    const c = walkingOnTheMap();
    c.tactical?.state.gameEvents.push(PRIMARY, SECONDARY);
    expect(c.dispatch({ type: 'compressTime' })).toEqual({ ok: true });
    expect(ourSoldiers(c)[0]?.pathSize).toBe(0);
    expect(c.tactical?.state.gameEvents).toEqual([SECONDARY]);
  });

  it('clears nothing when a speed is picked, as the increase button sets the level without StartTimeCompression', () => {
    const c = walkingOnTheMap();
    expect(c.dispatch({ type: 'compressTime', mode: CompressMode.MIN30 })).toEqual({ ok: true });
    expect(ourSoldiers(c)[0]?.pathSize).toBeGreaterThan(0);
  });

  it('clears again at every later start, as the map screen forgets each frame that compression occurred', () => {
    const c = walkingOnTheMap();
    expect(c.dispatch({ type: 'compressTime' })).toEqual({ ok: true });
    expect(c.dispatch({ type: 'stopTime' })).toEqual({ ok: true });
    c.tactical?.state.gameEvents.push(PRIMARY);
    expect(c.dispatch({ type: 'compressTime' })).toEqual({ ok: true });
    expect(c.tactical?.state.gameEvents).toEqual([]);
  });
});
