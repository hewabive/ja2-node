import { describe, expect, it } from 'vitest';
import { ItemLocators, MultiPurposeLocator, type ShownLocator } from './item-locators.ts';

const POOL = { gridNo: 12_884, level: 0 };
const OTHER_POOL = { gridNo: 12_886, level: 1 };
const CYCLE_MS = 40;
const FLASH_STEPS = 58;
const WRAPPED_STEPS = 255;
const SLOTS = 50;
const RADIO_FRAME_MS = 80;
const MULTI_PURPOSE_FRAMES = 40;

function stepFor(locators: ItemLocators, steps: number, from: number, locked = false): number {
  let now = from;
  for (let k = 0; k < steps; k++) {
    now += CYCLE_MS;
    locators.step(now, locked, false);
  }
  return now;
}

const tiles = (shown: readonly ShownLocator[]) => shown.map((l) => l.gridNo);

describe('the item locators (Handle_Items.cc SetItemPoolLocator, HandleFlashingItems)', () => {
  it('waits unseen while the locators are locked, then flashes for 58 steps of 40 ms once they unlock', () => {
    const locators = new ItemLocators();
    locators.add(POOL, 0);
    let now = stepFor(locators, 10, 0, true);
    expect(locators.shown()).toEqual([]);
    now = stepFor(locators, FLASH_STEPS - 1, now);
    expect(tiles(locators.shown())).toEqual([POOL.gridNo]);
    stepFor(locators, 1, now);
    expect(locators.shown()).toEqual([]);
  });

  it('steps once per 40 ms counter, whatever the frames between, and not while the clock is paused', () => {
    const locators = new ItemLocators();
    locators.add(POOL, 0);
    locators.unlock();
    for (let ms = 0; ms < FLASH_STEPS * CYCLE_MS; ms += CYCLE_MS / 4) locators.step(ms, false, true);
    expect(locators.shown()).toHaveLength(1);
    let now = 0;
    for (let k = 0; k < FLASH_STEPS; k++) {
      locators.step(now, false, false);
      locators.step(now + CYCLE_MS / 2, false, false);
      now += CYCLE_MS;
    }
    expect(locators.shown()).toEqual([]);
  });

  it('turns the radio frame once more than 80 ms have passed since the last turn, so every third step', () => {
    const locators = new ItemLocators();
    locators.add(POOL, 0);
    locators.unlock();
    const frames: number[] = [];
    let now = 0;
    for (let k = 0; k < 7; k++) {
      now += CYCLE_MS;
      locators.step(now, false, false);
      frames.push(locators.shown()[0]?.frame ?? -1);
    }
    expect(frames).toEqual([0, 0, 1, 1, 1, 2, 2]);
  });

  it('turns the radio frame at the first step after a long lock', () => {
    const locators = new ItemLocators();
    locators.add(POOL, 0);
    locators.step(10 * RADIO_FRAME_MS, false, false);
    expect(locators.shown()[0]?.frame).toBe(1);
  });

  it('keeps at most 50 locators, reusing the first free slot', () => {
    const locators = new ItemLocators();
    for (let k = 0; k < SLOTS + 1; k++) locators.add({ gridNo: k, level: 0 }, 0);
    locators.unlock();
    expect(locators.shown()).toHaveLength(SLOTS);
    locators.remove({ gridNo: 3, level: 0 });
    locators.add(OTHER_POOL, 0);
    locators.unlock();
    expect(tiles(locators.shown())[3]).toBe(OTHER_POOL.gridNo);
  });

  it('removes the first locator of a pool, by its tile and level', () => {
    const locators = new ItemLocators();
    locators.add(POOL, 0);
    locators.add({ ...POOL, level: 1 }, 0);
    locators.add(POOL, 0);
    locators.unlock();
    locators.remove(POOL);
    expect(locators.shown().map((l) => [l.gridNo, l.level])).toEqual([
      [POOL.gridNo, 1],
      [POOL.gridNo, 0],
    ]);
  });

  it('ends a pool’s first locator as any of its locators runs out, so a later one in an earlier slot ends an older one, which flashes on until its INT8 colour wraps round to 1', () => {
    const locators = new ItemLocators();
    locators.add(OTHER_POOL, 0);
    locators.add(POOL, 0);
    locators.unlock();
    let now = stepFor(locators, FLASH_STEPS / 2, 0);
    locators.remove(OTHER_POOL);
    locators.add(POOL, now);
    locators.unlock();
    now = stepFor(locators, FLASH_STEPS / 2, now);
    expect(locators.shown()).toHaveLength(1);
    now = stepFor(locators, WRAPPED_STEPS - 1, now);
    expect(locators.shown()).toHaveLength(1);
    stepFor(locators, 1, now);
    expect(locators.shown()).toEqual([]);
  });
});

describe('the multi-purpose locator (Interface.cc BeginMultiPurposeLocator, HandleMultiPurposeLocator)', () => {
  it('turns a frame once more than 80 ms have passed, from the first step, for 8 cycles of 5 frames', () => {
    const locator = new MultiPurposeLocator();
    locator.begin(POOL);
    const frames: number[] = [];
    let now = 1000;
    for (let k = 0; k < MULTI_PURPOSE_FRAMES; k++) {
      locator.step(now);
      frames.push(locator.shown()?.frame ?? -1);
      now += RADIO_FRAME_MS + 1;
    }
    expect(frames.slice(0, 6)).toEqual([1, 2, 3, 4, 0, 1]);
    expect(frames.at(-2)).toBe(4);
    expect(frames.at(-1)).toBe(-1);
  });

  it('starts again at another tile when begun anew', () => {
    const locator = new MultiPurposeLocator();
    locator.begin(POOL);
    locator.step(1000);
    locator.begin(OTHER_POOL);
    expect(locator.shown()).toEqual({ ...OTHER_POOL, frame: 0 });
  });
});
