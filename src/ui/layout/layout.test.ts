import { beforeEach, describe, expect, it } from 'vitest';
import { planStubSkin, readOriginalLayouts } from '../../../stubs/ui/skin.ts';
import { projectLayoutLoader, type TestRuntime, testRuntime } from '../../../tests/support/ui-runtime.ts';
import type { StaticImageCatalog } from '../assets.ts';
import type { UiKeyEvent } from '../input/events.ts';
import { galleryController, galleryScreen } from '../screens/gallery.ts';
import { NO_TEXT } from '../text/text-service.ts';
import { messageBoxLabels } from '../widgets/message-box.ts';
import type { WidgetInfo } from '../widgets/widget-info.ts';
import { ConstantScope } from './constants.ts';
import type { LayoutScreen } from './layout-screen.ts';
import type { LayoutModel } from './model.ts';
import { LayoutSchemaError, validateLayout } from './schema.ts';
import { messageBoxStyles } from './styles.ts';

async function stubImages(target: StaticImageCatalog): Promise<void> {
  for (const plan of planStubSkin(await readOriginalLayouts()).values()) {
    target.set(plan.path, {
      kind: 'indexed',
      animatedFrames: plan.animated,
      frames: plan.frames.map((f) => ({ width: f.width, height: f.height, offsetX: 0, offsetY: 0 })),
    });
  }
}

describe('constants and the schema', () => {
  it('evaluate names from the layout tables first, priorities with a prefix, and $i', async () => {
    const env = await projectLayoutLoader().environment(['Options_Screen']);
    const scope = new ConstantScope(env.tables, ['Options_Screen']);
    expect(scope.number('OPT_TOGGLE_BOX_START_Y + $i * OPT_GAP_BETWEEN_TOGGLE_BOXES', { i: 2 })).toBe(89 + 2 * 27);
    expect(scope.number('HIGH+10', {}, 'MSYS_PRIORITY_')).toBe(73);
    expect(scope.number('(OPT_SLIDER_BAR_SIZE - 1) / 2')).toBe(128);
    expect(() => scope.number('MSGBOX_BUTTON_WIDTH')).toThrow(/unknown numeric constant/);
  });

  it('reject unknown widgets, properties and frames', () => {
    expect(() => validateLayout({ screen: 'x', frame: 'nowhere' })).toThrow(LayoutSchemaError);
    expect(() => validateLayout({ screen: 'x', frame: 'std640', widgets: [{ type: 'blob' }] })).toThrow(/unknown widget type/);
    expect(() => validateLayout({ screen: 'x', frame: 'std640', widgets: [{ type: 'image', asset: 'a', size: 3 }] })).toThrow(
      /no property size/,
    );
    expect(
      validateLayout({ screen: 'x', frame: 'screen', widgets: [{ type: 'fill', x: 'A+1', width: 3, height: 4, color: '#102030' }] }).screen,
    ).toBe('x');
  });
});

describe('the gallery layout', () => {
  let t: TestRuntime;
  let model: LayoutModel;
  let screen: LayoutScreen;

  const widget = (id: string): WidgetInfo => {
    const found = screen.describe().find((w) => w.id === id) ?? t.runtime.describe().find((w) => w.id === id);
    if (!found) throw new Error(`no widget ${id}`);
    return found;
  };
  const clickWidget = (id: string) => {
    const { rect } = widget(id);
    const x = rect.x + Math.floor(rect.width / 2);
    const y = rect.y + Math.floor(rect.height / 2);
    t.move(x, y);
    t.frame();
    t.click(x, y);
    t.frame();
  };
  const status = () => widget('status').text;
  const key = (kind: UiKeyEvent['kind'], k: string) => t.runtime.input({ kind, key: k, code: '', modifiers: 0 });

  beforeEach(async () => {
    t = await testRuntime();
    await stubImages(t.images);
    const loader = projectLayoutLoader();
    model = await loader.load('original', 'gallery');
    const messageBox = await loader.load('original', 'message-box');
    const styles = messageBoxStyles(messageBox);
    screen = galleryScreen({
      runtime: t.runtime,
      model,
      text: NO_TEXT,
      messageBoxStyle: (i) => styles[i] ?? (styles[0] as (typeof styles)[number]),
      messageBoxLabels: messageBoxLabels(NO_TEXT),
    });
    t.runtime.host.push(screen);
    t.frame();
  });

  it('builds every widget with an id at its layout position', () => {
    expect(widget('push').rect).toMatchObject({ x: 8, y: 46, width: 61, height: 20 });
    expect(widget('choice2').rect).toMatchObject({ x: 8, y: 74 + 44 });
    expect(widget('volume').kind).toBe('slider');
    expect(widget('menu').visible).toBe(false);
    expect(screen.describe().filter((w) => w.kind.startsWith('button')).length).toBeGreaterThan(10);
  });

  it('turns clicks into controller actions and bindings into widget state', () => {
    clickWidget('push');
    expect(status()).toBe('push 1');
    clickWidget('toggle');
    expect(widget('toggle').state).toBe(true);
    clickWidget('choice1');
    expect(status()).toBe('choice 1');
    expect([widget('choice0').state, widget('choice1').state]).toEqual([false, true]);
    clickWidget('disabledDefault');
    expect(status()).toBe('choice 1');
  });

  it('opens the popup menu by its hotkey on release and selects an unshaded line', () => {
    key('keyDown', 'm');
    t.frame();
    expect(widget('menu').visible).toBe(false);
    key('keyUp', 'm');
    t.frame();
    expect(widget('menu').visible).toBe(true);
    clickWidget('menu.line2');
    expect(widget('menu').visible).toBe(true);
    clickWidget('menu.line1');
    expect(status()).toBe('menu Patient');
    expect(widget('menu').visible).toBe(false);
  });

  it('opens a message box from a modal widget and reports the result', () => {
    clickWidget('box0');
    expect(t.runtime.host.modal?.id).toBe('boxYesNo');
    clickWidget('boxYesNo.yes');
    expect(status()).toBe('box result 2');
    expect(t.runtime.host.modal).toBeNull();
  });

  it('edits the text field and drags the slider through the controller', () => {
    t.runtime.input({ kind: 'text', text: 'Bob' });
    t.frame();
    expect(status()).toBe('name Bob');
    const slider = widget('volume').rect;
    t.move(slider.x + 5, slider.y);
    t.frame();
    t.down(slider.x + 5, slider.y);
    t.frame();
    expect(status()).toBe('volume 127');
  });

  it('shows the fast help of a hovered button after 600 ms', () => {
    const { rect } = widget('push');
    t.move(rect.x + 5, rect.y + 5);
    t.frame();
    for (let i = 0; i < 40; i++) t.frame();
    expect(t.list.items.filter((i) => i.kind === 'shadow').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the controller contract', () => {
    const controller = galleryController(t.runtime);
    expect(Object.keys(controller.contract.bindings)).toContain('status');
  });
});
