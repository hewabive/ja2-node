import { describe, expect, it } from 'vitest';
import type { ScreenShift } from './dirty-rects.ts';
import type { DrawRun } from './dynamic-scene.ts';
import { DrawState, InstanceBuffer } from './instances.ts';
import { PictureMemo, type PictureUpdate } from './picture-memo.ts';

const VIEWPORT = { width: 640, height: 360 };
const ORIGIN: ScreenShift = { x: 0, y: 0 };
const SPRITE = { layer: 0, x: 0, y: 0, width: 20, height: 30 };

interface Scene {
  readonly buffer: InstanceBuffer;
  readonly runs: DrawRun[];
}

function scene(...spots: readonly (readonly [number, number, number])[]): Scene {
  const b = new InstanceBuffer();
  for (const [x, y, row] of spots) b.push(x, y, SPRITE, 0, SPRITE.width, row, 0, 0, 0, 0);
  return { buffer: b, runs: [{ state: DrawState.NEARER_OR_EQUAL, first: 0, count: b.count }] };
}

function update(memo: PictureMemo, s: Scene, offset = ORIGIN, key = 0, viewport = VIEWPORT): PictureUpdate {
  memo.begin(viewport, offset);
  memo.add(key);
  memo.addVisible(s.runs, s.buffer);
  return memo.update();
}

const at = (x: number, y: number) => ({ x0: x, y0: y, x1: x + SPRITE.width, y1: y + SPRITE.height });

describe('the world picture memo', () => {
  it('draws the first picture whole, a repeat not at all, and a changed sprite over its old and new places', () => {
    const memo = new PictureMemo();
    expect(update(memo, scene([10, 10, 1]))).toEqual({ kind: 'full' });
    expect(update(memo, scene([10, 10, 1]))).toEqual({ kind: 'same' });
    expect(update(memo, scene([10, 10, 2]))).toEqual({ kind: 'partial', shift: ORIGIN, rects: [at(10, 10)] });
    expect(update(memo, scene([50, 10, 2]))).toEqual({ kind: 'partial', shift: ORIGIN, rects: [at(50, 10), at(10, 10)] });
    expect(update(memo, scene([50, 10, 2], [200, 100, 1]))).toEqual({ kind: 'partial', shift: ORIGIN, rects: [at(200, 100)] });
  });

  it('draws the whole picture after a key change, on another viewport, after forgetting, or when most of it changed', () => {
    const memo = new PictureMemo();
    update(memo, scene([10, 10, 1]));
    expect(update(memo, scene([10, 10, 1]), ORIGIN, 1)).toEqual({ kind: 'full' });
    expect(update(memo, scene([10, 10, 1]), ORIGIN, 1, { width: 800, height: 360 })).toEqual({ kind: 'full' });
    memo.forget();
    expect(update(memo, scene([10, 10, 1]), ORIGIN, 1, { width: 800, height: 360 })).toEqual({ kind: 'full' });
    const big = { layer: 0, x: 0, y: 0, width: 800, height: 300 };
    const covering = (row: number) => {
      const b = new InstanceBuffer();
      b.push(0, 0, big, 0, big.width, row, 0, 0, 0, 0);
      return { buffer: b, runs: [{ state: DrawState.NEARER_OR_EQUAL, first: 0, count: 1 }] };
    };
    update(memo, covering(1), ORIGIN, 1, { width: 800, height: 360 });
    expect(update(memo, covering(2), ORIGIN, 1, { width: 800, height: 360 })).toEqual({ kind: 'full' });
  });

  it('shifts the picture with the camera and draws only the uncovered strip', () => {
    const memo = new PictureMemo();
    update(memo, scene([10, 10, 1]));
    expect(update(memo, scene([10, 10, 1]), { x: 40, y: 0 })).toEqual({
      kind: 'partial',
      shift: { x: 40, y: 0 },
      rects: [{ x0: 0, y0: 0, x1: 40, y1: 360 }],
    });
    expect(update(memo, scene([10, 10, 1]), { x: 40, y: -20 })).toEqual({
      kind: 'partial',
      shift: { x: 0, y: -20 },
      rects: [{ x0: 0, y0: 340, x1: 640, y1: 360 }],
    });
  });

  it('places a changed sprite at the new camera when the picture shifts', () => {
    const memo = new PictureMemo();
    update(memo, scene([100, 100, 1]));
    const shifted = update(memo, scene([100, 100, 2]), { x: -40, y: 0 });
    expect(shifted).toEqual({
      kind: 'partial',
      shift: { x: -40, y: 0 },
      rects: [{ x0: 600, y0: 0, x1: 640, y1: 360 }, at(60, 100)],
    });
  });

  it('draws the whole picture when a shift would break the dither pattern or leave the view', () => {
    const memo = new PictureMemo();
    update(memo, scene([10, 10, 1]));
    expect(update(memo, scene([10, 10, 1]), { x: 1, y: 0 })).toEqual({ kind: 'full' });
    expect(update(memo, scene([10, 10, 1]), { x: 1 + VIEWPORT.width, y: 0 })).toEqual({ kind: 'full' });
  });

  it('redraws a sprite that moved in the drawing order', () => {
    const memo = new PictureMemo();
    update(memo, scene([10, 10, 1], [20, 10, 2]));
    expect(update(memo, scene([20, 10, 2], [10, 10, 1]))).toEqual({ kind: 'partial', shift: ORIGIN, rects: [at(10, 10)] });
  });

  it('ignores sprites wholly outside the viewport, as the vertex shader drops them', () => {
    const memo = new PictureMemo();
    update(memo, scene([10, 10, 1], [-100, 10, 1]));
    expect(update(memo, scene([10, 10, 1], [-100, 10, 2]))).toEqual({ kind: 'same' });
    expect(update(memo, scene([10, 10, 1], [700, 10, 3]))).toEqual({ kind: 'same' });
    expect(update(memo, scene([10, 10, 1], [-15, 10, 3]))).toEqual({
      kind: 'partial',
      shift: ORIGIN,
      rects: [{ x0: 0, y0: 10, x1: 5, y1: 40 }],
    });
  });

  it('tells apart the same sprite under another draw state', () => {
    const memo = new PictureMemo();
    const s = scene([10, 10, 1]);
    update(memo, s);
    const farther = { buffer: s.buffer, runs: [{ ...s.runs[0], state: DrawState.FARTHER } as DrawRun] };
    expect(update(memo, farther)).toEqual({ kind: 'partial', shift: ORIGIN, rects: [at(10, 10)] });
  });

  it('grows past its first capacity', () => {
    const memo = new PictureMemo();
    const many = scene(...Array.from({ length: 600 }, (_, i) => [i % 600, 10, 1] as const));
    expect(update(memo, many)).toEqual({ kind: 'full' });
    expect(update(memo, many)).toEqual({ kind: 'same' });
  });
});
