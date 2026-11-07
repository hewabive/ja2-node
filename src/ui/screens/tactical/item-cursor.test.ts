import { describe, expect, it } from 'vitest';
import type { SoldierView } from '../../../protocol/view.ts';
import {
  applyCommand,
  combineCommand,
  cursorFromSlot,
  cursorOnLeftover,
  dropCommand,
  giveCommand,
  type ItemCursor,
  passCommand,
  putsBackUnchanged,
  remainingCursor,
  shownStatus,
  tossCommand,
} from './item-cursor.ts';

const OUR_TEAM = 0;
const ROBOT_BODY = 21;
const SMALL_POCKET = 11;
const CLIP_INDEX = 71;
const BOOSTER_INDEX = 235;
const BESIDE = 1201;
const FAR_TILE = 1210;

function view(id: number, team: number, extra: Partial<SoldierView> = {}): SoldierView {
  return {
    id,
    team,
    name: `S${id}`,
    bodyType: 0,
    gridNo: 0,
    x: 0,
    y: 0,
    level: 0,
    direction: 0,
    animation: 0,
    frame: 0,
    palettes: ['', '', '', ''],
    hand: '',
    surface: 0,
    frameSlot: 0,
    stateTick: 0,
    frameDelay: 0,
    ...extra,
  };
}

describe('the commands of the item cursor dropped on the map (HandleItemPointerClick)', () => {
  const clips = { slot: SMALL_POCKET, item: 'CLIP9_15', index: CLIP_INDEX, count: 2, status: [15, 15] };
  const merc = view(0, OUR_TEAM, { inventory: [clips] });

  it('gives one clip to the robot, the drop the server turns into its reload', () => {
    const robot = view(1, OUR_TEAM, { bodyType: ROBOT_BODY, kind: 'epc', controlled: true });
    const cursor = cursorFromSlot(merc, SMALL_POCKET, false);
    if (!cursor) throw new Error('no cursor');
    expect(giveCommand(cursor, robot.id)).toEqual({ type: 'give', soldier: 0, target: 1, slot: SMALL_POCKET, count: 1 });
  });

  it('drops at the feet or on the tile beside him, tosses to a tile and passes to a merc, with the pocket object', () => {
    const cursor = cursorFromSlot(merc, SMALL_POCKET, true);
    if (!cursor) throw new Error('no cursor');
    expect(dropCommand(cursor)).toEqual({ type: 'drop', soldier: 0, slot: SMALL_POCKET });
    expect(dropCommand(cursor, BESIDE)).toEqual({ type: 'drop', soldier: 0, slot: SMALL_POCKET, gridNo: BESIDE });
    expect(tossCommand(cursor, FAR_TILE, 1)).toEqual({ type: 'toss', soldier: 0, slot: SMALL_POCKET, gridNo: FAR_TILE, level: 1 });
    expect(passCommand(cursor, 3)).toEqual({ type: 'pass', soldier: 0, slot: SMALL_POCKET, target: 3 });
  });
});

describe('the item cursor dropped on the portrait (SMInvClickCamoCallback)', () => {
  const boosters = { slot: SMALL_POCKET, item: 'REGEN_BOOSTER', index: BOOSTER_INDEX, count: 3, status: [100, 60, 30] };
  const merc = view(0, OUR_TEAM, { inventory: [boosters] });

  it('applies one object by default, the SHIFT stack with count all and an object picked from the stack by its index', () => {
    const one = cursorFromSlot(merc, SMALL_POCKET, false);
    const stack = cursorFromSlot(merc, SMALL_POCKET, true);
    const picked = cursorFromSlot(merc, SMALL_POCKET, false, 2);
    if (!one || !stack || !picked) throw new Error('no cursor');
    expect(applyCommand(one, 0)).toEqual({ type: 'applyItem', soldier: 0, slot: SMALL_POCKET });
    expect(applyCommand(stack, 3)).toEqual({ type: 'applyItem', soldier: 0, slot: SMALL_POCKET, count: 'all', target: 3 });
    expect(applyCommand(picked, 0)).toEqual({ type: 'applyItem', soldier: 0, slot: SMALL_POCKET, index: 2 });
  });
});

describe('keys taken off the key ring into the cursor (BeginKeyRingItemPointer)', () => {
  it('are dropped, given, passed and tossed with the ring position as their source', () => {
    const keys: ItemCursor = { source: { kind: 'keyRing', soldier: 0, position: 4, count: 1 }, item: 'KEY_1' };
    expect(dropCommand(keys)).toEqual({ type: 'drop', soldier: 0, slot: { ring: 4 }, count: 1 });
    expect(giveCommand(keys, 2)).toEqual({ type: 'give', soldier: 0, target: 2, slot: { ring: 4 }, count: 1 });
    expect(passCommand(keys, 3)).toEqual({ type: 'pass', soldier: 0, slot: { ring: 4 }, count: 1, target: 3 });
    expect(tossCommand({ ...keys, source: { ...keys.source, count: 'all' } } as ItemCursor, FAR_TILE, 0)).toEqual({
      type: 'toss',
      soldier: 0,
      slot: { ring: 4 },
      gridNo: FAR_TILE,
    });
  });
});

describe('the CTRL+click of a cursor on a stack (UIHandleItemPlacement, CleanUpStack)', () => {
  const at = (source: ItemCursor['source']): ItemCursor => ({ source, item: 'CLIP9_15' });

  it('names the cursor’s source for every kind of cursor, and the other merc whose stack is clicked', () => {
    const slot = at({ kind: 'slot', soldier: 1, slot: 7, count: 1, index: 2 });
    expect(combineCommand(slot, 0, SMALL_POCKET)).toEqual({
      type: 'combineStack',
      soldier: 1,
      slot: SMALL_POCKET,
      from: 7,
      index: 2,
      toSoldier: 0,
    });
    expect(combineCommand(at({ kind: 'keyRing', soldier: 0, position: 4, count: 'all' }), 0, 8)).toEqual({
      type: 'combineStack',
      soldier: 0,
      slot: 8,
      from: { ring: 4 },
    });
    expect(combineCommand(at({ kind: 'magazine', soldier: 0, slot: 5 }), 0, 8)).toMatchObject({ from: { magazine: 5 } });
    expect(combineCommand(at({ kind: 'attachment', soldier: 0, slot: 5, attachment: 1 }), 0, 8)).toMatchObject({
      from: { attachment: 1, slot: 5 },
    });
    expect(combineCommand(at({ kind: 'money', soldier: 0, slot: 9, amount: 100 }), 0, 8)).toMatchObject({ from: 9 });
  });

  it('keeps the cursor while objects are left in it, on the index the server put them at', () => {
    const cursor = at({ kind: 'slot', soldier: 0, slot: 7, count: 1, index: 0 });
    expect(remainingCursor(cursor, { combined: true, left: 0 })).toBeNull();
    expect(remainingCursor(cursor, { combined: true, left: 1, index: 2 })?.source).toMatchObject({ index: 2 });
    expect(remainingCursor(cursor, { combined: false, left: 1 })).toBe(cursor);
  });
});

describe('the item cursor placed in a pocket (UIHandleItemPlacement)', () => {
  const stack = { slot: SMALL_POCKET, item: 'CLIP9_15', index: CLIP_INDEX, count: 3, status: [15, 7, 3] };
  const single = { slot: SMALL_POCKET + 1, item: 'CLIP9_15', index: CLIP_INDEX, count: 1, status: [15] };
  const merc = view(0, OUR_TEAM, { inventory: [stack, single] });
  const at = (slot: number, count: 1 | 'all'): ItemCursor => ({
    source: { kind: 'slot', soldier: 0, slot, count, index: 0 },
    item: 'CLIP9_15',
  });

  it('needs no command only where putting it back changes nothing: the whole stack or a lone object', () => {
    expect(putsBackUnchanged(at(SMALL_POCKET, 1), merc, SMALL_POCKET)).toBe(false);
    expect(putsBackUnchanged(at(SMALL_POCKET, 'all'), merc, SMALL_POCKET)).toBe(true);
    expect(putsBackUnchanged(at(SMALL_POCKET + 1, 1), merc, SMALL_POCKET + 1)).toBe(true);
    expect(putsBackUnchanged(at(SMALL_POCKET + 1, 1), merc, SMALL_POCKET)).toBe(false);
    expect(putsBackUnchanged(at(SMALL_POCKET, 'all'), view(1, OUR_TEAM, { inventory: [stack] }), SMALL_POCKET)).toBe(false);
  });

  it('keeps the cursor on the leftover the server names, and ends it when none is named', () => {
    expect(cursorOnLeftover({ item: 'CLIP9_15', count: 1 })).toBeNull();
    expect(cursorOnLeftover({ leftover: { item: 'CLIP9_15_AP', soldier: 2, slot: 7, count: 1, index: 2 } })).toEqual({
      source: { kind: 'slot', soldier: 2, slot: 7, count: 1, index: 2 },
      item: 'CLIP9_15_AP',
    });
    expect(cursorOnLeftover({ leftover: { item: 'CLIP9_15', soldier: 0, slot: 11, count: 'all' } })?.source).toEqual({
      kind: 'slot',
      soldier: 0,
      slot: 11,
      count: 'all',
      index: 0,
    });
  });
});

describe('the stack an object was taken off into the cursor (GetObjFrom)', () => {
  const stack = { slot: SMALL_POCKET, item: 'CLIP9_15', index: CLIP_INDEX, count: 3, status: [15, 7, 3] };
  const at = (count: 1 | 'all', index: number, soldier = 0): ItemCursor => ({
    source: { kind: 'slot', soldier, slot: SMALL_POCKET, count, index },
    item: 'CLIP9_15',
  });

  it('shows the objects left, so the status bar reads the next object once the top one is taken', () => {
    expect(shownStatus(at(1, 0), stack, 0)).toEqual([7, 3]);
    expect(shownStatus(at(1, 1), stack, 0)).toEqual([15, 3]);
    expect(shownStatus(at('all', 0), stack, 0)).toBe(stack.status);
    expect(shownStatus(at(1, 0, 1), stack, 0)).toBe(stack.status);
    expect(shownStatus(null, stack, 0)).toBe(stack.status);
  });
});
