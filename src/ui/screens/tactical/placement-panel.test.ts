import { describe, expect, it } from 'vitest';
import { testRuntime, uniformImage } from '../../../../tests/support/ui-runtime.ts';
import type { PlacementMercView, SoldierView, TacticalPlacementPromptView } from '../../../protocol/view.ts';
import { DrawList, rgb } from '../../draw-list.ts';
import type { UiKeyEvent } from '../../input/events.ts';
import { MouseReason } from '../../input/mouse.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { type PlacementAnswer, type PlacementMerc, PlacementPanel, type PlacementReply } from './placement-panel.ts';

const PANEL = 'interface/overheadinterface.sti';
const BUTTONS = 'interface/overheaduibuttons.sti';
const FACES = 'interface/panels.sti';
const STRINGS: Readonly<Record<number, string>> = {
  46: 'Clear',
  47: 'Spread',
  48: 'Group',
  49: 'Done',
  54: 'You must place all of your mercs',
  55: 'Sector',
  56: 'Choose entry positions',
  57: 'Inaccessible',
  58: 'Place your mercs in the highlighted section',
};
const TEXT: UiTextService = {
  string: (table, index) => (table === 'gpStrategicString' ? (STRINGS[index] ?? null) : null),
  edt: () => null,
};
const NORTH_STRIP_Y = 20;
const MIDDLE_Y = 150;
const MAP_X = 300;
const NIGHT_HATCH = rgb(63, 31, 31);
const BLACK = rgb(0, 0, 0);

interface Sent {
  readonly choice: PlacementAnswer;
  readonly place?: { soldier: number; gridNo: number };
}

function merc(soldier: number, group: number, over: Partial<PlacementMercView> = {}): PlacementMercView {
  return { soldier, side: 'north', group, placed: false, ...over };
}

function prompt(mercs: readonly PlacementMercView[], over: Partial<TacticalPlacementPromptView> = {}): TacticalPlacementPromptView {
  return {
    id: 'tacticalPlacement-1',
    kind: 'tacticalPlacement',
    sector: 'B9',
    button: 'clear',
    mercs,
    edgepoints: { north: [1043, 1203] },
    everyonePlaced: mercs.every((m) => m.placed),
    choices: ['place', 'spread', 'group', 'clear', 'done'],
    ...over,
  };
}

async function harness(options: { hour?: number; reply?: PlacementReply } = {}) {
  const t = await testRuntime();
  t.images.set(PANEL, uniformImage(1, 640, 160));
  t.images.set(BUTTONS, uniformImage(2, 69, 27));
  t.images.set(FACES, uniformImage(2, 47, 31));
  const sent: Sent[] = [];
  const boxes: string[] = [];
  const stats: PlacementMerc = { name: 'Ivan', face: null, life: 80, lifeMax: 90, bleeding: 20, breathMax: 100, morale: 50 };
  const panel = new PlacementPanel({
    services: t.runtime,
    text: TEXT,
    art: () => ({ panel: PANEL, buttons: BUTTONS, faces: FACES }),
    merc: () => stats,
    sectorName: (sector) => sector,
    hour: () => options.hour ?? 12,
    mapGridNo: () => 1203,
    mapRegion: () => null,
    answer: (_prompt, choice, place) => {
      sent.push(place ? { choice, place } : { choice });
      return Promise.resolve(options.reply ?? { ok: true });
    },
    box: (text) => boxes.push(text),
    exitGame: () => {},
  });
  const widget = (id: string) => panel.describe().find((w) => w.id === id);
  const click = (id: string) => {
    const rect = widget(id)?.rect;
    if (!rect) throw new Error(`no ${id}`);
    t.click(rect.x + 5, rect.y + 5);
  };
  return { t, panel, sent, boxes, widget, click };
}

const keyDown = (key: string): UiKeyEvent => ({ kind: 'keyDown', key, code: '', modifiers: 0 });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function piece(id: number): SoldierView {
  return { id, team: 0 } as unknown as SoldierView;
}

describe('the tactical placement panel (Tactical_Placement_GUI.cc)', () => {
  it('puts up the four buttons at 11 and 332 to 437 with Done disabled until everyone is placed, and the cells from 95, 371 two to a column (InitTacticalPlacementGUI, EnsureDoneButtonStatus)', async () => {
    const h = await harness();
    h.panel.sync(prompt([merc(0, 30), merc(1, 30), merc(2, 30)]));
    expect(['placement.clear', 'placement.spread', 'placement.group', 'placement.done'].map((id) => h.widget(id)?.rect)).toEqual(
      [332, 367, 402, 437].map((y) => ({ x: 11, y, width: 69, height: 27 })),
    );
    expect(h.widget('placement.done')?.enabled).toBe(false);
    const list = new DrawList();
    h.panel.render(list);
    const faces = list.items.flatMap((i) => (i.kind === 'image' && i.asset === FACES ? [[i.x, i.y]] : []));
    expect(faces).toEqual([
      [95, 371],
      [95, 422],
      [149, 371],
    ]);
    h.panel.sync(prompt([merc(0, 30, { placed: true }), merc(1, 30, { placed: true }), merc(2, 30, { placed: true })]));
    expect(h.widget('placement.done')?.enabled).toBe(true);
  });

  it('places the merc Clear selects with a click within 40 pixels of his side, then selects the next unplaced one, and boxes STR_TP_INVALID_MESSAGE off the strip (HandleTacticalPlacementClicksInOverheadMap, SelectNextUnplacedUnit)', async () => {
    const h = await harness();
    h.panel.sync(prompt([merc(0, 30), merc(1, 30)]));
    expect(h.panel.selected).toBe(0);
    h.t.move(MAP_X, MIDDLE_Y);
    h.panel.mapButton(MouseReason.LBUTTON_UP);
    expect(h.boxes).toEqual(['Place your mercs in the highlighted section']);
    expect(h.sent).toEqual([]);
    h.t.move(MAP_X, NORTH_STRIP_Y);
    h.panel.mapButton(MouseReason.LBUTTON_UP);
    await settle();
    expect(h.sent).toEqual([{ choice: 'place', place: { soldier: 0, gridNo: 1203 } }]);
    expect(h.panel.selected).toBe(1);
  });

  it('boxes the refusal of a spot no edge point is near (STR_TP_INACCESSIBLE_MESSAGE)', async () => {
    const h = await harness({ reply: { ok: false, data: { refusal: 'placementInaccessible' } } });
    h.panel.sync(prompt([merc(0, 30)]));
    h.t.move(MAP_X, NORTH_STRIP_Y);
    h.panel.mapButton(MouseReason.LBUTTON_UP);
    await settle();
    expect(h.boxes).toEqual(['Inaccessible']);
    expect(h.panel.selected).toBe(0);
  });

  it('answers the buttons and the keys s, g, c and Enter, Enter only once Done is enabled (TacticalPlacementHandle)', async () => {
    const h = await harness();
    h.panel.sync(prompt([merc(0, 30)]));
    h.click('placement.spread');
    for (const key of ['g', 'c', 'Enter']) h.panel.keyInput(keyDown(key));
    expect(h.sent.map((s) => s.choice)).toEqual(['spread', 'group', 'clear']);
    h.panel.sync(prompt([merc(0, 30, { placed: true })]));
    h.panel.keyInput(keyDown('Enter'));
    expect(h.sent.map((s) => s.choice)).toEqual(['spread', 'group', 'clear', 'done']);
  });

  it('hatches the map but the strip of the selected merc, black by day and 63, 31, 31 at night (RenderTacticalPlacementGUI)', async () => {
    for (const [hour, colour] of [
      [12, BLACK],
      [22, NIGHT_HATCH],
    ] as const) {
      const h = await harness({ hour });
      h.panel.sync(prompt([merc(0, 30)]));
      const list = new DrawList();
      h.panel.renderOverMap(list);
      expect(list.items.find((i) => i.kind === 'hatch')).toMatchObject({ x: 4, y: 30, color: colour });
    }
  });

  it('draws the selected piece in persons frame 7 and the others in their team frame (Overhead_Map.cc RenderOverheadOverlays)', async () => {
    const h = await harness();
    h.panel.sync(prompt([merc(0, 30), merc(1, 30)], { button: 'group' }));
    expect([h.panel.personFrame(piece(0)), h.panel.personFrame(piece(1))]).toEqual([7, 0]);
  });
});
