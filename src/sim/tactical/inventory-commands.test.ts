import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { createItem, createItems } from '../items/object.ts';
import { animName } from './anim-states.ts';
import type { TacticalContent } from './content.ts';
import { InvSlot, itemIn } from './inventory.ts';
import { AP } from './points.ts';
import { type Soldier, Team } from './soldier.ts';
import type { TacticalSim } from './tactical-sim.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const item = (name: string) => content.items.byName.get(name)?.index ?? -1;
const itemAt = (s: Soldier, slot: number) => content.items.byIndex.get(itemIn(s.inv, slot))?.name ?? 'NOTHING';

function inCombat(sim: TacticalSim): void {
  spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 95), Direction.NORTH);
  sim.lookAround();
  expect(sim.state.inCombat).toBe(true);
}

describe('moving items inside one inventory', () => {
  it('puts a pocket item into the hand, swapping the old hand item back into the pocket, for free in combat', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('HAND_GRENADE'), 100);
    inCombat(sim);
    const before = merc.actionPoints;
    const moved = sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket1', to: 'hand' });
    expect(moved).toMatchObject({ ok: true, data: { item: 'HAND_GRENADE', count: 1 } });
    expect(itemAt(merc, InvSlot.HAND)).toBe('HAND_GRENADE');
    expect(itemAt(merc, InvSlot.BIGPOCK1)).toBe('GLOCK_17');
    expect(merc.actionPoints).toBe(before);
    expect(sim.drainEvents().find((e) => e.type === 'itemMoved')).toMatchObject({ soldier: 0, item: 'HAND_GRENADE', from: 7, to: 5 });
  });

  it('moves one object of a stack with count 1 and refuses armour in the wrong slot', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.BIGPOCK1] = createItems(content.items, item('CLIP9_15'), 100, 4);
    merc.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('FLAK_JACKET'), 90);
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 7, to: 'smallPocket1', count: 1 })).toMatchObject({ ok: true });
    expect(merc.inv[InvSlot.BIGPOCK1]?.count).toBe(3);
    expect(merc.inv[InvSlot.SMALLPOCK1]?.count).toBe(1);
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket2', to: 'helmet' })).toMatchObject({
      ok: false,
      data: { refusal: 'doesNotFit' },
    });
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket2', to: 'vest' })).toMatchObject({ ok: true });
    expect(itemAt(merc, InvSlot.VEST)).toBe('FLAK_JACKET');
  });

  it('asks before merging on a hand item and attaches through attach', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.HAND] = createItem(content.items, item('FIRSTAIDKIT'), 40);
    merc.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('FIRSTAIDKIT'), 30);
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket1', to: 'hand' })).toMatchObject({
      ok: false,
      data: { refusal: 'mergePrompt' },
    });
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket1', to: 'hand', merge: true })).toMatchObject({
      ok: true,
      data: { result: 'merged' },
    });
    expect(merc.inv[InvSlot.HAND]?.status[0]).toBe(70);
    expect(itemAt(merc, InvSlot.BIGPOCK1)).toBe('NOTHING');
    merc.inv[InvSlot.HAND] = createItem(content.items, item('GLOCK_17'), 100);
    merc.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('SILENCER'), 90);
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket2', to: 'hand' })).toMatchObject({
      ok: false,
      data: { refusal: 'useAttach' },
    });
    expect(sim.dispatch({ type: 'attach', soldier: 0, item: 'bigPocket2', to: 'hand' })).toMatchObject({
      ok: true,
      data: { result: 'attached' },
    });
    expect(merc.inv[InvSlot.HAND]?.attachments[0]?.item).toBe(item('SILENCER'));
    expect(sim.dispatch({ type: 'detach', soldier: 0, slot: 'hand', attachment: 'SILENCER' })).toMatchObject({ ok: true });
    expect(merc.inv.some((o) => o.item === item('SILENCER'))).toBe(true);
    expect(merc.inv[InvSlot.HAND]?.attachments[0]?.item).toBe(0);
  });

  it('swaps the hands and lowers a rifle when the pistol comes up', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { gun: 'MP5K' });
    merc.inv[InvSlot.SECOND_HAND] = createItem(content.items, item('GLOCK_17'), 100);
    expect(sim.dispatch({ type: 'swapHands', soldier: 0 })).toEqual({ ok: true });
    expect(itemAt(merc, InvSlot.HAND)).toBe('GLOCK_17');
    expect(itemAt(merc, InvSlot.SECOND_HAND)).toBe('MP5K');
    expect(['LOWER_RIFLE', 'STANDING']).toContain(animName(t.content, merc.state));
  });
});

describe('reloading and unloading', () => {
  it('unloads for free, reloads by hand for 5 AP in combat and 10 AP with a magazine of another size', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.BIGPOCK1] = createItems(content.items, item('CLIP9_15'), 100, 2);
    merc.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('CLIP9_30'), 100);
    inCombat(sim);
    const ap = merc.actionPoints;
    expect(sim.dispatch({ type: 'unload', soldier: 0 })).toMatchObject({ ok: true, data: { magazine: 'CLIP9_15', rounds: 15 } });
    expect(merc.inv[InvSlot.HAND]?.gunShotsLeft).toBe(0);
    expect(merc.actionPoints).toBe(ap);
    expect(sim.dispatch({ type: 'unload', soldier: 0 })).toMatchObject({ ok: false, data: { refusal: 'gunEmpty' } });
    expect(sim.dispatch({ type: 'reload', soldier: 0 })).toMatchObject({ ok: true, data: { shots: 15 } });
    expect(ap - merc.actionPoints).toBe(AP.RELOAD_GUN);
    merc.inv[InvSlot.HAND] = { ...(merc.inv[InvSlot.HAND] as NonNullable<(typeof merc.inv)[number]>), gunShotsLeft: 0 };
    const before = merc.actionPoints;
    expect(sim.dispatch({ type: 'reload', soldier: 0, ammo: 'bigPocket2' })).toMatchObject({ ok: true, data: { shots: 15 } });
    expect(before - merc.actionPoints).toBe(2 * AP.RELOAD_GUN);
    expect(sim.dispatch({ type: 'reload', soldier: 0, ammo: 'bigPocket1', slot: 'vest' })).toMatchObject({
      ok: false,
      data: { refusal: 'emptySlot' },
    });
  });

  it('refuses ammunition of another calibre and a reload without ammo', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('CLIP45_7'), 100);
    expect(sim.dispatch({ type: 'reload', soldier: 0, ammo: 'bigPocket1' })).toMatchObject({ ok: false, data: { refusal: 'wrongAmmo' } });
    expect(sim.dispatch({ type: 'reload', soldier: 0 })).toMatchObject({ ok: false, data: { refusal: 'noAmmo' } });
  });
});

describe('passing items between mercs', () => {
  it('charges 2 AP to each merc in combat and needs both to have 3', () => {
    const sim = newCombatSim(content);
    const a = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const b = spawnSoldier(sim, 1, Team.OUR, gridNo(81, 81), Direction.NORTH);
    a.inv[InvSlot.BIGPOCK1] = createItems(content.items, item('CLIP9_15'), 100, 2);
    inCombat(sim);
    const apA = a.actionPoints;
    const apB = b.actionPoints;
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket1', toSoldier: 1, to: 'bigPocket1' })).toMatchObject({ ok: true });
    expect(b.inv[InvSlot.BIGPOCK1]?.count).toBe(2);
    expect(apA - a.actionPoints).toBe(2);
    expect(apB - b.actionPoints).toBe(2);
    b.actionPoints = 2;
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'hand', toSoldier: 1, to: 'bigPocket2' })).toMatchObject({
      ok: false,
      data: { refusal: 'notEnoughAP' },
    });
  });

  it('refuses a merc out of passing range', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    spawnSoldier(sim, 1, Team.OUR, gridNo(86, 80), Direction.NORTH);
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'hand', toSoldier: 1, to: 'bigPocket1' })).toMatchObject({
      ok: false,
      data: { refusal: 'tooFar' },
    });
  });
});

describe('items applied to a merc and dropped', () => {
  it('drinks from a canteen for 5 AP and gets breath back', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('CANTEEN'), 100);
    inCombat(sim);
    merc.breathRed = 5000;
    merc.breath = merc.breathMax - 50;
    const ap = merc.actionPoints;
    const breath = merc.breath;
    expect(sim.dispatch({ type: 'applyItem', soldier: 0, slot: 'bigPocket1' })).toMatchObject({ ok: true, data: { item: 'CANTEEN' } });
    expect(ap - merc.actionPoints).toBe(AP.DRINK);
    expect(merc.breath).toBeGreaterThan(breath);
    expect(merc.inv[InvSlot.BIGPOCK1]?.status[0]).toBe(80);
  });

  it('paints camouflage and refuses drugs', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('CAMOUFLAGEKIT'), 100);
    merc.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('ADRENALINE_BOOSTER'), 100);
    expect(sim.dispatch({ type: 'applyItem', soldier: 0, slot: 'bigPocket1' })).toMatchObject({ ok: true });
    expect(merc.camo).toBe(100);
    expect(merc.inv[InvSlot.BIGPOCK1]?.status[0]).toBe(50);
    expect(sim.dispatch({ type: 'applyItem', soldier: 0, slot: 'bigPocket2' })).toMatchObject({
      ok: false,
      data: { refusal: 'notPorted' },
    });
  });

  it('drops one magazine of a stack at the feet', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.BIGPOCK1] = createItems(content.items, item('CLIP9_15'), 100, 3);
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket1', to: 'ground', count: 1 })).toEqual({ ok: true });
    runUntilIdle(sim);
    expect(merc.inv[InvSlot.BIGPOCK1]?.count).toBe(2);
    expect(sim.visibleItems()).toMatchObject([{ gridNo: merc.gridNo, item: 'CLIP9_15', count: 1 }]);
  });
});
