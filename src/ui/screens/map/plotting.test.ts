import { describe, expect, it } from 'vitest';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import { parseSectorLabel } from './facts.ts';
import { MAP_GRID_X, MAP_GRID_Y, MAP_VIEW_HEIGHT, MAP_VIEW_START_X, MAP_VIEW_START_Y } from './map-view.ts';
import { type PathGeometry, tracePathRoute } from './path-trace.ts';
import { MIN_WAIT_TIME_FOR_TEMP_PATH, type PlotClient, Plotting, pathSectors, type RouteAnswer } from './plotting.ts';

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
    expect(plot.click(sector('C13'), true, [SOLDIER])).toEqual({ kind: 'appended' });
    expect(plot.legs).toEqual(['C13']);
    expect(plot.lastSectorOrOrigin()).toBe('C13');
    expect(plot.click(sector('C13'), true, [SOLDIER])).toEqual({ kind: 'confirm' });
    expect(plot.confirmCommand([SOLDIER])).toEqual({ type: 'route', soldier: SOLDIER, to: 'C13', extend: true, selected: [SOLDIER] });
  });

  it("confirms a merc's unchanged path with a route to its end for the mercs selected then (CheckIfClickOnLastSectorInPath, MapScreen.cc:5569)", () => {
    const plot = new Plotting('merc', SOLDIER, ROW, 'D13', ['C13', 'B13']);
    expect(plot.click(sector('B13'))).toEqual({ kind: 'confirm' });
    expect(plot.confirmCommand([SOLDIER, SOLDIER + 1])).toEqual({
      type: 'route',
      soldier: SOLDIER,
      to: 'B13',
      selected: [SOLDIER, SOLDIER + 1],
    });
  });

  it('keeps the selected list of each plotting click and sends them when one differs from the list at the confirm (MapScreen.cc:2315)', async () => {
    const client = new FakePlotClient(routes);
    const plot = new Plotting('merc', SOLDIER, ROW, 'D13', []);
    await rest(plot, client, 'C13', 0);
    plot.click(sector('C13'), true, [SOLDIER, SOLDIER + 1]);
    await rest(plot, client, 'B13', 1000);
    plot.click(sector('B13'), true, [SOLDIER]);
    expect(plot.confirmCommand([SOLDIER])).toMatchObject({
      to: 'B13',
      via: ['C13'],
      selected: [SOLDIER],
      selectedPerLeg: [[SOLDIER, SOLDIER + 1], [SOLDIER]],
    });
    expect(plot.confirmCommand([SOLDIER, SOLDIER + 1])).toMatchObject({ selected: [SOLDIER, SOLDIER + 1] });
    plot.update(client, 2000);
    await Promise.resolve();
    await Promise.resolve();
    plot.shorten(sector('C13'));
    expect(plot.confirmCommand([SOLDIER, SOLDIER + 1])).not.toHaveProperty('selectedPerLeg');
  });

  it('confirms a merc or the helicopter without a path at its own sector, and an unchanged helicopter path again (CheckIfClickOnLastSectorInPath)', () => {
    expect(new Plotting('merc', SOLDIER, ROW, 'D13', []).confirmCommand()).toEqual({
      type: 'route',
      soldier: SOLDIER,
      to: 'D13',
      selected: [],
    });
    expect(new Plotting('heli', SOLDIER, ROW, 'D13', []).confirmCommand()).toEqual({
      type: 'heliRoute',
      to: 'D13',
      extend: true,
      plotted: true,
      selected: [],
    });
    expect(new Plotting('heli', SOLDIER, ROW, 'D13', ['C13']).confirmCommand()).toEqual({
      type: 'heliRoute',
      to: 'C13',
      extend: true,
      plotted: true,
      selected: [],
    });
  });

  it('refuses a click off the road and sends the earlier legs as via, each with the Shift of its own click (Strategic_Pathing.cc:202-208)', async () => {
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
      shortest: [false, true],
      extend: true,
    });
    plot.click(sector('B13'));
    plot.shortest = false;
    expect(plot.confirmCommand()).toEqual({
      type: 'route',
      soldier: SOLDIER,
      to: 'B13',
      via: ['C13'],
      shortest: [false, true],
      extend: true,
      selected: [],
    });
  });

  it('ignores a click on a sector a merc cannot plot to, though it shows the temporary path there (MapScreen.cc:2307)', async () => {
    const client = new FakePlotClient(routes);
    const plot = new Plotting('merc', SOLDIER, ROW, 'D13', []);
    await rest(plot, client, 'C13', 0);
    expect(plot.tempPath()).toEqual(['D13', 'C13']);
    expect(plot.click(sector('C13'), false)).toEqual({ kind: 'ignored' });
    expect(plot.legs).toEqual([]);
    expect(plot.click(sector('D13'), false)).toEqual({ kind: 'confirm' });
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
    expect(plot.confirmCommand([SOLDIER])).toEqual({ type: 'heliRoute', to: 'C13', extend: true, plotted: true, selected: [SOLDIER] });
  });

  it('plots the helicopter the direct way while Shift is held, as its group is a player group (Strategic_Pathing.cc:348-352)', async () => {
    const client = new FakePlotClient(routes);
    const plot = new Plotting('heli', 0, -1, 'D13', []);
    plot.shortest = true;
    await rest(plot, client, 'C13', 0);
    expect(client.asked[0]).toEqual({ type: 'previewHeliRoute', to: 'C13', shortest: true, extend: true });
    plot.click(sector('C13'));
    expect(plot.confirmCommand()).toEqual({ type: 'heliRoute', to: 'C13', shortest: true, extend: true, plotted: true, selected: [] });
  });
});

describe('the path drawn on the map', () => {
  const geometry = (screenWidth: number): PathGeometry => ({
    startX: MAP_VIEW_START_X,
    startY: MAP_VIEW_START_Y,
    gridX: MAP_GRID_X,
    gridY: MAP_GRID_Y,
    viewHeight: MAP_VIEW_HEIGHT,
    screenWidth,
  });
  const toTheEastEdge = pathSectors(['C14', 'C15', 'C16']);

  it('leaves out the column 16 pieces at 640 pixels wide: the original tests the node against the screen width', () => {
    expect(tracePathRoute(toTheEastEdge, geometry(640), { x: 0, y: 0 })).toHaveLength(2);
    expect(tracePathRoute(toTheEastEdge, geometry(800), { x: 80, y: 0 })).toHaveLength(3);
  });
});
