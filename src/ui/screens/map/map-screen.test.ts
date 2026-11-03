import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type MapUiKit, type MapUiTest, mapUiKit, mapUiTest, TEST_VERSION } from '../../../../tests/support/map-ui.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { FontColor } from '../../../content/text/font-colors.ts';
import type { CampaignSession } from '../../../server/campaign-session.ts';
import { MercKind } from '../../../sim/campaign/roster.ts';
import { SectorFlag } from '../../../sim/strategic/forces/constants.ts';
import { setSectorFlag } from '../../../sim/strategic/map/sectors.ts';
import type { DrawItem } from '../../draw-list.ts';
import { KeyModifier, keyDownEvents, keyUpEvents, MouseButton, type RawKey } from '../../input/events.ts';
import { BUTTON_REPEAT_TIMEOUT_MS } from '../../input/mouse.ts';
import { Assignment } from './character-list.ts';
import { localMessage, MAX_MESSAGES_ON_MAP_BOTTOM } from './message-list.ts';

const PLOT_REST_MS = 250;
const ASSIGN_MENU_TRAIN = 5;
const TRAIN_MENU_TOWN = 1;
const MESSAGE_BOX = 'messageBox';
const SPEAKER = 60;
const MALE = 0;
const FEMALE = 1;
const FRED = 106;
const FRED_RUNNING_OUT = 17;
const FRED_KEY = { file: 'npcdata/106.edt', row: FRED_RUNNING_OUT, width: 240 };
const DRASSEN_MINE = 1;
const QUOTE_KEY = { file: 'npcdata/060.edt', row: 0, width: 240 };
const RADAR = 'radarmaps/test.sti';
const DRASSEN_MINE_FIRST_LEVEL = { x: 13, y: 4, z: 1 };
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;
const NIGHT_SHADE = { red: 100, green: 100, blue: 100, mono: false };
const MESSAGE_LINES = 30;
const LAST_TOP_LINE = MESSAGE_LINES - MAX_MESSAGES_ON_MAP_BOTTOM;
const SCROLL_AREA_X = 7;
const FULL_SHADE = { red: 255, green: 255, blue: 255, mono: false };

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

function setWorldHour(f: MapUiTest, hour: number): void {
  const clock = (f.session.sim as CampaignSession).campaign.state.clock;
  clock.seconds = Math.floor(clock.seconds / SECONDS_PER_DAY) * SECONDS_PER_DAY + hour * SECONDS_PER_HOUR;
  f.client.refresh();
  f.t.frame();
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

function setGameJustStarted(f: MapUiTest, started: boolean): void {
  (f.session.sim as CampaignSession).campaign.state.didGameJustStart = started;
  f.client.refresh();
  f.t.frame();
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

  it('cuts the line the player last saw said with Backspace, and nothing once that line was cut', () =>
    withMap(async (f) => {
      const tick = f.client.view.tick;
      const said = { type: 'npcQuote', tick, profile: SPEAKER, soldier: null, quote: 0, textKey: QUOTE_KEY, chars: 12 } as const;
      f.frames([{ tick, changed: [], removed: [], events: [said] }]);
      f.key('Backspace');
      await f.settle();
      expect(lastCommand(f)?.cmd).toEqual({ type: 'skipLine', profile: SPEAKER, tick });
      const sent = f.client.commands.length;
      f.frames([
        { tick, changed: [], removed: [], events: [said, { type: 'lineCut', tick, profile: SPEAKER, saidAt: tick, tail: false }] },
      ]);
      f.key('Backspace');
      await f.settle();
      expect(f.client.commands).toHaveLength(sent);
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
      await f.click('teamRow0.destination');
      f.key('s', KeyModifier.ALT);
      f.key('l', KeyModifier.ALT);
      await f.settle();
      expect(f.flow).toEqual(['quickSave', 'quickLoad', 'quickSave']);
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

  it('leaves the box of a sector lost in the tactical flow to the tactical screen', () =>
    withMap(async (f) => {
      (f.session.sim as CampaignSession).campaign.state.flow = 'tactical';
      f.client.refresh();
      const tick = f.client.view.tick;
      f.frames([{ tick, changed: [], removed: [], events: [{ type: 'sectorLost', tick, sector: 'C13', kind: 'town' }] }]);
      await f.settle();
      expect(f.t.runtime.host.modal).toBeNull();
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
});
