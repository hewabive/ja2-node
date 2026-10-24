import { describe, expect, it } from 'vitest';
import { HelpScroll, WHEEL_LINES } from './help-scroll.ts';

const LINE = 12;
const TEXT_AREA = 228;
const SCROLL_TOP = 97;
const SCROLL_HEIGHT = 182;

function scroll(pixels: number): HelpScroll {
  const s = new HelpScroll({ lineHeight: LINE, textAreaHeight: TEXT_AREA, scrollTop: SCROLL_TOP, scrollHeight: SCROLL_HEIGHT });
  s.setContent(pixels);
  return s;
}

describe('the help screen text scroll (HelpScreen.cc)', () => {
  it('counts whole lines of the page and shows the text area’s lines', () => {
    const s = scroll(30 * LINE + 7);
    expect(s.visibleLines).toBe(19);
    expect(s.totalLines).toBe(30);
    expect(s.enabled).toBe(true);
    expect(scroll(19 * LINE).enabled).toBe(false);
  });

  it('clamps the top line to the last full screen, then to the first line', () => {
    const s = scroll(40 * LINE);
    expect(s.move(-1)).toBe(false);
    expect(s.move(s.pageLines)).toBe(true);
    expect(s.top).toBe(18);
    expect(s.move(100)).toBe(true);
    expect(s.top).toBe(21);
    expect(s.move(1)).toBe(false);
    const short = scroll(10 * LINE);
    expect(short.move(5)).toBe(false);
    expect(short.top).toBe(0);
    expect(WHEEL_LINES).toBe(3);
  });

  it('sizes and places the box with the original’s float ratios', () => {
    expect(scroll(10 * LINE).box()).toEqual({ top: SCROLL_TOP, height: SCROLL_HEIGHT });
    expect(scroll(0).box()).toEqual({ top: SCROLL_TOP, height: SCROLL_HEIGHT });
    const s = scroll(30 * LINE);
    expect(s.box()).toEqual({ top: SCROLL_TOP, height: 115 });
    s.move(7);
    expect(s.box()).toEqual({ top: SCROLL_TOP + 42, height: 115 });
    s.move(100);
    expect(s.box()).toEqual({ top: SCROLL_TOP + 67, height: 115 });
  });

  it('drags the box by the point it was grabbed at, or by its middle when grabbed outside', () => {
    const s = scroll(30 * LINE);
    s.drag(SCROLL_TOP + 10);
    expect(s.top).toBe(0);
    s.drag(SCROLL_TOP + 10 + 33);
    expect(s.top).toBe(5);
    s.release();
    const outside = scroll(30 * LINE);
    outside.drag(SCROLL_TOP + 120);
    expect(outside.top).toBe(Math.trunc((11 * (120 - 57)) / 67));
    outside.drag(SCROLL_TOP + 170);
    expect(outside.top).toBe(11);
  });
});
