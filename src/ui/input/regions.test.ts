import { beforeAll, describe, expect, it } from 'vitest';
import { stubFontSet } from '../../../tests/support/ui-fonts.ts';
import { DrawList } from '../draw-list.ts';
import type { FontSet } from '../text/fonts.ts';
import { KeyModifier, MouseButton, type UiKeyEvent, type UiPointerEvent } from './events.ts';
import { ANY_MODIFIERS, findHotkey, type HotkeyTable } from './hotkeys.ts';
import { MouseReason, NO_CURSOR, Priority } from './mouse.ts';
import { type MouseRegion, RegionDispatcher } from './regions.ts';
import { FastHelp, tooltipBox } from './tooltips.ts';

type Log = string[];

function pointer(kind: UiPointerEvent['kind'], x: number, y: number, button: number = MouseButton.LEFT, wheel = 0): UiPointerEvent {
  return { kind, x, y, button, buttons: 0, wheel, modifiers: 0 };
}

function reasons(reason: number): string {
  return Object.entries(MouseReason)
    .filter(([name, bit]) => name !== 'NONE' && (reason & bit) !== 0)
    .map(([name]) => name)
    .join('|');
}

function logged(
  system: RegionDispatcher,
  log: Log,
  name: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  priority: number,
  cursor = NO_CURSOR,
) {
  return system.define({
    x1,
    y1,
    x2,
    y2,
    priority,
    cursor,
    id: name,
    onMove: (_r, reason) => log.push(`${name} move ${reasons(reason)}`),
    onButton: (_r, reason) => log.push(`${name} button ${reasons(reason)}`),
  });
}

describe('the region dispatcher', () => {
  it('lets the higher priority win and, among equal priorities, the newest', () => {
    const system = new RegionDispatcher();
    const log: Log = [];
    logged(system, log, 'back', 0, 0, 100, 100, Priority.HIGHEST);
    logged(system, log, 'low', 0, 0, 100, 100, Priority.LOW);
    logged(system, log, 'button', 10, 10, 20, 20, Priority.HIGHEST);
    system.pointer(pointer('pointerDown', 15, 15), 0);
    expect(log).toEqual(['button move GAIN_MOUSE', 'button move MOVE', 'button button LBUTTON_DWN']);
    expect(system.regions.map((r) => r.id)).toEqual(['button', 'back', 'low']);
  });

  it('includes the bottom-right edge in the hit test', () => {
    const system = new RegionDispatcher();
    const log: Log = [];
    logged(system, log, 'a', 10, 10, 20, 20, Priority.NORMAL);
    system.pointer(pointer('pointerMove', 20, 20), 0);
    system.pointer(pointer('pointerMove', 21, 20), 10);
    expect(log).toEqual(['a move GAIN_MOUSE', 'a move MOVE', 'a move LOST_MOUSE']);
  });

  it('sends MOVE, GAIN and LOST to the top region only and skips disabled regions', () => {
    const system = new RegionDispatcher();
    const log: Log = [];
    const top = logged(system, log, 'top', 0, 0, 50, 50, Priority.HIGH);
    logged(system, log, 'under', 0, 0, 50, 50, Priority.NORMAL);
    system.pointer(pointer('pointerMove', 5, 5), 0);
    top.disable();
    system.frame(16);
    expect(log).toEqual(['top move GAIN_MOUSE', 'top move MOVE', 'under move GAIN_MOUSE', 'under move MOVE']);
  });

  it('ORs simultaneous reasons into one call', () => {
    const system = new RegionDispatcher();
    const log: Log = [];
    logged(system, log, 'a', 0, 0, 50, 50, Priority.NORMAL);
    system.pointer(pointer('pointerMove', 5, 5), 0);
    system.pointer(pointer('wheel', 5, 5, -1, -1), 10);
    expect(log.at(-1)).toBe('a button WHEEL_UP');
  });

  it('locks button events to the pressed region and swallows a release over another region', () => {
    const system = new RegionDispatcher();
    const log: Log = [];
    logged(system, log, 'a', 0, 0, 10, 10, Priority.NORMAL);
    logged(system, log, 'b', 20, 0, 30, 10, Priority.NORMAL);
    system.pointer(pointer('pointerDown', 5, 5), 0);
    system.pointer(pointer('pointerMove', 25, 5), 10);
    system.pointer(pointer('pointerUp', 25, 5), 20);
    system.pointer(pointer('pointerDown', 25, 5), 30);
    expect(log).toEqual([
      'a move GAIN_MOUSE',
      'a move MOVE',
      'a button LBUTTON_DWN',
      'a move LOST_MOUSE',
      'b move GAIN_MOUSE',
      'b move MOVE',
      'b button LBUTTON_DWN',
    ]);
  });

  it('keeps the lock when the release falls where no region exists, swallowing the next click elsewhere', () => {
    const system = new RegionDispatcher();
    const log: Log = [];
    logged(system, log, 'a', 0, 0, 10, 10, Priority.NORMAL);
    logged(system, log, 'b', 20, 0, 30, 10, Priority.NORMAL);
    system.pointer(pointer('pointerDown', 5, 5), 0);
    system.pointer(pointer('pointerUp', 15, 5), 10);
    system.pointer(pointer('pointerDown', 25, 5), 20);
    system.pointer(pointer('pointerUp', 25, 5), 30);
    system.pointer(pointer('pointerDown', 25, 5), 40);
    expect(log.filter((l) => l.includes('button'))).toEqual(['a button LBUTTON_DWN', 'b button LBUTTON_DWN']);
  });

  it('adds a double click to the second down of down-up-down within 400 ms on the same region', () => {
    const system = new RegionDispatcher();
    const log: Log = [];
    logged(system, log, 'a', 0, 0, 10, 10, Priority.NORMAL);
    const click = (t: number) => {
      system.pointer(pointer('pointerDown', 5, 5), t);
      system.pointer(pointer('pointerUp', 5, 5), t + 50);
    };
    click(0);
    click(300);
    click(1000);
    click(1500);
    expect(log.filter((l) => l.includes('DWN'))).toEqual([
      'a button LBUTTON_DWN',
      'a button LBUTTON_DWN|LBUTTON_DOUBLECLICK',
      'a button LBUTTON_DWN',
      'a button LBUTTON_DWN',
    ]);
  });

  it('repeats a held button after 250 ms, then every 50 ms, from the injected clock', () => {
    const system = new RegionDispatcher();
    const log: Log = [];
    logged(system, log, 'a', 0, 0, 10, 10, Priority.NORMAL);
    system.pointer(pointer('pointerDown', 5, 5), 1000);
    for (const t of [1100, 1249, 1250, 1290, 1300, 1460]) system.frame(t);
    system.pointer(pointer('pointerUp', 5, 5), 1470);
    system.frame(1600);
    expect(log.filter((l) => l.includes('REPEAT')).length).toBe(3);
  });

  it('takes the cursor from the region, or from the next enabled region below that has one', () => {
    const system = new RegionDispatcher(0);
    const cursors: number[] = [];
    system.onCursor((c) => cursors.push(c));
    system.define({ x1: 0, y1: 0, x2: 100, y2: 100, priority: Priority.LOW, cursor: 7 });
    system.define({ x1: 0, y1: 0, x2: 100, y2: 100, priority: Priority.NORMAL, cursor: 9 });
    const top = system.define({ x1: 10, y1: 10, x2: 20, y2: 20, priority: Priority.HIGH, cursor: NO_CURSOR });
    system.pointer(pointer('pointerMove', 15, 15), 0);
    system.pointer(pointer('pointerMove', 50, 50), 10);
    top.changeCursor(3);
    system.pointer(pointer('pointerMove', 15, 15), 20);
    expect(cursors).toEqual([9, 9, 3]);
  });

  it('re-evaluates once per frame after the widgets change under a still pointer', () => {
    const system = new RegionDispatcher(0);
    const log: Log = [];
    system.pointer(pointer('pointerMove', 5, 5), 0);
    logged(system, log, 'new', 0, 0, 10, 10, Priority.NORMAL, 4);
    expect(log).toEqual([]);
    system.frame(16);
    expect(log).toEqual(['new move GAIN_MOUSE', 'new move MOVE']);
    expect(system.cursor).toBe(4);
  });

  it('survives callbacks that remove and define regions', () => {
    const system = new RegionDispatcher();
    const log: Log = [];
    let replacement: MouseRegion | null = null;
    const victim = system.define({
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 10,
      onButton: (r, reason) => {
        if (!(reason & MouseReason.LBUTTON_DWN)) return;
        r.remove();
        replacement = logged(system, log, 'replacement', 0, 0, 10, 10, Priority.NORMAL);
      },
      onMove: (_r, reason) => log.push(`victim move ${reasons(reason)}`),
    });
    system.pointer(pointer('pointerDown', 5, 5), 0);
    system.pointer(pointer('pointerUp', 5, 5), 10);
    expect(victim.exists).toBe(false);
    expect(replacement).not.toBeNull();
    expect(log).toEqual(['victim move GAIN_MOUSE', 'victim move MOVE', 'replacement move GAIN_MOUSE', 'replacement button LBUTTON_UP']);
  });
});

describe('fast help', () => {
  let fonts: FontSet;
  beforeAll(async () => {
    fonts = await stubFontSet();
  });

  it('appears after 600 ms of rest with no button down and resets on a click', () => {
    const system = new RegionDispatcher();
    const help = new FastHelp();
    const region = system.define({ x1: 100, y1: 100, x2: 160, y2: 120, onButton: () => undefined, onMove: () => undefined });
    region.setTooltip('Save the |game');
    const frame = (t: number) => {
      const list = new DrawList();
      system.frame(t);
      return { shown: help.render(list, system, t, fonts, 640, 480) !== null, list };
    };
    system.pointer(pointer('pointerMove', 120, 110), 0);
    frame(0);
    expect(frame(300).shown).toBe(false);
    expect(frame(599).shown).toBe(false);
    expect(frame(600).shown).toBe(false);
    const drawn = frame(616);
    expect(drawn.shown).toBe(true);
    expect(drawn.list.items.filter((i) => i.kind === 'shadow')).toHaveLength(2);
    expect(drawn.list.items.filter((i) => i.kind === 'rectangle')).toHaveLength(2);
    system.pointer(pointer('pointerDown', 120, 110), 620);
    expect(frame(700).shown).toBe(false);
    expect(frame(2000).shown).toBe(false);
    system.pointer(pointer('pointerUp', 120, 110), 2010);
    expect(frame(2100).shown).toBe(false);
    expect(frame(2700).shown).toBe(false);
    expect(frame(2716).shown).toBe(true);
  });

  it('places the box above the region, clamped to the screen', () => {
    const system = new RegionDispatcher();
    const tall = system.define({ x1: -20, y1: 200, x2: 100, y2: 300 });
    const short = system.define({ x1: 630, y1: 4, x2: 639, y2: 8 });
    const a = tooltipBox(tall, 'abc', fonts, 640, 480);
    const b = tooltipBox(short, 'a much longer tooltip text', fonts, 640, 480);
    expect(a.x).toBe(0);
    expect(a.y).toBe(200 + Math.trunc((-a.height * 3) / 4));
    expect(b.x).toBe(640 - b.width - 4);
    expect(b.y).toBe(0);
  });

  it('colours the tokens gold (bold), green and red, one character each', () => {
    const system = new RegionDispatcher();
    const help = new FastHelp();
    const region = system.define({ x1: 0, y1: 100, x2: 50, y2: 120, onButton: () => undefined });
    region.setTooltip('a|b^c~d');
    system.pointer(pointer('pointerMove', 10, 110), 0);
    help.render(new DrawList(), system, 0, fonts, 640, 480);
    help.render(new DrawList(), system, 700, fonts, 640, 480);
    const list = new DrawList();
    help.render(list, system, 716, fonts, 640, 480);
    const colors = list.items.flatMap((i) => (i.kind === 'glyphs' ? [[i.font, i.foreground]] : []));
    expect(colors).toEqual([
      ['font10arial', 130],
      ['font10arialbold', 146],
      ['font10arial', 184],
      ['font10arial', 162],
    ]);
  });
});

describe('hotkey tables', () => {
  const key = (kind: UiKeyEvent['kind'], k: string, modifiers = 0): UiKeyEvent => ({ kind, key: k, code: '', modifiers });
  const table: HotkeyTable = [
    { key: 'escape', on: 'up', action: 'cancel' },
    { key: 'l', mods: KeyModifier.CTRL, action: 'load' },
    { key: 'x', mods: ANY_MODIFIERS, action: 'anyX' },
    { key: 'a', on: ['down', 'repeat'], action: 'next', when: 'canNext' },
  ];

  it('match the key, the event phase and the exact modifier mask or any', () => {
    expect(findHotkey(table, key('keyDown', 'escape'))).toBeNull();
    expect(findHotkey(table, key('keyUp', 'escape'))?.action).toBe('cancel');
    expect(findHotkey(table, key('keyDown', 'l'))).toBeNull();
    expect(findHotkey(table, key('keyDown', 'l', KeyModifier.CTRL | KeyModifier.SHIFT))).toBeNull();
    expect(findHotkey(table, key('keyDown', 'l', KeyModifier.CTRL))?.action).toBe('load');
    expect(findHotkey(table, key('keyDown', 'x', KeyModifier.ALT))?.action).toBe('anyX');
  });

  it('honour repeats and conditions', () => {
    expect(findHotkey(table, key('keyRepeat', 'a'), () => true)?.action).toBe('next');
    expect(findHotkey(table, key('keyRepeat', 'a'), () => false)).toBeNull();
  });
});
