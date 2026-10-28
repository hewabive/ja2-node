import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type MapUiKit, type MapUiTest, mapUiKit, mapUiTest } from '../../../../tests/support/map-ui.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import type { DrawItem } from '../../draw-list.ts';
import { MouseButton } from '../../input/events.ts';

const PLOT_REST_MS = 250;
const MESSAGE_BOX = 'messageBox';

let kit: StubSectorKit;
let ui: MapUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await mapUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

function line(item: DrawItem): string {
  switch (item.kind) {
    case 'image':
      return `image ${item.asset}#${item.frame} ${item.x},${item.y}${item.shade ? ' shaded' : ''}`;
    case 'glyphs': {
      const first = item.glyphs[0];
      return `glyphs ${item.font} ${first ? `${first.x},${first.y}` : '-'} n=${item.glyphs.length} fg=${item.foreground}`;
    }
    case 'fill':
      return `fill ${item.x},${item.y} ${item.width}x${item.height} ${hex(item.color)}`;
    case 'shadow':
      return `shadow ${item.x},${item.y} ${item.width}x${item.height}`;
    case 'line':
    case 'rectangle':
      return `${item.kind} ${item.x1},${item.y1} ${item.x2},${item.y2} ${hex(item.color)}`;
    case 'clipPush':
      return `clip ${item.x},${item.y} ${item.width}x${item.height}`;
    default:
      return item.kind;
  }
}

function snapshot(f: MapUiTest): string {
  return `${f.draw().items.map(line).join('\n')}\n`;
}

function lastCommand(f: MapUiTest) {
  return f.client.commands.at(-1);
}

async function withMap(run: (f: MapUiTest) => Promise<void>): Promise<void> {
  const f = await mapUiTest(kit, ui);
  try {
    await run(f);
  } finally {
    await f.dispose();
  }
}

describe('the map screen over the stub map-screen campaign', () => {
  it('lists the squad, shows the info merc and the clock, and draws the same first frame', () =>
    withMap(async (f) => {
      const hook = f.screen.hook();
      expect(hook.rows.filter((r) => r !== null)).toHaveLength(4);
      expect(hook.info).not.toBeNull();
      expect(hook.filters).toMatchObject({ towns: true, teams: true, airspace: false });
      expect(hook.clock).toMatch(/^Day 1, \d\d:\d\d$/);
      expect(f.client.started).toBe(true);
      expect(f.widget('teamRow0.name').rect.width).toBeGreaterThan(0);
      expect(snapshot(f)).toMatchSnapshot();
    }));

  it('plots the squad to a sector through the destination column and confirms it with one route command', () =>
    withMap(async (f) => {
      await f.click('teamRow0.destination');
      expect(f.screen.hook().plotting).toMatchObject({ mode: 'merc', legs: [] });
      expect(f.client.holds.has('plotting')).toBe(true);
      await f.hoverSector('C13', PLOT_REST_MS);
      await f.clickSector('C13');
      expect(f.screen.hook().plotting?.legs).toEqual(['C13']);
      await f.clickSector('C13');
      expect(lastCommand(f)?.cmd).toMatchObject({ type: 'route', to: 'C13', extend: true });
      expect(lastCommand(f)?.reply.ok).toBe(true);
      expect(f.screen.hook().plotting).toBeNull();
      expect(f.client.holds.has('plotting')).toBe(false);
      expect(f.sounds.some((s) => s.startsWith('confirmRoute'))).toBe(true);
      const m = f.client.view.strategic?.mercs.find((x) => x.id === f.mercs[0]);
      const group = f.client.view.strategic?.groups.find((g) => g.members.includes(m?.id ?? -1));
      expect(group?.path.at(-1)).toBe('C13');
    }));

  it('opens the assignment popup over the row, holds time while it is open and closes it with Escape', () =>
    withMap(async (f) => {
      await f.click('teamRow1.assignment');
      await f.settle();
      expect(f.screen.hook().menu).toBe('assignment');
      expect(f.find('assignmentMenu')).toBeDefined();
      expect(f.client.holds.has('menus')).toBe(true);
      f.key('Escape');
      await f.settle();
      expect(f.screen.hook().menu).toBeNull();
      expect(f.client.holds.has('menus')).toBe(false);
    }));

  it('turns the airspace on like the border button, then plots and flies the helicopter after heliPlot', () =>
    withMap(async (f) => {
      const passenger = f.mercs[1] ?? -1;
      expect((await f.client.command({ type: 'boardVehicle', soldier: passenger, vehicle: 'helicopter' })).ok).toBe(true);
      await f.settle();
      expect(f.sounds).not.toContain('vehicleEntered');
      await f.click('filter4');
      expect(f.screen.hook().filters).toMatchObject({ airspace: true, towns: false });
      await f.clickSector('D13');
      expect(f.client.commands.find((c) => c.cmd.type === 'heliPlot')?.reply).toEqual({ ok: true });
      expect(f.screen.hook().plotting).toMatchObject({ mode: 'heli' });
      await f.hoverSector('B13', PLOT_REST_MS);
      await f.clickSector('B13');
      await f.clickSector('B13');
      expect(lastCommand(f)?.cmd).toMatchObject({ type: 'heliRoute', to: 'B13', extend: true, plotted: true });
      expect(lastCommand(f)?.reply).toMatchObject({ ok: true, data: { path: ['D13', 'C13', 'B13'] } });
      f.key('a', 0, 'KeyA');
      expect(f.screen.hook().filters.airspace).toBe(false);
    }));

  it('compresses time from the arrows: more starts at 5 minutes, less stops, and both wait while plotting', () =>
    withMap(async (f) => {
      await f.click('compressMore');
      expect(lastCommand(f)?.cmd).toEqual({ type: 'compressTime', mode: 2 });
      expect(f.screen.hook().compression).toMatchObject({ compressing: true, mode: 2 });
      await f.click('compressMore');
      expect(lastCommand(f)?.cmd).toEqual({ type: 'compressTime', mode: 3 });
      await f.click('compressLess');
      await f.click('compressLess');
      expect(lastCommand(f)?.cmd).toEqual({ type: 'stopTime' });
      expect(f.screen.hook().compression?.compressing).toBe(false);
      await f.click('teamRow0.destination');
      const sent = f.client.commands.length;
      expect(f.widget('compressMore').enabled).toBe(false);
      f.key('+');
      await f.settle();
      expect(f.client.commands.length).toBe(sent);
      expect(f.screen.hook().plotting).toBeNull();
    }));

  it('answers the militia payment prompt through a message box after a trainer is assigned', () =>
    withMap(async (f) => {
      const assigned = await f.client.command({ type: 'assign', soldiers: [f.trainer], to: { kind: 'trainMilitia' } });
      expect(assigned.ok).toBe(true);
      await f.settle();
      expect(f.t.runtime.host.modal?.id).toBe(MESSAGE_BOX);
      expect(f.client.view.prompt).toMatchObject({ kind: 'militiaPayment' });
      f.key('Enter');
      await f.settle();
      expect(f.client.commands.at(-1)?.cmd).toMatchObject({ type: 'answer', choice: 'yes' });
      expect(f.client.view.prompt ?? null).toBeNull();
      expect(f.client.view.strategic?.mercs.find((m) => m.id === f.trainer)?.assignment).toBe(27);
    }));

  it('closes the prompt box when an agent answers the prompt first, without answering again', () =>
    withMap(async (f) => {
      expect((await f.client.command({ type: 'assign', soldiers: [f.trainer], to: { kind: 'trainMilitia' } })).ok).toBe(true);
      await f.settle();
      expect(f.t.runtime.host.modal?.id).toBe(MESSAGE_BOX);
      expect((await f.client.command({ type: 'answer', choice: 'no' })).ok).toBe(true);
      const sent = f.client.commands.length;
      f.frames([{ tick: f.client.view.tick, changed: [], removed: [] }]);
      await f.settle();
      expect(f.t.runtime.host.modal).toBeNull();
      expect(f.client.commands.length).toBe(sent);
    }));

  it('selects the squad with its number key and the next merc with the arrow', () =>
    withMap(async (f) => {
      f.key('1', 0, 'Digit1');
      await f.settle();
      expect(f.screen.hook().selected).toHaveLength(4);
      const info = f.screen.hook().info;
      f.key('ArrowRight');
      await f.settle();
      expect(f.screen.hook().info).not.toBe(info);
      await f.click('teamRow0.name', MouseButton.RIGHT);
      expect(f.screen.hook().inventoryOpen).toBe(true);
      f.key('Escape');
      expect(f.screen.hook().inventoryOpen).toBe(false);
    }));
});
