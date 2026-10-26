import { describe, expect, it } from 'vitest';
import type { DrawRun } from './dynamic-scene.ts';
import { DrawState, InstanceBuffer } from './instances.ts';
import { PictureMemo } from './picture-memo.ts';

const VIEWPORT = { width: 640, height: 360 };
const ORIGIN = { x: 0, y: 0 };
const SPRITE = { layer: 0, x: 0, y: 0, width: 20, height: 30 };

function buffer(...spots: readonly (readonly [number, number, number])[]): { buffer: InstanceBuffer; runs: DrawRun[] } {
  const b = new InstanceBuffer();
  for (const [x, y, row] of spots) b.push(x, y, SPRITE, 0, SPRITE.width, row, 0, 0, 0, 0);
  return { buffer: b, runs: [{ state: DrawState.NEARER_OR_EQUAL, first: 0, count: b.count }] };
}

function changed(memo: PictureMemo, scene: { buffer: InstanceBuffer; runs: DrawRun[] }, offset = ORIGIN, scalar = 0): boolean {
  memo.begin();
  memo.add(scalar);
  memo.addVisible(scene.runs, scene.buffer, VIEWPORT, offset);
  return memo.changed();
}

describe('the world picture memo', () => {
  it('reports the first picture and any later difference, and nothing for a repeat', () => {
    const memo = new PictureMemo();
    expect(changed(memo, buffer([10, 10, 1]))).toBe(true);
    expect(changed(memo, buffer([10, 10, 1]))).toBe(false);
    expect(changed(memo, buffer([10, 10, 2]))).toBe(true);
    expect(changed(memo, buffer([10, 10, 2]), ORIGIN, 1)).toBe(true);
    expect(changed(memo, buffer([10, 10, 2], [50, 50, 2]), ORIGIN, 1)).toBe(true);
  });

  it('ignores sprites wholly outside the viewport, as the vertex shader drops them', () => {
    const memo = new PictureMemo();
    changed(memo, buffer([10, 10, 1], [-100, 10, 1]));
    expect(changed(memo, buffer([10, 10, 1], [-100, 10, 2]))).toBe(false);
    expect(changed(memo, buffer([10, 10, 1], [700, 10, 3]))).toBe(false);
    expect(changed(memo, buffer([10, 10, 1], [-15, 10, 3]))).toBe(true);
    expect(changed(memo, buffer([10, 10, 1], [-15, 10, 3]), { x: -10, y: 0 })).toBe(true);
    expect(changed(memo, buffer([10, 10, 1], [-15, 10, 4]), { x: -10, y: 0 })).toBe(false);
  });

  it('tells apart the same sprites under another draw state', () => {
    const memo = new PictureMemo();
    const scene = buffer([10, 10, 1]);
    changed(memo, scene);
    expect(changed(memo, { buffer: scene.buffer, runs: [{ ...scene.runs[0], state: DrawState.FARTHER } as DrawRun] })).toBe(true);
  });

  it('draws again after it forgets the last picture', () => {
    const memo = new PictureMemo();
    changed(memo, buffer([10, 10, 1]));
    memo.forget();
    expect(changed(memo, buffer([10, 10, 1]))).toBe(true);
  });

  it('grows past its first capacity', () => {
    const memo = new PictureMemo();
    const many = buffer(...Array.from({ length: 600 }, (_, i) => [i % 600, 10, 1] as const));
    expect(changed(memo, many)).toBe(true);
    expect(changed(memo, many)).toBe(false);
  });
});
