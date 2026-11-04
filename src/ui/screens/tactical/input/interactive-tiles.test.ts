import { describe, expect, it } from 'vitest';
import type { InteractiveNode } from '../environment.ts';
import { type CheckPoint, InteractiveTileCheck } from './interactive-tiles.ts';

const AT: CheckPoint = { x: 300, y: 150, centerX: 805, centerY: 805 };

function node(gridNo: number, bottom: number): InteractiveNode {
  return { gridNo, index: 0, tile: 7, bottom, door: false, open: false };
}

function checked(nodes: readonly InteractiveNode[]): { check: InteractiveTileCheck; asked: () => number } {
  const check = new InteractiveTileCheck();
  let asks = 0;
  check.frame(AT, () => {
    asks++;
    return nodes;
  });
  return { check, asked: () => asks };
}

const overGridNo = (check: InteractiveTileCheck) => check.over?.gridNo ?? null;

describe('the interactive tile under the pointer (Interactive_Tiles.cc)', () => {
  it('takes the node whose rectangle reaches lowest, the first of a tie', () => {
    expect(overGridNo(checked([node(1, 200), node(2, 230), node(3, 230), node(4, 210)]).check)).toBe(2);
  });

  it('cycles the stack in sweep order from the node found, round to the first, with n (CycleIntTileFindStack)', () => {
    const { check } = checked([node(1, 200), node(2, 230), node(3, 210)]);
    const cycled: (number | null)[] = [];
    for (let press = 0; press < 4; press++) {
      check.cycle();
      check.frame(AT, () => []);
      cycled.push(overGridNo(check));
    }
    expect(cycled).toEqual([3, 1, 2, 3]);
  });

  it('checks again only when the pointer or the render centre moves, keeping the node found and the cycle meanwhile (ShouldCheckForMouseDetections)', () => {
    const { check, asked } = checked([node(1, 200), node(2, 230)]);
    check.cycle();
    check.frame(AT, () => []);
    expect([asked(), overGridNo(check)]).toEqual([1, 1]);
    check.frame({ ...AT, centerX: AT.centerX + 10 }, () => [node(5, 220)]);
    expect(overGridNo(check)).toBe(5);
    check.frame({ ...AT, centerX: AT.centerX + 10, x: AT.x + 1 }, () => []);
    expect(overGridNo(check)).toBeNull();
  });

  it('keeps no node after a reset until the pointer moves, as a selection or an explosion leaves it (BeginCurInteractiveTileCheck)', () => {
    const { check } = checked([node(1, 200)]);
    check.begin();
    check.frame(AT, () => [node(1, 200)]);
    expect(check.over).toBeNull();
    check.frame({ ...AT, y: AT.y + 1 }, () => [node(1, 200)]);
    expect(overGridNo(check)).toBe(1);
  });

  it('never takes a node whose rectangle reaches no lower than the screen top: the node found before stays', () => {
    const { check } = checked([node(1, 200)]);
    check.frame({ ...AT, y: 0 }, () => [node(2, 0)]);
    expect(overGridNo(check)).toBe(1);
  });
});
