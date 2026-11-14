import { beforeAll, describe, expect, it } from 'vitest';
import { hintAnswer, newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { createItem } from '../items/object.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { InvSlot } from '../tactical/inventory.ts';
import { Team } from '../tactical/soldier.ts';
import type { ItemInfo } from './item-info.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function item(name: string): number {
  const def = content.items.byName.get(name);
  if (!def) throw new Error(`no item ${name}`);
  return def.index;
}

const GUN_STATUS = 64;
const EXTENDER_STATUS = 90;
const LAUNCHER_STATUS = 55;

describe('the description box numbers of an object in a pocket (RenderItemDescriptionBox)', () => {
  it('reads the object in the slot with its attachments, not a new object of its type', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const gun = createItem(content.items, item('M14'), GUN_STATUS);
    const [extender] = gun.attachments;
    if (!extender) throw new Error('no attachment slot');
    extender.item = item('GUN_BARREL_EXTENDER');
    extender.status = EXTENDER_STATUS;
    merc.inv[InvSlot.HAND] = gun;
    const held = hintAnswer(sim, 'itemInfo', { soldier: merc.id, slot: 'hand' });
    const type = hintAnswer(sim, 'itemInfo', { item: item('M14') });
    expect([held.ok, type.ok]).toEqual([true, true]);
    const heldStats = (held.data as ItemInfo).weapon;
    const typeStats = (type.data as ItemInfo).weapon;
    expect(heldStats?.status).toBe(GUN_STATUS);
    expect(heldStats?.range?.value).toBeGreaterThan(typeStats?.range?.value ?? 0);
  });

  it('describes an attachment as a new object of its item at its status (ItemDescAttachmentsCallbackSecondary)', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const gun = createItem(content.items, item('M14'), GUN_STATUS);
    const [launcher] = gun.attachments;
    if (!launcher) throw new Error('no attachment slot');
    launcher.item = item('UNDER_GLAUNCHER');
    launcher.status = LAUNCHER_STATUS;
    merc.inv[InvSlot.HAND] = gun;
    const answer = hintAnswer(sim, 'itemInfo', { soldier: merc.id, slot: 'hand', attachment: 0 });
    expect(answer.ok, answer.reason).toBe(true);
    expect(answer.data).toMatchObject({ item: item('UNDER_GLAUNCHER'), kind: 'weapon', weapon: { status: LAUNCHER_STATUS } });
    expect(hintAnswer(sim, 'itemInfo', { soldier: merc.id, slot: 'hand', attachment: 1 }).data).toMatchObject({
      refusal: 'noAttachment',
    });
  });
});
