import { describe, expect, it } from 'vitest';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import { parseSectorLabel } from './facts.ts';
import { MIN_WAIT_TIME_FOR_TEMP_PATH, type PlotClient, Plotting, type RouteAnswer } from './plotting.ts';

const SOLDIER = 3;
const ROW = 0;

function sector(label: string) {
  const s = parseSectorLabel(label);
  if (!s) throw new Error(label);
  return s;
}

class FakePlotClient implements PlotClient {
  readonly asked: CommandEnvelope[] = [];
  readonly #routes: Readonly<Record<string, RouteAnswer>>;

  constructor(routes: Readonly<Record<string, RouteAnswer>>) {
    this.#routes = routes;
  }

  async hintNow(request: CommandEnvelope) {
    this.asked.push(request);
    const answer = this.#routes[String(request.to)];
    return answer ? { ok: true, data: answer } : { ok: false, reason: 'noRoute' };
  }
}

const routes: Record<string, RouteAnswer> = {
  C13: { path: ['D13'], temp: ['D13', 'C13'], etaMinutes: 90 },
  B13: { path: ['D13', 'C13'], temp: ['C13', 'B13'], etaMinutes: 200 },
};

async function rest(plot: Plotting, client: PlotClient, label: string, now: number): Promise<number> {
  plot.hoverAt(sector(label), now);
  plot.update(client, now + MIN_WAIT_TIME_FOR_TEMP_PATH);
  await Promise.resolve();
  await Promise.resolve();
  return now + MIN_WAIT_TIME_FOR_TEMP_PATH;
}

describe('route plotting on the map screen', () => {
  it('asks for the temporary path only after the pointer rests, appends legs and confirms with one route', async () => {
    const client = new FakePlotClient(routes);
    const plot = new Plotting('merc', SOLDIER, ROW, 'D13', []);
    plot.hoverAt(sector('C13'), 0);
    plot.update(client, MIN_WAIT_TIME_FOR_TEMP_PATH - 1);
    expect(client.asked).toEqual([]);
    expect(plot.click(sector('C13'))).toEqual({ kind: 'ignored' });
    await rest(plot, client, 'C13', 0);
    expect(client.asked[0]).toEqual({ type: 'previewRoute', soldier: SOLDIER, to: 'C13', extend: true });
    expect(plot.tempPath()).toEqual(['D13', 'C13']);
    expect(plot.etaMinutes()).toBe(90);
    expect(plot.click(sector('C13'))).toEqual({ kind: 'appended' });
    expect(plot.legs).toEqual(['C13']);
    expect(plot.lastSectorOrOrigin()).toBe('C13');
    expect(plot.click(sector('C13'))).toEqual({ kind: 'confirm' });
    expect(plot.confirmCommand()).toEqual({ type: 'route', soldier: SOLDIER, to: 'C13', extend: true });
    expect(plot.routeFor(SOLDIER + 1)).toMatchObject({ soldier: SOLDIER + 1, to: 'C13' });
  });

  it('refuses a click off the road and sends the earlier legs as via with Shift as shortest', async () => {
    const client = new FakePlotClient(routes);
    const plot = new Plotting('merc', SOLDIER, ROW, 'D13', []);
    await rest(plot, client, 'A1', 0);
    expect(plot.click(sector('A1'))).toEqual({ kind: 'offRoad' });
    await rest(plot, client, 'C13', 1000);
    plot.click(sector('C13'));
    plot.shortest = true;
    await rest(plot, client, 'B13', 2000);
    expect(client.asked.find((q) => q.to === 'B13')).toEqual({
      type: 'previewRoute',
      soldier: SOLDIER,
      to: 'B13',
      via: ['C13'],
      shortest: true,
      extend: true,
    });
    plot.click(sector('B13'));
    expect(plot.confirmCommand()).toEqual({ type: 'route', soldier: SOLDIER, to: 'B13', via: ['C13'], shortest: true, extend: true });
  });

  it('cancels at the origin, shortens the confirmed path on the server and pending legs in the client', async () => {
    const client = new FakePlotClient(routes);
    const confirmed = new Plotting('merc', SOLDIER, ROW, 'D13', ['D13', 'C13', 'B13']);
    expect(confirmed.shorten(sector('D13'))).toEqual({ kind: 'cancel' });
    expect(confirmed.shorten(sector('C13'))).toEqual({ kind: 'shortenBase', at: 'C13' });
    expect(confirmed.shorten(sector('B13'))).toEqual({ kind: 'abort' });
    const pending = new Plotting('merc', SOLDIER, ROW, 'D13', []);
    await rest(pending, client, 'C13', 0);
    pending.click(sector('C13'));
    await rest(pending, client, 'B13', 1000);
    pending.click(sector('B13'));
    pending.update(client, 2000);
    await Promise.resolve();
    await Promise.resolve();
    expect(pending.plottedPath()).toEqual(['D13', 'C13', 'B13']);
    expect(pending.shorten(sector('C13'))).toEqual({ kind: 'shortenLegs' });
    expect(pending.legs).toEqual(['C13']);
  });

  it('plots the helicopter with heli previews and a plotted heliRoute', async () => {
    const client = new FakePlotClient(routes);
    const plot = new Plotting('heli', 0, -1, 'D13', []);
    await rest(plot, client, 'C13', 0);
    expect(client.asked[0]).toEqual({ type: 'previewHeliRoute', to: 'C13', extend: true });
    plot.click(sector('C13'));
    expect(plot.confirmCommand()).toEqual({ type: 'heliRoute', to: 'C13', extend: true, plotted: true });
    expect(plot.routeFor(SOLDIER)).toBeNull();
  });
});
