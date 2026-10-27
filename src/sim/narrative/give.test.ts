import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { type FakeHost, fakeHost, NPC_TYPE, recordArray } from '../../../tests/support/narrative.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { createItem, createMoney, type ItemObject } from '../items/object.ts';
import { Npc } from '../strategic/narrative/npc-ids.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { InvSlot, NUM_INV_SLOTS } from '../tactical/inventory.ts';
import { type Soldier, Team } from '../tactical/soldier.ts';
import type { TacticalSim } from '../tactical/tactical-sim.ts';
import { handleNpcItemGiven, placeObjectInSoldierProfile, returnItemToPlayer, takeGivenObject } from './give.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const NPC = 94;
const MERC = 3;
const NPC_ID = 60;
const MERC_ID = 0;
const item = (name: string) => content.items.byName.get(name)?.index ?? -1;

interface Scene {
  readonly sim: TacticalSim;
  readonly host: FakeHost;
  readonly npc: Soldier;
  readonly merc: Soldier;
}

function scene(npcProfile = NPC, mercAt = gridNo(81, 80)): Scene {
  const sim = newCombatSim(content);
  const npc = spawnSoldier(sim, NPC_ID, Team.CIV, gridNo(80, 80), Direction.EAST, { profile: npcProfile });
  const merc = spawnSoldier(sim, MERC_ID, Team.OUR, mercAt, Direction.WEST, { profile: MERC });
  const base = fakeHost({
    scripts: { [npcProfile]: recordArray({}) },
    types: { [npcProfile]: NPC_TYPE },
    profiles: { [npcProfile]: {}, [MERC]: {} },
  });
  const host: FakeHost = { ...base, tactical: () => sim.state };
  return { sim, host, npc, merc };
}

function gun(status: number): ItemObject {
  const o = createItem(content.items, item('GLOCK_17'), status);
  o.gunShotsLeft = 3;
  const first = o.attachments[0];
  if (first) Object.assign(first, { item: item('SILENCER'), status: 80 });
  return o;
}

describe('taking an item into the NPC profile (PlaceObjectInSoldierProfile, docs/24 §4.4)', () => {
  it('fills the first free pocket and gives the soldier a fresh item: attachments and ammo are lost', () => {
    const { sim, host, npc } = scene();
    expect(placeObjectInSoldierProfile(host, sim.state, NPC, gun(55))).toBe(true);
    const p = host.profile(NPC);
    expect(p?.inventory[InvSlot.BIGPOCK1]).toBe(item('GLOCK_17'));
    expect(p?.inventoryStatus[InvSlot.BIGPOCK1]).toBe(55);
    expect(p?.inventoryCount[InvSlot.BIGPOCK1]).toBe(1);
    const fresh = npc.inv[InvSlot.BIGPOCK1];
    expect(fresh?.item).toBe(item('GLOCK_17'));
    expect(fresh?.status[0]).toBe(55);
    expect(fresh?.gunShotsLeft).toBeGreaterThan(3);
    expect(fresh?.attachments.every((a) => a.item === 0)).toBe(true);
  });

  it('never uses the last small pocket: with every other pocket taken the item vanishes', () => {
    const { sim, host, npc } = scene();
    const p = host.profile(NPC);
    for (let k: number = InvSlot.BIGPOCK1; k < InvSlot.SMALLPOCK8; k++) if (p) p.inventoryCount[k] = 1;
    expect(placeObjectInSoldierProfile(host, sim.state, NPC, gun(90))).toBe(false);
    expect(npc.inv[InvSlot.SMALLPOCK8]?.item ?? 0).toBe(0);
  });

  it('keeps money as a sum: the first pile takes a free pocket unmarked, later money rebuilds the pile', () => {
    const { sim, host, npc } = scene();
    placeObjectInSoldierProfile(host, sim.state, NPC, createMoney(content.items, 300));
    const p = host.profile(NPC);
    expect(p?.money).toBe(300);
    expect(p?.inventoryCount[InvSlot.BIGPOCK1]).toBe(0);
    expect(npc.inv[InvSlot.BIGPOCK1]).toMatchObject({ item: item('MONEY'), money: 300 });
    placeObjectInSoldierProfile(host, sim.state, NPC, createMoney(content.items, 200));
    expect(p?.money).toBe(500);
    const piles = npc.inv.filter((o) => o.item === item('MONEY'));
    expect(piles.map((o) => o.money)).toEqual([500]);
  });

  it('drops the attachments of a gun given to Madlab at his feet', () => {
    const { sim, host, npc } = scene(Npc.MADLAB);
    placeObjectInSoldierProfile(host, sim.state, Npc.MADLAB, gun(70));
    const silencer = sim.state.worldItems.find((wi) => wi.object.item === item('SILENCER'));
    expect(silencer?.gridNo).toBe(npc.gridNo);
    expect(silencer?.level).toBe(0);
  });

  it('reports the taken object without removing anything more from the giving merc', () => {
    const { host, merc } = scene();
    const pocket = createItem(content.items, item('CANTEEN'), 100);
    Object.assign(merc.inv[InvSlot.BIGPOCK2] as object, pocket);
    takeGivenObject(host, NPC, createItem(content.items, item('CANTEEN'), 100), MERC);
    expect(merc.inv[InvSlot.BIGPOCK2]?.item).toBe(item('CANTEEN'));
    expect(host.emitted).toContainEqual(expect.objectContaining({ type: 'npcTookItem', npc: NPC_ID, profile: NPC, from: MERC_ID }));
  });
});

describe('returning a refused item (ReturnItemToPlayer)', () => {
  it('puts it back into the merc’s pockets, or drops it at his feet when they are full', () => {
    const { sim, host, merc } = scene();
    returnItemToPlayer(host, MERC, createItem(content.items, item('CANTEEN'), 100));
    expect(merc.inv.some((o) => o.item === item('CANTEEN'))).toBe(true);
    for (let k = 0; k < NUM_INV_SLOTS; k++) {
      const slot = merc.inv[k];
      if (slot && slot.item === 0) Object.assign(slot, createItem(content.items, item('CROWBAR'), 100));
    }
    returnItemToPlayer(host, MERC, createItem(content.items, item('CROWBAR'), 50));
    expect(sim.state.worldItems.some((wi) => wi.object.item === item('CROWBAR') && wi.gridNo === merc.gridNo)).toBe(true);
    expect(host.emitted.at(-1)).toMatchObject({ type: 'itemReturned', to: MERC_ID, dropped: true });
  });
});

describe('an NPC giving its gift (HandleNPCItemGiven, docs/24 §4.5)', () => {
  it('drops a copy at the NPC when the talker is out of reach; the NPC keeps its own', () => {
    const { sim, host, npc } = scene(NPC, gridNo(80, 120));
    Object.assign(npc.inv[InvSlot.BIGPOCK1] as object, createItem(content.items, item('CANTEEN'), 100));
    host.talk.inPanel = true;
    host.context.src = MERC_ID;
    host.context.dest = NPC_ID;
    handleNpcItemGiven(host, NPC, InvSlot.BIGPOCK1);
    expect(sim.state.worldItems.some((wi) => wi.object.item === item('CANTEEN') && wi.gridNo === npc.gridNo)).toBe(true);
    expect(npc.inv[InvSlot.BIGPOCK1]?.item).toBe(item('CANTEEN'));
    expect(host.emitted).toContainEqual(expect.objectContaining({ type: 'npcGaveItem', npc: NPC_ID, to: null, dropped: true }));
  });

  it('closes the panel and walks the NPC over to hand it to the talker', () => {
    const { host, npc, merc } = scene(NPC, gridNo(83, 80));
    Object.assign(npc.inv[InvSlot.BIGPOCK1] as object, createItem(content.items, item('CANTEEN'), 100));
    host.talk.inPanel = true;
    host.context.src = MERC_ID;
    host.context.dest = NPC_ID;
    handleNpcItemGiven(host, NPC, InvSlot.BIGPOCK1);
    expect(host.talk.inPanel).toBe(false);
    expect(npc.pendingGive).toMatchObject({ target: merc.id, slot: InvSlot.BIGPOCK1 });
    expect(npc.tempObject?.item).toBe(item('CANTEEN'));
  });
});
