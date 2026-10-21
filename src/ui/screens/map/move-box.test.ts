import { describe, expect, it } from 'vitest';
import { testRuntime } from '../../../../tests/support/ui-runtime.ts';
import { FontColor } from '../../../content/text/font-colors.ts';
import type { DrawItem } from '../../draw-list.ts';
import { DrawList } from '../../draw-list.ts';
import { FontName } from '../../text/fonts.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { DEFAULT_POPUP_COLORS, type PopupBoxStyle } from '../../widgets/popup-box.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import { DBL_CLICK_DELAY_FOR_MOVE_MENU, MoveBox } from './move-box.ts';
import { type MoveFeedback, type MoveMember, type MovePlan, MoveSelection } from './move-selection.ts';

const STRINGS: Readonly<Record<string, readonly string[]>> = {
  pMovementMenuStrings: ['Move Mercs In Sector %s', 'Plot Travel Route', 'Cancel', 'Other'],
  pSquadMenuStrings: ['Squad 1', 'Squad 2'],
};

const TEXT: UiTextService = { string: (table, index) => STRINGS[table]?.[index] ?? null, edt: () => null };

function member(id: number, over: Partial<MoveMember> = {}): MoveMember {
  return { id, name: `M${id}`, assignment: 0, squad: 0, vehicle: null, betweenSectors: false, listed: true, refusal: null, ...over };
}

async function harness(members: readonly MoveMember[]) {
  const t = await testRuntime();
  const style: PopupBoxStyle = {
    border: 'interface/popup.sti',
    background: 'interface/popupbackground.pcx',
    font: t.fonts.get(FontName.BLOCKFONT2),
    marginLeft: 6,
    marginTop: 6,
    marginBottom: 4,
    marginRight: 4,
    lineSpace: 2,
    colors: { ...DEFAULT_POPUP_COLORS, highlight: FontColor.WHITE, secondaryShade: FontColor.YELLOW },
    resize: true,
  };
  const feedback: NonNullable<MoveFeedback>[] = [];
  const plans: MovePlan[] = [];
  let closed = 0;
  const box = new MoveBox({
    regions: t.runtime.regions,
    text: TEXT,
    owner: 'test',
    style: () => style,
    origin: () => ({ x: 0, y: 0 }),
    now: () => t.now,
    vehicleType: () => 0,
    report: (f) => feedback.push(f),
    done: (plan) => plans.push(plan),
    closed: () => closed++,
  });
  box.show('D13', new MoveSelection(members));
  const line = (text: string): WidgetInfo => {
    const found = box.describe().find((w) => w.kind === 'popupLine' && w.text === text);
    if (!found)
      throw new Error(
        `no line ${text}: ${box
          .describe()
          .map((w) => w.text)
          .join('|')}`,
      );
    return found;
  };
  const click = (text: string) => {
    const r = line(text).rect;
    t.click(r.x + 2, r.y + 2);
  };
  return { t, box, feedback, plans, click, line, closed: () => closed };
}

function glyphColours(list: DrawList): number[] {
  return list.items.flatMap((item: DrawItem) => (item.kind === 'glyphs' ? [item.foreground] : []));
}

describe('the move box', () => {
  it('opens at 450, 100 with a white header and a yellow cancel line', async () => {
    const h = await harness([member(1), member(2)]);
    const list = new DrawList();
    h.box.render(list);
    const menu = h.box.describe()[0];
    expect(menu?.rect.x).toBe(450);
    expect(menu?.rect.y).toBe(100);
    const colours = glyphColours(list);
    expect(colours[0]).toBe(FontColor.WHITE);
    expect(colours.at(-1)).toBe(FontColor.YELLOW);
  });

  it('toggles a squad on a click and rebuilds the lines with the plot line', async () => {
    const h = await harness([member(1), member(2)]);
    h.click('Squad 1');
    expect(h.box.lines.map((l) => l.text)).toContain('*Squad 1*');
    expect(h.box.lines.map((l) => l.text)).toContain('Plot Travel Route');
    h.t.now += DBL_CLICK_DELAY_FOR_MOVE_MENU;
    h.click('Plot Travel Route');
    expect(h.plans).toEqual([{ soldiers: [1, 2], squads: [0], vehicles: [] }]);
    expect(h.box.open).toBe(false);
  });

  it('plots on a second click within the double-click delay once something is picked', async () => {
    const h = await harness([member(1), member(2)]);
    h.click('   M1');
    h.t.now += DBL_CLICK_DELAY_FOR_MOVE_MENU - 1;
    h.click('   *M1*');
    expect(h.plans).toEqual([{ soldiers: [1], squads: [], vehicles: [] }]);
  });

  it('reports why a merc cannot be picked and ignores the heading', async () => {
    const h = await harness([member(1, { refusal: 'tooTired' })]);
    h.click('Move Mercs In Sector D13');
    h.click('   M1');
    expect(h.feedback).toEqual([{ refusal: 'tooTired' }]);
    expect(h.box.selection?.anythingSelected()).toBe(false);
  });

  it('closes on Cancel and on a click outside the box', async () => {
    const h = await harness([member(1)]);
    h.click('Cancel');
    expect(h.box.open).toBe(false);
    expect(h.closed()).toBe(1);
    h.box.show('D13', new MoveSelection([member(1)]));
    h.t.click(20, 20);
    expect(h.box.open).toBe(false);
    expect(h.closed()).toBe(2);
    expect(h.t.runtime.regions.regions.filter((r) => r.owner === 'test')).toEqual([]);
  });
});
