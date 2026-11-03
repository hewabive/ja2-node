import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { Terrain } from '../../content/world/terrain.ts';
import type { ItemsPickedUpEvent, SimEvent } from '../events.ts';
import { createItem } from '../items/object.ts';
import { changeSoldierStance } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { InvSlot, itemIn } from './inventory.ts';
import { adjustGridNoForItemPlacement, apsToPickupItem, apsToReachItems, soldierPickupItem } from './item-actions.ts';
import { MercQuote, QuoteSaidFlag } from './narrative/merc-quotes.ts';
import type { QuoteSaidRecord } from './narrative/port.ts';
import { AP } from './points.ts';
import { type Soldier, Team } from './soldier.ts';
import type { TacticalSim } from './tactical-sim.ts';
import { addItemToPool, Visibility, WorldItemFlags } from './world-items.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const item = (name: string) => content.items.byName.get(name)?.index ?? -1;

describe('picking up and dropping items', () => {
  it('picks up every visible item on the tile with the pickup animation and charges AP_PICKUP_ITEM once', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 95), Direction.NORTH);
    sim.lookAround();
    expect(t.inCombat).toBe(true);
    addItemToPool(t, merc.gridNo, createItem(t.content.items, item('CANTEEN'), 100), Visibility.VISIBLE, 0);
    addItemToPool(t, merc.gridNo, createItem(t.content.items, item('CROWBAR'), 90), Visibility.VISIBLE, 0);
    addItemToPool(t, merc.gridNo, createItem(t.content.items, item('WIRECUTTERS'), 90), Visibility.INVISIBLE, 0);
    const before = merc.actionPoints;
    expect(sim.dispatch({ type: 'pickUp', soldier: 0 })).toEqual({ ok: true });
    expect(t.content.animations.controls[merc.state]?.id).toBe('PICKUP_ITEM');
    const events = runUntilIdle(sim);
    expect(events.find((e) => e.type === 'itemsPickedUp')).toMatchObject({ soldier: 0, gridNo: merc.gridNo });
    expect(before - merc.actionPoints).toBe(AP.PICKUP_ITEM);
    expect(merc.inv.some((o) => o.item === item('CANTEEN'))).toBe(true);
    expect(merc.inv.some((o) => o.item === item('CROWBAR'))).toBe(true);
    expect(t.worldItems.map((wi) => wi.object.item)).toEqual([item('WIRECUTTERS')]);
  });

  it('picks up a chosen item at once when crouched', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    changeSoldierStance(t, merc, 3);
    runUntilIdle(sim);
    addItemToPool(t, merc.gridNo, createItem(t.content.items, item('CANTEEN'), 100), Visibility.VISIBLE, 0);
    addItemToPool(t, merc.gridNo, createItem(t.content.items, item('CROWBAR'), 90), Visibility.VISIBLE, 0);
    expect(sim.dispatch({ type: 'pickUp', soldier: 0, items: [1] })).toEqual({ ok: true });
    expect(merc.inv.some((o) => o.item === item('CROWBAR'))).toBe(true);
    expect(merc.inv.some((o) => o.item === item('CANTEEN'))).toBe(false);
    expect(t.worldItems).toHaveLength(1);
  });

  it('walks to an item elsewhere and picks it up on arrival', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    addItemToPool(t, gridNo(83, 80), createItem(t.content.items, item('CROWBAR'), 90), Visibility.VISIBLE, 0);
    expect(sim.dispatch({ type: 'pickUp', soldier: 0, gridNo: gridNo(83, 80) })).toEqual({ ok: true });
    const events = runUntilIdle(sim);
    expect(merc.gridNo).toBe(gridNo(83, 80));
    expect(events.some((e) => e.type === 'itemsPickedUp')).toBe(true);
    expect(merc.inv.some((o) => o.item === item('CROWBAR'))).toBe(true);
    expect(t.worldItems).toHaveLength(0);
  });

  it('picks up the items lying on a structure when no zLevel is given, as GetLargestZLevelOfItemPool does for a click on it', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const cabinet = gridNo(82, 80);
    addItemToPool(t, cabinet, createItem(t.content.items, item('CANTEEN'), 100), Visibility.VISIBLE, 0, WorldItemFlags.DONTRENDER, 40);
    expect(sim.dispatch({ type: 'pickUp', soldier: 0, gridNo: cabinet, zLevel: 0 })).toMatchObject({ ok: false });
    expect(sim.dispatch({ type: 'pickUp', soldier: 0, gridNo: cabinet })).toEqual({ ok: true });
    runUntilIdle(sim);
    expect(merc.inv.some((o) => o.item === item('CANTEEN'))).toBe(true);
  });

  it('approaches a pile under another soldier from a side tile, never from a diagonal one', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const pile = gridNo(80, 80);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(81, 79), Direction.SOUTH);
    spawnSoldier(sim, 1, Team.OUR, pile, Direction.SOUTH);
    addItemToPool(t, pile, createItem(t.content.items, item('CROWBAR'), 90), Visibility.VISIBLE, 0);
    expect(adjustGridNoForItemPlacement(t, merc, pile)).toBe(gridNo(80, 79));
    expect(sim.dispatch({ type: 'pickUp', soldier: 0, gridNo: pile })).toEqual({ ok: true });
    runUntilIdle(sim);
    expect(merc.gridNo).toBe(gridNo(80, 79));
    expect(merc.inv.some((o) => o.item === item('CROWBAR'))).toBe(true);
  });

  it('refuses a pickup in combat whose walk and pickup together cost more APs than he has', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 95), Direction.NORTH);
    sim.lookAround();
    expect(t.inCombat).toBe(true);
    const pile = gridNo(83, 80);
    addItemToPool(t, pile, createItem(t.content.items, item('CROWBAR'), 90), Visibility.VISIBLE, 0);
    const cost = apsToPickupItem(t, merc, pile);
    expect(cost).toBeGreaterThan(AP.PICKUP_ITEM);
    merc.actionPoints = cost - 1;
    expect(sim.dispatch({ type: 'pickUp', soldier: 0, gridNo: pile })).toMatchObject({ ok: false, data: { refusal: 'notEnoughAP' } });
    merc.actionPoints = cost;
    expect(sim.dispatch({ type: 'pickUp', soldier: 0, gridNo: pile })).toEqual({ ok: true });
  });

  it('drops the hand item at the drop animation code and shows it to the squad', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const gun = itemIn(merc.inv, InvSlot.HAND);
    expect(sim.dispatch({ type: 'drop', soldier: 0 })).toEqual({ ok: true });
    expect(t.worldItems).toHaveLength(0);
    const events = runUntilIdle(sim);
    expect(events.find((e) => e.type === 'itemDropped')).toMatchObject({ soldier: 0, gridNo: merc.gridNo });
    expect(itemIn(merc.inv, InvSlot.HAND)).toBe(0);
    expect(sim.visibleItems()).toEqual([
      { gridNo: merc.gridNo, level: 0, item: t.content.items.byIndex.get(gun)?.name, count: 1, status: 100 },
    ]);
  });

  it('refuses an escort’s pickup, search, drop, toss and pass, and a swimmer’s drop, as the hand cursor and the item cursor do', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const escort = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const mate = spawnSoldier(sim, 1, Team.OUR, gridNo(82, 80), Direction.WEST);
    t.narrative = { ...t.narrative, isEpc: (s) => s === escort };
    addItemToPool(t, escort.gridNo, createItem(t.content.items, item('CANTEEN'), 100), Visibility.VISIBLE, 0);
    const refusal = (cmd: { readonly type: string; readonly [key: string]: unknown }) => {
      const result = sim.dispatch({ soldier: 0, ...cmd });
      return result.ok ? null : result.data.refusal;
    };
    expect([
      refusal({ type: 'pickUp' }),
      refusal({ type: 'pickUp', gridNo: gridNo(80, 85) }),
      refusal({ type: 'drop' }),
      refusal({ type: 'toss', gridNo: gridNo(80, 90) }),
      refusal({ type: 'pass', target: mate.id }),
    ]).toEqual(['escortCannotDoThat', 'escortCannotDoThat', 'cannotDrop', 'cannotToss', 'cannotPass']);
    expect(t.worldItems).toHaveLength(1);
    const swimmer = spawnSoldier(sim, 2, Team.OUR, gridNo(90, 90), Direction.SOUTH);
    swimmer.overTerrain = Terrain.DEEP_WATER;
    expect(sim.dispatch({ type: 'drop', soldier: swimmer.id })).toMatchObject({ ok: false, data: { refusal: 'cannotDrop' } });
  });

  it('reveals items our mercs see and leaves unseen ones hidden', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    addItemToPool(t, gridNo(80, 84), createItem(t.content.items, item('CANTEEN'), 100), Visibility.INVISIBLE, 0);
    addItemToPool(t, gridNo(80, 70), createItem(t.content.items, item('CROWBAR'), 100), Visibility.INVISIBLE, 0);
    addItemToPool(t, gridNo(80, 85), createItem(t.content.items, item('WIRECUTTERS'), 100), Visibility.HIDDEN_ITEM, 0);
    sim.lookAround();
    expect(sim.visibleItems().map((i) => i.item)).toEqual(['CANTEEN']);
  });
});

const IVAN = 7;
const BARRY = 0;
const COOL_STATUS = 60;
const PICKUP_TICKS = 400;

interface PickupScene {
  readonly sim: TacticalSim;
  readonly merc: Soldier;
  readonly said: [number, number][];
  readonly flags: Map<number, QuoteSaidRecord>;
}

function pickupScene(profile: number, team: number = Team.OUR): PickupScene {
  const sim = newCombatSim(content);
  const t = sim.state;
  const merc = spawnSoldier(sim, team === Team.OUR ? 0 : 20, team, gridNo(80, 80), Direction.SOUTH, { profile });
  const said: [number, number][] = [];
  const flags = new Map<number, QuoteSaidRecord>();
  t.narrative = {
    ...t.narrative,
    sayQuote: (s, quote) => said.push([s.id, quote]),
    quoteSaidFlags: (s) => {
      const record = flags.get(s.id) ?? { quoteSaidFlags: 0, quoteSaidExtFlags: 0 };
      flags.set(s.id, record);
      return record;
    },
  };
  return { sim, merc, said, flags };
}

function pickUp(s: PickupScene, name: string, status = COOL_STATUS): ItemsPickedUpEvent | undefined {
  const t = s.sim.state;
  addItemToPool(t, s.merc.gridNo, createItem(t.content.items, item(name), status), Visibility.VISIBLE, 0);
  if (s.merc.team === Team.OUR) expect(s.sim.dispatch({ type: 'pickUp', soldier: s.merc.id })).toEqual({ ok: true });
  else soldierPickupItem(t, s.merc, s.merc.gridNo, 0, null);
  const events: SimEvent[] = [];
  for (let tick = 0; tick < PICKUP_TICKS; tick++) {
    s.sim.step();
    events.push(...s.sim.drainEvents());
  }
  return events.find((e): e is ItemsPickedUpEvent => e.type === 'itemsPickedUp');
}

describe('the found-something-special line (Handle_Items.cc SoldierGetItemFromWorld, Items.cc ItemIsCool)', () => {
  it('has a merc with that quote say it once for a weapon of deadliness 30 in 60% shape, and the GOTIT sound after that', () => {
    const s = pickupScene(IVAN);
    const found = pickUp(s, 'AK74');
    expect([s.said, found?.battleSound]).toEqual([[[s.merc.id, MercQuote.FOUND_SOMETHING_SPECIAL]], undefined]);
    expect((s.flags.get(s.merc.id)?.quoteSaidFlags ?? 0) & QuoteSaidFlag.FOUND_SOMETHING_NICE).toBe(QuoteSaidFlag.FOUND_SOMETHING_NICE);
    const again = pickUp(s, 'KEVLAR_VEST_Y');
    expect([s.said, again?.battleSound]).toEqual([[[s.merc.id, MercQuote.FOUND_SOMETHING_SPECIAL]], 'GOTIT']);
  });

  it('counts armour of protection 20 and a launcher as special', () => {
    const armour = pickupScene(IVAN);
    pickUp(armour, 'KEVLAR_VEST_Y');
    const launcher = pickupScene(IVAN);
    pickUp(launcher, 'GLAUNCHER');
    expect([armour.said, launcher.said]).toEqual([
      [[armour.merc.id, MercQuote.FOUND_SOMETHING_SPECIAL]],
      [[launcher.merc.id, MercQuote.FOUND_SOMETHING_SPECIAL]],
    ]);
  });

  it('gives the GOTIT sound for a worn, weak or plain item and for a merc whose gun quote is the kill line', () => {
    const cases: [number, string, number][] = [
      [IVAN, 'AK74', COOL_STATUS - 1],
      [IVAN, 'AKM', 100],
      [IVAN, 'KEVLAR_VEST_18', 100],
      [IVAN, 'CANTEEN', 100],
      [BARRY, 'AK74', 100],
    ];
    for (const [profile, name, status] of cases) {
      const s = pickupScene(profile);
      expect([pickUp(s, name, status)?.battleSound, s.said]).toEqual(['GOTIT', []]);
    }
  });

  it('keeps an enemy who picks something up quiet', () => {
    const s = pickupScene(IVAN, Team.ENEMY);
    const picked = pickUp(s, 'AK74');
    expect(picked).toBeDefined();
    expect([picked?.battleSound, s.said]).toEqual([undefined, []]);
  });
});

describe('the spotted-something line after hidden items are found (Handle_Items.cc LookForHiddenItems)', () => {
  function withCosmeticPick(s: PickupScene, pick: number): number[] {
    const draws: number[] = [];
    s.sim.state.narrative = {
      ...s.sim.state.narrative,
      cosmeticPick: (choices) => {
        draws.push(choices);
        return pick;
      },
    };
    return draws;
  }

  function hideWirecutters(s: PickupScene): void {
    const t = s.sim.state;
    addItemToPool(t, s.merc.gridNo, createItem(t.content.items, item('WIRECUTTERS'), 100), Visibility.HIDDEN_ITEM, 0);
  }

  it('has our merc who picks up and turns up a hidden item say one of the two lines, picked on the cosmetic stream (:1283-1290)', () => {
    const s = pickupScene(BARRY);
    const draws = withCosmeticPick(s, 1);
    hideWirecutters(s);
    pickUp(s, 'CANTEEN', 100);
    const wirecutters = s.sim.state.worldItems.find((wi) => wi.object.item === item('WIRECUTTERS'));
    expect([s.said, draws, wirecutters?.visible]).toEqual([[[s.merc.id, MercQuote.SPOTTED_SOMETHING_ONE + 1]], [2], Visibility.VISIBLE]);
  });

  it('has our merc who searches a tile of hidden items only say the line too (:1360-1365)', () => {
    const s = pickupScene(BARRY);
    const draws = withCosmeticPick(s, 0);
    hideWirecutters(s);
    soldierPickupItem(s.sim.state, s.merc, s.merc.gridNo, 0, null);
    for (let tick = 0; tick < PICKUP_TICKS; tick++) s.sim.step();
    expect([s.said, draws]).toEqual([[[s.merc.id, MercQuote.SPOTTED_SOMETHING_ONE]], [2]]);
  });

  it('keeps a merc who finds nothing hidden quiet and draws nothing', () => {
    const s = pickupScene(BARRY);
    const draws = withCosmeticPick(s, 1);
    pickUp(s, 'CANTEEN', 100);
    expect([s.said, draws]).toEqual([[], []]);
  });
});

describe('searching a tile that shows no item (Turn_Based_Input.cc HandleHandCursorClick, Handle_Items.cc HandleSoldierPickupItem)', () => {
  const nothingFound = (events: readonly SimEvent[]) => events.filter((e) => e.type === 'nothingFound');

  function combatScene(): { sim: TacticalSim; merc: Soldier } {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 95), Direction.NORTH);
    sim.lookAround();
    expect(sim.state.inCombat).toBe(true);
    return { sim, merc };
  }

  it('walks to the tile, searches it and says the NOTHING battle sound, paying only the walk (:1369)', () => {
    const { sim, merc } = combatScene();
    const tile = gridNo(83, 80);
    const walk = apsToReachItems(sim.state, merc, tile) - AP.PICKUP_ITEM;
    const before = merc.actionPoints;
    expect(sim.dispatch({ type: 'pickUp', soldier: 0, gridNo: tile })).toEqual({ ok: true });
    const events = runUntilIdle(sim);
    expect([merc.gridNo, nothingFound(events), before - merc.actionPoints]).toEqual([
      tile,
      [expect.objectContaining({ soldier: 0, gridNo: tile })],
      walk,
    ]);
  });

  it('turns up the hidden items of the searched tile with the spotted line and no NOTHING sound (:1360-1365)', () => {
    const s = pickupScene(BARRY);
    const t = s.sim.state;
    const tile = gridNo(82, 80);
    addItemToPool(t, tile, createItem(t.content.items, item('WIRECUTTERS'), 100), Visibility.HIDDEN_ITEM, 0);
    expect(s.sim.dispatch({ type: 'pickUp', soldier: s.merc.id, gridNo: tile })).toEqual({ ok: true });
    const events = runUntilIdle(s.sim);
    const wirecutters = t.worldItems.find((wi) => wi.object.item === item('WIRECUTTERS'));
    expect([s.said, wirecutters?.visible, nothingFound(events)]).toEqual([
      [[s.merc.id, MercQuote.SPOTTED_SOMETHING_ONE]],
      Visibility.VISIBLE,
      [],
    ]);
  });

  it('leaves a hidden item beside a buried one hidden: only a tile of hidden items alone is searched (all_hidden)', () => {
    const s = pickupScene(BARRY);
    const t = s.sim.state;
    addItemToPool(t, s.merc.gridNo, createItem(t.content.items, item('WIRECUTTERS'), 100), Visibility.HIDDEN_ITEM, 0);
    addItemToPool(t, s.merc.gridNo, createItem(t.content.items, item('CROWBAR'), 100), Visibility.BURIED, 0);
    expect(s.sim.dispatch({ type: 'pickUp', soldier: s.merc.id })).toEqual({ ok: true });
    const events = runUntilIdle(s.sim);
    expect([s.said, t.worldItems.map((wi) => wi.visible), nothingFound(events).length]).toEqual([
      [],
      [Visibility.HIDDEN_ITEM, Visibility.BURIED],
      1,
    ]);
  });

  it('has a merc below 30 morale refuse with his refusing-order line, and one at 30 search', () => {
    const s = pickupScene(BARRY);
    s.merc.morale = 29;
    expect(s.sim.dispatch({ type: 'pickUp', soldier: s.merc.id })).toMatchObject({ ok: false, data: { refusal: 'refusesOrder' } });
    expect(s.said).toEqual([[s.merc.id, MercQuote.REFUSING_ORDER]]);
    s.merc.morale = 30;
    expect(s.sim.dispatch({ type: 'pickUp', soldier: s.merc.id })).toEqual({ ok: true });
  });

  it('checks no APs: a merc short of the walk sets off and stops where they run out, one on the tile searches with none', () => {
    const { sim, merc } = combatScene();
    const tile = gridNo(84, 80);
    merc.actionPoints = apsToReachItems(sim.state, merc, tile) - AP.PICKUP_ITEM - 1;
    expect(sim.dispatch({ type: 'pickUp', soldier: 0, gridNo: tile })).toEqual({ ok: true });
    const walked = runUntilIdle(sim);
    expect([merc.gridNo !== tile, merc.gridNo !== gridNo(80, 80), merc.pendingPickup?.gridNo, nothingFound(walked)]).toEqual([
      true,
      true,
      tile,
      [],
    ]);
    const spent = combatScene();
    spent.merc.actionPoints = 0;
    expect(spent.sim.dispatch({ type: 'pickUp', soldier: 0 })).toEqual({ ok: true });
    expect(nothingFound(runUntilIdle(spent.sim))).toHaveLength(1);
  });

  it('keeps nothingThere for chosen items on a tile that shows none and for a height without items', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const cabinet = gridNo(82, 80);
    expect(sim.dispatch({ type: 'pickUp', soldier: 0, gridNo: cabinet, items: [0] })).toMatchObject({
      ok: false,
      data: { refusal: 'nothingThere' },
    });
    addItemToPool(t, cabinet, createItem(t.content.items, item('CANTEEN'), 100), Visibility.VISIBLE, 0, WorldItemFlags.DONTRENDER, 40);
    expect(sim.dispatch({ type: 'pickUp', soldier: 0, gridNo: cabinet, zLevel: 0 })).toMatchObject({
      ok: false,
      data: { refusal: 'nothingThere' },
    });
  });

  it('has a soldier whose pile is gone when he gets there say the NOTHING battle sound (:1313)', () => {
    const s = pickupScene(IVAN, Team.ENEMY);
    soldierPickupItem(s.sim.state, s.merc, s.merc.gridNo, 0, null);
    const events: SimEvent[] = [];
    for (let tick = 0; tick < PICKUP_TICKS; tick++) {
      s.sim.step();
      events.push(...s.sim.drainEvents());
    }
    expect(nothingFound(events)).toEqual([expect.objectContaining({ soldier: s.merc.id, gridNo: s.merc.gridNo })]);
  });
});
