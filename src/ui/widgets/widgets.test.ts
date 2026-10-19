import { beforeEach, describe, expect, it } from 'vitest';
import { type TestRuntime, testRuntime, uniformImage } from '../../../tests/support/ui-runtime.ts';
import { FontColor } from '../../content/text/font-colors.ts';
import { DrawList, type GlyphRunItem, type ImageItem, LOW_PERCENT_SHADOW_FACTOR } from '../draw-list.ts';
import { MouseButton } from '../input/events.ts';
import type { Screen } from '../screen.ts';
import { FontName } from '../text/fonts.ts';
import { FADE_STEP_MS, Fade, fadeFactor } from './fade.ts';
import { MercPopupBackground, MercTextBox, mercTextColors } from './merc-text-box.ts';
import { MessageBox, MessageBoxFlag, MessageBoxReturn, type MessageBoxStyle } from './message-box.ts';
import { DEFAULT_POPUP_COLORS, PopupBox, PopupMenu } from './popup-box.ts';
import { ProgressBar } from './progress-bar.ts';
import { interpolateRect, SnapshotZoom, ZOOM_STEP_MS } from './snapshot-zoom.ts';
import { defaultTextFieldScheme, TextFieldGroup } from './text-field.ts';

const BORDER = 'interface/test-popup.sti';
const BACKGROUND = 'interface/test-popup.pcx';
const TEXT_BORDER = 'interface/test-text.sti';
const BUTTONS = 'interface/test-msg.sti';
const THUMB = 'interface/test-thumb.sti';
const LABELS = { ok: 'OK', yes: 'Yes', no: 'No', rehire: 'Rehire', lie: 'Lie', skip: 'Skip', continue: 'Continue', stop: 'Stop' };

function images(list: DrawList): ImageItem[] {
  return list.items.filter((i): i is ImageItem => i.kind === 'image');
}

function runs(list: DrawList): GlyphRunItem[] {
  return list.items.filter((i): i is GlyphRunItem => i.kind === 'glyphs');
}

function idleScreen(): Screen & { updates: number } {
  const s = {
    id: 'idle',
    updates: 0,
    enter: () => undefined,
    exit: () => undefined,
    update: () => {
      s.updates++;
    },
    input: () => false,
    render: (list: DrawList) => list.fill(0, 0, 10, 10, 0x123456),
  };
  return s;
}

describe('the shared widgets', () => {
  let t: TestRuntime;

  beforeEach(async () => {
    t = await testRuntime();
    t.images.set(BORDER, uniformImage(6, 2, 2));
    t.images.set(BACKGROUND, uniformImage(1, 320, 240));
    t.images.set(TEXT_BORDER, uniformImage(8, 10, 10));
    t.images.set(BUTTONS, uniformImage(4, 61, 20));
    t.images.set(THUMB, uniformImage(1, 42, 25));
  });

  describe('the popup box', () => {
    const style = () => ({
      border: BORDER,
      background: BACKGROUND,
      font: t.fonts.get(FontName.FONT10ARIAL),
      marginLeft: 6,
      marginTop: 6,
      marginBottom: 4,
      marginRight: 4,
      lineSpace: 2,
      colors: DEFAULT_POPUP_COLORS,
      resize: true,
      secondColumnMinOffset: 10,
    });

    it('resizes to its text and tiles the border with an overlapping last piece', () => {
      const box = new PopupBox(style(), 100, 50);
      box.setLines([{ text: 'Doctor', second: '2' }, { text: 'Patient' }]);
      const font = style().font;
      expect(box.height).toBe(6 + 2 * (font.glyphs[0] ? font.glyphs[0].height + font.glyphs[0].offsetY + 2 : 0) + 4);
      const list = new DrawList();
      box.draw(list);
      const pieces = images(list).filter((i) => i.asset === BORDER);
      const tiles = Math.trunc((box.width - 4) / 16);
      expect(pieces.filter((p) => p.frame === 4)).toHaveLength(2 * (tiles + 1));
      expect(pieces.find((p) => p.frame === 1)).toMatchObject({ x: 100 + box.width - 2, y: 50 });
      expect(list.items[0]).toMatchObject({ kind: 'clipPush', x: 100, y: 50, width: box.width, height: box.height });
    });

    it('colours the lines highlight > secondary shade > shade > normal', () => {
      const box = new PopupBox(style(), 0, 0);
      box.setLines([{ text: 'a' }, { text: 'b', shade: 'shade' }, { text: 'c', shade: 'secondary' }, { text: 'd' }]);
      box.highlighted = 3;
      const list = new DrawList();
      box.draw(list);
      expect(runs(list).map((r) => r.foreground)).toEqual([
        DEFAULT_POPUP_COLORS.foreground,
        DEFAULT_POPUP_COLORS.shade,
        DEFAULT_POPUP_COLORS.secondaryShade,
        DEFAULT_POPUP_COLORS.highlight,
      ]);
    });

    it('as a menu: highlights unshaded lines, selects with a click, closes on a release outside or a right click', () => {
      const box = new PopupBox(style(), 100, 50);
      box.setLines([{ text: 'One' }, { text: 'Two', shade: 'shade' }, { text: 'Three' }]);
      const events: string[] = [];
      const menu = new PopupMenu(box, {
        regions: t.runtime.regions,
        onSelect: (i) => events.push(`select ${i}`),
        onClose: () => events.push('close'),
      });
      menu.show();
      const lineY = (i: number) => 50 + 6 + i * box.lineStep + 1;
      t.move(110, lineY(0));
      t.frame();
      expect(box.highlighted).toBe(0);
      t.move(110, lineY(1));
      expect(box.highlighted).toBe(-1);
      t.click(110, lineY(1));
      t.click(110, lineY(2));
      expect(events).toEqual(['select 2']);
      t.click(5, 5);
      expect(events).toEqual(['select 2', 'close']);
      expect(menu.open).toBe(false);
    });
  });

  describe('the merc text box', () => {
    const art = { background: BACKGROUND, border: TEXT_BORDER, backgroundIndex: MercPopupBackground.BASIC };

    it('shrinks to short text and tiles its border every ten pixels', () => {
      const fonts = { text: t.fonts.get(FontName.FONT12ARIAL), bold: t.fonts.get(FontName.FONT10ARIALBOLD) };
      const box = new MercTextBox(art, { text: 'Hi', width: 300, marginX: 0, marginTop: 0, marginBottom: 0 }, fonts);
      expect(box.width).toBeLessThan(60);
      const long = new MercTextBox(art, { text: 'word '.repeat(80), width: 300, marginX: 40, marginTop: 10, marginBottom: 30 }, fonts);
      expect(long.width).toBe(349);
      expect(long.height).toBeLessThan(200);
      const list = new DrawList();
      long.render(list, 10, 20);
      const borders = images(list).filter((i) => i.asset === TEXT_BORDER);
      expect(borders.filter((b) => b.frame === 1)).toHaveLength(Math.ceil((long.width - 20) / 10));
      expect(borders.find((b) => b.frame === 7)).toMatchObject({ x: 10 + long.width - 10, y: 20 + long.height - 10 });
    });

    it('takes its text colours from the background', () => {
      expect(mercTextColors(MercPopupBackground.WHITE)).toMatchObject({ foreground: 2, shadow: FontColor.MCOLOR_WHITE });
      expect(mercTextColors(MercPopupBackground.GREY)).toMatchObject({ foreground: 2, shadow: 0 });
      expect(mercTextColors(MercPopupBackground.DIALOG)).toMatchObject({ foreground: FontColor.MCOLOR_WHITE, shadow: 2 });
    });
  });

  describe('the message box', () => {
    const style = (): MessageBoxStyle => ({
      textBox: { background: BACKGROUND, border: TEXT_BORDER, backgroundIndex: MercPopupBackground.DIALOG },
      buttons: BUTTONS,
      buttonOff: 0,
      buttonOn: 1,
      fontColor: FontColor.MCOLOR_WHITE,
      shadowColor: 2,
      cursor: 0,
    });

    it('centres on the screen, blocks everything below and returns the clicked button', () => {
      const under = idleScreen();
      t.runtime.host.push(under);
      let below = 0;
      t.runtime.regions.define({ x1: 0, y1: 0, x2: 640, y2: 480, priority: 127, onButton: () => below++ });
      const results: number[] = [];
      const box = new MessageBox(t.runtime, {
        style: style(),
        text: 'Quit?',
        flags: MessageBoxFlag.YESNO,
        labels: LABELS,
        onClose: (r) => results.push(r),
      });
      t.runtime.host.openModal(box);
      t.frame();
      const { x, y, width, height } = box.box;
      expect(x).toBe(Math.trunc((640 - width) / 2));
      expect(y).toBe(Math.trunc((480 - height) / 2));
      const buttons = box.describe().filter((w) => w.kind.startsWith('button'));
      expect(buttons.map((b) => b.text)).toEqual(['Yes', 'No']);
      expect(buttons[1]?.rect.x).toBe((buttons[0]?.rect.x ?? 0) + 61 + 15);
      t.click(5, 5);
      expect(below).toBe(0);
      const no = buttons[1]?.rect ?? { x: 0, y: 0, width: 0, height: 0 };
      t.move(no.x + 5, no.y + 5);
      t.click(no.x + 5, no.y + 5);
      t.frame();
      expect(results).toEqual([MessageBoxReturn.NO]);
      expect(t.runtime.host.modal).toBeNull();
      expect(under.updates).toBe(0);
      t.frame();
      expect(under.updates).toBe(1);
    });

    it('answers its keys on key up only, and the four numbered set with 1-4', () => {
      const results: number[] = [];
      const open = (flags: MessageBoxFlag) => {
        const box = new MessageBox(t.runtime, { style: style(), text: 'x', flags, labels: LABELS, onClose: (r) => results.push(r) });
        t.runtime.host.openModal(box);
        return box;
      };
      open(MessageBoxFlag.YESNO);
      t.runtime.input({ kind: 'keyDown', key: 'y', code: 'KeyY', modifiers: 0 });
      t.frame();
      expect(results).toEqual([]);
      t.runtime.input({ kind: 'keyUp', key: 'y', code: 'KeyY', modifiers: 0 });
      t.frame();
      open(MessageBoxFlag.FOUR_NUMBERED_BUTTONS);
      t.runtime.input({ kind: 'keyUp', key: '3', code: 'Digit3', modifiers: 0 });
      t.frame();
      open(MessageBoxFlag.CONTINUESTOP);
      t.runtime.input({ kind: 'keyUp', key: 'Enter', code: 'Enter', modifiers: 0 });
      t.frame();
      expect(results).toEqual([MessageBoxReturn.YES, 3, MessageBoxReturn.OK]);
    });

    it('freezes the screen under it: the backdrop is the screen as it was, and the UI clock stops', () => {
      const under = idleScreen();
      t.runtime.host.push(under);
      const before = t.runtime.clock.ja2Now;
      t.runtime.host.openModal(new MessageBox(t.runtime, { style: style(), text: 'x', flags: MessageBoxFlag.OK, labels: LABELS }));
      t.frame(100);
      t.frame(100);
      expect(t.runtime.clock.ja2Now).toBe(before);
      expect(t.list.items[0]).toMatchObject({ kind: 'fill', color: 0x123456 });
      expect(under.updates).toBe(0);
    });
  });

  describe('the slider', () => {
    it('sets the inverted vertical value from a click, a drag outside the region and the wheel, and ignores the maximum', () => {
      const values: number[] = [];
      const slider = t.runtime.sliders.add({
        style: 'verticalSteel',
        x: 100,
        y: 100,
        length: 254,
        steps: 127,
        thumb: THUMB,
        onChange: (v) => values.push(v),
      });
      t.move(100, 100 + 127);
      t.down(100, 100 + 127);
      expect(values.at(-1)).toBe(127 - 63);
      t.move(100, 20);
      t.frame();
      expect(values.at(-1)).toBe(127);
      t.move(100, 600);
      t.frame();
      expect(values.at(-1)).toBe(0);
      t.up(100, 600);
      t.frame();
      t.move(100, 200);
      t.runtime.input({ kind: 'wheel', x: 100, y: 200, button: -1, buttons: 0, wheel: -1, modifiers: 0 });
      expect(values.at(-1)).toBe(4);
      slider.setValue(127);
      expect(slider.value).toBe(4);
      slider.setValue(50);
      expect(slider.value).toBe(50);
      const list = new DrawList();
      slider.render(list);
      expect(images(list)[0]).toMatchObject({ asset: THUMB, x: 100 - 21, y: slider.boxPosition - 12 });
    });
  });

  describe('the text field', () => {
    it('edits with filters, selection and caret keys, swallows unmodified keys and blinks on the UI clock', () => {
      const group = new TextFieldGroup(t.runtime.regions, t.sounds, defaultTextFieldScheme(t.fonts.get(FontName.FONT12POINT1)));
      const name = group.add({ x: 10, y: 10, width: 100, height: 20, text: 'Ivan', maxLength: 6 });
      const number = group.add({ x: 10, y: 40, width: 100, height: 20, maxLength: 3, filter: 'numeric' });
      const key = (k: string, modifiers = 0) => group.input({ kind: 'keyDown', key: k, code: '', modifiers });
      expect(group.active).toBe(name);
      expect(group.selection).toEqual([0, 4]);
      group.input({ kind: 'text', text: 'Bob' });
      expect(name.text).toBe('Bob');
      expect(key('Backspace')).toBe(true);
      expect(name.text).toBe('Bo');
      group.input({ kind: 'text', text: 'bXYZW' });
      expect(name.text).toBe('BobXYZ');
      expect(key('q')).toBe(true);
      expect(key('l', 2)).toBe(false);
      expect(key('Enter')).toBe(false);
      key('Home');
      key('ArrowRight', 1);
      key('ArrowRight', 1);
      key('Delete');
      expect(name.text).toBe('bXYZ');
      key('Tab');
      expect(group.active).toBe(number);
      group.input({ kind: 'text', text: 'a1b2c3d4' });
      expect(number.text).toBe('123');
      const lit = new DrawList();
      group.render(lit, 1200);
      const dark = new DrawList();
      group.render(dark, 1700);
      expect(lit.items.length - dark.items.length).toBe(1);
      expect(t.sounds.names()).toContain('ENTERING_TEXT');
    });

    it('places the caret where the field is clicked', () => {
      const group = new TextFieldGroup(t.runtime.regions, t.sounds, defaultTextFieldScheme(t.fonts.get(FontName.FONT12POINT1)));
      group.add({ x: 10, y: 10, width: 100, height: 20, text: 'abcdef', maxLength: 10 });
      t.move(11, 15);
      t.down(11, 15, MouseButton.LEFT);
      expect(group.cursor).toBe(0);
    });
  });

  describe('the progress bar, the fade and the snapshot zoom', () => {
    it('fills the load bar from x + 2 + fraction × (w − 4)', () => {
      const bar = new ProgressBar({ x: 162, y: 427, width: 318, height: 16, style: 'loadBar' });
      bar.setRelativeRange(0, 50);
      bar.setPercentage(50);
      const list = new DrawList();
      bar.render(list);
      expect(list.items[0]).toMatchObject({ kind: 'fill', x: 162, y: 427, width: Math.trunc(2 + 0.25 * 314), height: 16 });
    });

    it('fades out in eleven 0.8 steps then black, and in from 0.8^8', () => {
      expect(fadeFactor('out', 0)).toBeCloseTo(LOW_PERCENT_SHADOW_FACTOR);
      expect(fadeFactor('out', 10)).toBeCloseTo(LOW_PERCENT_SHADOW_FACTOR ** 11);
      expect(fadeFactor('out', 11)).toBe(0);
      expect(fadeFactor('in', 0)).toBeCloseTo(LOW_PERCENT_SHADOW_FACTOR ** 8);
      expect(fadeFactor('in', 8)).toBeCloseTo(1);
      const done: string[] = [];
      t.runtime.host.push(idleScreen());
      t.runtime.host.openModal(new Fade(t.runtime, { direction: 'out', onDone: () => done.push('out') }));
      t.frame();
      for (let i = 0; i < 12; i++) t.frame(FADE_STEP_MS);
      expect(done).toEqual(['out']);
    });

    it('captures the frame once and stretches it into the growing rectangle', () => {
      t.runtime.host.push(idleScreen());
      const zoom = new SnapshotZoom(t.runtime, {
        steps: 4,
        destination: interpolateRect({ x: 300, y: 200, width: 40, height: 30 }, { x: 0, y: 0, width: 640, height: 480 }),
      });
      t.runtime.host.openModal(zoom);
      t.frame();
      t.frame(ZOOM_STEP_MS * 2);
      const capture = t.list.items.find((i) => i.kind === 'capture');
      const snapshot = t.list.items.find((i) => i.kind === 'snapshot');
      expect(capture).toBeDefined();
      expect(snapshot).toMatchObject({ x: 150, y: 100, width: 340, height: 255, sourceArea: { x: 0, y: 0, width: 640, height: 480 } });
    });
  });
});
