import { describe, expect, it } from 'vitest';
import { testRuntime, uniformImage } from '../../../../tests/support/ui-runtime.ts';
import type { AutoBandageView, SoldierView, ViewFrame } from '../../../protocol/view.ts';
import { DrawList } from '../../draw-list.ts';
import type { UiKeyEvent } from '../../input/events.ts';
import { FontName } from '../../text/fonts.ts';
import type { UiTextService } from '../../text/text-service.ts';
import {
  AutoBandageBox,
  autoBandageNotices,
  autoBandagePanelGeometry,
  autoBandageRefusalText,
  medicCells,
  patientCells,
} from './auto-bandage-box.ts';

const SCREEN = { width: 640, height: 480 };
const PANEL = 'interface/group_confirm_tactical.sti';
const FACES = 'interface/panels.sti';
const CELL = 15;
const STRINGS: Readonly<Record<string, Readonly<Record<number, string>>>> = {
  zMarksMapScreenText: { 13: 'Medics', 14: 'Patients', 15: 'Done', 16: 'Stop' },
  pDoctorWarningString: { 1: 'Your medics were unable to completely bandage everyone.' },
  Message: { 44: 'Sector not cleared' },
  TacticalStr: { 116: 'Nobody to bandage', 129: 'Cannot auto-bandage' },
};
const TEXT: UiTextService = { string: (table, index) => STRINGS[table]?.[index] ?? null, edt: () => null };

type FrameEvent = NonNullable<ViewFrame['events']>[number];

function soldier(id: number, over: Partial<SoldierView> = {}): SoldierView {
  return {
    id,
    name: `M${id}`,
    team: 0,
    profile: id,
    life: 60,
    lifeMax: 80,
    bleeding: 10,
    breathMax: 90,
    morale: 50,
    ...over,
  } as unknown as SoldierView;
}

function running(medics: readonly number[], patients: readonly number[], complete = false): AutoBandageView {
  return { complete, medics, patients };
}

async function harness(soldiers: readonly SoldierView[] = [soldier(0), soldier(1), soldier(2)]) {
  const t = await testRuntime();
  t.images.set(PANEL, uniformImage(21, 70, 15));
  t.images.set(FACES, uniformImage(2, 47, 31));
  let ends = 0;
  const box = new AutoBandageBox({
    services: t.runtime,
    text: TEXT,
    art: () => ({ panel: PANEL, faces: FACES, buttonFont: t.fonts.get(FontName.BLOCKFONT2) }),
    soldier: (id) => soldiers.find((s) => s.id === id) ?? null,
    portrait: (s) => `faces/65face/0${s.id}.sti`,
    ensure: () => true,
    end: () => ends++,
  });
  const button = (id: string) => box.describe().find((w) => w.id === id);
  const click = (id: string) => {
    const rect = button(id)?.rect;
    if (!rect) throw new Error(`no ${id}`);
    t.click(rect.x + 5, rect.y + 5);
  };
  return { t, box, button, click, ends: () => ends };
}

function images(list: DrawList): string[] {
  return list.items.flatMap((i) => (i.kind === 'image' ? [`${i.asset}#${i.frame}@${i.x},${i.y}`] : []));
}

const keyUp = (key: string): UiKeyEvent => ({ kind: 'keyUp', key, code: '', modifiers: 0 });
const keyDown = (key: string): UiKeyEvent => ({ kind: 'keyDown', key, code: '', modifiers: 0 });

describe('the auto-bandage box (Auto_Bandage.cc DisplayAutoBandageUpdatePanel)', () => {
  it('is two faces wide below three faces and four wide from three up, the wider list setting the width', () => {
    const shape = (n: number) => {
      const g = autoBandagePanelGeometry(n, 1, SCREEN);
      return [g.wide, g.medicRows];
    };
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(shape)).toEqual([
      [2, 1],
      [2, 1],
      [4, 1],
      [4, 1],
      [4, 2],
      [4, 2],
      [4, 2],
      [4, 2],
    ]);
    expect(autoBandagePanelGeometry(1, 3, SCREEN).wide).toBe(4);
  });

  it('centres the cells over the panel line and puts the buttons under the second cell of a four-wide box', () => {
    expect(autoBandagePanelGeometry(1, 1, SCREEN)).toEqual({
      wide: 2,
      medicRows: 1,
      patientRows: 1,
      x: 250,
      y: 121,
      width: 140,
      height: 107,
      button: { x: 250, y: 231 },
    });
    const g = autoBandagePanelGeometry(3, 5, SCREEN);
    expect(g).toEqual({ wide: 4, medicRows: 1, patientRows: 2, x: 180, y: 96, width: 280, height: 156, button: { x: 250, y: 255 } });
    expect(medicCells(g).map((c) => [c.x, c.y, c.index])).toEqual([
      [180, 96, 0],
      [250, 96, 1],
      [320, 96, 2],
      [390, 96, 3],
    ]);
    expect(patientCells(g).map((c) => [c.x, c.y])[4]).toEqual([180, 203]);
    expect(autoBandagePanelGeometry(1, 1, { width: 960, height: 540 })).toMatchObject({ x: 410, y: 151 });
  });

  it('shows a merc on both lists twice, a medic above and a patient below, with their names in the cells', async () => {
    const h = await harness();
    expect(h.box.update(running([2], [0, 2]))).toBe(true);
    const list = new DrawList();
    h.box.render(list);
    const drawn = images(list);
    expect(drawn.filter((i) => i.startsWith('faces/65face/02.sti'))).toEqual([
      'faces/65face/02.sti#0@260,129',
      'faces/65face/02.sti#0@330,187',
    ]);
    expect(drawn).toContain('faces/65face/00.sti#0@260,187');
    expect(drawn.filter((i) => i.startsWith(`${PANEL}#${CELL}@`))).toEqual([
      `${PANEL}#15@250,121`,
      `${PANEL}#15@320,121`,
      `${PANEL}#15@250,179`,
      `${PANEL}#15@320,179`,
    ]);
  });

  it('draws the breath bar at the breath maximum, not the breath, and no bars at all for the dead', async () => {
    const h = await harness([soldier(0), soldier(1, { breath: 10, breathMax: 90 }), soldier(2, { life: 0 })]);
    h.box.update(running([1], [0, 2]));
    const list = new DrawList();
    h.box.render(list);
    const breathColumn = list.items.flatMap((i) => (i.kind === 'fill' && i.x === 297 && i.y < 179 ? [[i.y, i.height]] : []));
    expect(breathColumn).toEqual([[132, 24]]);
    const deadBars = list.items.filter((i) => i.kind === 'fill' && i.x >= 364 && i.x < 372 && i.y > 179);
    expect(deadBars.map((i) => (i.kind === 'fill' ? [i.x, i.y, i.width, i.height] : null))).toEqual([[364, 187, 8, 28]]);
  });

  it('enables Stop until the mode is complete and Done only then, and either asks for the end once', async () => {
    const h = await harness();
    h.box.update(running([1], [0]));
    expect([h.button('autoBandageBox.done')?.enabled, h.button('autoBandageBox.cancel')?.enabled]).toEqual([false, true]);
    expect([h.button('autoBandageBox.done')?.text, h.button('autoBandageBox.cancel')?.text]).toEqual(['Done', 'Stop']);
    h.box.update(running([1], [0], true));
    expect([h.button('autoBandageBox.done')?.enabled, h.button('autoBandageBox.cancel')?.enabled]).toEqual([true, false]);
    h.click('autoBandageBox.cancel');
    expect(h.ends()).toBe(0);
    h.click('autoBandageBox.done');
    h.click('autoBandageBox.done');
    expect(h.ends()).toBe(1);
    h.box.update(null);
    expect([h.box.open, h.box.describe()]).toEqual([false, []]);
  });

  it('ends on the release of Esc while not complete, of Enter or Space once complete, and on nothing else', async () => {
    const h = await harness();
    h.box.update(running([1], [0]));
    for (const event of [keyUp('Enter'), keyUp(' '), keyDown('Escape'), keyUp('a')]) h.box.input(event);
    expect(h.ends()).toBe(0);
    h.box.input(keyUp('Escape'));
    expect(h.ends()).toBe(1);
    h.box.update(null);
    h.box.update(running([1], [0], true));
    h.box.input(keyUp('Escape'));
    expect(h.ends()).toBe(1);
    h.box.input(keyUp(' '));
    expect(h.ends()).toBe(2);
  });

  it('shadows the screen it opens on once and keeps that picture under the box', async () => {
    const h = await harness();
    h.box.update(running([1], [0]));
    const first = new DrawList();
    h.box.render(first);
    expect(first.items.slice(0, 2).map((i) => i.kind)).toEqual(['shadow', 'capture']);
    expect([h.box.frozen, h.box.coversScreen]).toEqual([true, false]);
    const later = new DrawList();
    h.box.render(later);
    expect(h.box.coversScreen).toBe(true);
    expect(later.items[0]).toMatchObject({ kind: 'snapshot', x: 0, y: 0, width: 640, height: 480 });
    const fullScreen = (i: DrawList['items'][number]) => 'width' in i && i.width === SCREEN.width && i.height === SCREEN.height;
    expect(later.items.filter(fullScreen).map((i) => i.kind)).toEqual(['snapshot']);
    expect(later.items.some((i) => i.kind === 'capture')).toBe(false);
    h.box.update(null);
    expect(h.box.coversScreen).toBe(false);
  });

  it('masks the screen but draws no panel and no buttons when a list is empty', async () => {
    const h = await harness();
    h.box.update(running([], []));
    const list = new DrawList();
    h.box.render(list);
    expect(list.items.map((i) => i.kind)).toEqual(['shadow', 'capture']);
    expect(h.box.describe().map((w) => [w.id, w.visible])).toEqual([['autoBandageBox', false]]);
    expect(h.t.runtime.regions.regions.some((r) => r.id === 'autoBandageMask')).toBe(true);
    h.box.input(keyUp('Escape'));
    expect(h.ends()).toBe(1);
  });

  it("shows the refusals of the question as their OK boxes and a failed end as pDoctorWarningString's", () => {
    expect(autoBandageRefusalText(TEXT, 'sectorNotCleared')).toBe('Sector not cleared');
    expect(autoBandageRefusalText(TEXT, 'conversationOpen')).toBeNull();
    const events = [
      { type: 'autoBandageRefused', tick: 4, refusal: 'nobodyToBandage' },
      { type: 'autoBandageEnded', tick: 9, failed: false, worldSecondsWarped: 125 },
      { type: 'autoBandageEnded', tick: 12, failed: true, worldSecondsWarped: 60 },
    ] as unknown as FrameEvent[];
    expect(autoBandageNotices([{ tick: 12, changed: [], removed: [], events }], TEXT)).toEqual([
      { text: 'Nobody to bandage', prompt: { id: 'autoBandageRefused-4-nobodyToBandage', kind: 'autoBandageRefused' }, fullScreen: true },
      {
        text: 'Your medics were unable to completely bandage everyone.',
        prompt: { id: 'autoBandageEnded-12-failed', kind: 'autoBandageEnded' },
        fullScreen: false,
      },
    ]);
  });
});
