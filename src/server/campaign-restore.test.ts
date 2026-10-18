import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { copyStrategicState, strategicSnapshot } from '../../tests/support/state-copy.ts';
import type { CommandEnvelope } from '../protocol/messages.ts';
import { advance, type StopCondition } from '../sim/advance.ts';
import { DEFAULT_AIM_CONTRACT } from '../sim/campaign/laptop/aim.ts';
import { createStrategicState } from '../sim/strategic/state.ts';
import { CompressMode } from '../sim/strategic/time/constants.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { TacticalSim } from '../sim/tactical/tactical-sim.ts';
import { assembleCampaign, buildNewCampaign } from './campaign-factory.ts';
import { CampaignSession } from './campaign-session.ts';
import { createSandboxSession, TacticalSession } from './sandbox.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const SEED = 11;
const HIRED_PROFILES = [0, 1, 2];
const SIX_HOURS = 6 * 3600;
const STEP_EAST = 2;
const MAP_SCREEN_TICKS = 50;
const SANDBOX_TICKS = 400;

type Step = { readonly command: CommandEnvelope } | { readonly until: StopCondition };

async function sessionsAtTheMapScreen(): Promise<{ readonly original: CampaignSession; readonly restored: CampaignSession }> {
  const exists = (path: string) => kit.worlds.exists(path);
  const built = await buildNewCampaign(kit.read, exists, () => createStrategicState({ seed: SEED }));
  const original = new CampaignSession(built.campaign, built.roster, built.worlds, built.texts);
  for (const profile of HIRED_PROFILES)
    expect(original.dispatch({ type: 'aimHire', profile, contract: DEFAULT_AIM_CONTRACT })).toMatchObject({ ok: true });
  expect(original.dispatch({ type: 'closeLaptop' })).toMatchObject({ ok: true });
  advance(original, { ticks: MAP_SCREEN_TICKS });
  expect(built.campaign.tactical).toBeNull();
  expect(original.tick).toBe(MAP_SCREEN_TICKS);
  const copy = copyStrategicState(built.campaign.state);
  const assembled = assembleCampaign(kit.read, exists, built.parts, copy, { construction: 'restore' });
  const restored = new CampaignSession(assembled.campaign, assembled.roster, assembled.worlds, built.texts);
  return { original, restored };
}

async function run(session: CampaignSession, step: Step): Promise<unknown> {
  if ('until' in step) return advance(session, step.until);
  await session.prepare(step.command);
  const result = session.dispatch(step.command);
  return { result, events: session.drainEvents() };
}

describe('a campaign restored around a copy of its strategic state', () => {
  it('starts from equal state and continues exactly like the original', async () => {
    const { original, restored } = await sessionsAtTheMapScreen();
    expect(strategicSnapshot(restored.campaign.state)).toEqual(strategicSnapshot(original.campaign.state));
    expect(restored.view()).toEqual(original.view());
    const steps: Step[] = [
      { command: { type: 'compressTime', mode: CompressMode.MIN5 } },
      { until: { ticks: 300 } },
      { until: { idle: true } },
    ];
    for (const step of steps) expect(await run(restored, step)).toEqual(await run(original, step));
    expect(original.campaign.state.flow).toBe('tactical');
    const merc = original.view().strategic?.mercs[0];
    const soldier = original.view().soldiers.find((s) => s.id === merc?.id);
    if (!merc || !soldier) throw new Error('the squad did not land');
    const later: Step[] = [
      { command: { type: 'move', soldier: merc.id, to: soldier.gridNo + STEP_EAST, mode: 'walk' } },
      { until: { idle: true } },
      { command: { type: 'mapScreen' } },
      { command: { type: 'route', soldier: merc.id, to: 'A10' } },
      { until: { worldSeconds: SIX_HOURS } },
    ];
    for (const step of later) expect(await run(restored, step)).toEqual(await run(original, step));
    expect(restored.view()).toEqual(original.view());
    expect(strategicSnapshot(restored.campaign.state)).toEqual(strategicSnapshot(original.campaign.state));
  });
});

describe('a tactical sim restored around its own state', () => {
  it('keeps the state as it is and continues exactly like an uninterrupted sim', async () => {
    const uninterrupted = await createSandboxSession(kit.read, false, SEED);
    const interrupted = await createSandboxSession(kit.read, false, SEED);
    expect(advance(interrupted, { ticks: SANDBOX_TICKS })).toEqual(advance(uninterrupted, { ticks: SANDBOX_TICKS }));
    const state = interrupted.sim.state;
    const restored = new TacticalSession(TacticalSim.restore(interrupted.sim.world, state));
    expect(restored.sim.state).toBe(state);
    expect(restored.tick).toBe(SANDBOX_TICKS);
    expect(restored.view()).toEqual(uninterrupted.view());
    const merc = uninterrupted.view().soldiers.find((s) => s.team === Team.OUR);
    if (!merc) throw new Error('no merc in the sandbox');
    const move = { type: 'move', soldier: merc.id, to: merc.gridNo + STEP_EAST, mode: 'run' };
    expect(restored.dispatch(move)).toEqual(uninterrupted.dispatch(move));
    expect(advance(restored, { ticks: SANDBOX_TICKS })).toEqual(advance(uninterrupted, { ticks: SANDBOX_TICKS }));
    expect(restored.view()).toEqual(uninterrupted.view());
  });
});
