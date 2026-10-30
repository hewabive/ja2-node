import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { advance } from '../advance.ts';
import { createStrategicState } from '../strategic/state.ts';
import { CompressMode, NUM_SEC_IN_DAY } from '../strategic/time/constants.ts';
import { buildDayLightLevels, NORMAL_LIGHTLEVEL_DAY, NORMAL_LIGHTLEVEL_NIGHT } from '../strategic/time/environment.ts';
import { worldHour } from '../strategic/time/world-clock.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { CampaignSim } from './campaign-sim.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

describe('campaign clock', () => {
  it('compresses time on the strategic map and follows the day light schedule', () => {
    const state = createStrategicState({ worldSeconds: NUM_SEC_IN_DAY + 6 * 3600 });
    buildDayLightLevels(state.queue, state.clock);
    state.env.lightValue = NORMAL_LIGHTLEVEL_NIGHT;
    const campaign = new CampaignSim(state);
    expect(campaign.dispatch({ type: 'compressTime', mode: CompressMode.MIN60 })).toEqual({ ok: true });
    const lights: [number, number][] = [];
    let last = state.env.lightValue;
    while (state.clock.seconds < 2 * NUM_SEC_IN_DAY) {
      campaign.step();
      if (state.env.lightValue !== last) lights.push([Math.trunc((state.clock.seconds % NUM_SEC_IN_DAY) / 60), state.env.lightValue]);
      last = state.env.lightValue;
    }
    expect(lights.slice(0, 9)).toEqual([
      [6 * 60 + 47, 11],
      [6 * 60 + 49, 10],
      [6 * 60 + 51, 9],
      [6 * 60 + 53, 8],
      [6 * 60 + 55, 7],
      [6 * 60 + 57, 6],
      [6 * 60 + 59, 5],
      [7 * 60 + 1, 4],
      [7 * 60 + 3, NORMAL_LIGHTLEVEL_DAY],
    ]);
    expect(lights.at(-1)).toEqual([21 * 60 + 13, NORMAL_LIGHTLEVEL_NIGHT]);
    expect(state.env.globalTemperature).toBe(0);
    expect(campaign.dispatch({ type: 'stopTime' })).toEqual({ ok: true });
    expect(advance(campaign, { idle: true }, 10).reason).toBe('idle');
  });

  it('runs one world second per 200 ticks while a sector is loaded and freezes in combat', () => {
    const tactical = newCombatSim(content);
    const campaign = new CampaignSim(createStrategicState(), tactical);
    const start = campaign.state.clock.seconds;
    for (let i = 0; i < 2000; i++) campaign.step();
    expect(campaign.state.clock.seconds - start).toBe(10);
    tactical.state.inCombat = true;
    for (let i = 0; i < 2000; i++) campaign.step();
    expect(campaign.state.clock.seconds - start).toBe(10);
    expect(worldHour(campaign.state.clock)).toBe(1);
    expect(campaign.dispatch({ type: 'compressTime' }).ok).toBe(false);
  });

  it('opens on the map screen with the sector loaded when created there: a map compression mode stays, stopped (MapScreenHandle)', () => {
    const tactical = newCombatSim(content);
    const state = createStrategicState();
    Object.assign(state.clock, { mode: CompressMode.MIN30, compressionOn: true });
    const campaign = new CampaignSim(state, tactical, {}, 'createOnMapScreen');
    expect([campaign.state.flow, campaign.tactical]).toEqual(['strategic', tactical]);
    expect([state.clock.mode, state.clock.compressionOn]).toEqual([CompressMode.MIN30, false]);
    const start = state.clock.seconds;
    for (let i = 0; i < 2000; i++) campaign.step();
    expect(state.clock.seconds).toBe(start);
    expect(tactical.tick).toBe(0);
  });
});
