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

  it('toggles the diagnostics overlay with Ctrl+F before the screens see the key and draws it under the cursor', () => {
    const keys: string[] = [];
    t.runtime.host.push({
      ...contentScreen(false),
      input: (event) => {
        if (event.kind === 'keyDown') keys.push(event.key);
        return true;
      },
    });
    t.move(300, 300);
    const ctrlF = { kind: 'keyDown', key: 'f', code: 'KeyF', modifiers: KeyModifier.CTRL } as const;
    expect(t.runtime.input(ctrlF)).toBe(true);
    expect(t.runtime.diagnostics.enabled).toBe(true);
    t.runtime.diagnostics.show([
      { text: '60 FPS', alarm: false },
      { text: 'playback lag 8000 ms', alarm: true },
    ]);
    t.frame();
    const runs = t.list.items.filter((i) => i.kind === 'glyphs');
    expect(runs.map((r) => ({ x: r.glyphs[0]?.x, y: r.glyphs[0]?.y, foreground: r.foreground }))).toEqual([
      { x: 11, y: 23, foreground: 208 },
      { x: 11, y: 35, foreground: 162 },
    ]);
    expect(t.list.items.at(-2)).toMatchObject({ kind: 'image', asset: 'cursors/cursor.sti' });
    t.runtime.input({ kind: 'keyDown', key: 'f', code: 'KeyF', modifiers: 0 });
    t.runtime.input(ctrlF);
    expect(t.runtime.diagnostics.enabled).toBe(false);
    t.frame();
    expect(t.list.items.some((i) => i.kind === 'glyphs')).toBe(false);
    expect(keys).toEqual(['f']);
  });

  it('draws the cell the top screen points at above the sampled lines, every frame', () => {
    let gridNo: number | null = 12345;
    t.runtime.host.push({ ...contentScreen(false), pointedCell: () => ({ gridNo, level: 0, map: 'maps/a9.dat' }) });
    t.runtime.input({ kind: 'keyDown', key: 'f', code: 'KeyF', modifiers: KeyModifier.CTRL });
    t.runtime.diagnostics.show([{ text: '60 FPS', alarm: false }]);
    t.frame();
    const rows = () => t.list.items.filter((i) => i.kind === 'glyphs').map((r) => ({ y: r.glyphs[0]?.y, glyphs: r.glyphs.length }));
    expect(rows()).toEqual([
      { y: 23, glyphs: 'cell 12345 (x 25, y 77), level 0, maps/a9.dat'.length },
      { y: 35, glyphs: '60 FPS'.length },
    ]);
    gridNo = null;
    t.frame();
    expect(rows()[0]).toEqual({ y: 23, glyphs: 'cell: none'.length });
    t.runtime.host.openModal(new Fade(t.runtime, { direction: 'out' }));
    t.frame();
    expect(rows()).toEqual([{ y: 23, glyphs: '60 FPS'.length }]);
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
