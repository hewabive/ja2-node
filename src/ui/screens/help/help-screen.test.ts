import { beforeEach, describe, expect, it } from 'vitest';
import { helpLayout, MemoryHelpStore, registerStubSkin, stubHelpText } from '../../../../tests/support/help.ts';
import { type TestRuntime, testRuntime } from '../../../../tests/support/ui-runtime.ts';
import type { UiKeyEvent } from '../../input/events.ts';
import type { LayoutModel } from '../../layout/model.ts';
import type { ScreenGeometry } from '../../services.ts';
import type { UiTextService } from '../../text/text-service.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import { HELP_SCREEN, HelpOverlay, helpBoxOrigin } from './help-overlay.ts';
import { mapHelpScreen } from './help-pages.ts';
import { HelpSystem } from './help-system.ts';

const WIDE: ScreenGeometry = { width: 960, height: 540, stdX: 160, stdY: 30 };
const SCREEN = { id: 'tactical' };

let model: LayoutModel;
let text: UiTextService;
let t: TestRuntime;
let pauses: boolean[];

beforeEach(async () => {
  model ??= await helpLayout();
  text ??= await stubHelpText((table) => (table === 'gzHelpScreenText' ? 'Exit help screen' : null));
  pauses = [];
  t = await testRuntime(undefined, { pauseGame: (paused) => pauses.push(paused) });
  await registerStubSkin(t);
});

function widgets(): readonly WidgetInfo[] {
  return t.runtime.describe();
}

function widget(id: string): WidgetInfo {
  const found = widgets().find((w) => w.id === id);
  if (!found) throw new Error(`no widget ${id}`);
  return found;
}

function key(name: string, kind: UiKeyEvent['kind'] = 'keyUp'): void {
  t.runtime.input({ kind, key: name, code: name, modifiers: 0 } as UiKeyEvent);
}

function clickWidget(id: string): void {
  const r = widget(id).rect;
  t.click(r.x + 2, r.y + 2);
  t.frame();
}

function open(kind: HelpOverlay['kind'], forced = false): HelpOverlay {
  const overlay = new HelpOverlay({ runtime: t.runtime, text, model, kind, forced, hideAll: false, closed: () => undefined });
  t.runtime.host.openModal(overlay);
  t.frame();
  return overlay;
}

describe('the help screen overlay (HelpScreen.cc, docs/28 §4.7)', () => {
  it('sits centred over the viewport, small without page buttons, and on the laptop monitor', () => {
    expect(helpBoxOrigin(model, 'tactical', { width: 640, height: 480, stdX: 0, stdY: 0 })).toEqual({ x: 114, y: 34 });
    expect(helpBoxOrigin(model, 'sectorInventory', { width: 640, height: 480, stdX: 0, stdY: 0 })).toEqual({ x: 160, y: 34 });
    expect(helpBoxOrigin(model, 'laptop', { width: 640, height: 480, stdX: 0, stdY: 0 })).toEqual({ x: 156, y: 81 });
    expect(helpBoxOrigin(model, 'map', WIDE)).toEqual({ x: 274, y: 64 });
    expect(helpBoxOrigin(model, 'laptop', WIDE)).toEqual({ x: 316, y: 111 });
  });

  it('shows the title, the reminder, the page buttons and, when it came up by itself, the check box', () => {
    open('tactical');
    expect(widget('helpTitle').text).toBe('Stub tactical screen');
    expect(widget('helpSubtitle').text).toContain('press H');
    expect(
      widgets()
        .filter((w) => w.id.startsWith('helpPage'))
        .map((w) => w.text),
    ).toEqual(['Start', 'Moving', 'Sight', 'Combat', 'Items', 'Keys']);
    expect(widget('helpPage0').state).toBe('pressed');
    expect(widget('helpPage0').rect).toMatchObject({ x: 114 + 11, y: 34 + 12 });
    expect(widget('helpPage1').rect.y).toBe(34 + 12 + 30);
    expect(widget('helpDontShowAgain').visible).toBe(true);
    expect(widget('helpExit').rect).toMatchObject({ x: 114 + 291 + 92, y: 34 + 9 });
    expect(pauses).toEqual([true]);
  });

  it('hides the check box and its line when forced, and has no page buttons on a small screen', () => {
    open('mapNoOneHired', true);
    expect(widgets().some((w) => w.id.startsWith('helpPage'))).toBe(false);
    expect(widget('helpDontShowAgain').visible).toBe(false);
    expect(widget('helpTitle').rect.x).toBe(160 + 15);
    expect(widget('helpExit').rect.x).toBe(160 + 291);
  });

  it('pages with the buttons and Left/Right on release, clamped to the pages, back to the first line each time', () => {
    const overlay = open('laptop');
    expect(overlay.page).toBe(0);
    key('ArrowLeft');
    expect(overlay.page).toBe(0);
    key('ArrowRight', 'keyDown');
    expect(overlay.page).toBe(0);
    key('ArrowRight');
    t.frame();
    expect(overlay.page).toBe(1);
    expect(widget('helpPage1').state).toBe('pressed');
    expect(widget('helpPage0').state).toBe('normal');
    clickWidget('helpPage7');
    expect(overlay.page).toBe(7);
    key('ArrowRight');
    expect(overlay.page).toBe(7);
  });

  it('scrolls a long page by line, by page, with the arrows and the wheel, and leaves a short page alone', () => {
    const overlay = open('tactical');
    expect(overlay.totalLines).toBeGreaterThan(overlay.visibleLines);
    expect(widget('helpScrollUp').enabled).toBe(true);
    key('ArrowDown');
    expect(overlay.top).toBe(1);
    key('ArrowDown', 'keyRepeat');
    expect(overlay.top).toBe(2);
    key('ArrowDown', 'keyDown');
    expect(overlay.top).toBe(2);
    key('PageDown');
    expect(overlay.top).toBe(Math.min(2 + overlay.visibleLines - 1, overlay.totalLines - overlay.visibleLines));
    key('PageUp');
    key('ArrowUp');
    expect(overlay.top).toBe(0);
    const down = widget('helpScrollDown').rect;
    t.down(down.x + 2, down.y + 2);
    t.frame();
    t.up(down.x + 2, down.y + 2);
    expect(overlay.top).toBe(1);
    const area = widgets().find((w) => w.id === 'helpScrollBox')?.rect;
    expect(area).toBeDefined();
    if (area) {
      t.move(area.x + 5, area.y + 100);
      t.runtime.input({ kind: 'wheel', x: area.x + 5, y: area.y + 100, button: 0, buttons: 0, wheel: 1, modifiers: 0 });
      expect(overlay.top).toBe(4);
      t.runtime.input({ kind: 'wheel', x: area.x + 5, y: area.y + 100, button: 0, buttons: 0, wheel: -1, modifiers: 0 });
      expect(overlay.top).toBe(1);
    }
    clickWidget('helpPage3');
    expect(overlay.top).toBe(0);
    expect(widget('helpScrollUp').enabled).toBe(false);
  });

  it('closes on Escape released or the exit button and unpauses the game', () => {
    let closed: boolean | null | undefined;
    const overlay = new HelpOverlay({
      runtime: t.runtime,
      text,
      model,
      kind: 'map',
      forced: false,
      hideAll: false,
      closed: (hide) => {
        closed = hide;
      },
    });
    t.runtime.host.openModal(overlay);
    t.frame();
    clickWidget('helpDontShowAgain');
    expect(overlay.dontShowAgain).toBe(true);
    key('Escape', 'keyDown');
    expect(t.runtime.host.modal?.id).toBe(HELP_SCREEN);
    key('Escape');
    expect(t.runtime.host.modal).toBeNull();
    expect(closed).toBe(true);
    expect(pauses).toEqual([true, false]);
    const forced = open('map', true);
    clickWidget('helpExit');
    expect(t.runtime.host.modal).toBeNull();
    expect(forced.forced).toBe(true);
  });
});

describe('when a help screen comes up (ShouldTheHelpScreenComeUp)', () => {
  function system(store: MemoryHelpStore | null): HelpSystem {
    return new HelpSystem({ runtime: t.runtime, text, model, store: () => store });
  }

  it('comes up by itself on the third frame of a screen whose help was not seen, once per campaign', () => {
    const store = new MemoryHelpStore();
    const help = system(store);
    help.frame({ screen: SCREEN, kind: 'tactical', blocked: false });
    help.frame({ screen: SCREEN, kind: 'tactical', blocked: false });
    expect(help.overlay).toBeNull();
    help.frame({ screen: SCREEN, kind: 'tactical', blocked: false });
    expect(help.overlay?.kind).toBe('tactical');
    expect(help.overlay?.forced).toBe(false);
    expect(store.seen(help.bit('tactical'))).toBe(true);
    help.overlay?.close();
    for (let i = 0; i < 5; i++) help.frame({ screen: SCREEN, kind: 'tactical', blocked: false });
    expect(help.overlay).toBeNull();
    expect(store.hiddenChanges).toEqual([false]);
  });

  it('waits while blocked, restarts the count on a new screen and never comes up when hidden or without a campaign', () => {
    const store = new MemoryHelpStore();
    const help = system(store);
    help.frame({ screen: SCREEN, kind: 'map', blocked: false });
    help.frame({ screen: SCREEN, kind: 'map', blocked: true });
    help.frame({ screen: { id: 'map' }, kind: 'map', blocked: false });
    expect(help.delay).toBe(1);
    expect(help.overlay).toBeNull();
    store.hiddenFlag = true;
    for (let i = 0; i < 5; i++) help.frame({ screen: SCREEN, kind: 'map', blocked: false });
    expect(help.overlay).toBeNull();
    const none = system(null);
    for (let i = 0; i < 5; i++) none.frame({ screen: SCREEN, kind: 'laptop', blocked: false });
    expect(none.overlay).toBeNull();
  });

  it('comes up at once when forced, marks the screen seen and leaves the hide flag alone', () => {
    const store = new MemoryHelpStore();
    const help = system(store);
    help.force('laptop');
    expect(help.overlay?.forced).toBe(true);
    expect(store.seen(help.bit('laptop'))).toBe(true);
    help.overlay?.close();
    expect(store.hiddenChanges).toEqual([]);
  });

  it('hides every help screen when the box was checked', () => {
    const store = new MemoryHelpStore();
    const help = system(store);
    for (let i = 0; i < 3; i++) help.frame({ screen: SCREEN, kind: 'sectorInventory', blocked: false });
    t.frame();
    clickWidget('helpDontShowAgain');
    key('Escape');
    expect(store.hiddenChanges).toEqual([true]);
  });

  it('picks the map screen’s help from the sector inventory, the hired team and the start of the game', () => {
    expect(mapHelpScreen({ sectorInventoryOpen: true, anyMercsHired: false, gameJustStarted: true })).toBe('sectorInventory');
    expect(mapHelpScreen({ sectorInventoryOpen: false, anyMercsHired: false, gameJustStarted: true })).toBe('mapNoOneHired');
    expect(mapHelpScreen({ sectorInventoryOpen: false, anyMercsHired: true, gameJustStarted: true })).toBe('mapNotInArulco');
    expect(mapHelpScreen({ sectorInventoryOpen: false, anyMercsHired: true, gameJustStarted: false })).toBe('map');
  });
});
