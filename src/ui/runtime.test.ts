import { beforeEach, describe, expect, it } from 'vitest';
import { type TestRuntime, testRuntime, uniformImage } from '../../tests/support/ui-runtime.ts';
import { encodeEdtRecords } from '../content/formats/edt.ts';
import { EdtLayouts } from '../content/text/edt-layouts.ts';
import type { DrawList } from './draw-list.ts';
import { KeyModifier } from './input/events.ts';
import type { Screen } from './screen.ts';
import { EdtTextCache } from './text/edt-text.ts';
import { Fade } from './widgets/fade.ts';

function contentScreen(tooltips: boolean): Screen {
  return {
    id: 'content',
    rendersTooltips: tooltips,
    enter: () => undefined,
    exit: () => undefined,
    update: () => undefined,
    input: () => false,
    render: (list: DrawList) => list.fill(0, 0, 640, 480, 0x101010),
  };
}

describe('the ui runtime', () => {
  let t: TestRuntime;

  beforeEach(async () => {
    t = await testRuntime();
    t.images.set('cursors/cursor.sti', uniformImage(1, 12, 18));
  });

  it('draws the screen, then the fast help, then the software cursor last', () => {
    t.runtime.host.push(contentScreen(true));
    const region = t.runtime.regions.define({
      x1: 100,
      y1: 100,
      x2: 200,
      y2: 140,
      cursor: 0,
      onButton: () => undefined,
      onMove: () => undefined,
    });
    region.setTooltip('help');
    t.move(150, 120);
    for (let i = 0; i < 45; i++) t.frame();
    const kinds = t.list.items.map((i) => i.kind);
    expect(kinds[0]).toBe('fill');
    expect(kinds.indexOf('shadow')).toBeGreaterThan(0);
    expect(t.list.items.at(-2)).toMatchObject({ kind: 'image', asset: 'cursors/cursor.sti', x: 150, y: 120 });
    expect(t.runtime.cursorReport()).toMatchObject({ name: 'CURSOR_NORMAL', x: 150, y: 120, visible: true });
  });

  it('skips the fast help of screens that do not draw it and hides the cursor outside the canvas or under a fade', () => {
    t.runtime.host.push(contentScreen(false));
    const region = t.runtime.regions.define({ x1: 100, y1: 100, x2: 200, y2: 140, onButton: () => undefined, onMove: () => undefined });
    region.setTooltip('help');
    t.move(150, 120);
    for (let i = 0; i < 45; i++) t.frame();
    expect(t.list.items.some((i) => i.kind === 'shadow')).toBe(false);
    t.runtime.pointerLeft();
    t.frame();
    expect(t.runtime.cursorReport().visible).toBe(false);
    t.move(150, 121);
    t.runtime.host.openModal(new Fade(t.runtime, { direction: 'out' }));
    t.frame();
    expect(t.runtime.cursorReport().visible).toBe(false);
  });

  it('keeps the held keys and modifiers for polling', () => {
    t.runtime.input({ kind: 'keyDown', key: 'Shift', code: 'ShiftLeft', modifiers: KeyModifier.SHIFT });
    t.runtime.input({ kind: 'keyDown', key: 'a', code: 'KeyA', modifiers: KeyModifier.SHIFT });
    expect([t.runtime.isKeyDown('a'), t.runtime.modifiers]).toEqual([true, KeyModifier.SHIFT]);
    t.runtime.input({ kind: 'keyUp', key: 'a', code: 'KeyA', modifiers: 0 });
    expect([t.runtime.isKeyDown('a'), t.runtime.modifiers]).toEqual([false, 0]);
  });
});

describe('EDT text', () => {
  it('reads the fields of a record by their flattened index', () => {
    const layouts = new EdtLayouts([{ path: 'binarydata/test.edt', columns: [8, 4] }]);
    const cache = new EdtTextCache(layouts, 'english');
    cache.add(
      'binarydata/test.edt',
      encodeEdtRecords(
        [
          ['first', 'a'],
          ['second', 'b'],
        ],
        [8, 4],
      ),
    );
    expect([cache.field('binarydata/test.edt', 0), cache.field('binarydata/test.edt', 3), cache.field('binarydata/test.edt', 4)]).toEqual([
      'first',
      'b',
      null,
    ]);
    expect(cache.field('binarydata/other.edt', 0)).toBeNull();
  });
});
