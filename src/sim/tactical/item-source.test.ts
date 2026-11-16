import { beforeAll, describe, expect, it } from 'vitest';
import { hintAnswer, newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { DIRECTION_INCREMENT, Direction, gridNo } from '../../content/world/grid.ts';
import { createItems, createMoney } from '../items/object.ts';
import type { TacticalContent } from './content.ts';
import { InvSlot } from './inventory.ts';
import type { OutsideSource } from './item-source.ts';
import { type Soldier, Team } from './soldier.ts';
import type { TacticalSim } from './tactical-sim.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const ORIGIN = gridNo(70, 80);
const EAST = DIRECTION_INCREMENT[Direction.EAST] ?? 0;
const FAR_TILE = gridNo(76, 80);
const KEY_ID = 1;
const POSITION = 3;
const ITEM_KEY = 'KEY_1';

const keyItem = () => content.items.byName.get(ITEM_KEY)?.index ?? -1;

function holder(keys = 3): { sim: TacticalSim; merc: Soldier } {
  const sim = newCombatSim(content);
  const merc = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
  const ring = merc.keyRing ?? [];
  ring[POSITION] = { keyId: KEY_ID, count: keys };
  return { sim, merc };
}

const keysOnRing = (s: Soldier) => s.keyRing?.[POSITION]?.count ?? 0;
const keysOnGround = (sim: TacticalSim) =>
  sim.state.worldItems.filter((wi) => wi.object.item === keyItem()).map((wi) => ({ gridNo: wi.gridNo, count: wi.object.count }));
const keysCarried = (s: Soldier) => s.inv.filter((o) => o.item === keyItem()).reduce((n, o) => n + o.count, 0);

describe('keys taken off the key ring by the item cursor (BeginKeyRingItemPointer)', () => {
  it('drops one key at the feet and all keys of the position on the tile beside him', () => {
    const { sim, merc } = holder();
    expect(sim.dispatch({ type: 'drop', soldier: 0, slot: { ring: POSITION }, count: 1 })).toEqual({ ok: true });
    runUntilIdle(sim);
    expect(keysOnRing(merc)).toBe(2);
    expect(sim.dispatch({ type: 'drop', soldier: 0, slot: { ring: POSITION }, gridNo: ORIGIN + EAST })).toEqual({ ok: true });
    runUntilIdle(sim);
    expect(keysOnRing(merc)).toBe(0);
    expect(merc.keyRing?.[POSITION]?.keyId).not.toBe(KEY_ID);
    expect(keysOnGround(sim)).toEqual(
      expect.arrayContaining([
        { gridNo: ORIGIN, count: 1 },
        { gridNo: ORIGIN + EAST, count: 2 },
      ]),
    );
  });

  it('throws the keys of a position onto a far tile, which the toss preview lands', () => {
    const { sim, merc } = holder(2);
    const preview = hintAnswer(sim, 'previewAction', { soldier: 0, kind: 'toss', gridNo: FAR_TILE, slot: { ring: POSITION } });
    expect(preview).toMatchObject({ ok: true, data: { ok: true, landsAt: FAR_TILE } });
    expect(sim.dispatch({ type: 'toss', soldier: 0, slot: { ring: POSITION }, gridNo: FAR_TILE })).toEqual({ ok: true });
    runUntilIdle(sim);
    expect(keysOnRing(merc)).toBe(0);
    expect(keysOnGround(sim)).toEqual([{ gridNo: FAR_TILE, count: 2 }]);
  });

  it('passes a key to a merc within reach, and keeps on the ring what found no room with him', () => {
    const { sim, merc } = holder(2);
    const mate = spawnSoldier(sim, 1, Team.OUR, ORIGIN + 2 * EAST, Direction.WEST);
    expect(sim.dispatch({ type: 'pass', soldier: 0, slot: { ring: POSITION }, count: 1, target: 1 })).toEqual({
      ok: true,
      data: { passed: true },
    });
    expect(keysCarried(mate)).toBe(1);
    expect(keysOnRing(merc)).toBe(1);
    const laden = spawnSoldier(sim, 2, Team.OUR, ORIGIN - 2 * EAST, Direction.EAST);
    const gun = content.items.byName.get('GLOCK_17')?.index ?? 0;
    for (let slot = InvSlot.HAND; slot < laden.inv.length; slot++) laden.inv[slot] = createItems(content.items, gun, 100, 1);
    expect(sim.dispatch({ type: 'pass', soldier: 0, slot: { ring: POSITION }, target: 2 })).toEqual({ ok: true, data: { passed: false } });
    expect(keysOnRing(merc)).toBe(1);
    expect(keysCarried(laden)).toBe(0);
  });

  it('refuses an empty ring position and an index into it', () => {
    const { sim } = holder();
    expect(sim.dispatch({ type: 'drop', soldier: 0, slot: { ring: POSITION + 1 } })).toMatchObject({
      ok: false,
      data: { refusal: 'emptySlot' },
    });
    expect(sim.dispatch({ type: 'drop', soldier: 0, slot: { ring: POSITION }, index: 1 })).toMatchObject({
      ok: false,
      data: { refusal: 'badIndex' },
    });
    expect(sim.dispatch({ type: 'drop', soldier: 0, slot: { ring: 64 } })).toMatchObject({ ok: false, data: { refusal: 'badSlot' } });
  });
});

describe('an object from outside the pockets in the item cursor (RemoveMoney with the account)', () => {
  const WITHDRAWN = 500;
  const moneyItem = () => content.items.byName.get('MONEY')?.index ?? -1;
  const moneyOnGround = (sim: TacticalSim) =>
    sim.state.worldItems.filter((wi) => wi.object.item === moneyItem()).map((wi) => ({ gridNo: wi.gridNo, money: wi.object.money }));

  function withdrawal(): { readonly source: OutsideSource; readonly booked: () => number } {
    let booked = 0;
    return {
      source: {
        outside: createMoney(content.items, WITHDRAWN),
        taken: () => {
          booked++;
        },
      },
      booked: () => booked,
    };
  }

  function mercOf(sim: TacticalSim): Soldier {
    const merc = sim.soldier(0);
    if (!merc) throw new Error('no merc');
    return merc;
  }

  it('is thrown onto a far tile, which the toss preview of an account amount lands, and is taken once as it leaves his hand', () => {
    const { sim } = holder(0);
    const preview = hintAnswer(sim, 'previewAction', { soldier: 0, kind: 'toss', gridNo: FAR_TILE, account: WITHDRAWN });
    expect(preview).toMatchObject({ ok: true, data: { ok: true } });
    const landsAt = (preview.data as { landsAt: number }).landsAt;
    expect(hintAnswer(sim, 'previewAction', { soldier: 0, kind: 'toss', gridNo: FAR_TILE, account: 0 })).toMatchObject({
      data: { ok: false, refusal: 'badAmount' },
    });
    const close = withdrawal();
    expect(sim.tossFromCursor(mercOf(sim), { type: 'toss', soldier: 0, gridNo: ORIGIN + EAST }, close.source)).toMatchObject({
      ok: false,
      data: { refusal: 'tooClose' },
    });
    expect(close.booked()).toBe(0);
    const far = withdrawal();
    expect(sim.tossFromCursor(mercOf(sim), { type: 'toss', soldier: 0, gridNo: FAR_TILE }, far.source)).toEqual({ ok: true });
    expect(far.booked()).toBe(1);
    runUntilIdle(sim);
    expect(moneyOnGround(sim)).toEqual([{ gridNo: landsAt, money: WITHDRAWN }]);
  });

  it('is passed to a merc within reach and taken only once he has found room for it', () => {
    const { sim } = holder(0);
    const laden = spawnSoldier(sim, 2, Team.OUR, ORIGIN - 2 * EAST, Direction.EAST);
    const gun = content.items.byName.get('GLOCK_17')?.index ?? 0;
    for (let slot = InvSlot.HAND; slot < laden.inv.length; slot++) laden.inv[slot] = createItems(content.items, gun, 100, 1);
    const refused = withdrawal();
    expect(sim.passFromCursor(mercOf(sim), { type: 'pass', soldier: 0, target: 2 }, refused.source)).toEqual({
      ok: true,
      data: { passed: false },
    });
    expect(refused.booked()).toBe(0);
    const mate = spawnSoldier(sim, 1, Team.OUR, ORIGIN + 2 * EAST, Direction.WEST);
    const passed = withdrawal();
    expect(sim.passFromCursor(mercOf(sim), { type: 'pass', soldier: 0, target: 1 }, passed.source)).toEqual({
      ok: true,
      data: { passed: true },
    });
    expect(passed.booked()).toBe(1);
    expect(mate.inv.some((o) => o.item === moneyItem() && o.money === WITHDRAWN)).toBe(true);
  });
});
