import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildFirstLandingCampaign } from '../../../../tests/support/e2e-campaign-saves.ts';
import { type MapUiKit, type MapUiTest, mapUiKit, mapUiTest, TEST_VERSION } from '../../../../tests/support/map-ui.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { GrabbedPointer, type TestRuntimeOptions } from '../../../../tests/support/ui-runtime.ts';
import { addVehicleOfOurs } from '../../../../tests/support/vehicles.ts';
import { Body } from '../../../content/anim/body-types.ts';
import { MAP_SIDE, parseSectorString, sectorId } from '../../../content/strategic/sector-ids.ts';
import { FontColor } from '../../../content/text/font-colors.ts';
import { TICK_MS } from '../../../protocol/messages.ts';
import type { CampaignSession } from '../../../server/campaign-session.ts';
import { MercKind } from '../../../sim/campaign/roster.ts';
import { emptySectorDiff, sectorKey } from '../../../sim/campaign/sector-diff.ts';
import { createItem, createItems, emptyObject } from '../../../sim/items/object.ts';
import { StatAmt, StatCause } from '../../../sim/strategic/economy/constants.ts';
import { SectorFlag } from '../../../sim/strategic/forces/constants.ts';
import { sectorInfo, setSectorFlag } from '../../../sim/strategic/map/sectors.ts';
import { InvSlot } from '../../../sim/tactical/inventory.ts';
import { WorldItemFlags } from '../../../sim/tactical/world-items.ts';
import { type DrawItem, rgb } from '../../draw-list.ts';
import { KeyModifier, keyDownEvents, keyUpEvents, MouseButton, type RawKey } from '../../input/events.ts';
import { BUTTON_REPEAT_TIMEOUT_MS } from '../../input/mouse.ts';
import { SECTOR_ZOOM_TIME, SectorZoom } from '../front-end/sector-zoom.ts';
import { CHANGE_STAT_RECENTLY_DURATION_MS } from '../tactical/panel-models.ts';
import { Assignment, CHAR_TEXT_FONT_COLOR } from './character-list.ts';
import { mapFacts, parseSectorLabel, sectorLabel } from './facts.ts';
import { localMessage, MAX_MESSAGES_ON_MAP_BOTTOM } from './message-list.ts';
import { TeamColumn } from './team-list-view.ts';

const PLOT_REST_MS = 250;
const HELICOPTER_ICONS = 'interface/helicop.sti';
const HELI_SHADOW_FRAME = 1;
const ASSIGN_MENU_TRAIN = 5;
const TRAIN_MENU_TOWN = 1;
const MAX_MILITIA_TRAINERS = 2;
const MESSAGE_BOX = 'messageBox';
const EXIT_BUTTONS = ['laptopButton', 'tacticalButton', 'optionsButton'];
const SQUAD_SECTOR = 'D13';
const PLOT_TRAVEL_ROUTE = 'Plot Travel Route';
const MALE = 0;
const FEMALE = 1;
const FRED = 106;
const FRED_RUNNING_OUT = 17;
const FRED_KEY = { file: 'npcdata/106.edt', row: FRED_RUNNING_OUT, width: 240 };
const DRASSEN_MINE = 1;
const RADAR = 'radarmaps/test.sti';
const CLOCK_X = 554;
const CLOCK_Y = 457;
const START_HOUR = 1;
const FIRST_ARRIVAL_HOUR = 7;
const DRASSEN_MINE_FIRST_LEVEL = { x: 13, y: 4, z: 1 };
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;
const NIGHT_SHADE = { red: 100, green: 100, blue: 100, mono: false };
const MESSAGE_LINES = 30;
const LAST_TOP_LINE = MESSAGE_LINES - MAX_MESSAGES_ON_MAP_BOTTOM;
const SCROLL_AREA_X = 7;
const FULL_SHADE = { red: 255, green: 255, blue: 255, mono: false };
const RADAR_ITEM_COLUMNS = 88;
const RADAR_ITEM_ROW = 7;
const RADAR_FLASH_MS = 210;
const STASH_GRIDNO = 12_345;
const GLOW_DELAY_MS = 70;
const GLOW_RED_STEP = 25;
const FRAME_MS = 16;
const HAND_GLOW_X1 = 3;
const HAND_GLOW_Y1 = 80;
const PORTRAIT_ICONS = 'interface/portraiticons.sti';
const ADRENALINE_ICON = 7;
const DRUNK_ICON = 8;
const HEALTH_SUBPOINTS = 50;
const TRAINABLE_HEALTH = 60;
const TRAINING_POINTS = 40;
const ROUTE_CONFIRMED = 'Travel route confirmed.';
const ROUTE_UNCHANGED = 'Destination unchanged.';
const INVALID_DROPOFF = 'New recruits cannot arrive there.';
const DISMISS_LINE = 'contractMenu.line5';
const LAST_ROW = 19;
const EMPTY_ROW = 10;
const FIRST_SUBLEVEL = 1;
const EDGE_OF_WORLD = 12;
const MAP_CURSORS = 'interface/mapcursr.sti';
const ETA_POPUP = 'interface/eta_pop_up.sti';
const ETA_POPUP_HEIGHT = 21;
const ETA_TEXT_PIECES = 3;

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

function whiteFaces(f: MapUiTest): number {
  return f.draw().items.filter((item) => item.kind === 'image' && item.shade?.base === 'white').length;
}

function glyphColours(f: MapUiTest): number[] {
  return f.draw().items.flatMap((item) => (item.kind === 'glyphs' ? [item.foreground] : []));
}

function snapshot(f: MapUiTest): string {
  return `${f.draw().items.map(line).join('\n')}\n`;
}

function lastCommand(f: MapUiTest) {
  return f.client.commands.at(-1);
}

function setWorldHour(f: MapUiTest, hour: number): void {
  const clock = (f.session.sim as CampaignSession).campaign.state.clock;
  clock.seconds = Math.floor(clock.seconds / SECONDS_PER_DAY) * SECONDS_PER_DAY + hour * SECONDS_PER_HOUR;
  f.client.refresh();
  f.t.frame();
}

function clockGlyphs(f: MapUiTest): string {
  const inClock = (item: DrawItem) => item.kind === 'glyphs' && (item.glyphs[0]?.x ?? 0) >= CLOCK_X && (item.glyphs[0]?.y ?? 0) >= CLOCK_Y;
  const text = (item: DrawItem) => (item.kind === 'glyphs' ? item.glyphs.map((g) => g.index).join() : '');
  return f.draw().items.filter(inClock).map(text).join('|');
}

function radarShade(f: MapUiTest) {
  const radar = f.draw().items.find((item) => item.kind === 'image' && item.asset === RADAR);
  return radar?.kind === 'image' ? radar.shade : undefined;
}

function pressKeypad(f: MapUiTest, key: string, code: string, numLock = true): void {
  const raw = { key, code, repeat: false, shift: false, ctrl: false, alt: false, numLock };
  for (const event of [...keyDownEvents(raw), ...keyUpEvents(raw)]) f.t.runtime.input(event);
  f.t.frame();
}

function pressAlone(f: MapUiTest, key: string, code: string, held: Partial<RawKey>): void {
  const released: RawKey = { key, code, repeat: false, shift: false, ctrl: false, alt: false, numLock: true };
  for (const event of [...keyDownEvents({ ...released, ...held }), ...keyUpEvents(released)]) f.t.runtime.input(event);
  f.t.frame();
}

function hoverWidget(f: MapUiTest, id: string): void {
  const { rect } = f.widget(id);
  const x = rect.x + Math.floor(rect.width / 2);
  const y = rect.y + Math.floor(rect.height / 2);
  f.t.runtime.input({ kind: 'pointerMove', x, y, button: MouseButton.LEFT, buttons: 0, wheel: 0, modifiers: 0 });
  f.t.frame();
}

function nudgePointer(f: MapUiTest): void {
  const { mouseX, mouseY } = f.t.runtime.regions;
  f.t.runtime.input({ kind: 'pointerMove', x: mouseX + 1, y: mouseY, button: MouseButton.LEFT, buttons: 0, wheel: 0, modifiers: 0 });
  f.t.frame();
}

function handOutlines(f: MapUiTest): DrawItem[] {
  return f.draw().items.filter((i) => i.kind === 'rectangle' && i.x1 === HAND_GLOW_X1 && i.y1 === HAND_GLOW_Y1);
}

function textColourIn(f: MapUiTest, id: string): number | undefined {
  const { rect } = f.widget(id);
  const inside = (x: number, y: number) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
  const item = f.draw().items.find((i) => i.kind === 'glyphs' && i.glyphs[0] !== undefined && inside(i.glyphs[0].x, i.glyphs[0].y));
  return item?.kind === 'glyphs' ? item.foreground : undefined;
}

function fillMessageList(f: MapUiTest, lines: number): void {
  f.media.log = Array.from({ length: lines }, (_, i) => localMessage(i, `Line ${i}`));
  f.t.frame();
}

function wheelOver(f: MapUiTest, id: string, wheel: number): void {
  const { rect } = f.widget(id);
  const y = rect.y + rect.height - 1;
  f.t.runtime.input({ kind: 'wheel', x: rect.x + 1, y, button: MouseButton.LEFT, buttons: 0, wheel, modifiers: 0 });
  f.t.frame();
}

function putBullseyeAt(f: MapUiTest, sector: string): void {
  const at = parseSectorLabel(sector);
  if (!at) throw new Error(`no sector ${sector}`);
  (f.session.sim as CampaignSession).campaign.state.laptop.mercArriveSector = sectorId(at);
  f.client.refresh();
  f.t.frame();
}

async function clickBullseyeUnderHelicopter(f: MapUiTest): Promise<void> {
  const heli = f.client.view.strategic?.helicopter;
  const sector = heli && 'sector' in heli ? heli.sector : '';
  putBullseyeAt(f, sector);
  await f.click('filter4');
  await f.clickSector(sector);
}

function setGameJustStarted(f: MapUiTest, started: boolean): void {
  (f.session.sim as CampaignSession).campaign.state.didGameJustStart = started;
  f.client.refresh();
  f.t.frame();
}

function setMapInterfaceDisabled(f: MapUiTest, disabled: boolean): void {
  (f.session.sim as CampaignSession).campaign.state.movement.disableMapInterfaceDueToBattle = disabled;
  f.client.refresh();
  f.t.frame();
}

function listedMercs(f: MapUiTest): [number, number, number] {
  const mercOn = (row: number) => {
    const id = f.screen.list.slots[row]?.merc;
    if (id === null || id === undefined) throw new Error(`no merc on row ${row}`);
    return id;
  };
  return [mercOn(0), mercOn(1), mercOn(2)];
}

function moveMercAway(f: MapUiTest, id: number): void {
  const merc = (f.session.sim as CampaignSession).campaign.battle?.roster.get(id);
  if (!merc) throw new Error(`no roster merc ${id}`);
  merc.sector = { x: 1, y: 1, z: 0 };
  f.client.refresh();
  f.t.frame();
}

function stashClipInSelectedSector(f: MapUiTest): void {
  const campaign = (f.session.sim as CampaignSession).campaign;
  const items = campaign.battle?.content.items;
  if (!items) throw new Error('no item table');
  const object = createItem(items, items.byName.get('CLIP9_15')?.index ?? 0, 15);
  const flags = WorldItemFlags.REACHABLE;
  const diff = { ...emptySectorDiff(), items: [{ exists: true, gridNo: STASH_GRIDNO, level: 0, object, flags, zHeight: 0, visible: 1 }] };
  campaign.state.sectorDiffs.set(sectorKey(f.screen.selectedSector), diff);
}

async function withMap(run: (f: MapUiTest) => Promise<void>, options: TestRuntimeOptions = {}): Promise<void> {
  const f = await mapUiTest(kit, ui, options);
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

  it('zooms into the night frame presented before the first compression, as BeginLoadScreen copies it before the clock warps to 07:00', async () => {
    const f = await mapUiTest(kit, ui, {}, buildFirstLandingCampaign);
    try {
      f.media.radar = () => RADAR;
      f.t.frame();
      const night = clockGlyphs(f);
      expect(night).not.toBe('');
      expect([f.client.view.clock?.hour, radarShade(f), f.client.view.strategic?.flow]).toEqual([START_HOUR, NIGHT_SHADE, 'strategic']);
      expect((await f.session.prepareAndDispatch({ type: 'compressTime', mode: 2 })).ok).toBe(true);
      f.client.refresh();
      expect([f.client.view.clock?.hour, f.client.view.strategic?.flow]).toEqual([FIRST_ARRIVAL_HOUR, 'tactical']);
      f.t.runtime.host.openModal(new SectorZoom(f.t.runtime, () => undefined));
      f.t.frame();
      expect([clockGlyphs(f), radarShade(f)]).toEqual([night, NIGHT_SHADE]);
      f.t.frame(SECTOR_ZOOM_TIME);
      f.t.frame();
      expect(f.t.runtime.host.modal).toBeNull();
      expect(clockGlyphs(f)).not.toBe(night);
      expect(radarShade(f)).toEqual(FULL_SHADE);
    } finally {
      await f.dispose();
    }
  });

  it('darkens the radar picture of the selected sector at night, from 21:00 to 7:00', () =>
    withMap(async (f) => {
      f.media.radar = () => RADAR;
      setWorldHour(f, 12);
      expect(radarShade(f)).toEqual(FULL_SHADE);
      setWorldHour(f, 21);
      expect(radarShade(f)).toEqual(NIGHT_SHADE);
      setWorldHour(f, 6);
      expect(radarShade(f)).toEqual(NIGHT_SHADE);
      setWorldHour(f, 7);
      expect(radarShade(f)).toEqual(FULL_SHADE);
    }));

  it('flashes the sector inventory item under the pointer on the radar, white and then green every 200 ms', () =>
    withMap(async (f) => {
      f.media.radar = () => RADAR;
      f.media.radarItemDot = (gridNo) => ({ x: gridNo % RADAR_ITEM_COLUMNS, y: RADAR_ITEM_ROW });
      const campaign = (f.session.sim as CampaignSession).campaign;
      const items = campaign.battle?.content.items;
      if (!items) throw new Error('no item table');
      const clip = items.byName.get('CLIP9_15')?.index ?? 0;
      const at = STASH_GRIDNO;
      const object = createItem(items, clip, 15);
      const diff = { ...emptySectorDiff(), items: [{ exists: true, gridNo: at, level: 0, object, flags: 0, zHeight: 0, visible: 1 }] };
      campaign.state.sectorDiffs.set(sectorKey(f.screen.selectedSector), diff);
      f.screen.openSectorInventory();
      await f.settle();
      hoverWidget(f, 'poolSlot0');
      const blips = () =>
        f
          .draw()
          .items.filter((i) => i.kind === 'rectangle' && i.x2 === i.x1 + 1 && i.y2 === i.y1 + 1)
          .map((i) => (i.kind === 'rectangle' ? hex(i.color) : ''));
      expect(blips()).toEqual(['#ffffff']);
      f.t.frame(RADAR_FLASH_MS);
      expect(blips()).toEqual(['#00ff00']);
      hoverWidget(f, 'poolSlot1');
      expect(blips()).toEqual([]);
    }));

  it('keeps the radar picture of a level below ground light at night', () =>
    withMap(async (f) => {
      f.media.radar = () => RADAR;
      const campaign = (f.session.sim as CampaignSession).campaign;
      setSectorFlag(campaign.state.map, DRASSEN_MINE_FIRST_LEVEL, SectorFlag.ALREADY_VISITED, 1);
      setWorldHour(f, 22);
      await f.clickSector('D13');
      f.key('Delete');
      expect(f.screen.selectedSector).toEqual(DRASSEN_MINE_FIRST_LEVEL);
      expect(radarShade(f)).toEqual(FULL_SHADE);
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
      expect(lastCommand(f)?.cmd).toMatchObject({ type: 'endPlot', outcome: 'confirm', steps: [{ to: 'C13' }] });
      expect(lastCommand(f)?.reply.ok).toBe(true);
      expect(f.screen.hook().plotting).toBeNull();
      expect(f.client.holds.has('plotting')).toBe(false);
      expect(f.sounds.some((s) => s.startsWith('confirmRoute'))).toBe(true);
      const m = f.client.view.strategic?.mercs.find((x) => x.id === f.mercs[0]);
      const group = f.client.view.strategic?.groups.find((g) => g.members.includes(m?.id ?? -1));
      expect(group?.path.at(-1)).toBe('C13');
    }));

  it('regroups the movers at Done, before the plot, so a plot given up with Escape leaves the new squad (HandleMoveoutOfSectorMovementTroops)', () =>
    withMap(async (f) => {
      const [mover, stayer] = f.mercs;
      const squadOf = (id: number | undefined) => f.client.view.strategic?.mercs.find((m) => m.id === id)?.assignment;
      const name = f.client.view.strategic?.mercs.find((m) => m.id === mover)?.name ?? '';
      expect(squadOf(mover)).toBe(squadOf(stayer));
      await f.clickSector(SQUAD_SECTOR);
      await f.clickSector(SQUAD_SECTOR);
      await f.settle();
      const line = (text: string) => `moveBox.line${(f.screen.hook().moveBox ?? []).findIndex((l) => l.trim() === text)}`;
      await f.click(line(name));
      await f.click(line(PLOT_TRAVEL_ROUTE));
      await f.settle();
      expect(f.client.commands.map((c) => c.cmd.type)).toContain('regroupForMove');
      expect(lastCommand(f)).toMatchObject({
        cmd: { type: 'regroupForMove', soldiers: [mover], squads: [], vehicles: [] },
        reply: { ok: true },
      });
      expect(f.screen.hook().plotting).toMatchObject({ mode: 'merc', legs: [] });
      expect(squadOf(mover)).not.toBe(squadOf(stayer));
      f.key('Escape');
      await f.settle();
      expect(f.screen.hook().plotting).toBeNull();
      expect(squadOf(mover)).not.toBe(squadOf(stayer));
      expect(f.client.commands.filter((c) => c.cmd.type === 'routeGroup')).toHaveLength(0);
      expect(lastCommand(f)?.cmd).toMatchObject({ type: 'endPlot', soldier: mover, outcome: 'abort', selected: [mover] });
    }));

  it('plots after Done for the first mover from his own path, and confirms it again on his sector as any plot (HandleSettingTheSelectedListOfMercs, Map_Screen_Interface.cc:2862-2915)', () =>
    withMap(async (f) => {
      const [mover] = f.mercs;
      const name = f.client.view.strategic?.mercs.find((m) => m.id === mover)?.name ?? '';
      await f.clickSector(SQUAD_SECTOR);
      await f.clickSector(SQUAD_SECTOR);
      await f.settle();
      const line = (text: string) => `moveBox.line${(f.screen.hook().moveBox ?? []).findIndex((l) => l.trim() === text)}`;
      await f.click(line(name));
      await f.click(line(PLOT_TRAVEL_ROUTE));
      await f.settle();
      expect(f.screen.hook().plotting).toMatchObject({ soldier: mover, mode: 'merc', legs: [] });
      await f.clickSector(SQUAD_SECTOR);
      expect(lastCommand(f)).toMatchObject({
        cmd: { type: 'endPlot', soldier: mover, outcome: 'confirm', selected: [mover] },
        reply: { ok: true },
      });
      expect(f.screen.hook()).toMatchObject({ plotting: null, uiMessage: ROUTE_UNCHANGED });
    }));

  it("moves the pointer onto the first line of the assignment box as it opens, unless don't move mouse is set", () => {
    const grab = new GrabbedPointer();
    return withMap(
      async (f) => {
        await f.click('teamRow1.assignment');
        await f.settle();
        const box = f.widget('assignmentMenu').rect;
        const step = f.widget('assignmentMenu.line0').rect.height;
        expect(grab.warps).toEqual([{ x: box.x + box.width - 6, y: box.y + Math.trunc(step / 2) + 2 }]);
        expect(f.t.runtime.cursorReport()).toMatchObject(grab.warps[0] ?? {});
        f.key('Escape');
        await f.settle();
        grab.keepsPointer = true;
        await f.click('teamRow1.assignment');
        await f.settle();
        expect(f.find('assignmentMenu')).toBeDefined();
        expect(grab.warps).toHaveLength(1);
      },
      { pointerWarp: grab },
    );
  });

  it("measures the pointer's spot on an escort's popup on the assignment box, which is not shown", () => {
    const grab = new GrabbedPointer();
    return withMap(
      async (f) => {
        await f.click('teamRow1.assignment');
        await f.settle();
        const assignmentBox = f.widget('assignmentMenu').rect;
        f.key('Escape');
        await f.settle();
        const campaign = (f.session.sim as CampaignSession).campaign;
        const record = campaign.battle?.roster.get(f.mercs[1] ?? -1);
        if (!record) throw new Error('no escort');
        Object.assign(record.record, { kind: MercKind.EPC });
        f.client.refresh();
        await f.click(`teamRow${f.screen.list.rowOf(record.id)}.assignment`);
        await f.settle();
        const epcBox = f.widget('assignmentMenu').rect;
        const step = f.widget('assignmentMenu.line0').rect.height;
        expect(epcBox.width).not.toBe(assignmentBox.width);
        expect(grab.warps.at(-1)).toEqual({ x: epcBox.x + assignmentBox.width - 6, y: epcBox.y + Math.trunc(step / 2) + 2 });
      },
      { pointerWarp: grab },
    );
  });

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
      expect(f.sounds.filter((s) => s.startsWith('vehicleEntered'))).toEqual([]);
      await f.click('filter4');
      expect(f.screen.hook().filters).toMatchObject({ airspace: true, towns: false });
      await f.clickSector('D13');
      expect(f.client.commands.find((c) => c.cmd.type === 'heliPlot')?.reply).toEqual({ ok: true });
      expect(f.screen.hook().plotting).toMatchObject({ mode: 'heli' });
      await f.hoverSector('B13', PLOT_REST_MS);
      await f.clickSector('B13');
      await f.clickSector('B13');
      expect(lastCommand(f)?.cmd).toMatchObject({
        type: 'endPlot',
        helicopter: true,
        steps: [{ to: 'B13' }],
        outcome: 'confirm',
        selected: f.screen.list.selectedIds(),
      });
      expect(lastCommand(f)?.reply).toMatchObject({ ok: true, data: { path: ['D13', 'C13', 'B13'] } });
      f.key('a', 0, 'KeyA');
      expect(f.screen.hook().filters.airspace).toBe(false);
    }));

  it('draws the confirmed helicopter route from the click until its command settles, as the original sets the path at once', () =>
    withMap(async (f) => {
      const passenger = f.mercs[1] ?? -1;
      expect((await f.client.command({ type: 'boardVehicle', soldier: passenger, vehicle: 'helicopter' })).ok).toBe(true);
      await f.settle();
      await f.click('filter4');
      await f.clickSector('D13');
      await f.hoverSector('B13', PLOT_REST_MS);
      await f.clickSector('B13');
      const send = f.client.command.bind(f.client);
      let settle: () => void = () => undefined;
      f.client.command = (cmd) =>
        cmd.type === 'endPlot'
          ? new Promise((resolve) => {
              settle = () => resolve(send(cmd));
            })
          : send(cmd);
      const shadows = () =>
        f.draw().items.filter((i) => i.kind === 'image' && i.asset === HELICOPTER_ICONS && i.frame === HELI_SHADOW_FRAME);
      expect(shadows()).toEqual([]);
      await f.clickSector('B13');
      expect(f.screen.hook().plotting).toBeNull();
      expect(f.client.view.strategic?.helicopter).toMatchObject({ path: [] });
      expect(shadows()).toHaveLength(1);
      settle();
      await f.settle();
      expect(lastCommand(f)?.cmd).toMatchObject({ type: 'endPlot', helicopter: true, steps: [{ to: 'B13' }] });
      expect(shadows()).toHaveLength(1);
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
      expect(f.client.commands.slice(sent).map((c) => c.cmd)).toEqual([
        { type: 'endPlot', soldier: f.screen.list.slots[0]?.merc, outcome: 'abort', selected: f.screen.list.selectedIds() },
      ]);
      expect(f.screen.hook().plotting).toBeNull();
    }));

  it('tells why time cannot compress when the plus key is refused, as the other compression keys do', () =>
    withMap(async (f) => {
      (f.session.sim as CampaignSession).campaign.state.atLeastOneMercHired = false;
      f.client.refresh();
      const sent = f.client.commands.length;
      f.key('+');
      await f.settle();
      expect(f.client.commands.length).toBe(sent);
      expect(f.t.runtime.host.modal?.id).toBe(MESSAGE_BOX);
      expect(f.widget(MESSAGE_BOX).text).toBe("Go to AIM and hire some mercs ( *Hint* it's in the Laptop )");
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

  it('boxes the refusal the trainMilitia assign names in data.refusal, as the original boxes a disloyal town', () =>
    withMap(async (f) => {
      const sim = f.session.sim as CampaignSession;
      for (const town of sim.campaign.state.economy.towns) if (town) town.rating = 0;
      await f.click(`teamRow${f.screen.list.rowOf(f.trainer)}.assignment`);
      await f.click(`assignmentMenu.line${ASSIGN_MENU_TRAIN}`);
      await f.click(`trainingMenu.line${TRAIN_MENU_TOWN}`);
      await f.settle();
      const sent = lastCommand(f);
      expect(sent?.cmd).toMatchObject({ type: 'assign', to: { kind: 'trainMilitia' } });
      expect(sent?.reply).toMatchObject({
        ok: false,
        data: { refusal: 'loyaltyTooLow', results: [{ ok: false, refusal: 'loyaltyTooLow' }] },
      });
      expect(f.t.runtime.host.modal?.id).toBe(MESSAGE_BOX);
    }));

  it('boxes pMilitiaConfirmStrings 7 with the cost the balance cannot pay and leaves the trainer on a squad (HandleInterfaceMessageForCostOfTrainingMilitia)', () =>
    withMap(async (f) => {
      (f.session.sim as CampaignSession).campaign.state.finances.balance = 700;
      f.client.refresh();
      await f.click(`teamRow${f.screen.list.rowOf(f.trainer)}.assignment`);
      await f.click(`assignmentMenu.line${ASSIGN_MENU_TRAIN}`);
      await f.click(`trainingMenu.line${TRAIN_MENU_TOWN}`);
      expect(lastCommand(f)?.reply).toMatchObject({ ok: true, data: { results: [{ ok: true, militia: 'cannotAfford' }] } });
      f.deliver();
      await f.settle();
      expect(f.t.runtime.host.modal?.id).toBe(MESSAGE_BOX);
      expect(f.widget(MESSAGE_BOX).text).toBe('You cannot afford the $750 to train town militia here.');
      expect(f.client.view.strategic?.mercs.find((m) => m.id === f.trainer)?.assignment).toBeLessThan(Assignment.ON_DUTY);
      f.key('Enter');
      await f.settle();
      expect(f.t.runtime.host.modal).toBeNull();
    }));

  it('boxes pMapErrorString 18 and prints 48 in the list when a paid sector cannot take a listed merc (NotifyPlayerOfAssignmentAttemptFailure)', () =>
    withMap(async (f) => {
      const sim = f.session.sim as CampaignSession;
      const at = f.client.view.strategic?.mercs.find((m) => m.id === f.trainer)?.sector ?? '';
      sectorInfo(sim.campaign.state.map, parseSectorString(at)).militiaTrainingPaid = true;
      f.client.refresh();
      f.key('1', 0, 'Digit1');
      await f.settle();
      expect(f.screen.hook().selected.length).toBeGreaterThan(MAX_MILITIA_TRAINERS);
      await f.click(`teamRow${f.screen.list.rowOf(f.trainer)}.assignment`);
      await f.click(`assignmentMenu.line${ASSIGN_MENU_TRAIN}`);
      await f.click(`trainingMenu.line${TRAIN_MENU_TOWN}`);
      const data = lastCommand(f)?.reply.data as { readonly results?: readonly { readonly ok: boolean }[] } | undefined;
      const results = data?.results ?? [];
      expect(results[0]).toEqual({ ok: true, militia: 'alreadyPaid' });
      expect(results.some((r) => !r.ok)).toBe(true);
      await f.settle();
      expect(f.widget(MESSAGE_BOX).text).toBe('At least one of your mercs could not be put on this assignment.');
      expect(f.screen.hook().messages.at(-1)).toBe('Note that only two mercs may train militia in each sector.');
    }));

  it('asks for the payment of a selected group without boxing pMapErrorString 48 for the mercs only a yes assigns', () =>
    withMap(async (f) => {
      f.key('1', 0, 'Digit1');
      await f.settle();
      expect(f.screen.hook().selected.length).toBeGreaterThan(1);
      await f.click(`teamRow${f.screen.list.rowOf(f.trainer)}.assignment`);
      await f.click(`assignmentMenu.line${ASSIGN_MENU_TRAIN}`);
      await f.click(`trainingMenu.line${TRAIN_MENU_TOWN}`);
      const data = lastCommand(f)?.reply.data as { readonly results?: readonly unknown[] } | undefined;
      expect(data?.results?.[0]).toEqual({ ok: true, militia: 'pending' });
      await f.settle();
      expect(f.client.view.prompt).toMatchObject({ kind: 'militiaPayment' });
      expect(f.widget(MESSAGE_BOX).text).toBe('Training a squad of town militia will cost $750. Approve expenditure?');
    }));

  it('boxes the militia refusals of a finished session and of a yes without the money: 8 loyalty, 9 a full town or SAM site, 7 the cost, 2', () =>
    withMap(async (f) => {
      const tick = f.client.view.tick;
      const rejected = { type: 'militiaTrainingRejected', tick, soldiers: [f.trainer], cost: 750 } as const;
      const events = [
        { ...rejected, reason: 'loyaltyTooLow', sector: 'C13' },
        { ...rejected, reason: 'militiaFull', sector: 'C13' },
        { ...rejected, reason: 'militiaFull', sector: 'D15' },
        { ...rejected, reason: 'cannotAfford', sector: 'C13' },
        { ...rejected, reason: 'fundsGone', sector: 'C13', cost: 1500 },
        { ...rejected, reason: 'declined', sector: 'C13' },
      ] as const;
      f.frames([{ tick, changed: [], removed: [], events }]);
      const texts: string[] = [];
      for (let i = 0; i < events.length - 1; i++) {
        await f.settle();
        texts.push(f.widget(MESSAGE_BOX).text ?? '');
        f.key('Enter');
      }
      await f.settle();
      expect(texts).toEqual([
        'Drassen needs a loyalty of 20 percent for you to be able to continue training militia.',
        'You cannot train the militia in Drassen any further.',
        'You cannot train the militia in D15: Woods any further.',
        'You cannot afford the $750 to train town militia here.',
        "You can't afford it.",
      ]);
      expect(f.t.runtime.host.modal).toBeNull();
    }));

  it('prints the reason of a menu order refused for the whole command in the message list, the menu left open', () =>
    withMap(async (f) => {
      const campaign = (f.session.sim as CampaignSession).campaign;
      await f.click(`teamRow${f.screen.list.rowOf(f.trainer)}.assignment`);
      await f.click(`assignmentMenu.line${ASSIGN_MENU_TRAIN}`);
      campaign.state.battle.prompt = { id: 'militia-1', kind: 'militiaContinue', trainer: f.trainer, sector: 0, cost: 750 } as never;
      await f.click(`trainingMenu.line${TRAIN_MENU_TOWN}`);
      expect(lastCommand(f)?.reply).toMatchObject({ ok: false, data: { refusal: 'promptOpen' } });
      expect(f.screen.hook().messages.at(-1)).toBe('answer the militiaContinue prompt first');
      expect(f.find(`trainingMenu.line${TRAIN_MENU_TOWN}`)).toBeDefined();
    }));

  it('boxes the militia promotions, veterans from green first, one in the singular, the lines joined by spaces, a rank nobody reached left out', () =>
    withMap(async (f) => {
      const tick = f.client.view.tick;
      const promotions = [
        { type: 'militiaPromoted', tick, greenToElite: 2, greenToRegular: 1, regularToElite: 3 },
        { type: 'militiaPromoted', tick: tick + 1, greenToElite: 0, greenToRegular: 4, regularToElite: 1 },
      ] as const;
      f.frames([
        { tick, changed: [], removed: [], events: [promotions[0]] },
        { tick: tick + 1, changed: [], removed: [], events: [promotions[1]] },
      ]);
      const texts: string[] = [];
      for (let i = 0; i < promotions.length; i++) {
        await f.settle();
        texts.push(f.widget(MESSAGE_BOX).text ?? '');
        f.key('Enter');
      }
      await f.settle();
      expect(texts).toEqual([
        '2 green militia have been promoted to veteran militia. 1 green militia has been promoted to a regular militia. 3 regular militia have been promoted to veteran militia.',
        '4 green militia have been promoted to regular militia. 1 regular militia has been promoted to a veteran militia.',
      ]);
      expect(f.t.runtime.host.modal).toBeNull();
    }));

  it('masks the screen while the player pauses: a click anywhere unpauses and opens nothing (CreateDestroyScreenMaskForPauseGame)', () =>
    withMap(async (f) => {
      f.key('Pause');
      expect(f.client.paused).toBe(true);
      expect(f.widget('pauseMask').enabled).toBe(true);
      const sent = f.client.commands.length;
      await f.click(`teamRow${f.screen.list.rowOf(f.trainer)}.assignment`);
      expect(f.client.paused).toBe(false);
      expect(f.find('assignmentMenu.line0')).toBeUndefined();
      expect(f.widget('pauseMask').enabled).toBe(false);
      await f.click(`teamRow${f.screen.list.rowOf(f.trainer)}.assignment`);
      expect(f.find('assignmentMenu.line0')).toBeDefined();
      expect(f.client.commands.length).toBe(sent);
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

  it('lists the version and the game options in the message list with v', () =>
    withMap(async (f) => {
      f.key('v');
      await f.settle();
      expect(f.screen.hook().messages.slice(-5)).toEqual([
        `Version: ${TEST_VERSION}`,
        'Difficulty Level: Expert',
        'Extra Difficulty: Iron Man',
        'Gun Options: Tons of Guns',
        'Game Style: Realistic',
      ]);
      expect(f.sounds).toContain('newMessageBeep');
    }));

  it('shuts the laptop, tactical and options buttons while the pause is locked or the town box is open (AllowedToExitFromMapscreenTo)', () =>
    withMap(async (f) => {
      const exits = () => EXIT_BUTTONS.map((id) => f.widget(id).enabled);
      const lockPause = (locked: boolean) => {
        (f.session.sim as CampaignSession).campaign.state.clock.pauseLocked = locked;
        f.client.refresh();
        f.t.frame();
      };
      await f.clickSector(SQUAD_SECTOR);
      expect(exits()).toEqual([true, true, true]);
      lockPause(true);
      expect(f.client.view.clock?.exitRefusal).toBe('pauseLocked');
      expect(exits()).toEqual([false, false, false]);
      lockPause(false);
      expect(exits()).toEqual([true, true, true]);
      await f.clickSector(SQUAD_SECTOR, MouseButton.RIGHT);
      expect(f.screen.hook().townBox).not.toBeNull();
      expect(exits()).toEqual([false, false, false]);
    }));

  it('quick saves with Alt+S and quick loads with Alt+L where the screen may be left, a refusal in a box', () =>
    withMap(async (f) => {
      f.key('s', KeyModifier.ALT);
      f.key('l', KeyModifier.ALT);
      await f.settle();
      expect(f.flow).toEqual(['quickSave', 'quickLoad']);
      f.replies.quickSaveFailure = 'You cannot save now.';
      f.key('s', KeyModifier.ALT);
      await f.settle();
      expect(f.widget(MESSAGE_BOX).text).toBe('You cannot save now.');
      f.key('Enter');
      await f.settle();
      await f.clickSector(SQUAD_SECTOR, MouseButton.RIGHT);
      expect(f.screen.hook().townBox).not.toBeNull();
      f.key('s', KeyModifier.ALT);
      f.key('l', KeyModifier.ALT);
      await f.settle();
      expect(f.flow).toEqual(['quickSave', 'quickLoad', 'quickSave']);
    }));

  it('quick saves while plotting, which AllowedToExitFromMapscreenTo does not check', () =>
    withMap(async (f) => {
      await f.click('teamRow0.destination');
      f.key('s', KeyModifier.ALT);
      await f.settle();
      expect(f.flow).toEqual(['quickSave']);
      expect(f.screen.hook().plotting).not.toBeNull();
    }));

  it('boxes a lost SAM site, a producing mine with the new daily income and a town, each sector named in full', () =>
    withMap(async (f) => {
      const tick = f.client.view.tick;
      const lost = [
        { type: 'sectorLost', tick, sector: 'D15', kind: 'sam' },
        { type: 'sectorLost', tick, sector: 'D13', kind: 'mine', dailyIncome: 12500 },
        { type: 'sectorLost', tick, sector: 'C13', kind: 'town' },
      ] as const;
      f.frames([{ tick, changed: [], removed: [], events: lost }]);
      const texts: string[] = [];
      for (let i = 0; i < lost.length; i++) {
        await f.settle();
        texts.push(f.widget(MESSAGE_BOX).text ?? '');
        f.key('Enter');
      }
      await f.settle();
      expect(texts).toEqual([
        'The SAM site in D15: Woods has been taken over.',
        'The mine in D13: Drassen Mine has been taken over. Your daily income has been reduced to $12,500 per day.',
        "Deidranna's forces have just taken over C13: Drassen.",
      ]);
      expect(f.t.runtime.host.modal).toBeNull();
    }));

  it('boxes an invaded SAM site by its short name and a town in full, and leaves other sectors to the message log', () =>
    withMap(async (f) => {
      const tick = f.client.view.tick;
      const invasions = [
        { type: 'invasion', tick, sector: 'D15', kind: 'sam' },
        { type: 'invasion', tick, sector: 'B5', kind: 'other' },
        { type: 'invasion', tick, sector: 'C13', kind: 'town' },
      ] as const;
      f.frames([{ tick, changed: [], removed: [], events: invasions }]);
      const texts: string[] = [];
      for (let i = 0; i < 2; i++) {
        await f.settle();
        texts.push(f.widget(MESSAGE_BOX).text ?? '');
        f.key('Enter');
      }
      await f.settle();
      expect(texts).toEqual([
        "Deidranna's forces have just invaded the SAM site in D15",
        "Deidranna's forces have just invaded C13: Drassen",
      ]);
      expect(f.t.runtime.host.modal).toBeNull();
    }));

  it('boxes a bloodcat ambush by the sector in full, the lair entrance by its fixed line and an attack on mercs who cannot fight', () =>
    withMap(async (f) => {
      const tick = f.client.view.tick;
      const panel = { type: 'preBattle', tick, persistent: true, autoStart: false, prompt: null } as const;
      const notices = [
        { ...panel, sector: 'C13', encounter: 'bloodcatAmbush', notice: 'bloodcatAmbush' },
        { ...panel, sector: 'I16', encounter: 'enteringBloodcatLair', notice: 'bloodcatLair' },
        { ...panel, sector: 'D13', encounter: 'enemyInvasion' },
        { ...panel, sector: 'D13', encounter: 'enemyInvasion', autoStart: true, notice: 'unconsciousMercsAttacked' },
      ] as const;
      f.frames([{ tick, changed: [], removed: [], events: notices }]);
      const texts: string[] = [];
      for (let i = 0; i < 3; i++) {
        await f.settle();
        texts.push(f.widget(MESSAGE_BOX).text ?? '');
        f.key('Enter');
      }
      await f.settle();
      expect(texts).toEqual([
        'You have been ambushed by bloodcats in sector C13: Drassen!',
        'You have just entered what appears to be a bloodcat lair in sector I16!',
        'Enemies attack your mercs in sector D13: Drassen Mine.  None of your mercs are able to fight!',
      ]);
      expect(f.t.runtime.host.modal).toBeNull();
    }));

  it('boxes a landing zone moved off enemy airspace and a rerouted arrival with the original’s strings (HandleAirspaceControlUpdated, CheckForValidArrivalSector)', () =>
    withMap(async (f) => {
      const tick = f.client.view.tick;
      f.frames([
        {
          tick,
          changed: [],
          removed: [],
          events: [
            { type: 'landingZoneReset', tick, from: 'B13', to: 'A9' },
            { type: 'arrivalRerouted', tick, from: 'B13', to: 'A13' },
          ],
        },
      ]);
      const texts: string[] = [];
      for (let i = 0; i < 2; i++) {
        await f.settle();
        texts.push(f.widget(MESSAGE_BOX).text ?? '');
        f.key('Enter');
      }
      await f.settle();
      expect(texts).toEqual([
        'Airspace over B13: Drassen is no longer secure!  Arrival sector was moved to A9: Omerta.',
        'Arrival of new recruits is being rerouted to sector A13, as scheduled drop-off point of sector B13 is enemy occupied.',
      ]);
      expect(f.t.runtime.host.modal).toBeNull();
    }));

  it('leaves the box of a sector lost in the tactical flow to the tactical screen', () =>
    withMap(async (f) => {
      (f.session.sim as CampaignSession).campaign.state.flow = 'tactical';
      f.client.refresh();
      const tick = f.client.view.tick;
      f.frames([{ tick, changed: [], removed: [], events: [{ type: 'sectorLost', tick, sector: 'C13', kind: 'town' }] }]);
      await f.settle();
      expect(f.t.runtime.host.modal).toBeNull();
    }));

  it('boxes a vehicle of ours that burns its last fuel, naming its type by pVehicleStrings and the sector (ReportVehicleOutOfGas)', () =>
    withMap(async (f) => {
      const hummer = addVehicleOfOurs((f.session.sim as CampaignSession).campaign, parseSectorString('B13'));
      f.client.refresh();
      const tick = f.client.view.tick;
      f.frames([{ tick, changed: [], removed: [], events: [{ type: 'vehicleOutOfGas', tick, vehicle: hummer.vehicleId, sector: 'B13' }] }]);
      await f.settle();
      expect(f.widget(MESSAGE_BOX).text).toBe('The Hummer has run out of gas and is now stranded in B13.');
      f.key('Enter');
      await f.settle();
      expect(f.t.runtime.host.modal).toBeNull();
    }));

  it("sounds a merc getting into a ground vehicle, or out of one on the loaded map, at the vehicle's tile only while the map screen is up", () =>
    withMap(async (f) => {
      const hummer = addVehicleOfOurs((f.session.sim as CampaignSession).campaign, parseSectorString('B13'));
      f.client.refresh();
      const tick = f.client.view.tick;
      const merc = f.mercs[0] ?? -1;
      const vehicle = hummer.vehicleId;
      const leftOnTheMap = { type: 'vehicleLeft', tick, soldier: merc, vehicle, gridNo: 12345 } as const;
      f.frames([
        {
          tick,
          changed: [],
          removed: [],
          events: [
            { type: 'vehicleBoarded', tick, soldier: merc, vehicle },
            { type: 'vehicleLeft', tick, soldier: merc, vehicle },
            leftOnTheMap,
          ],
        },
      ]);
      const entered = () => f.sounds.filter((s) => s.startsWith('vehicleEntered'));
      expect(entered()).toEqual(['vehicleEntered nowhere', 'vehicleEntered 12345']);
      (f.session.sim as CampaignSession).campaign.state.flow = 'tactical';
      f.client.refresh();
      f.frames([{ tick, changed: [], removed: [], events: [{ type: 'vehicleBoarded', tick, soldier: merc, vehicle }, leftOnTheMap] }]);
      expect(entered()).toHaveLength(2);
    }));

  it('makes a merc who bleeds the info character, the selection reset even when he is one already, and flashes his face (SoldierBleed, SetInfoChar)', () =>
    withMap(async (f) => {
      const [first, second] = f.mercs;
      if (first === undefined || second === undefined) throw new Error('two mercs needed');
      const list = f.screen.list;
      const tick = f.client.view.tick;
      const bled = (soldier: number) => f.frames([{ tick, changed: [], removed: [], events: [{ type: 'mercBled', tick, soldier }] }]);
      list.changeInfo(list.rowOf(first), true);
      list.setSelected(list.rowOf(second));
      f.t.frame();
      expect(whiteFaces(f)).toBe(0);
      bled(second);
      expect(f.screen.hook()).toMatchObject({ info: second, selected: [second] });
      expect(whiteFaces(f)).toBeGreaterThan(0);
      list.setSelected(list.rowOf(first));
      bled(second);
      expect(f.screen.hook()).toMatchObject({ info: second, selected: [second] });
    }));

  it('flashes the info face at the damage feedback of gas or bleeding without changing the info character', () =>
    withMap(async (f) => {
      const info = f.screen.hook().info ?? -1;
      const other = f.mercs.find((m) => m !== info) ?? -1;
      const tick = f.client.view.tick;
      f.frames([{ tick, changed: [], removed: [], events: [{ type: 'damageFeedback', tick, soldier: other, cause: 'bleeding' }] }]);
      expect([f.screen.hook().info, whiteFaces(f)]).toEqual([info, 0]);
      f.frames([{ tick, changed: [], removed: [], events: [{ type: 'damageFeedback', tick, soldier: info, cause: 'bleeding' }] }]);
      expect([f.screen.hook().info, whiteFaces(f) > 0]).toEqual([info, true]);
    }));

  it('drops the face flash of a damage feedback once a load replaces the state, as the loaded game never flashed it', () =>
    withMap(async (f) => {
      const info = f.screen.hook().info ?? -1;
      const tick = f.client.view.tick;
      f.frames([{ tick, changed: [], removed: [], events: [{ type: 'damageFeedback', tick, soldier: info, cause: 'bleeding' }] }]);
      expect(whiteFaces(f)).toBeGreaterThan(0);
      f.screen.stateReplaced();
      f.t.frame();
      expect(whiteFaces(f)).toBe(0);
    }));

  it("prints the maximum life red or green for 60 s after the change time the merc's view carries, on the clock its tick runs (DrawCharHealth)", () =>
    withMap(async (f) => {
      const campaign = (f.session.sim as CampaignSession).campaign;
      const info = f.screen.hook().info ?? -1;
      const soldier = campaign.battle?.roster.get(info)?.soldier;
      if (!soldier) throw new Error('no info merc');
      const nowMs = f.client.view.tick * TICK_MS;
      const recoloured = (lifeMax: { at: number; up: boolean } | null) => {
        f.t.frame();
        const before = glyphColours(f);
        soldier.statChanges = lifeMax ? { lifeMax } : {};
        f.client.refresh();
        f.t.frame();
        const after = glyphColours(f);
        return after.flatMap((colour, i) => (colour !== before[i] ? [colour] : []));
      };
      expect(recoloured({ at: nowMs, up: false })).toEqual([FontColor.RED]);
      expect(recoloured({ at: nowMs - CHANGE_STAT_RECENTLY_DURATION_MS, up: false })).toEqual([CHAR_TEXT_FONT_COLOR]);
      expect(recoloured({ at: nowMs, up: true })).toEqual([FontColor.LTGREEN]);
    }));

  it('prints the maximum life a merc off the loaded map gains on an assignment green, as ChangeStat marks the change there too', () =>
    withMap(async (f) => {
      const campaign = (f.session.sim as CampaignSession).campaign;
      expect(campaign.tactical).toBeNull();
      const info = f.screen.hook().info ?? -1;
      const merc = campaign.battle?.roster.get(info);
      const progress = merc ? campaign.state.profiles.get(merc.soldier.profile) : undefined;
      const crew = campaign.economy?.crew;
      if (!merc || !progress || !crew) throw new Error('no info merc');
      Object.assign(progress.stats, { lifeMax: TRAINABLE_HEALTH });
      Object.assign(progress.gains, { lifeMax: HEALTH_SUBPOINTS - 1 });
      merc.soldier.lifeMax = TRAINABLE_HEALTH;
      f.client.refresh();
      f.t.frame();
      const greens = () => glyphColours(f).filter((colour) => colour === FontColor.LTGREEN).length;
      const before = greens();
      crew.statChange(info, StatAmt.HEALTH, TRAINING_POINTS, StatCause.TRAINING);
      expect((await f.client.command({ type: 'inventory', sector: SQUAD_SECTOR })).ok).toBe(true);
      f.deliver();
      expect(greens() - before).toBe(1);
    }));

  it('cries a death on the map screen through its own sounds, and leaves one on the tactical screen to the tactical director', () =>
    withMap(async (f) => {
      const tick = f.client.view.tick;
      const merc = f.mercs[0] ?? -1;
      const cry = { voice: '005', bodyType: 0, team: 0 };
      f.frames([
        {
          tick,
          changed: [],
          removed: [],
          events: [
            { type: 'mercDied', tick, soldier: merc, sector: 'B13', mapScreen: true, cry },
            { type: 'mercDied', tick, soldier: merc, sector: 'B13', mapScreen: true },
            { type: 'mercDied', tick, soldier: merc, sector: 'B13', cry },
          ],
        },
      ]);
      expect(f.sounds.filter((s) => s.startsWith('mercDiedOffTheMap'))).toEqual([
        `mercDiedOffTheMap ${merc} 005`,
        `mercDiedOffTheMap ${merc} mute`,
      ]);
    }));

  it('grunts at a damage on the map screen through its own sounds, and leaves one on the tactical screen to the tactical director', () =>
    withMap(async (f) => {
      const tick = f.client.view.tick;
      const merc = f.mercs[0] ?? -1;
      f.frames([
        {
          tick,
          changed: [],
          removed: [],
          events: [
            { type: 'damageFeedback', tick, soldier: merc, cause: 'bleeding', mapScreen: true },
            { type: 'damageFeedback', tick, soldier: merc, cause: 'gas' },
          ],
        },
      ]);
      expect(f.sounds.filter((s) => s.startsWith('damageFeedback'))).toEqual([`damageFeedback ${merc} bleeding`]);
    }));

  it('curses a check failed on the map screen through its own sounds once, and leaves one on the tactical screen to the tactical director', () =>
    withMap(async (f) => {
      const tick = f.client.view.tick;
      const merc = f.mercs[0] ?? -1;
      f.frames([
        {
          tick,
          changed: [],
          removed: [],
          events: [
            { type: 'skillCheckFailed', tick, soldier: merc, mapScreen: true },
            { type: 'skillCheckFailed', tick, soldier: merc, certain: true },
          ],
        },
      ]);
      expect(f.sounds.filter((s) => s.startsWith('skillCheckFailed'))).toEqual([`skillCheckFailed ${merc}`]);
    }));

  it('plays the reload of a merc off the loaded map through its own sounds, and leaves one in the sector to the tactical director', () =>
    withMap(async (f) => {
      const tick = f.client.view.tick;
      const merc = f.mercs[0] ?? -1;
      const gun = 1;
      f.frames([
        {
          tick,
          changed: [],
          removed: [],
          events: [
            { type: 'reloaded', tick, soldier: merc, item: gun, mapScreen: true },
            { type: 'reloaded', tick, soldier: merc, item: gun },
          ],
        },
      ]);
      expect(f.sounds.filter((s) => s.startsWith('reloaded'))).toEqual([`reloaded ${gun}`]);
    }));

  it('plays an attachment made on the map through its own sounds, and leaves one made in tactical to the tactical director', () =>
    withMap(async (f) => {
      const tick = f.client.view.tick;
      const merc = f.mercs[0] ?? -1;
      const attached = { type: 'itemAttached', tick, soldier: merc, item: 'SILENCER', to: 'GLOCK_17', result: 'attached' } as const;
      f.frames([
        {
          tick,
          changed: [],
          removed: [],
          events: [{ ...attached, sound: 'ATTACH_TO_GUN', mapScreen: true }, attached],
        },
      ]);
      expect(f.sounds.filter((s) => s.startsWith('itemAttached'))).toEqual([`itemAttached ${merc} ATTACH_TO_GUN mute`]);
    }));

  it('opens the contract menu behind the price line and asks before a dismissal from it, outside the renewal sequence (ContractMenuBtnCallbackPrimary)', () =>
    withMap(async (f) => {
      const merc = f.mercs[0] ?? -1;
      const contract = (f.session.sim as CampaignSession).campaign.contracts?.roster.get(merc)?.contract;
      if (!contract) throw new Error('no contract');
      contract.contractPriceIncreased = true;
      expect((await f.client.command({ type: 'openContractMenu', soldier: merc })).data).toEqual({ afterLine: true });
      f.session.advance({ idle: true });
      f.client.refresh();
      f.frames([]);
      await f.settle();
      expect(f.client.view.contractPrompt).toMatchObject({ kind: 'contractRenewal', soldier: merc, fromSequence: false });
      expect(f.screen.hook().menu).toBe('contract');
      const sent = f.client.commands.length;
      await f.click('contractMenu.line5');
      await f.settle();
      expect(f.t.runtime.host.modal?.id).toBe(MESSAGE_BOX);
      expect(f.client.commands.length).toBe(sent);
    }));

  it("boxes an escort's lone move with pMapErrorString 6 or 7 by the sex of his profile, naming the escort", () =>
    withMap(async (f) => {
      const campaign = (f.session.sim as CampaignSession).campaign;
      const record = campaign.battle?.roster.get(f.mercs[1] ?? -1);
      if (!record) throw new Error('no escort');
      expect((await f.client.command({ type: 'assignSquad', soldier: record.id, squad: 'new' })).ok).toBe(true);
      Object.assign(record.record, { kind: MercKind.EPC });
      const texts: string[] = [];
      for (const sex of [MALE, FEMALE]) {
        Object.assign(campaign.state.profiles.get(record.soldier.profile) ?? {}, { sex });
        f.client.refresh();
        await f.click(`teamRow${f.screen.list.rowOf(record.id)}.destination`);
        await f.settle();
        texts.push(f.widget(MESSAGE_BOX).text ?? '');
        f.key('Enter');
        await f.settle();
      }
      const name = record.soldier.name;
      expect(texts).toEqual([
        `${name} needs an escort to move. Place him on a squad with one.`,
        `${name} needs an escort to move. Place her on a squad with one.`,
      ]);
      expect(f.client.commands.at(-1)?.cmd.type).toBe('assignSquad');
    }));

  it('draws the adrenaline and drink icons on the info face, as every face with a soldier has them', () =>
    withMap(async (f) => {
      const info = f.screen.hook().info;
      const drinker = (f.session.sim as CampaignSession).campaign.battle?.roster.get(info ?? -1)?.soldier;
      if (!drinker) throw new Error('no info merc');
      const icons = () => {
        f.client.refresh();
        f.t.frame();
        return f.draw().items.flatMap((i) => (i.kind === 'image' && i.asset === PORTRAIT_ICONS ? [i.frame] : []));
      };
      expect(icons()).toEqual([]);
      drinker.drugs.adrenaline.effect = 16;
      drinker.drugs.alcohol.effect = 40;
      expect(icons()).toEqual([ADRENALINE_ICON, DRUNK_ICON]);
      drinker.drugs.adrenaline.effect = 0;
      drinker.drugs.adrenaline.sideEffect = 20;
      expect(icons()).toEqual([DRUNK_ICON]);
    }));

  it("keeps the level it shows while a head miner speaks: Stracciatella's switch to the surface selects the sector it shows", () =>
    withMap(async (f) => {
      f.key('Delete');
      await f.settle();
      expect(f.screen.hook().level).toBe(1);
      const tick = f.client.view.tick;
      const said = {
        type: 'headMinerQuote',
        tick,
        mine: DRASSEN_MINE,
        profile: FRED,
        quote: FRED_RUNNING_OUT,
        textKey: FRED_KEY,
        chars: 12,
      } as const;
      f.frames([{ tick, changed: [], removed: [], events: [said] }]);
      await f.settle();
      expect(f.screen.hook()).toMatchObject({ level: 1, selectedSector: expect.stringMatching(/-1$/) });
    }));

  it('compresses time with the keypad plus and minus and selects the squad with a keypad digit', () =>
    withMap(async (f) => {
      pressKeypad(f, '+', 'NumpadAdd');
      await f.settle();
      expect(lastCommand(f)?.cmd).toEqual({ type: 'compressTime', mode: 2 });
      pressKeypad(f, '-', 'NumpadSubtract');
      await f.settle();
      expect(lastCommand(f)?.cmd).toEqual({ type: 'stopTime' });
      pressKeypad(f, '1', 'Numpad1');
      await f.settle();
      expect(f.screen.hook().selected).toHaveLength(4);
    }));

  it('keeps the player paused through keypad 5 without NumLock, which the input layer drops, and unpauses at the typed 5', () =>
    withMap(async (f) => {
      f.key('Pause');
      expect(f.client.paused).toBe(true);
      pressKeypad(f, 'Clear', 'Numpad5', false);
      pressKeypad(f, 'Unidentified', 'Numpad5', false);
      expect(f.client.paused).toBe(true);
      pressKeypad(f, '5', 'Numpad5');
      expect(f.client.paused).toBe(false);
    }));

  it('keeps the player paused through Shift, Ctrl, Alt, Print Screen and Scroll Lock pressed alone, which queue no key event', () =>
    withMap(async (f) => {
      f.key('Pause');
      pressAlone(f, 'Shift', 'ShiftLeft', { shift: true });
      pressAlone(f, 'Control', 'ControlLeft', { ctrl: true });
      pressAlone(f, 'Alt', 'AltLeft', { alt: true });
      pressAlone(f, 'AltGraph', 'AltRight', { ctrl: true, alt: true });
      pressAlone(f, 'PrintScreen', 'PrintScreen', {});
      pressAlone(f, 'ScrollLock', 'ScrollLock', {});
      expect(f.client.paused).toBe(true);
      pressKeypad(f, '5', 'Numpad5');
      expect(f.client.paused).toBe(false);
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

  it('ignores clicks on the map until the first arrival, with mercs hired too, as DidGameJustStart does', () =>
    withMap(async (f) => {
      const start = f.screen.hook().selectedSector;
      expect(start).not.toBe('C13');
      setGameJustStarted(f, true);
      await f.clickSector('C13');
      await f.clickSector('C13', MouseButton.RIGHT);
      expect(f.screen.hook()).toMatchObject({ selectedSector: start, townBox: null });
      setGameJustStarted(f, false);
      await f.clickSector('C13');
      expect(f.screen.hook().selectedSector).toBe('C13');
    }));

  it('ignores clicks on the map while a battle is about to begin, plotting included, as fDisableMapInterfaceDueToBattle does', () =>
    withMap(async (f) => {
      const start = f.screen.hook().selectedSector;
      setMapInterfaceDisabled(f, true);
      await f.clickSector('C13');
      await f.clickSector('C13', MouseButton.RIGHT);
      expect(f.screen.hook()).toMatchObject({ selectedSector: start, townBox: null });
      await f.click('teamRow0.destination');
      await f.hoverSector('C13', PLOT_REST_MS);
      await f.clickSector('C13');
      expect(f.screen.hook().plotting).toMatchObject({ mode: 'merc', legs: [] });
      setMapInterfaceDisabled(f, false);
      await f.clickSector('C13');
      expect(f.screen.hook().plotting?.legs).toEqual(['C13']);
    }));

  it('draws the other selected rows light blue while the destination column of a selected row is under the pointer', () =>
    withMap(async (f) => {
      f.key('1', 0, 'Digit1');
      await f.settle();
      expect(f.screen.hook().selected.length).toBeGreaterThan(1);
      hoverWidget(f, 'teamRow0.name');
      expect(textColourIn(f, 'teamRow1.name')).not.toBe(FontColor.LTBLUE);
      hoverWidget(f, 'teamRow0.destination');
      expect(textColourIn(f, 'teamRow0.name')).toBe(FontColor.WHITE);
      expect(textColourIn(f, 'teamRow1.name')).toBe(FontColor.LTBLUE);
    }));

  it('moves the landing zone from the bullseye with nobody in transit, as the original does after the first arrival', () =>
    withMap(async (f) => {
      const zone = f.client.view.strategic?.landingZone ?? '';
      expect(f.client.view.strategic?.mercs.some((m) => m.assignment === Assignment.IN_TRANSIT)).toBe(false);
      await f.click('filter4');
      await f.clickSector(zone);
      expect(f.screen.hook().changingArrival).toBe(true);
      await f.clickSector('C13');
      expect(lastCommand(f)?.cmd).toEqual({ type: 'setLandingZone', sector: 'C13' });
    }));

  it('asks whether Skyrider or the landing zone moves when the helicopter icon is over the bullseye, and Arrivals moves the zone', () =>
    withMap(async (f) => {
      await clickBullseyeUnderHelicopter(f);
      expect(f.t.runtime.host.modal?.id).toBe(MESSAGE_BOX);
      expect(f.widget(MESSAGE_BOX).text).toBe('Select Skyrider or the Arrivals Drop-off?');
      expect([f.widget(`${MESSAGE_BOX}.yes`).text, f.widget(`${MESSAGE_BOX}.no`).text]).toEqual(['Skyrider', 'Arrivals']);
      expect(f.screen.hook().changingArrival).toBe(false);
      await f.click(`${MESSAGE_BOX}.no`);
      expect(f.t.runtime.host.modal).toBeNull();
      expect(f.client.commands.some((c) => c.cmd.type === 'heliPlot')).toBe(false);
      expect(f.screen.hook()).toMatchObject({
        changingArrival: true,
        plotting: null,
        uiMessage: 'Click on the sector where you would like the mercs to arrive instead.',
      });
    }));

  it('plots the helicopter when Skyrider is chosen in the box over the bullseye', () =>
    withMap(async (f) => {
      expect((await f.client.command({ type: 'boardVehicle', soldier: f.mercs[1] ?? -1, vehicle: 'helicopter' })).ok).toBe(true);
      await clickBullseyeUnderHelicopter(f);
      await f.click(`${MESSAGE_BOX}.yes`);
      expect(f.t.runtime.host.modal).toBeNull();
      expect(f.client.commands.find((c) => c.cmd.type === 'heliPlot')?.reply).toEqual({ ok: true });
      expect(f.screen.hook()).toMatchObject({ changingArrival: false, plotting: { mode: 'heli' } });
    }));

  it('moves the message list to the spot pressed in its scroll area, and on under the pointer while the button is held', () =>
    withMap(async (f) => {
      fillMessageList(f, MESSAGE_LINES);
      expect(f.screen.hook().firstMessage).toBe(LAST_TOP_LINE);
      const area = f.widget('messageScrollArea');
      expect(area.enabled).toBe(true);
      const x = area.rect.x + SCROLL_AREA_X;
      f.t.down(x, area.rect.y + 4);
      f.t.frame();
      expect(f.screen.hook().firstMessage).toBe(0);
      f.t.move(x, area.rect.y + 30);
      f.t.frame();
      expect(f.screen.hook().firstMessage).toBe(0);
      f.t.frame(BUTTON_REPEAT_TIMEOUT_MS);
      expect(f.screen.hook().firstMessage).toBe(11);
      f.t.up(x, area.rect.y + 30);
      f.t.frame();
      f.t.click(x, area.rect.y + 20);
      f.t.frame();
      expect(f.screen.hook().firstMessage).toBe(7);
      f.t.click(x, area.rect.y + 54);
      f.t.frame();
      expect(f.screen.hook().firstMessage).toBe(LAST_TOP_LINE);
      f.t.click(x, area.rect.y + 5);
      f.t.frame();
      expect(f.screen.hook().firstMessage).toBe(0);
    }));

  it('scrolls the message list by three lines with the wheel over the list or its scroll area', () =>
    withMap(async (f) => {
      fillMessageList(f, MESSAGE_LINES);
      wheelOver(f, 'messageList', -1);
      expect(f.screen.hook().firstMessage).toBe(LAST_TOP_LINE - 3);
      wheelOver(f, 'messageScrollArea', -1);
      expect(f.screen.hook().firstMessage).toBe(LAST_TOP_LINE - 6);
      wheelOver(f, 'messageScrollArea', 1);
      expect(f.screen.hook().firstMessage).toBe(LAST_TOP_LINE - 3);
    }));

  it('turns the message scroll area off while the list fits on the panel, as EnableDisableMessageScrollButtonsAndRegions does', () =>
    withMap(async (f) => {
      fillMessageList(f, MAX_MESSAGES_ON_MAP_BOTTOM);
      expect(f.widget('messageScrollArea').enabled).toBe(false);
      fillMessageList(f, MAX_MESSAGES_ON_MAP_BOTTOM + 1);
      expect(f.widget('messageScrollArea').enabled).toBe(true);
    }));

  it('selects the level of the merc whose destination plot starts, as JumpToLevel moves the selected sector with the level', () =>
    withMap(async (f) => {
      f.key('Delete');
      await f.settle();
      expect(f.screen.hook()).toMatchObject({ level: 1, selectedSector: expect.stringMatching(/-1$/) });
      await f.click('teamRow0.destination');
      expect(f.screen.hook()).toMatchObject({ level: 0, plotting: { mode: 'merc' } });
      expect(f.screen.hook().selectedSector).not.toMatch(/-/);
    }));

  it('keeps the info character on a team row click while a sector inventory item is held, unless that merc stands in the sector', () =>
    withMap(async (f) => {
      const [holder, away, near] = listedMercs(f);
      moveMercAway(f, away);
      await f.click('teamRow0.name');
      stashClipInSelectedSector(f);
      f.screen.openSectorInventory();
      await f.settle();
      await f.click('poolSlot0');
      await f.click('teamRow1.name');
      expect(f.screen.hook().info).toBe(holder);
      await f.click('teamRow2.name');
      expect(f.screen.hook().info).toBe(near);
      await f.click('poolSlot0');
      expect(f.screen.mapInventory.holding).toBe(false);
      await f.click('teamRow1.name');
      expect(f.screen.hook().info).toBe(away);
    }));

  it("stacks and sorts the open sector inventory with SHIFT+S and refills the mercs' magazines from the pool item under the pointer with SHIFT+R, as extra_hotkeys has them on (HandleModShift)", () =>
    withMap(async (f) => {
      const campaign = (f.session.sim as CampaignSession).campaign;
      const items = campaign.battle?.content.items;
      if (!items) throw new Error('no item table');
      const clipItem = items.byName.get('CLIP9_15')?.index ?? 0;
      const clip = (shots: number) => Object.assign(createItem(items, clipItem, 100), { status: [shots] });
      const flags = WorldItemFlags.REACHABLE;
      const record = (shots: number) => ({
        exists: true,
        gridNo: STASH_GRIDNO,
        level: 0,
        object: clip(shots),
        flags,
        zHeight: 0,
        visible: 1,
      });
      await f.click('teamRow0.name');
      campaign.state.sectorDiffs.set(sectorKey(f.screen.selectedSector), { ...emptySectorDiff(), items: [record(5), record(6)] });
      for (const m of campaign.battle?.roster.all() ?? []) {
        const inv = m.soldier.inv;
        inv.forEach((o, slot) => {
          if (o.item === clipItem) inv[slot] = emptyObject();
        });
      }
      const [holder] = listedMercs(f);
      const pocket = () => campaign.battle?.roster.get(holder)?.soldier.inv[InvSlot.SMALLPOCK1];
      Object.assign(pocket() ?? {}, clip(3));
      f.client.refresh();
      const stash = () => {
        const answer = campaign.dispatch({ type: 'inventory', sector: SQUAD_SECTOR });
        return answer.ok ? (answer.data as { stash: { index: number; status: number[] }[] }).stash.map((e) => [e.index, e.status]) : [];
      };
      f.key('s', KeyModifier.SHIFT);
      await f.settle();
      expect(f.client.commands).toEqual([]);
      f.screen.openSectorInventory();
      await f.settle();
      f.key('s', KeyModifier.SHIFT);
      await f.settle();
      expect(lastCommand(f)).toEqual({
        cmd: { type: 'stackAndSortStash', sector: SQUAD_SECTOR, order: [1, 0] },
        reply: { ok: true, data: { sector: SQUAD_SECTOR, entries: 1 } },
      });
      expect(stash()).toEqual([[0, [11]]]);
      hoverWidget(f, 'poolSlot0');
      f.key('r', KeyModifier.SHIFT);
      await f.settle();
      expect(lastCommand(f)?.cmd).toEqual({ type: 'refillFromStash', sector: SQUAD_SECTOR, item: 0, order: [0] });
      expect(pocket()?.status).toEqual([14]);
      expect(stash()).toEqual([]);
    }));

  it('steps the info character with the arrows past a merc who could not take the held item, as ValidSelectableCharForNextOrPrev', () =>
    withMap(async (f) => {
      const [holder, away, near] = listedMercs(f);
      moveMercAway(f, away);
      await f.click('teamRow0.name', MouseButton.RIGHT);
      const pocket = f.client.view.strategic?.mercs.find((m) => m.id === holder)?.inventory?.[0];
      if (!pocket) throw new Error('the info merc carries nothing');
      await f.click(`mercSlot${pocket.slot}`);
      f.key('ArrowRight');
      await f.settle();
      expect(f.screen.hook().info).toBe(near);
      f.key('ArrowLeft');
      await f.settle();
      expect(f.screen.hook().info).toBe(holder);
      await f.click(`mercSlot${pocket.slot}`);
      expect(f.screen.mapInventory.holding).toBe(false);
      f.key('ArrowRight');
      await f.settle();
      expect(f.screen.hook().info).toBe(away);
    }));
});

function edgeOfWorldSector(): string {
  const strategic = ui.client.rules.strategic;
  if (!strategic) throw new Error('no strategic rules');
  const facts = mapFacts(strategic.content, strategic.economy);
  for (let y = 1; y <= MAP_SIDE; y++)
    for (let x = 1; x <= MAP_SIDE; x++) if (facts.traversability(sectorId({ x, y })) === EDGE_OF_WORLD) return sectorLabel({ x, y, z: 0 });
  throw new Error('no edge of the world on the map');
}

function mercRecord(f: MapUiTest, id: number) {
  const record = (f.session.sim as CampaignSession).campaign.battle?.roster.get(id);
  if (!record) throw new Error(`no roster merc ${id}`);
  return record;
}

function rowOf(f: MapUiTest, id: number | undefined): number {
  return f.screen.list.rowOf(id ?? -1);
}

async function boardHelicopter(f: MapUiTest, id: number | undefined): Promise<void> {
  expect((await f.client.command({ type: 'boardVehicle', soldier: id ?? -1, vehicle: 'helicopter' })).ok).toBe(true);
  await f.settle();
}

async function plotMercRoute(f: MapUiTest, row: number, to: string): Promise<void> {
  await f.click(`teamRow${row}.destination`);
  await f.hoverSector(to, PLOT_REST_MS);
  await f.clickSector(to);
  await f.clickSector(to);
}

describe('the map screen team list, plotting and contract rules of the original', () => {
  it('plots for Skyrider from the destination column of a passenger, with the airspace on and the selection woken (TeamListDestinationRegionBtnCallBackPrimary)', () =>
    withMap(async (f) => {
      const passenger = f.mercs[1];
      await boardHelicopter(f, passenger);
      const row = rowOf(f, passenger);
      await f.click(`teamRow${row}.destination`);
      expect(f.client.commands.find((c) => c.cmd.type === 'heliPlot')?.reply).toEqual({ ok: true });
      expect(f.screen.hook()).toMatchObject({
        filters: { airspace: true },
        plotting: { mode: 'heli' },
        glow: { line: row, column: TeamColumn.DESTINATION },
      });
      await f.hoverSector('C13', PLOT_REST_MS);
      await f.clickSector('C13');
      await f.clickSector('C13');
      expect(lastCommand(f)?.cmd).toMatchObject({
        type: 'endPlot',
        helicopter: true,
        outcome: 'confirm',
        selected: f.screen.list.selectedIds(),
      });
      expect(lastCommand(f)?.reply.ok).toBe(true);
    }));

  it('turns the airspace off when the destination column of a merc on foot is clicked', () =>
    withMap(async (f) => {
      await f.click('filter4');
      expect(f.screen.hook().filters.airspace).toBe(true);
      await f.click('teamRow0.destination');
      expect(f.screen.hook()).toMatchObject({ filters: { airspace: false }, plotting: { mode: 'merc' } });
    }));

  it('confirms an unchanged path of a merc for the mercs selected then, with his quote and the confirmed message (CheckIfClickOnLastSectorInPath, RebuildWayPointsForAllSelectedCharsGroups)', () =>
    withMap(async (f) => {
      await plotMercRoute(f, 0, 'C13');
      f.key('Escape');
      f.sounds.length = 0;
      await f.click('teamRow0.destination');
      await f.clickSector('C13');
      expect(lastCommand(f)?.cmd).toEqual({
        type: 'endPlot',
        soldier: f.screen.list.slots[0]?.merc,
        outcome: 'confirm',
        selected: f.screen.list.selectedIds(),
      });
      expect(f.screen.list.selectedIds()).toHaveLength(4);
      expect(f.screen.hook().uiMessage).toBe(ROUTE_CONFIRMED);
      expect(f.sounds.some((s) => s.startsWith('confirmRoute'))).toBe(true);
    }));

  it("confirms the helicopter's unchanged path through Skyrider, without the merc's message", () =>
    withMap(async (f) => {
      await boardHelicopter(f, f.mercs[1]);
      await f.click(`teamRow${rowOf(f, f.mercs[1])}.destination`);
      await f.hoverSector('C13', PLOT_REST_MS);
      await f.clickSector('C13');
      await f.clickSector('C13');
      const flown = f.client.commands.length;
      await f.click(`teamRow${rowOf(f, f.mercs[1])}.destination`);
      await f.clickSector('C13');
      expect(f.client.commands.length).toBeGreaterThan(flown);
      expect(lastCommand(f)?.cmd).toEqual({ type: 'endPlot', helicopter: true, outcome: 'confirm', selected: f.screen.list.selectedIds() });
      expect(lastCommand(f)?.reply).toMatchObject({ ok: true, data: { path: ['D13', 'C13'] } });
      expect(f.screen.hook()).toMatchObject({ plotting: null, uiMessage: null });
    }));

  it('confirms the helicopter without a path on its own sector, which takes it off, and says the route is unchanged (CheckIfClickOnLastSectorInPath, MapScreen.cc:5509-5520, :5596-5599)', () =>
    withMap(async (f) => {
      await boardHelicopter(f, f.mercs[1]);
      await f.click('filter4');
      await f.clickSector('D13');
      expect(f.screen.hook().plotting).toMatchObject({ mode: 'heli', legs: [] });
      await f.clickSector('D13');
      expect(lastCommand(f)).toMatchObject({
        cmd: { type: 'endPlot', helicopter: true, outcome: 'confirm', selected: f.screen.list.selectedIds() },
        reply: { ok: true, data: { path: [] } },
      });
      expect(f.screen.hook()).toMatchObject({ plotting: null, uiMessage: ROUTE_UNCHANGED });
      expect(f.client.view.strategic?.helicopter).toMatchObject({ airborne: true, hovering: false });
    }));

  it('keeps plotting for its merc through a squad selection, each click and the confirm acting on the mercs selected then (SelectAllCharactersInSquad, MapScreen.cc:7830, :2315, :5569)', () =>
    withMap(async (f) => {
      const [plotter, other] = listedMercs(f);
      expect((await f.client.command({ type: 'assignSquad', soldier: other, squad: 'new' })).ok).toBe(true);
      await f.settle();
      const otherSquad = f.client.view.strategic?.mercs.find((m) => m.id === other)?.squad ?? -1;
      await f.click(`teamRow${rowOf(f, plotter)}.destination`);
      f.key(String(otherSquad + 1), 0, `Digit${otherSquad + 1}`);
      await f.settle();
      expect(f.screen.hook().plotting).toMatchObject({ soldier: plotter, mode: 'merc' });
      expect(f.screen.list.selectedIds()).toEqual([other]);
      await f.hoverSector('C13', PLOT_REST_MS);
      await f.clickSector('C13');
      await f.clickSector('C13');
      expect(lastCommand(f)).toMatchObject({
        cmd: { type: 'endPlot', soldier: plotter, steps: [{ to: 'C13', selected: [other] }], outcome: 'confirm', selected: [other] },
        reply: { ok: true },
      });
      const groupOf = (id: number | undefined) => f.client.view.strategic?.groups.find((g) => g.members.includes(id ?? -1));
      expect(groupOf(other)).toMatchObject({ betweenSectors: true, next: 'C13' });
      expect(groupOf(plotter)).toMatchObject({ betweenSectors: false });
    }));

  it('keeps plotting while the sector inventory is open, which takes the map clicks, and goes on once it closes (OpenSectorInventory, MapScreen.cc:2236)', () =>
    withMap(async (f) => {
      await f.click('teamRow0.destination');
      f.key('i', KeyModifier.CTRL, 'KeyI');
      await f.settle();
      expect(f.screen.mapInventory.pool.open).toBe(true);
      expect(f.screen.hook()).toMatchObject({ plotting: { mode: 'merc', legs: [] }, glow: { line: 0, column: TeamColumn.DESTINATION } });
      await f.clickSector('C13');
      expect(f.screen.hook().plotting?.legs).toEqual([]);
      f.key('i', KeyModifier.CTRL, 'KeyI');
      await f.settle();
      expect(f.screen.mapInventory.pool.open).toBe(false);
      await f.hoverSector('C13', PLOT_REST_MS);
      await f.clickSector('C13');
      await f.clickSector('C13');
      expect(lastCommand(f)).toMatchObject({ cmd: { type: 'endPlot', steps: [{ to: 'C13' }], outcome: 'confirm' }, reply: { ok: true } });
    }));

  it('says the route is unchanged wherever plotting is given up by the sort buttons, the contract menu or the arrows (AbortMovementPlottingMode)', () =>
    withMap(async (f) => {
      const giveUp: readonly (() => void)[] = [() => f.key('F1'), () => f.key('c', 0, 'KeyC'), () => f.key('ArrowRight')];
      for (const action of giveUp) {
        await f.click('teamRow0.destination');
        expect(f.screen.hook().plotting).not.toBeNull();
        action();
        await f.settle();
        expect(f.screen.hook()).toMatchObject({ plotting: null, uiMessage: ROUTE_UNCHANGED });
        f.key('Escape');
        f.key('Escape');
        await f.settle();
      }
    }));

  it('gives up plotting silently on a click on a name, which only resets the modes (TeamListInfoRegionBtnCallBackPrimary)', () =>
    withMap(async (f) => {
      await f.click('teamRow0.destination');
      await f.click('teamRow1.name');
      expect(f.screen.hook()).toMatchObject({ plotting: null, uiMessage: null });
    }));

  it("restores the plot's starting path on Escape after the clicks and shortenings it replays, as AbortMovementPlottingMode does (RestorePreviousPaths, MapScreen.cc:4097)", () =>
    withMap(async (f) => {
      await plotMercRoute(f, 0, 'B13');
      f.key('Escape');
      const plotter = f.screen.list.slots[0]?.merc;
      const pathOf = () => f.client.view.strategic?.groups.find((g) => g.members.includes(plotter ?? -1))?.path;
      const before = pathOf();
      await f.click('teamRow0.destination');
      await f.hoverSector('B12', PLOT_REST_MS);
      await f.clickSector('B12');
      f.key('Escape');
      await f.settle();
      expect(lastCommand(f)).toMatchObject({
        cmd: { type: 'endPlot', soldier: plotter, steps: [{ to: 'B12' }], outcome: 'abort', selected: f.screen.list.selectedIds() },
        reply: { ok: true },
      });
      expect(pathOf()).toEqual(before);
      expect(f.screen.hook()).toMatchObject({ plotting: null, uiMessage: ROUTE_UNCHANGED });
    }));

  it('cuts the path in the client on a right click and sends the cut with the plot, the server path left as it is until then (CancelOrShortenPlottedPath)', () =>
    withMap(async (f) => {
      await plotMercRoute(f, 0, 'B13');
      f.key('Escape');
      const plotter = f.screen.list.slots[0]?.merc;
      const groupOf = () => f.client.view.strategic?.groups.find((g) => g.members.includes(plotter ?? -1));
      expect(groupOf()?.path.at(-1)).toBe('B13');
      await f.click('teamRow0.destination');
      const sent = f.client.commands.length;
      await f.clickSector('C13', MouseButton.RIGHT);
      expect(f.client.commands.length).toBe(sent);
      expect(f.screen.plotting?.plottedPath().at(-1)).toBe('C13');
      expect(groupOf()?.path.at(-1)).toBe('B13');
      await f.clickSector('C13');
      expect(f.client.commands.length).toBe(sent);
      await f.clickSector('C13');
      expect(lastCommand(f)).toMatchObject({
        cmd: { type: 'endPlot', steps: [{ cut: 'C13', selected: f.screen.list.selectedIds() }], outcome: 'confirm' },
        reply: { ok: true },
      });
      expect(groupOf()?.path.at(-1)).toBe('C13');
    }));

  it('leaves the clicked legs on the path at a silent end of the plot, the group not moving (TeamListInfoRegionBtnCallBackPrimary, MapScreen.cc:4276)', () =>
    withMap(async (f) => {
      const plotter = f.screen.list.slots[0]?.merc;
      await f.click('teamRow0.destination');
      await f.hoverSector('C13', PLOT_REST_MS);
      await f.clickSector('C13');
      await f.click('teamRow1.name');
      expect(lastCommand(f)).toMatchObject({ cmd: { type: 'endPlot', soldier: plotter, steps: [{ to: 'C13' }], outcome: 'drop' } });
      const group = f.client.view.strategic?.groups.find((g) => g.members.includes(plotter ?? -1));
      expect(group?.path.at(-1)).toBe('C13');
      expect(group?.betweenSectors).toBe(false);
    }));

  it('gives the plot up with the restore as the screen goes away (EndMapScreen, MapScreen.cc:3096)', () =>
    withMap(async (f) => {
      await f.click('teamRow0.destination');
      f.screen.exit();
      expect(lastCommand(f)?.cmd).toMatchObject({ type: 'endPlot', outcome: 'abort' });
    }));

  it('draws the plotted path and the ground ETA text over the sector inventory, without the ETA popup (MapScreen.cc:1887-1895, :1051; Map_Screen_Interface_Border.cc:101)', () =>
    withMap(async (f) => {
      await plotMercRoute(f, 0, 'B13');
      await f.click('teamRow0.destination');
      const cursors = () => f.draw().items.filter((i) => i.kind === 'image' && i.asset === MAP_CURSORS).length;
      const popup = () => f.draw().items.find((i) => i.kind === 'image' && i.asset === ETA_POPUP);
      const shown = popup();
      if (shown?.kind !== 'image') throw new Error('no ETA popup while plotting');
      const etaGlyphs = () =>
        f
          .draw()
          .items.filter((i) => i.kind === 'glyphs' && i.glyphs[0] !== undefined && Math.abs(i.glyphs[0].y - shown.y) < ETA_POPUP_HEIGHT)
          .length;
      expect(cursors()).toBeGreaterThan(0);
      f.key('i', KeyModifier.CTRL, 'KeyI');
      await f.settle();
      expect(f.screen.mapInventory.pool.open).toBe(true);
      expect(cursors()).toBeGreaterThan(0);
      expect(popup()).toBeUndefined();
      expect(etaGlyphs()).toBe(ETA_TEXT_PIECES);
    }));

  it('lets the exit keys leave while plotting and gives the plot up on the way out (AllowedToExitFromMapscreenTo, EndMapScreen)', () =>
    withMap(async (f) => {
      await f.click('teamRow0.destination');
      f.key('o', 0, 'KeyO');
      expect(f.flow).toEqual(['options']);
      expect(f.widget('laptopButton').enabled).toBe(true);
    }));

  it('gives up plotting when the inventory is toggled (RequestToggleMercInventoryPanel)', () =>
    withMap(async (f) => {
      await f.click('teamRow0.destination');
      f.key('Enter');
      expect(f.screen.hook()).toMatchObject({ plotting: null, uiMessage: ROUTE_UNCHANGED, inventoryOpen: true });
    }));

  it('toggles the inventory from the hand with either mouse button (ItemRegionBtnCallback)', () =>
    withMap(async (f) => {
      await f.click('infoHand', MouseButton.RIGHT);
      expect(f.screen.hook().inventoryOpen).toBe(true);
      await f.click('infoHand');
      expect(f.screen.hook().inventoryOpen).toBe(false);
    }));

  it('keeps the inventory open while a sector inventory item is held, by Enter and by the hand (CanToggleSelectedCharInventory)', () =>
    withMap(async (f) => {
      await f.click('teamRow0.name', MouseButton.RIGHT);
      stashClipInSelectedSector(f);
      f.screen.openSectorInventory();
      await f.settle();
      await f.click('poolSlot0');
      expect(f.screen.mapInventory.pool.cursor?.item).toBe('CLIP9_15');
      f.key('Enter');
      expect(f.screen.hook().inventoryOpen).toBe(true);
      await f.click('infoHand');
      expect(f.screen.hook().inventoryOpen).toBe(true);
      await f.click('poolSlot0');
      f.key('Enter');
      expect(f.screen.hook().inventoryOpen).toBe(false);
    }));

  it('opens the inventory under a held sector inventory item only for a merc in the sector shown (CanToggleSelectedCharInventory)', () =>
    withMap(async (f) => {
      const [first] = listedMercs(f);
      await f.click('teamRow0.name', MouseButton.RIGHT);
      await f.click('infoHand');
      expect(f.screen.hook().inventoryOpen).toBe(false);
      stashClipInSelectedSector(f);
      f.screen.openSectorInventory();
      await f.settle();
      await f.click('poolSlot0');
      expect(f.screen.mapInventory.pool.cursor?.item).toBe('CLIP9_15');
      mercRecord(f, first).betweenSectors = true;
      f.client.refresh();
      await f.click('teamRow0.name', MouseButton.RIGHT);
      await f.click('infoHand');
      f.key('Enter');
      expect(f.screen.hook().inventoryOpen).toBe(false);
      mercRecord(f, first).betweenSectors = false;
      f.client.refresh();
      f.key('Enter');
      expect(f.screen.hook().inventoryOpen).toBe(true);
    }));

  it('closes the description box instead of the inventory at a toggle (RequestToggleMercInventoryPanel)', () =>
    withMap(async (f) => {
      const [holder] = listedMercs(f);
      await f.click('teamRow0.name', MouseButton.RIGHT);
      const pocket = f.client.view.strategic?.mercs.find((m) => m.id === holder)?.inventory?.[0];
      if (!pocket) throw new Error('the info merc carries nothing');
      await f.click(`mercSlot${pocket.slot}`, MouseButton.RIGHT);
      await f.settle();
      expect(f.screen.mapInventory.merc.description.open).toBe(true);
      f.key('Enter');
      await f.settle();
      expect([f.screen.mapInventory.merc.description.open, f.screen.hook().inventoryOpen]).toEqual([false, true]);
    }));

  it('outlines the hand from the first glow step while the pointer is on it, red 1 up to 10 and down to 0, and drops it as the pointer leaves (GlowItem)', () =>
    withMap(async (f) => {
      expect([f.screen.hook().info, f.screen.hook().inventoryOpen]).toEqual([listedMercs(f)[0], false]);
      f.t.frame(GLOW_DELAY_MS);
      hoverWidget(f, 'infoHand');
      expect(f.screen.hook().handGlow).toBeNull();
      f.t.frame(GLOW_DELAY_MS - FRAME_MS);
      const colours = [f.screen.hook().handGlow];
      for (let step = 0; step < 21; step++) {
        f.t.frame(GLOW_DELAY_MS);
        colours.push(f.screen.hook().handGlow);
      }
      expect(colours).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2]);
      expect(handOutlines(f)).toEqual([{ kind: 'rectangle', x1: 3, y1: 80, x2: 64, y2: 104, color: rgb(2 * GLOW_RED_STEP, 0, 0) }]);
      hoverWidget(f, 'infoFace');
      expect([f.screen.hook().handGlow, handOutlines(f)]).toEqual([null, []]);
    }));

  it('holds the hand outline at its colour while the contract menu the c key opens over it is up, as GlowItem runs only without the menus (MapScreen.cc:2018)', () =>
    withMap(async (f) => {
      hoverWidget(f, 'infoHand');
      f.t.frame(GLOW_DELAY_MS);
      f.key('c', 0, 'KeyC');
      await f.settle();
      const held = f.screen.hook().handGlow;
      expect([f.screen.hook().menu, held]).toEqual(['contract', expect.any(Number)]);
      for (let step = 0; step < 3; step++) f.t.frame(GLOW_DELAY_MS);
      expect([f.screen.hook().handGlow, handOutlines(f).length]).toEqual([held, 1]);
      f.key('Escape');
      f.t.frame(GLOW_DELAY_MS);
      expect([f.screen.hook().menu, f.screen.hook().handGlow]).not.toEqual([null, held]);
    }));

  it('holds the glow of the assignment line at its colour while the assignment menu is up, as the team list glows step only without the menus (MapScreen.cc:2018-2027)', () =>
    withMap(async (f) => {
      hoverWidget(f, 'teamRow0.assignment');
      const colours = () => {
        const seen: (number | undefined)[] = [];
        for (let step = 0; step < 3; step++) {
          f.t.frame(GLOW_DELAY_MS);
          seen.push(f.screen.hook().glow?.colour);
        }
        return seen;
      };
      expect(new Set(colours()).size).toBeGreaterThan(1);
      await f.click('teamRow0.assignment');
      const held = f.screen.hook().glow;
      expect([f.screen.hook().menu, held?.column]).toEqual(['assignment', TeamColumn.ASSIGNMENT]);
      expect(colours()).toEqual([held?.colour, held?.colour, held?.colour]);
      f.key('Escape');
      expect(f.screen.hook().menu).toBeNull();
      expect(new Set(colours()).size).toBeGreaterThan(1);
    }));

  it('lights the hand only while the inventory can be toggled, and a check failing under it ends the glow at the next pointer move, lit again only as the pointer comes back (ItemRegionMvtCallback)', () =>
    withMap(async (f) => {
      const [first] = listedMercs(f);
      await f.click('teamRow0.name', MouseButton.RIGHT);
      await f.click('infoHand');
      stashClipInSelectedSector(f);
      f.screen.openSectorInventory();
      await f.settle();
      await f.click('poolSlot0');
      expect([f.screen.hook().info, f.screen.hook().inventoryOpen, f.screen.mapInventory.pool.cursor?.item]).toEqual([
        first,
        false,
        'CLIP9_15',
      ]);
      const glowAfterEntering = () => {
        hoverWidget(f, 'infoFace');
        hoverWidget(f, 'infoHand');
        f.t.frame(GLOW_DELAY_MS);
        return f.screen.hook().handGlow;
      };
      const betweenSectors = (between: boolean) => {
        mercRecord(f, first).betweenSectors = between;
        f.client.refresh();
        f.t.frame(GLOW_DELAY_MS);
      };
      betweenSectors(true);
      expect(glowAfterEntering()).toBeNull();
      betweenSectors(false);
      expect(glowAfterEntering()).not.toBeNull();
      betweenSectors(true);
      expect(f.screen.hook().handGlow).not.toBeNull();
      nudgePointer(f);
      expect(f.screen.hook().handGlow).toBeNull();
      betweenSectors(false);
      nudgePointer(f);
      f.t.frame(GLOW_DELAY_MS);
      expect(f.screen.hook().handGlow).toBeNull();
      expect(glowAfterEntering()).not.toBeNull();
    }));

  it('leaves the sector inventory open on Escape, as its own button closes it (HandleKeyESC)', () =>
    withMap(async (f) => {
      f.screen.openSectorInventory();
      await f.settle();
      f.key('Escape');
      await f.settle();
      expect(f.screen.mapInventory.pool.open).toBe(true);
    }));

  it('keeps an item held from a pocket or the sector inventory on Escape, with the inventory open, as HandleKeyESC has no branch for it', () =>
    withMap(async (f) => {
      const [holder] = listedMercs(f);
      await f.click('teamRow0.name', MouseButton.RIGHT);
      const pocket = f.client.view.strategic?.mercs.find((m) => m.id === holder)?.inventory?.[0];
      if (!pocket) throw new Error('the info merc carries nothing');
      await f.click(`mercSlot${pocket.slot}`);
      f.key('Escape');
      await f.settle();
      expect(f.screen.mapInventory.merc.panel.cursor?.item).toBe(pocket.item);
      expect(f.screen.hook().inventoryOpen).toBe(true);
      await f.click(`mercSlot${pocket.slot}`);
      stashClipInSelectedSector(f);
      f.screen.openSectorInventory();
      await f.settle();
      await f.click('poolSlot0');
      f.key('Escape');
      await f.settle();
      expect(f.screen.mapInventory.pool.cursor?.item).toBe('CLIP9_15');
      expect(f.screen.hook().inventoryOpen).toBe(true);
      await f.click('poolSlot0');
      f.key('Escape');
      await f.settle();
      expect(f.screen.hook().inventoryOpen).toBe(false);
    }));

  it('leaves the stack popup up on Escape, which closes the inventory only without one (HandleKeyESC)', () =>
    withMap(async (f) => {
      const [holder] = listedMercs(f);
      const items = (f.session.sim as CampaignSession).campaign.battle?.content.items;
      if (!items) throw new Error('no item table');
      mercRecord(f, holder).soldier.inv[InvSlot.SMALLPOCK1] = createItems(items, items.byName.get('CLIP9_15')?.index ?? 0, 100, 2);
      f.client.refresh();
      await f.click('teamRow0.name', MouseButton.RIGHT);
      await f.click(`mercSlot${InvSlot.SMALLPOCK1}`, MouseButton.RIGHT);
      expect(f.screen.mapInventory.merc.stack.open).toBe(true);
      f.key('Escape');
      await f.settle();
      expect(f.screen.mapInventory.merc.stack.open).toBe(true);
      expect(f.screen.hook().inventoryOpen).toBe(true);
    }));

  it('keeps the inventory open under the stack popup at Enter, which the original closes under it (original-bugs "Enter under the stack popup")', () =>
    withMap(async (f) => {
      const [holder] = listedMercs(f);
      const items = (f.session.sim as CampaignSession).campaign.battle?.content.items;
      if (!items) throw new Error('no item table');
      mercRecord(f, holder).soldier.inv[InvSlot.SMALLPOCK1] = createItems(items, items.byName.get('CLIP9_15')?.index ?? 0, 100, 2);
      f.client.refresh();
      await f.click('teamRow0.name', MouseButton.RIGHT);
      await f.click(`mercSlot${InvSlot.SMALLPOCK1}`, MouseButton.RIGHT);
      expect(f.screen.mapInventory.merc.stack.open).toBe(true);
      f.key('Enter');
      await f.settle();
      expect([f.screen.mapInventory.merc.stack.open, f.screen.hook().inventoryOpen]).toEqual([true, true]);
    }));

  it('turns the airspace off on the way below ground, by key or by selecting a sector there (ChangeSelectedMapSector)', () =>
    withMap(async (f) => {
      await f.click('filter4');
      f.key('Delete');
      expect(f.screen.level).toBe(FIRST_SUBLEVEL);
      expect(f.screen.hook().filters.airspace).toBe(false);
    }));

  it('names the sector recruits cannot be sent to while the landing zone moves (HandleMapUI, NS_INVALID_DROPOFF_SECTOR)', () =>
    withMap(async (f) => {
      const zone = f.client.view.strategic?.landingZone ?? '';
      await f.click('filter4');
      await f.clickSector(zone);
      expect(f.screen.hook().changingArrival).toBe(true);
      await f.clickSector(edgeOfWorldSector());
      expect(f.screen.hook()).toMatchObject({ changingArrival: true, uiMessage: INVALID_DROPOFF });
    }));

  it('ignores the team list while a locked line holds the map screen, but for a right click on the sleep column (fLockOutMapScreenInterface)', () =>
    withMap(async (f) => {
      const [first, second] = listedMercs(f);
      await f.click('teamRow0.destination');
      expect(f.screen.hook().plotting).not.toBeNull();
      f.speech.presenter.lockMapScreen(true);
      await f.click('teamRow1.name');
      await f.click('teamRow1.assignment');
      await f.click('teamRow1.destination', MouseButton.RIGHT);
      hoverWidget(f, 'teamRow1.assignment');
      expect(f.screen.hook()).toMatchObject({ info: first, menu: null, plotting: { mode: 'merc' } });
      expect(f.screen.hook().glow?.line).toBe(0);
      await f.click('teamRow1.sleep', MouseButton.RIGHT);
      expect(f.screen.hook()).toMatchObject({ info: first, plotting: null });
      f.speech.presenter.lockMapScreen(false);
      await f.click('teamRow1.name');
      expect(f.screen.hook().info).toBe(second);
    }));

  it('switches off the columns a row cannot use and reads the remove help for the dead and the captured (EnableDisableTeamListRegionsAndHelpText)', () =>
    withMap(async (f) => {
      const [first = -1, second = -1] = f.mercs;
      expect(f.widget(`teamRow${LAST_ROW}.name`).enabled).toBe(false);
      expect(f.widget(`teamRow${LAST_ROW}.departure`).enabled).toBe(false);
      expect(f.widget('teamRow0.assignment')).toMatchObject({ enabled: true, text: 'Assign Merc' });
      mercRecord(f, first).assignment = Assignment.ASSIGNMENT_POW;
      mercRecord(f, second).life = 0;
      f.client.refresh();
      f.t.frame();
      const captured = rowOf(f, first);
      const dead = rowOf(f, second);
      expect(f.widget(`teamRow${captured}.departure`).enabled).toBe(false);
      expect(f.widget(`teamRow${captured}.assignment`).text).toBe('Remove Merc');
      expect(f.widget(`teamRow${captured}.destination`).text ?? '').toBe('');
      expect(f.widget(`teamRow${dead}.departure`).enabled).toBe(true);
      expect(f.widget(`teamRow${dead}.assignment`).text).toBe('Remove Merc');
    }));

  it('resets the modes through a switched-off column instead of acting on it (MapScreenMarkRegionBtnCallback)', () =>
    withMap(async (f) => {
      await f.click('teamRow0.destination');
      const { rect } = f.widget(`teamRow${EMPTY_ROW}.departure`);
      expect(f.widget(`teamRow${EMPTY_ROW}.departure`).enabled).toBe(false);
      await f.clickAt(rect.x + 1, rect.y + 1);
      expect(f.screen.hook()).toMatchObject({ plotting: null, menu: null, uiMessage: ROUTE_UNCHANGED });
    }));

  it('gives the status bars and the corner icons their help, nothing for a dead merc (UpdateCharRegionHelpText, UpdateHelpTextForMapScreenMercIcons)', () =>
    withMap(async (f) => {
      const m = f.client.view.strategic?.mercs.find((x) => x.id === f.screen.hook().info);
      if (!m) throw new Error('no info merc');
      expect(f.widget('infoStatusBars').text).toBe(`Health: ${m.life}/${m.lifeMax}, Energy: ${m.breath}/${m.breathMax}, Morale: Stable`);
      expect(f.widget('infoCornerIcon0').text).toBe('Merc has a finite contract.');
      expect(f.widget('infoCornerIcon2').text ?? '').toBe('');
      mercRecord(f, m.id).life = 0;
      f.client.refresh();
      f.t.frame();
      expect(f.widget('infoStatusBars').text ?? '').toBe('');
    }));

  it('hides the numbers of a captured merc in the help of the status bars', () =>
    withMap(async (f) => {
      const id = f.screen.hook().info ?? -1;
      mercRecord(f, id).assignment = Assignment.ASSIGNMENT_POW;
      f.client.refresh();
      f.t.frame();
      expect(f.widget('infoStatusBars').text).toBe('Health: ??, Energy: ??, Morale: ??');
    }));

  it('keeps the contract row glowing from the key on through the price line, and closes the menu with a right click on a line (ContractMenuBtnCallbackSecondary)', () =>
    withMap(async (f) => {
      const merc = f.screen.hook().info ?? -1;
      const contract = (f.session.sim as CampaignSession).campaign.contracts?.roster.get(merc)?.contract;
      if (!contract) throw new Error('no contract');
      contract.contractPriceIncreased = true;
      f.key('c', 0, 'KeyC');
      await f.settle();
      const glow = { line: f.screen.list.rowOf(merc), column: TeamColumn.CONTRACT };
      expect(f.screen.hook()).toMatchObject({ menu: null, glow });
      f.session.advance({ idle: true });
      f.client.refresh();
      f.frames([]);
      await f.settle();
      expect(f.screen.hook()).toMatchObject({ menu: 'contract', glow });
      f.key('Escape');
      await f.settle();
      f.key('c', 0, 'KeyC');
      await f.settle();
      expect(f.screen.hook()).toMatchObject({ menu: 'contract', glow });
      await f.click('contractMenu.line2', MouseButton.RIGHT);
      expect(f.screen.hook()).toMatchObject({ menu: null, glow: null });
    }));

  it('closes the open submenu with a right click on a line of the assignment box, and keeps the box (AssignmentMenuBtnCallbackSecondary)', () =>
    withMap(async (f) => {
      await f.click('teamRow0.assignment');
      await f.settle();
      await f.click('assignmentMenu.line0');
      await f.settle();
      expect(f.find('squadMenu')).toBeDefined();
      await f.click('assignmentMenu.line1', MouseButton.RIGHT);
      await f.settle();
      expect(f.find('squadMenu')).toBeUndefined();
      expect(f.screen.hook().menu).toBe('assignment');
    }));

  it('closes the contract menu at once when Dismiss is chosen, whatever the answer to its box (ContractMenuBtnCallbackPrimary)', () =>
    withMap(async (f) => {
      f.key('c', 0, 'KeyC');
      await f.settle();
      await f.click(DISMISS_LINE);
      await f.settle();
      expect(f.screen.hook().menu).toBeNull();
      expect(f.t.runtime.host.modal?.id).toBe(MESSAGE_BOX);
      await f.click(`${MESSAGE_BOX}.no`);
      await f.settle();
      expect(f.screen.hook().menu).toBeNull();
      expect(f.client.commands.some((c) => c.cmd.type === 'dismiss')).toBe(false);
    }));

  it('opens the contract menu for the robot, which it dismisses, and only resets the modes for a prisoner on the c key (CanExtendContractForSoldier, RequestContractMenu)', () =>
    withMap(async (f) => {
      const merc = f.screen.hook().info ?? -1;
      const record = mercRecord(f, merc);
      record.assignment = Assignment.ASSIGNMENT_POW;
      f.client.refresh();
      f.t.frame();
      f.key('c', 0, 'KeyC');
      await f.settle();
      expect(f.screen.hook().menu).toBeNull();
      expect(f.client.commands.some((c) => c.cmd.type === 'openContractMenu')).toBe(false);
      record.assignment = 0;
      Object.assign(record.soldier, { bodyType: Body.ROBOTNOWEAPON });
      f.client.refresh();
      f.t.frame();
      expect(f.widget('contractButton').enabled).toBe(true);
      f.key('c', 0, 'KeyC');
      await f.settle();
      expect(f.screen.hook().menu).toBe('contract');
    }));

  it('shows the remove box for a dead merc from the c key and his contract column (DetermineIfContractMenuCanBeShown)', () =>
    withMap(async (f) => {
      const merc = f.screen.hook().info ?? -1;
      mercRecord(f, merc).life = 0;
      f.client.refresh();
      f.t.frame();
      f.key('c', 0, 'KeyC');
      await f.settle();
      expect(f.screen.hook().menu).toBe('assignment');
      expect(f.t.runtime.describe().find((w) => w.id === 'assignmentMenu.line0' && w.kind === 'popupLine')?.text).toBe('Remove Merc');
    }));
});
