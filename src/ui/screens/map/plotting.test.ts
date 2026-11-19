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
  it("asks for the temporary path only after the pointer rests, appends legs and confirms with the plot's end", async () => {
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
    expect(plot.endCommand('confirm', [SOLDIER])).toEqual({
      type: 'endPlot',
      soldier: SOLDIER,
      steps: [{ to: 'C13', selected: [SOLDIER] }],
      outcome: 'confirm',
      selected: [SOLDIER],
    });
  });

  it("confirms a merc's unchanged path, or the helicopter's, for the mercs selected then (CheckIfClickOnLastSectorInPath, MapScreen.cc:5509-5569)", () => {
    const plot = new Plotting('merc', SOLDIER, ROW, 'D13', ['D13', 'C13', 'B13']);
    expect(plot.click(sector('B13'))).toEqual({ kind: 'confirm' });
    expect(plot.endCommand('confirm', [SOLDIER, SOLDIER + 1])).toEqual({
      type: 'endPlot',
      soldier: SOLDIER,
      outcome: 'confirm',
      selected: [SOLDIER, SOLDIER + 1],
    });
    expect(new Plotting('merc', SOLDIER, ROW, 'D13', []).click(sector('D13'))).toEqual({ kind: 'confirm' });
    const heli = new Plotting('heli', SOLDIER, ROW, 'D13', []);
    expect(heli.click(sector('D13'))).toEqual({ kind: 'confirm' });
    expect(heli.endCommand('confirm', [])).toEqual({ type: 'endPlot', helicopter: true, outcome: 'confirm', selected: [] });
  });

  it('keeps each click and shortening with the selected list and the Shift of its moment (MapScreen.cc:2315, Map_Screen_Interface_Map.cc:956-960, Strategic_Pathing.cc:202-208)', async () => {
    const client = new FakePlotClient(routes);
    const plot = new Plotting('merc', SOLDIER, ROW, 'D13', []);
    await rest(plot, client, 'A1', 0);
    expect(plot.click(sector('A1'))).toEqual({ kind: 'offRoad' });
    await rest(plot, client, 'C13', 1000);
    plot.click(sector('C13'), true, [SOLDIER, SOLDIER + 1]);
    plot.shortest = true;
    await rest(plot, client, 'B13', 2000);
    expect(client.asked.find((q) => q.to === 'B13')).toEqual({
      type: 'previewRoute',
      soldier: SOLDIER,
      to: 'B13',
      steps: [{ to: 'C13' }],
      shortest: true,
      extend: true,
    });
    plot.click(sector('B13'), true, [SOLDIER]);
    plot.shortest = false;
    expect(plot.plottedPath()).toEqual(['D13', 'C13', 'B13']);
    expect(plot.shorten(sector('C13'), [SOLDIER + 2])).toEqual({ kind: 'shortened' });
    expect(plot.plottedPath()).toEqual(['D13', 'C13']);
    expect(plot.endCommand('abort', [SOLDIER])).toEqual({
      type: 'endPlot',
      soldier: SOLDIER,
      steps: [
        { to: 'C13', selected: [SOLDIER, SOLDIER + 1] },
        { to: 'B13', shortest: true, selected: [SOLDIER] },
        { cut: 'C13', selected: [SOLDIER + 2] },
      ],
      outcome: 'abort',
      selected: [SOLDIER],
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

  it('cancels at the origin, gives the plot up on the last sector or off the path, and shortens anywhere else (CancelOrShortenPlottedPath)', () => {
    const plot = new Plotting('merc', SOLDIER, ROW, 'D13', ['D13', 'C13', 'B13']);
    expect(plot.shorten(sector('D13'))).toEqual({ kind: 'cancel' });
    expect(plot.shorten(sector('B13'))).toEqual({ kind: 'abort' });
    expect(plot.shorten(sector('A1'))).toEqual({ kind: 'abort' });
    expect(plot.changed).toBe(false);
    expect(plot.shorten(sector('C13'))).toEqual({ kind: 'shortened' });
    expect(plot.changed).toBe(true);
    expect(new Plotting('merc', SOLDIER, ROW, 'D13', []).shorten(sector('C13'))).toEqual({ kind: 'abort' });
  });

  it('plots the helicopter with heli previews and ends the plot for it', async () => {
    const client = new FakePlotClient(routes);
    const plot = new Plotting('heli', 0, -1, 'D13', []);
    await rest(plot, client, 'C13', 0);
    expect(client.asked[0]).toEqual({ type: 'previewHeliRoute', to: 'C13', extend: true });
    plot.click(sector('C13'));
    expect(plot.endCommand('confirm', [SOLDIER])).toEqual({
      type: 'endPlot',
      helicopter: true,
      steps: [{ to: 'C13', selected: [] }],
      outcome: 'confirm',
      selected: [SOLDIER],
    });
  });

  it('plots the helicopter the direct way while Shift is held, as its group is a player group (Strategic_Pathing.cc:348-352)', async () => {
    const client = new FakePlotClient(routes);
    const plot = new Plotting('heli', 0, -1, 'D13', []);
    plot.shortest = true;
    await rest(plot, client, 'C13', 0);
    expect(client.asked[0]).toEqual({ type: 'previewHeliRoute', to: 'C13', shortest: true, extend: true });
    plot.click(sector('C13'));
    expect(plot.endCommand('drop', [])).toMatchObject({ steps: [{ to: 'C13', shortest: true }], outcome: 'drop' });
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
