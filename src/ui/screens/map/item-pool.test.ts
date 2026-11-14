import { describe, expect, it } from 'vitest';
import type { StashEntryView } from '../../../protocol/map-inventory.ts';
import type { ItemCursor } from '../tactical/item-cursor.ts';
import {
  arrangeCommand,
  discardCommand,
  discardFromStashCommand,
  entryView,
  fromStashCommand,
  openedLayout,
  POOL_SLOTS_PER_PAGE,
  PoolRefusal,
  poolClickRefusal,
  poolEntry,
  poolObjects,
  poolPages,
  poolSize,
  poolSlotOrigin,
  refreshedLayout,
  shownEntry,
  stashCursor,
  stashPlacements,
  toStashCommand,
  withinStashCommand,
} from './item-pool.ts';

function entry(index: number, count = 1, reachable = true): StashEntryView {
  return { index, item: 'GLOCK_17', count, status: Array.from({ length: count }, () => 90), reachable, gridNo: 100 + index, level: 0 };
}

const slotCursor = (count: 'all' | 1, index = 0): ItemCursor => ({
  source: { kind: 'slot', soldier: 3, slot: 7, count, index },
  item: 'GLOCK_17',
});

describe('the sector inventory pool', () => {
  it('pads the visible items to whole pages and adds a page when fewer than two slots stay free', () => {
    expect(poolSize(0)).toBe(POOL_SLOTS_PER_PAGE);
    expect(poolSize(43)).toBe(POOL_SLOTS_PER_PAGE);
    expect(poolSize(44)).toBe(2 * POOL_SLOTS_PER_PAGE);
    expect(poolSize(45)).toBe(2 * POOL_SLOTS_PER_PAGE);
    expect(poolPages(0)).toBe(1);
    expect(poolPages(44)).toBe(2);
    expect(poolPages(90)).toBe(3);
  });

  it('fills the slots column by column, nine to a column, page by page', () => {
    expect(poolSlotOrigin(0)).toEqual({ column: 0, row: 0 });
    expect(poolSlotOrigin(8)).toEqual({ column: 0, row: 8 });
    expect(poolSlotOrigin(9)).toEqual({ column: 1, row: 0 });
    const stash = Array.from({ length: 50 }, (_, i) => entry(i));
    const entries = new Map(stash.map((e) => [e.index, e]));
    const layout = openedLayout(stash);
    expect(poolEntry(layout, entries, 1, 0)?.index).toBe(POOL_SLOTS_PER_PAGE);
    expect(poolEntry(layout, entries, 1, 5)).toBeNull();
  });

  it('keeps the slots of the pool as it opened: a gone entry leaves a hole, a placement lands in its slot or the first hole, a new entry in the first hole, and a page more when fewer than two slots stay free (CheckAndUnDateSlotAllocation)', () => {
    const opened = openedLayout([entry(7), entry(3), entry(5)]);
    expect(opened.slice(0, 4)).toEqual([7, 3, 5, null]);
    expect(opened).toHaveLength(POOL_SLOTS_PER_PAGE);
    const taken = refreshedLayout(opened, [entry(7), entry(5)], []);
    expect(taken.slice(0, 4)).toEqual([7, null, 5, null]);
    const placed = refreshedLayout(taken, [entry(7), entry(5), entry(3), entry(9)], [{ index: 3, slot: 10 }]);
    expect(placed.slice(0, 11)).toEqual([7, 9, 5, null, null, null, null, null, null, null, 3]);
    const moved = refreshedLayout(placed, [entry(7), entry(5), entry(3), entry(9)], [{ index: 7, slot: 3 }]);
    expect(moved.slice(0, 4)).toEqual([null, 9, 5, 7]);
    const full = Array.from({ length: POOL_SLOTS_PER_PAGE - 1 }, (_, i) => entry(i));
    expect(refreshedLayout(openedLayout(full.slice(0, 40)), full, [])).toHaveLength(2 * POOL_SLOTS_PER_PAGE);
  });

  it('counts the objects of every slot', () => {
    expect(poolObjects([entry(0, 3), entry(1), entry(2, 2)])).toBe(6);
  });

  it('lifts one object or the whole slot into the cursor and shows what stays behind', () => {
    const stack = entry(4, 3);
    const one = stashCursor(stack, false, { sector: 'D13', z: 0 });
    expect(one).toMatchObject({ kind: 'stash', index: 4, count: 1, sector: 'D13', z: 0 });
    expect(shownEntry(stack, one)).toMatchObject({ count: 2, status: [90, 90] });
    expect(shownEntry(stack, stashCursor(stack, true, { sector: 'D13', z: 0 }))).toBeNull();
    expect(shownEntry(entry(5), stashCursor(entry(5), false, { sector: 'D13', z: 0 }))).toBeNull();
    expect(shownEntry(entry(6), one)).toMatchObject({ index: 6 });
  });

  it('turns an entry into an inventory view with its ammunition and attachments', () => {
    const gun: StashEntryView = { ...entry(0), ammo: { item: 'CLIP9_15', shots: 12 }, attachments: [{ item: 'SILENCER', status: 80 }] };
    expect(entryView(gun)).toMatchObject({ slot: -1, item: 'GLOCK_17', ammo: { shots: 12 }, attachments: [{ item: 'SILENCER' }] });
  });

  it('builds the map-screen commands: from the stash, into it and into the trash can', () => {
    const cursor = stashCursor(entry(2, 2), false, { sector: 'D13', z: 1 });
    expect(fromStashCommand(cursor, 3, 11)).toEqual({
      type: 'moveItem',
      soldier: 3,
      from: 'ground',
      item: 2,
      to: 11,
      sector: 'D13',
      z: 1,
      count: 1,
    });
    expect(toStashCommand(slotCursor('all'), null, { sector: 'D13', z: 0 })).toEqual({
      type: 'moveItem',
      soldier: 3,
      from: 7,
      to: 'ground',
      sector: 'D13',
    });
    expect(toStashCommand(slotCursor(1), entry(9), { sector: 'D13', z: 0 })).toMatchObject({ stashIndex: 9, count: 1 });
    expect(discardCommand(slotCursor(1, 2))).toEqual({ type: 'discardItem', soldier: 3, slot: 7, count: 1, index: 2 });
    const attachment: ItemCursor = { source: { kind: 'attachment', soldier: 3, slot: 5, attachment: 0 }, item: 'SILENCER' };
    expect(toStashCommand(attachment, null, { sector: 'D13', z: 0 })).toBeNull();
    expect(discardCommand(attachment)).toBeNull();
  });

  it('builds the commands of the pool cursor: onto another pool slot, into the trash can, and the write-back as the pool closes', () => {
    const cursor = stashCursor(entry(2, 2), false, { sector: 'D13', z: 1 });
    expect(withinStashCommand(cursor, 3, entry(5))).toEqual({
      type: 'moveItem',
      soldier: 3,
      from: 'ground',
      item: 2,
      to: 'ground',
      stashIndex: 5,
      sector: 'D13',
      z: 1,
      count: 1,
    });
    expect(withinStashCommand(stashCursor(entry(2), true, { sector: 'D13', z: 0 }), 3, null)).toEqual({
      type: 'moveItem',
      soldier: 3,
      from: 'ground',
      item: 2,
      to: 'ground',
      sector: 'D13',
    });
    expect(discardFromStashCommand(cursor, 3)).toEqual({
      type: 'discardItem',
      soldier: 3,
      slot: 'ground',
      item: 2,
      sector: 'D13',
      z: 1,
      count: 1,
    });
    expect(arrangeCommand([4, null, 1, null], { sector: 'D13', z: 0 })).toEqual({ type: 'arrangeStash', sector: 'D13', order: [4, 1] });
    expect(stashPlacements({ stashIndex: 6, leftover: 2 }, 9, 1)).toEqual([
      { index: 6, slot: 9 },
      { index: 2, slot: 1 },
    ]);
    expect(stashPlacements({ item: 'GLOCK_17' }, 9, 1)).toEqual([]);
  });

  it('puts keys taken off the key ring into the stash and into the trash can (BeginKeyRingItemPointer)', () => {
    const keys: ItemCursor = { source: { kind: 'keyRing', soldier: 3, position: 6, count: 1 }, item: 'KEY_1' };
    expect(toStashCommand(keys, entry(4), { sector: 'D13', z: 0 })).toEqual({
      type: 'moveItem',
      soldier: 3,
      from: { ring: 6 },
      to: 'ground',
      stashIndex: 4,
      sector: 'D13',
      count: 1,
    });
    expect(discardCommand({ ...keys, source: { ...keys.source, count: 'all' } } as ItemCursor)).toEqual({
      type: 'discardItem',
      soldier: 3,
      slot: { ring: 6 },
    });
  });

  it('checks a click in the original order', () => {
    const base = { entry: entry(0), holding: false, mercInSector: true, usable: true };
    expect(poolClickRefusal(base)).toBeNull();
    expect(poolClickRefusal({ ...base, entry: entry(0, 1, false), mercInSector: null })).toBe(PoolRefusal.UNREACHABLE);
    expect(poolClickRefusal({ ...base, mercInSector: null, usable: false })).toBe(PoolRefusal.NO_MERC);
    expect(poolClickRefusal({ ...base, mercInSector: false, usable: false })).toBe(PoolRefusal.ELSEWHERE);
    expect(poolClickRefusal({ ...base, usable: false })).toBe(PoolRefusal.BATTLE);
    expect(poolClickRefusal({ ...base, entry: null, holding: true })).toBeNull();
  });
});
