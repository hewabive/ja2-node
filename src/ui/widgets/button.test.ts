import { beforeEach, describe, expect, it } from 'vitest';
import { type TestRuntime, testRuntime, uniformImage } from '../../../tests/support/ui-runtime.ts';
import { DrawList, type GlyphRunItem, type ImageItem } from '../draw-list.ts';
import { MouseReason, Priority } from '../input/mouse.ts';
import type { Screen } from '../screen.ts';
import { FontName } from '../text/fonts.ts';
import { type Button, buttonImage, checkBoxImage, NO_IMAGE, twoFrameImage } from './button.ts';
import { BUTTON_SOUND_VOLUME, ButtonSoundScheme, DISABLED_BUTTON_SOUND, UiScreenKind } from './button-sounds.ts';

const ART = 'interface/test-buttons.sti';
const CHECK = 'interface/test-check.sti';

function screen(kind: UiScreenKind): Screen {
  return {
    id: 'test',
    soundScreen: kind,
    enter: () => undefined,
    exit: () => undefined,
    update: () => undefined,
    input: () => false,
    render: () => undefined,
  };
}

function drawn(t: TestRuntime, button: Button): DrawList {
  const list = new DrawList();
  t.runtime.buttons.draw(list, button);
  return list;
}

function frameOf(list: DrawList): number | undefined {
  return list.items.find((i): i is ImageItem => i.kind === 'image')?.frame;
}

describe('buttons', () => {
  let t: TestRuntime;
  let clicks: string[];

  beforeEach(async () => {
    t = await testRuntime();
    t.images.set(ART, {
      kind: 'indexed',
      animatedFrames: 0,
      frames: [0, 1, 2, 3, 4].map((i) => ({ width: 60, height: 20, offsetX: i === 4 ? 2 : 0, offsetY: 0 })),
    });
    t.images.set(CHECK, uniformImage(4, 16, 16));
    t.runtime.host.push(screen(UiScreenKind.OPTIONS));
    clicks = [];
  });

  const quick = (extra: Partial<Parameters<TestRuntime['runtime']['buttons']['create']>[0]> = {}) =>
    t.runtime.buttons.create({
      x: 100,
      y: 100,
      image: buttonImage(ART, 0, 1, 2, 3, 4),
      priority: Priority.HIGH,
      onClick: (_b, reason) => clicks.push(reason & MouseReason.LBUTTON_UP ? 'up' : reason & MouseReason.LBUTTON_DWN ? 'down' : 'other'),
      ...extra,
    });

  it('takes the largest offset + size of the frames it uses as its size', () => {
    expect(t.runtime.buttons.imageSize(buttonImage(ART, NO_IMAGE, 1, NO_IMAGE, 3, 4))).toEqual({ width: 62, height: 20 });
    expect(quick().region).toMatchObject({ x1: 100, y1: 100, x2: 162, y2: 120 });
  });

  it('picks the off, off-hover, on and on-hover frames, and the grayed frame when disabled', () => {
    const b = quick();
    expect(frameOf(drawn(t, b))).toBe(1);
    t.move(110, 110);
    t.frame();
    expect(frameOf(drawn(t, b))).toBe(2);
    t.down(110, 110);
    expect(frameOf(drawn(t, b))).toBe(4);
    t.move(300, 300);
    expect(frameOf(drawn(t, b))).toBe(1);
    b.disable();
    expect(frameOf(drawn(t, b))).toBe(0);
  });

  it('fires on a release over the button where the press started, with drag-off feedback and switch sounds', () => {
    const b = quick();
    t.move(110, 110);
    t.down(110, 110);
    expect(b.clicked).toBe(true);
    t.move(300, 300);
    expect(b.clicked).toBe(false);
    t.move(110, 110);
    expect(b.clicked).toBe(true);
    t.up(110, 110);
    expect(clicks).toEqual(['down', 'up']);
    expect(b.clicked).toBe(false);
    expect(t.sounds.names()).toEqual(['BIG_SWITCH3_IN', 'BIG_SWITCH3_OUT', 'BIG_SWITCH3_IN']);
    expect(t.sounds.played[0]?.volume).toBe(BUTTON_SOUND_VOLUME);
  });

  it('does not fire when the release happens elsewhere and restores the state', () => {
    const b = quick();
    t.move(110, 110);
    t.down(110, 110);
    t.move(300, 300);
    t.up(300, 300);
    expect(clicks).toEqual(['down']);
    expect(b.clicked).toBe(false);
  });

  it('toggles a NEWTOGGLE button on the press and reverts it when the pointer leaves while pressed', () => {
    const b = quick({ kind: 'toggle', image: twoFrameImage(ART, 1, 3) });
    t.move(110, 110);
    t.down(110, 110);
    t.up(110, 110);
    expect(b.clicked).toBe(true);
    t.down(110, 110);
    expect(b.clicked).toBe(false);
    t.move(300, 300);
    expect(b.clicked).toBe(true);
  });

  it('toggles a check box on a release inside, showing the hilite frames only while pressing', () => {
    const b = quick({ kind: 'checkbox', image: checkBoxImage(CHECK) });
    t.move(105, 105);
    t.frame();
    expect(frameOf(drawn(t, b))).toBe(0);
    t.down(105, 105);
    expect(frameOf(drawn(t, b))).toBe(1);
    t.up(105, 105);
    expect(b.clicked).toBe(true);
    expect(frameOf(drawn(t, b))).toBe(2);
    t.down(105, 105);
    t.up(105, 105);
    expect(b.clicked).toBe(false);
    expect(t.sounds.names()).toEqual(['BIG_SWITCH3_IN', 'BIG_SWITCH3_OUT']);
  });

  it('draws the disabled styles: hatch without text, shade with text, explicit styles and none', () => {
    const font = t.fonts.get(FontName.FONT12ARIAL);
    const plain = quick({ image: twoFrameImage(ART, 1, 3) });
    const texted = quick({ x: 200, image: twoFrameImage(ART, 1, 3), text: { text: 'OK', font, color: 208 } });
    const shaded = quick({ x: 300, image: twoFrameImage(ART, 1, 3), disabledStyle: 'shaded' });
    const none = quick({ x: 400, image: twoFrameImage(ART, 1, 3), disabledStyle: 'none' });
    for (const b of [plain, texted, shaded, none]) b.disable();
    expect(drawn(t, plain).items.at(-1)).toMatchObject({ kind: 'hatch', x: 100, y: 100, width: 60, height: 20 });
    expect(drawn(t, texted).items.at(-1)).toMatchObject({ kind: 'shadow', x: 200, y: 100, width: 61, height: 21 });
    expect(drawn(t, shaded).items.at(-1)).toMatchObject({ kind: 'shadow' });
    expect(drawn(t, none).items.map((i) => i.kind)).toEqual(['image']);
    const box = quick({ x: 500, kind: 'checkbox', image: checkBoxImage(CHECK) });
    box.disable();
    const list = drawn(t, box);
    expect([frameOf(list), list.items.at(-1)?.kind]).toEqual([1, 'hatch']);
  });

  it('plays the disabled sound on a press of a disabled button', () => {
    quick().disable();
    t.move(110, 110);
    t.down(110, 110);
    expect(t.sounds.played).toEqual([{ file: DISABLED_BUTTON_SOUND, volume: BUTTON_SOUND_VOLUME }]);
    expect(clicks).toEqual([]);
  });

  it('centres its text in the inset, shifted by the -1 sub-offsets, and one pixel down-right while pressed', () => {
    const font = t.fonts.get(FontName.FONT12ARIAL);
    const b = quick({ image: twoFrameImage(ART, 1, 3), text: { text: 'OK', font, color: 208, downColor: 162 } });
    const glyphs = (list: DrawList) => list.items.find((i): i is GlyphRunItem => i.kind === 'glyphs');
    const before = glyphs(drawn(t, b));
    t.move(110, 110);
    t.down(110, 110);
    const after = glyphs(drawn(t, b));
    expect((after?.glyphs[0]?.x ?? 0) - (before?.glyphs[0]?.x ?? 0)).toBe(1);
    expect((after?.glyphs[0]?.y ?? 0) - (before?.glyphs[0]?.y ?? 0)).toBe(1);
    expect([before?.foreground, after?.foreground]).toEqual([208, 162]);
    expect(drawn(t, b).items[1]).toMatchObject({ kind: 'clipPush', x: 103, y: 102, width: 54, height: 16 });
  });

  it('hides a button by disabling its region: not drawn, no input', () => {
    const b = quick();
    b.hide();
    const list = new DrawList();
    t.runtime.buttons.render(list);
    expect(list.items).toEqual([]);
    t.move(110, 110);
    t.down(110, 110);
    expect(clicks).toEqual([]);
  });

  it('defers the deletion of a button inside its own callback', () => {
    let self: Button | null = null;
    self = quick({
      onClick: (b, reason) => {
        if (!(reason & MouseReason.LBUTTON_UP)) return;
        b.remove();
        clicks.push(`removed ${t.runtime.buttons.buttons.includes(b)}`);
      },
    });
    t.move(110, 110);
    t.click(110, 110);
    expect(clicks).toEqual(['removed true']);
    expect(t.runtime.buttons.buttons.includes(self)).toBe(false);
  });

  it('chooses the generic sound scheme from the current screen when the button is created', () => {
    t.runtime.host.replace(screen(UiScreenKind.LAPTOP));
    expect(quick().soundScheme).toBe(ButtonSoundScheme.COMPUTERBEEP2);
    t.runtime.host.replace(screen(UiScreenKind.GAME_INIT_OPTIONS));
    expect(quick().soundScheme).toBe(ButtonSoundScheme.VERYSMALLSWITCH2);
    t.runtime.host.replace(screen(UiScreenKind.OTHER));
    const silent = quick();
    expect(silent.soundScheme).toBe(ButtonSoundScheme.GENERIC);
    t.move(110, 110);
    t.down(110, 110);
    expect(t.sounds.played).toEqual([]);
  });

  it('draws nothing for a hot spot but keeps its button semantics', () => {
    const spot = t.runtime.buttons.create({
      x: 10,
      y: 10,
      width: 30,
      height: 10,
      kind: 'hotspot',
      onClick: (_b, r) => clicks.push(r & MouseReason.LBUTTON_UP ? 'up' : 'down'),
    });
    expect(drawn(t, spot).items).toEqual([]);
    t.move(15, 15);
    t.click(15, 15);
    expect(clicks).toEqual(['down', 'up']);
  });
});
