import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { type ItemTable, loadItemTable } from '../../content/items/items.ts';
import { createItem, createItems, createMoney } from '../items/object.ts';
import { emptyInventory, InvSlot } from './inventory.ts';
import { inventoryView, sameInventory } from './inventory-view.ts';

const DATA_DIR = join(import.meta.dirname, '../../../data');
let items: ItemTable;

beforeAll(async () => {
  items = await loadItemTable(async (path) => JSON.parse(readFileSync(join(DATA_DIR, path), 'utf8')));
});

function index(name: string): number {
  const def = items.byName.get(name);
  if (!def) throw new Error(`no item ${name}`);
  return def.index;
}

describe('inventory view', () => {
  it('lists the filled slots with their stack, loaded ammo and money', () => {
    const inv = emptyInventory();
    inv[InvSlot.HAND] = createItem(items, index('GLOCK_17'), 90);
    inv[InvSlot.SMALLPOCK1] = createItems(items, index('CLIP9_15'), 100, 2);
    inv[InvSlot.SMALLPOCK2] = createMoney(items, 250);
    const view = inventoryView(items, inv);
    expect(view.map((v) => v.slot)).toEqual([InvSlot.HAND, InvSlot.SMALLPOCK1, InvSlot.SMALLPOCK2]);
    expect(view[0]).toMatchObject({ item: 'GLOCK_17', count: 1, status: [90] });
    expect(view[0]?.ammo?.shots).toBeGreaterThan(0);
    expect(view[1]).toMatchObject({ item: 'CLIP9_15', count: 2, status: [15, 15] });
    expect(view[2]?.money).toBe(250);
  });

  it('compares by content so frames carry inventory changes only', () => {
    const inv = emptyInventory();
    inv[InvSlot.HAND] = createItem(items, index('GLOCK_17'), 90);
    const before = inventoryView(items, inv);
    expect(sameInventory(before, inventoryView(items, inv))).toBe(true);
    inv[InvSlot.SMALLPOCK1] = createItem(items, index('CLIP9_15'), 100);
    expect(sameInventory(before, inventoryView(items, inv))).toBe(false);
  });
});
