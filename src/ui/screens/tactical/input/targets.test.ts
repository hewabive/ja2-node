import { describe, expect, it } from 'vitest';
import type { SoldierView } from '../../../../protocol/view.ts';
import type { ScreenBox } from '../environment.ts';
import { findSoldier, PICK_ANYONE, type PickRules, type SoldierScreenRects, SoldierStack } from './targets.ts';

const POINTER_TILE = 500;
const OTHER_TILE = 501;
const HUMVEE = 22;

function soldier(id: number, over: Partial<SoldierView> = {}): SoldierView {
  return {
    id,
    team: 1,
    name: '',
    bodyType: 0,
    gridNo: OTHER_TILE,
    x: 0,
    y: 0,
    level: 0,
    direction: 0,
    animation: 0,
    frame: 0,
    palettes: ['', '', '', ''],
    hand: '',
    frameSlot: 0,
    stateTick: 0,
    frameDelay: 0,
    ...over,
  };
}

function rects(boxes: Record<number, ScreenBox>, picture: (id: number, x: number, y: number) => boolean = () => true): SoldierScreenRects {
  return { soldierBox: (id) => boxes[id] ?? null, soldierPictureAt: picture };
}

const at = (x: number, y: number, level = 0) => ({ x, y, gridNo: POINTER_TILE, level });
const anyone = PICK_ANYONE;

describe('the soldier under the pointer (FindSoldier)', () => {
  it('finds the soldier whose screen rectangle holds the pointer, its right and bottom edges included', () => {
    const world = rects({ 1: { x: 100, y: 50, width: 20, height: 40 } });
    const soldiers = [soldier(1)];
    expect(findSoldier(soldiers, at(120, 90), world, anyone)?.id).toBe(1);
    expect(findSoldier(soldiers, at(121, 90), world, anyone)).toBeNull();
    expect(findSoldier(soldiers, at(120, 91), world, anyone)).toBeNull();
  });

  it('takes the rectangle that reaches lowest on screen, the first soldier of a tie', () => {
    const world = rects({
      1: { x: 100, y: 50, width: 20, height: 40 },
      2: { x: 105, y: 60, width: 20, height: 40 },
      3: { x: 110, y: 60, width: 20, height: 40 },
    });
    expect(findSoldier([soldier(1), soldier(2), soldier(3)], at(112, 70), world, anyone)?.id).toBe(2);
  });

  it('finds the soldier standing on the pointer tile away from his rectangle, and he competes by his rectangle bottom', () => {
    const world = rects({ 1: { x: 0, y: 200, width: 20, height: 40 }, 2: { x: 100, y: 50, width: 20, height: 40 } });
    expect(findSoldier([soldier(1, { gridNo: POINTER_TILE }), soldier(2)], at(110, 60), world, anyone)?.id).toBe(1);
  });

  it('looks only at soldiers on the interface level', () => {
    const world = rects({ 1: { x: 100, y: 50, width: 20, height: 40 } });
    const onRoof = [soldier(1, { level: 1, gridNo: POINTER_TILE })];
    expect(findSoldier(onRoof, at(110, 60), world, anyone)).toBeNull();
    expect(findSoldier(onRoof, at(110, 60, 1), world, anyone)?.id).toBe(1);
  });

  it('passes over a rectangle the caller cannot pick by but still finds that soldier on the pointer tile', () => {
    const world = rects({ 1: { x: 100, y: 50, width: 20, height: 40 } });
    const byTileOnly: PickRules = { ...PICK_ANYONE, byRectangle: () => false };
    expect(findSoldier([soldier(1)], at(110, 60), world, byTileOnly)).toBeNull();
    expect(findSoldier([soldier(1, { gridNo: POINTER_TILE })], at(110, 60), world, byTileOnly)?.id).toBe(1);
  });

  it('passes over a soldier the caller rules out, by his rectangle and on the pointer tile, for the one behind him', () => {
    const world = rects({ 1: { x: 100, y: 50, width: 20, height: 40 }, 2: { x: 105, y: 40, width: 20, height: 40 } });
    const soldiers = [soldier(1, { gridNo: POINTER_TILE }), soldier(2)];
    const passOverFirst: PickRules = { ...PICK_ANYONE, passedOver: (s) => s.id === 1 };
    expect(findSoldier(soldiers, at(110, 60), world, anyone)?.id).toBe(1);
    expect(findSoldier(soldiers, at(110, 60), world, passOverFirst)?.id).toBe(2);
  });

  it('finds a vehicle only where his picture has data, even on the pointer tile', () => {
    const box = { x: 100, y: 50, width: 20, height: 40 };
    const truck = [soldier(1, { bodyType: HUMVEE, gridNo: POINTER_TILE })];
    const noData = rects({ 1: box }, () => false);
    expect(findSoldier(truck, at(110, 60), noData, anyone)).toBeNull();
    expect(findSoldier(truck, at(110, 60), rects({ 1: box }), anyone)?.id).toBe(1);
  });

  it('finds no soldier without a picture shown', () => {
    expect(findSoldier([soldier(1, { gridNo: POINTER_TILE })], at(110, 60), rects({}), anyone)).toBeNull();
  });
});

describe('the soldier stack under the pointer (FindSoldier with FIND_SOLDIER_BEGINSTACK, CycleSoldierFindStack)', () => {
  const stacked = rects({
    1: { x: 100, y: 50, width: 20, height: 40 },
    2: { x: 105, y: 60, width: 20, height: 40 },
    3: { x: 110, y: 55, width: 20, height: 40 },
  });
  const crowd = [soldier(1), soldier(2), soldier(3)];
  const pointer = at(112, 70);

  function stackOver(soldiers = crowd): SoldierStack {
    const stack = new SoldierStack();
    stack.begin(soldiers, pointer, stacked, anyone);
    return stack;
  }

  it('cycles from the one after the lowest rectangle to the last, then to nobody on the tile, then from the first', () => {
    const stack = stackOver();
    const cycled: (number | null)[] = [];
    const kinds: string[] = [];
    for (let press = 0; press < 5; press++) {
      kinds.push(stack.cycle(POINTER_TILE));
      cycled.push(stack.current);
    }
    expect(cycled).toEqual([3, null, 1, 2, 3]);
    expect(kinds).toEqual(['soldier', 'ground', 'soldier', 'soldier', 'soldier']);
  });

  it('makes no stack where nobody is under the pointer', () => {
    const stack = stackOver([soldier(4)]);
    expect([stack.handling, stack.cycle(POINTER_TILE)]).toEqual([false, 'none']);
  });

  it('keeps the stacked soldier while the pointer is on him, though another reaches lower', () => {
    const stack = stackOver();
    stack.cycle(POINTER_TILE);
    stack.cycle(POINTER_TILE);
    stack.cycle(POINTER_TILE);
    expect(findSoldier(crowd, pointer, stacked, anyone, stack)?.id).toBe(1);
    expect(findSoldier(crowd, pointer, stacked, anyone)?.id).toBe(2);
  });

  it('finds nobody the first time the pointer is off the stacked soldier, and the stack ends then', () => {
    const stack = stackOver();
    stack.cycle(POINTER_TILE);
    const offTheThird = at(106, 92);
    expect(findSoldier(crowd, offTheThird, stacked, anyone, stack)).toBeNull();
    stack.endUnlessHeldAt(POINTER_TILE);
    expect(stack.handling).toBe(false);
    expect(findSoldier(crowd, offTheThird, stacked, anyone, stack)?.id).toBe(2);
  });

  it('keeps nobody while the stack is on the ground of its tile, and ends it on another tile', () => {
    const stack = stackOver();
    stack.cycle(POINTER_TILE);
    stack.cycle(POINTER_TILE);
    expect(findSoldier(crowd, pointer, stacked, anyone, stack)).toBeNull();
    stack.endUnlessHeldAt(POINTER_TILE);
    expect(stack.handling).toBe(true);
    stack.endUnlessHeldAt(OTHER_TILE);
    expect(stack.handling).toBe(false);
  });
});
