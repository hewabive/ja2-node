import type { ItemTable } from '../../src/content/items/items.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import { createItem, createItems, emptyObject } from '../../src/sim/items/object.ts';
import { InvSlot } from '../../src/sim/tactical/inventory.ts';

const PISTOL = 'GLOCK_17';
const MAGAZINE = 'CLIP9_15';
const LETTER = 'LETTER';
const MAGAZINES = 2;
const FULL = 100;

function index(items: ItemTable, name: string): number {
  const def = items.byName.get(name);
  if (!def) throw new Error(`no item ${name}`);
  return def.index;
}

export function armSquadWithPistols(session: CampaignSession, items: ItemTable): void {
  const letter = index(items, LETTER);
  for (const m of session.campaign.battle?.roster.all() ?? []) {
    const inv = m.soldier.inv;
    const kept = inv.find((o) => o.item === letter);
    for (let slot = 0; slot < inv.length; slot++) inv[slot] = emptyObject();
    inv[InvSlot.HAND] = createItem(items, index(items, PISTOL), FULL);
    inv[InvSlot.SMALLPOCK1] = createItems(items, index(items, MAGAZINE), FULL, MAGAZINES);
    if (kept) inv[InvSlot.SMALLPOCK2] = kept;
  }
}
