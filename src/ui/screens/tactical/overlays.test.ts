import { describe, expect, it } from 'vitest';
import { DamageNumber, LOCATOR_FRAME_MS, Locator, SHOW_LOCATOR_FAST_CYCLES, SHOW_LOCATOR_NORMAL_CYCLES, TimeCounter } from './overlays.ts';

const LOCATOR_FRAMES = 5;
const FAST_LOCATOR_STEPS = (SHOW_LOCATOR_FAST_CYCLES - 1) * LOCATOR_FRAMES;

function updatesUntilDone(locator: Locator, from: number, frameMs: number): number {
  let updates = 1;
  for (let now = from; locator.update(now); now += frameMs) updates++;
  return updates;
}

describe('the radio locator', () => {
  it('takes its first step at once and then at most one a frame however long the frame, as DrawSelectedUIAboveGuy steps on TIMECOUNTERDONE', () => {
    const locator = new Locator(SHOW_LOCATOR_FAST_CYCLES, new TimeCounter());
    expect([locator.frame, locator.shown]).toEqual([0, false]);
    expect(locator.update(1000)).toBe(true);
    expect([locator.frame, locator.shown]).toEqual([1, true]);
    expect(locator.update(1000 + LOCATOR_FRAME_MS - 1)).toBe(true);
    expect(locator.frame).toBe(1);
    expect(locator.update(10_000)).toBe(true);
    expect(locator.frame).toBe(2);
    expect(updatesUntilDone(locator, 10_000 + 10 * LOCATOR_FRAME_MS, 10 * LOCATOR_FRAME_MS)).toBe(FAST_LOCATOR_STEPS - 2);
  });

  it("waits for the soldier's counter when shown again and keeps showing, as ShowRadioLocator restarts only the frame and the cycles", () => {
    const counter = new TimeCounter();
    const first = new Locator(SHOW_LOCATOR_FAST_CYCLES, counter);
    first.update(0);
    first.update(LOCATOR_FRAME_MS);
    first.show(SHOW_LOCATOR_NORMAL_CYCLES);
    expect([first.frame, first.shown]).toEqual([0, true]);
    expect(first.update(2 * LOCATOR_FRAME_MS - 1)).toBe(true);
    expect(first.frame).toBe(0);
    first.update(2 * LOCATOR_FRAME_MS);
    expect(first.frame).toBe(1);
    const next = new Locator(SHOW_LOCATOR_FAST_CYCLES, counter);
    next.update(3 * LOCATOR_FRAME_MS - 1);
    expect([next.frame, next.shown]).toEqual([0, false]);
    next.update(3 * LOCATOR_FRAME_MS);
    expect([next.frame, next.shown]).toEqual([1, true]);
  });
});

describe('the floating damage number', () => {
  const DAMAGE_DISPLAY_DELAY_MS = 250;
  const DAMAGE_STEPS = 8;
  const BACK_ON_THE_GAME_SCREEN = 60_000;

  it('drifts a step every 250 ms for 8 steps, at most one a frame, so a number put up while the map screen is up drifts from the return', () => {
    const number = new DamageNumber(0, 10, 20);
    expect(number.update(DAMAGE_DISPLAY_DELAY_MS - 1)).toBe(true);
    expect([number.dx, number.dy]).toEqual([10, 20]);
    expect(number.update(BACK_ON_THE_GAME_SCREEN)).toBe(true);
    expect([number.dx, number.dy]).toEqual([11, 19]);
    let steps = 1;
    for (let now = BACK_ON_THE_GAME_SCREEN + DAMAGE_DISPLAY_DELAY_MS; number.update(now); now += DAMAGE_DISPLAY_DELAY_MS) steps++;
    expect(steps + 1).toBe(DAMAGE_STEPS);
    expect([number.dx, number.dy]).toEqual([10 + DAMAGE_STEPS, 20 - DAMAGE_STEPS]);
  });
});
