import { beforeEach, describe, expect, it } from 'vitest';
import { type TestRuntime, testRuntime, uniformImage } from '../../../tests/support/ui-runtime.ts';
import { type DrawList, type FillItem, type ImageItem, rgb } from '../draw-list.ts';
import type { Screen } from '../screen.ts';
import { FontName } from '../text/fonts.ts';
import { DropDown, DropDownView, NO_SELECTION } from './drop-down.ts';
import { FrameAnimator } from './frame-animator.ts';

const ENTRIES = 17;
const VISIBLE = 10;
const BORDER = 'interface/test-border.sti';
const ARROWS = 'laptop/test-arrows.sti';
const LABELS = Array.from({ length: ENTRIES }, (_, i) => `City ${i}`);
const GOLD = rgb(200, 169, 87);

function cities(): DropDown {
  return new DropDown({ entries: ENTRIES, visible: VISIBLE, selectOnHover: true });
}

describe('the drop-down model', () => {
  it('selects on hover, closes on a choice and scrolls the top with the arrows', () => {
    const d = cities();
    expect(d.selected).toBe(NO_SELECTION);
    d.toggle();
    d.hover(3);
    expect(d.selected).toBe(3);
    d.choose(4);
    expect([d.selected, d.open]).toEqual([4, false]);
    for (let k = 0; k < 20; k++) d.stepDown();
    expect([d.selected, d.top]).toEqual([16, 7]);
    for (let k = 0; k < 20; k++) d.stepUp();
    expect([d.selected, d.top]).toEqual([0, 0]);
  });

  it('steps toward a scroll-area entry one at a time and jumps there on a drag', () => {
    const d = cities();
    d.stepToward(12);
    expect(d.selected).toBe(0);
    d.dragTo(12);
    expect([d.selected, d.top]).toEqual([12, 3]);
    d.stepToward(0);
    expect(d.selected).toBe(11);
    d.dragTo(1);
    expect([d.selected, d.top]).toEqual([1, 1]);
  });

  it('snaps a top past the end back as the original does', () => {
    const d = cities();
    d.top = 8;
    d.clampTop();
    expect(d.top).toBe(6);
  });

  it('counts selection changes and keeps nothing selected on the up arrow', () => {
    const d = cities();
    d.stepUp();
    expect([d.selected, d.changes]).toEqual([NO_SELECTION, 0]);
    d.stepDown();
    expect([d.selected, d.changes]).toEqual([0, 1]);
    d.reset();
    expect([d.selected, d.top, d.open]).toEqual([NO_SELECTION, 0, false]);
  });
});

describe('the drop-down view', () => {
  let t: TestRuntime;
  let view: DropDownView;
  let model: DropDown;
  let changes: number[];

  beforeEach(async () => {
    t = await testRuntime();
    t.images.set(BORDER, uniformImage(8, 10, 10));
    t.images.set(ARROWS, uniformImage(2, 18, 20));
    model = cities();
    changes = [];
    view = new DropDownView({
      model,
      geometry: {
        x: 393,
        y: 169,
        width: 182,
        height: 139,
        rowGap: 2,
        textX: 6,
        textY: 5,
        rowTop: 4,
        rowBottom: 7,
        rowRightInset: 6,
        highlightInset: 4,
        highlightBottom: 6,
      },
      look: {
        font: t.fonts.get(FontName.FONT12ARIAL),
        border: BORDER,
        background: rgb(0, 0, 0),
        color: 145,
        selectedColor: 2,
        selectedFill: GOLD,
      },
      scroll: {
        width: 22,
        arrows: ARROWS,
        arrowWidth: 18,
        arrowHeight: 20,
        upY: 174,
        downY: 284,
        thumb: rgb(186, 165, 68),
        thumbLight: rgb(235, 222, 171),
        thumbDark: rgb(65, 49, 6),
      },
      regions: t.runtime.regions,
      closeArea: { x1: 111, y1: 46, x2: 613, y2: 446 },
      onChange: (selected) => changes.push(selected),
    });
    const screen: Screen = {
      id: 'dropDownTest',
      enter: () => undefined,
      exit: () => undefined,
      update: () => view.sync(),
      input: () => false,
      render: (list: DrawList) => view.render(list, LABELS),
    };
    t.runtime.host.push(screen);
  });

  function rowCentre(row: number): { x: number; y: number } {
    const info = view.describe(LABELS)[row];
    if (!info) throw new Error(`no row ${row}`);
    return { x: info.rect.x + Math.floor(info.rect.width / 2), y: info.rect.y + Math.floor(info.rect.height / 2) };
  }

  it('defines its regions only while open and draws the border, the rows and the gold selection', () => {
    t.frame();
    expect(view.describe(LABELS)).toEqual([]);
    model.toggle();
    t.frame();
    expect(view.describe(LABELS)).toHaveLength(VISIBLE);
    const images = t.list.items.filter((i): i is ImageItem => i.kind === 'image');
    expect(images.filter((i) => i.asset === BORDER).length).toBeGreaterThan(8);
    expect(images.filter((i) => i.asset === ARROWS).map((i) => i.frame)).toEqual([1, 0]);
    const fills = t.list.items.filter((i): i is FillItem => i.kind === 'fill');
    expect(fills.some((f) => f.color === GOLD)).toBe(true);
  });

  it('selects the hovered row, chooses on a click and closes from the area around it', () => {
    model.toggle();
    t.frame();
    const third = rowCentre(2);
    t.move(third.x, third.y);
    t.frame();
    expect(model.selected).toBe(2);
    const fifth = rowCentre(4);
    t.move(fifth.x, fifth.y);
    t.click(fifth.x, fifth.y);
    t.frame();
    expect([model.selected, model.open]).toEqual([4, false]);
    expect(changes).toEqual([2, 4]);
    expect(view.describe(LABELS)).toEqual([]);
    model.toggle();
    t.frame();
    t.move(150, 400);
    t.click(150, 400);
    t.frame();
    expect(model.open).toBe(false);
  });

  it('steps the selection with the down arrow', () => {
    model.toggle();
    t.frame();
    t.move(393 + 182 + 5, 284 + 5);
    t.click(393 + 182 + 5, 284 + 5);
    t.frame();
    expect(model.selected).toBe(0);
  });
});

describe('the drop-down as the florist list', () => {
  it('shows every destination without a scroll bar, selects on hover and closes on a pick', async () => {
    const t = await testRuntime();
    t.images.set(BORDER, uniformImage(8, 10, 10));
    const model = new DropDown({ entries: ENTRIES, visible: ENTRIES, selectOnHover: true });
    const view = new DropDownView({
      model,
      geometry: {
        x: 310,
        y: 130,
        width: 150,
        height: 0,
        rowGap: 2,
        textX: 6,
        textY: 3,
        rowTop: 4,
        rowBottom: 0,
        rowRightInset: 0,
        highlightInset: 4,
        highlightBottom: 6,
      },
      look: {
        font: t.fonts.get(FontName.FONT12ARIAL),
        border: BORDER,
        background: rgb(0, 0, 0),
        color: 145,
        selectedColor: 2,
        selectedFill: GOLD,
      },
      scroll: null,
      regions: t.runtime.regions,
      closeArea: { x1: 111, y1: 46, x2: 613, y2: 446 },
      onChange: () => undefined,
    });
    t.runtime.host.push({
      id: 'floristListTest',
      enter: () => undefined,
      exit: () => undefined,
      update: () => view.sync(),
      input: () => false,
      render: (list: DrawList) => view.render(list, LABELS),
    });
    model.toggle();
    t.frame();
    const rows = view.describe(LABELS);
    expect(rows).toHaveLength(ENTRIES);
    expect(t.list.items.some((i) => i.kind === 'image' && i.asset === ARROWS)).toBe(false);
    const last = rows[ENTRIES - 1];
    if (!last) throw new Error('no last row');
    const at = { x: last.rect.x + 5, y: last.rect.y + Math.floor(last.rect.height / 2) };
    t.move(at.x, at.y);
    t.frame();
    expect(model.selected).toBe(ENTRIES - 1);
    t.click(at.x, at.y);
    t.frame();
    expect([model.selected, model.open]).toEqual([ENTRIES - 1, false]);
  });
});

describe('the frame animator', () => {
  it('advances one frame per elapsed delay and wraps', () => {
    const a = new FrameAnimator(5, 150, 0, 1);
    expect(a.update(100)).toBe(1);
    expect(a.update(151)).toBe(2);
    expect(a.update(200)).toBe(2);
    a.reset(1000, 4);
    expect(a.update(1151)).toBe(0);
  });
});
