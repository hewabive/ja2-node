import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { advance, type StopReport } from '../advance.ts';
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

const SLICE_SECONDS = 60;

function onTheMap(seed: number, to: string): CampaignSim {
  const { campaign: c } = createTestCampaign(kit, { seed, mercs: 2, garrison: { admins: 0, troops: 0, elites: 0 } });
  landFirstSquad(c);
  advance(c, { idle: true }, 20_000);
  const route = c.dispatch({ type: 'route', soldier: 0, to });
  if (!route.ok) throw new Error(`route refused: ${route.reason}`);
  advance(c, { ticks: 20_000, events: ['sectorUnloaded'] });
  if (c.state.flow !== 'strategic') throw new Error('the squad did not leave the sector');
  return c;
}

function answerAnything(c: CampaignSim): void {
  for (let k = 0; k < 10; k++) {
    const prompt = c.state.battle.prompt;
    if (!prompt) return;
    if (prompt.kind === 'preBattle') {
      const choice =
        prompt.options.find((o) => o.enabled && o.choice === 'retreat') ??
        prompt.options.find((o) => o.enabled && o.choice === 'autoresolve') ??
        prompt.options.find((o) => o.enabled);
      c.dispatch({ type: 'answer', prompt: prompt.id, choice: choice?.choice });
    } else if (prompt.kind === 'surrender') c.dispatch({ type: 'answer', prompt: prompt.id, choice: 'reject' });
    else if (prompt.kind === 'autoresolveDone') c.dispatch({ type: 'answer', prompt: prompt.id, choice: 'done' });
    else c.dispatch({ type: 'answer', prompt: prompt.id, choice: prompt.kind === 'npcOfNote' ? 'continue' : 'separately' });
    if (c.state.flow === 'autoresolve' && !c.state.battle.prompt) advance(c, { idle: true });
  }
}

function digest(c: CampaignSim, report: StopReport): string {
  return JSON.stringify({
    reason: report.reason,
    world: report.worldTime,
    rng: c.state.rng.state(),
    groups: c.state.forces.groups.map((g) => [g.id, g.sector, g.betweenSectors]),
  });
}

describe('advance on the strategic map', () => {
  it('compresses time until the group reaches its final destination and reports the stop with the world time', () => {
    const c = onTheMap(3, 'B9');
    const report = advance(c, { compressionStopped: true, mode: CompressMode.MIN30 });
    expect(report.reason).toBe('event');
    expect(report.events.find((e) => e.type === 'compressionStarted')).toMatchObject({ mode: CompressMode.MIN30 });
    expect(report.events.at(-1)).toMatchObject({ type: 'compressionStopped', reason: 'arrived' });
    expect(report.worldTime?.seconds).toBe(c.state.clock.seconds);
    expect(c.state.forces.groups.find((g) => g.player)?.sector).toMatchObject({ x: 9, y: 2 });
  });

  it('stops compression at the first slice end at or past a world-time target', () => {
    const c = onTheMap(3, 'B9');
    const start = c.state.clock.seconds;
    const report = advance(c, { worldSeconds: 600, mode: CompressMode.MIN5 });
    expect(report.reason).toBe('worldTime');
    expect(report.events.at(-1)).toMatchObject({ type: 'worldTimeReached' });
    expect(report.events.some((e) => e.type === 'compressionStopped' && e.reason === 'worldTime')).toBe(true);
    const elapsed = c.state.clock.seconds - start;
    expect(elapsed).toBeGreaterThanOrEqual(600);
    expect(elapsed).toBeLessThan(600 + SLICE_SECONDS);
    expect(c.state.clock.compressionOn).toBe(false);
  });

  it('reports a new day and accepts an absolute target, answering battles on the way', () => {
    const c = onTheMap(3, 'B9');
    advance(c, { compressionStopped: true, mode: CompressMode.MIN30 });
    const day = Math.trunc(c.state.clock.seconds / 86_400);
    const target = { day: day + 1, hour: 1 };
    const seen: string[] = [];
    let report = advance(c, { worldTime: target, mode: CompressMode.MIN60 });
    for (let k = 0; k < 20 && report.reason !== 'worldTime'; k++) {
      seen.push(...report.events.map((e) => e.type));
      const prompt = c.state.battle.prompt;
      if (prompt) answerAnything(c);
      report = advance(c, { worldTime: target, mode: CompressMode.MIN60 });
    }
    seen.push(...report.events.map((e) => e.type));
    expect(report.reason).toBe('worldTime');
    expect(seen).toContain('dayStarted');
    expect(report.worldTime?.day).toBe(day + 1);
  });

  it('accepts a world-time target in tactical real time without compressing', () => {
    const { campaign: c } = createTestCampaign(kit, { seed: 4, mercs: 1, garrison: { admins: 0, troops: 0, elites: 0 } });
    landFirstSquad(c);
    advance(c, { idle: true }, 20_000);
    expect(c.state.flow).toBe('tactical');
    const report = advance(c, { worldSeconds: 2 }, 1000);
    expect(report.reason).toBe('worldTime');
    expect(report.events.some((e) => e.type === 'compressionStarted')).toBe(false);
  });

  it('reports a refused compression with its reason', () => {
    const c = onTheMap(3, 'B9');
    c.state.atLeastOneMercHired = false;
    const report = advance(c, { worldSeconds: 600 });
    expect(report).toMatchObject({ reason: 'refused', refusal: 'no merc has been hired yet' });
    expect(report.worldTime?.seconds).toBe(c.state.clock.seconds);
  });

  it('compresses again after a stop when told to ignore compression stops', () => {
    const c = onTheMap(3, 'B9');
    const report = advance(c, { worldSeconds: 3 * 3600, compressionStopped: false, mode: CompressMode.MIN30 });
    const clockEvents = report.events.flatMap((e) =>
      e.type === 'compressionStarted'
        ? ['started']
        : e.type === 'compressionStopped'
          ? [e.reason]
          : e.type === 'preBattle'
            ? ['preBattle']
            : [],
    );
    expect(clockEvents).toEqual(['started', 'arrived', 'started', 'preBattle', 'battle']);
    expect(report.reason).toBe('decision');
  });

  it('gives the same result under one advance and under many small ones', () => {
    const once = onTheMap(7, 'B9');
    const a = advance(once, { compressionStopped: true, mode: CompressMode.MIN30 });
    const chunked = onTheMap(7, 'B9');
    expect(chunked.dispatch({ type: 'compressTime', mode: CompressMode.MIN30 })).toMatchObject({ ok: true });
    let b = advance(chunked, { ticks: 7, events: ['compressionStopped'] });
    while (b.reason === 'ticks') b = advance(chunked, { ticks: 7, events: ['compressionStopped'] });
    expect(digest(chunked, { ...b, reason: 'event' })).toBe(digest(once, a));
  });

  it('keeps a moving squad on its way when another member is routed to the same sector', () => {
    const c = onTheMap(3, 'B9');
    const group = c.state.forces.groups.find((g) => g.player && g.size > 0);
    const before = { next: group?.next, arrival: group?.arrivalTime, between: group?.betweenSectors };
    expect(c.dispatch({ type: 'route', soldier: 1, to: 'B9' })).toMatchObject({ ok: true });
    expect({ next: group?.next, arrival: group?.arrivalTime, between: group?.betweenSectors }).toEqual(before);
    expect(c.state.battle.prompt).toBeNull();
  });
});
