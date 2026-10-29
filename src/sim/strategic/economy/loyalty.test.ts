import { beforeAll, describe, expect, it } from 'vitest';
import {
  type EconomyTestContent,
  economyTestContext,
  loadEconomyTestContent,
  setPlayerControlled,
  setTownNames,
} from '../../../../tests/support/economy.ts';
import { parseSectorString } from '../../../content/strategic/sector-ids.ts';
import { initializeMapStructure } from '../map/init.ts';
import { sectorInfo } from '../map/sectors.ts';
import { Fact } from '../narrative/fact-ids.ts';
import { setFact } from '../narrative/facts.ts';
import { LoyaltyEvent, Town } from './constants.ts';
import {
  affectAllTownsLoyaltyByDistanceFrom,
  checkIfEntireTownHasBeenLiberated,
  decrementTownLoyalty,
  distancePercentAdjustment,
  handleGlobalLoyaltyEvent,
  incrementTownLoyalty,
  onSectorLiberated,
  onSectorTakenByEnemy,
  reduceLoyaltyForRebelsBetrayed,
  setTownLoyalty,
  shortestTownDistances,
  startTownLoyaltyIfFirstTime,
  theftChance,
} from './loyalty.ts';
import { initializeMines } from './mines.ts';

let content: EconomyTestContent;
beforeAll(async () => {
  content = await loadEconomyTestContent();
});

function context(facts: Record<number, number> = {}, rebelsHostile = false) {
  const { ctx } = economyTestContext({ content, setup: { hooks: { rebelsHostile: () => rebelsHostile } } });
  for (const [id, value] of Object.entries(facts)) setFact(ctx.state.narrative, Number(id), value);
  initializeMapStructure(ctx);
  setTownNames(ctx);
  return ctx;
}

describe('town loyalty accumulator', () => {
  it('starts towns at sentiment, halved before Miguel reads the letter, Omerta at 0', () => {
    const before = context();
    startTownLoyaltyIfFirstTime(before, Town.DRASSEN);
    startTownLoyaltyIfFirstTime(before, Town.OMERTA);
    startTownLoyaltyIfFirstTime(before, Town.TIXA);
    expect(before.state.economy.towns[Town.DRASSEN]).toMatchObject({ rating: 15, started: true });
    expect(before.state.economy.towns[Town.OMERTA]).toMatchObject({ rating: 0, started: true });
    expect(before.state.economy.towns[Town.TIXA]?.started).toBe(false);
    const after = context({ [Fact.MIGUEL_READ_LETTER]: 1 });
    startTownLoyaltyIfFirstTime(after, Town.DRASSEN);
    startTownLoyaltyIfFirstTime(after, Town.OMERTA);
    expect(after.state.economy.towns[Town.DRASSEN]?.rating).toBe(30);
    expect(after.state.economy.towns[Town.OMERTA]?.rating).toBe(90);
  });

  it('scales by sentiment and keeps the remainder', () => {
    const ctx = context();
    setTownLoyalty(ctx, Town.DRASSEN, 50);
    incrementTownLoyalty(ctx, Town.DRASSEN, 1312);
    expect(ctx.state.economy.towns[Town.DRASSEN]).toMatchObject({ rating: 53, change: 468 });
    setTownLoyalty(ctx, Town.MEDUNA, 50);
    decrementTownLoyalty(ctx, Town.MEDUNA, 750);
    expect(ctx.state.economy.towns[Town.MEDUNA]).toMatchObject({ rating: 47, change: 0 });
  });

  it('keeps the sign of a negative remainder and floors at 0', () => {
    const ctx = context();
    setTownLoyalty(ctx, Town.ALMA, 10);
    decrementTownLoyalty(ctx, Town.ALMA, 120);
    expect(ctx.state.economy.towns[Town.ALMA]).toMatchObject({ rating: 10, change: -200 });
    decrementTownLoyalty(ctx, Town.ALMA, 240);
    expect(ctx.state.economy.towns[Town.ALMA]).toMatchObject({ rating: 9, change: -100 });
    decrementTownLoyalty(ctx, Town.ALMA, 100000);
    expect(ctx.state.economy.towns[Town.ALMA]).toMatchObject({ rating: 0, change: 0 });
  });

  it('caps at 100, and Omerta at 10 while the rebels are hostile, zeroing the remainder', () => {
    const ctx = context();
    setTownLoyalty(ctx, Town.DRASSEN, 99);
    incrementTownLoyalty(ctx, Town.DRASSEN, 400);
    expect(ctx.state.economy.towns[Town.DRASSEN]).toMatchObject({ rating: 100, change: 0 });
    const hostile = context({}, true);
    setTownLoyalty(hostile, Town.OMERTA, 5);
    incrementTownLoyalty(hostile, Town.OMERTA, 10000);
    expect(hostile.state.economy.towns[Town.OMERTA]).toMatchObject({ rating: 10, change: 0 });
  });

  it('applies big changes in chunks of 10000', () => {
    const ctx = context();
    setTownLoyalty(ctx, Town.OMERTA, 0);
    incrementTownLoyalty(ctx, Town.OMERTA, 10000);
    expect(ctx.state.economy.towns[Town.OMERTA]).toMatchObject({ rating: 90, change: 0 });
  });

  it('ignores towns that have not started', () => {
    const ctx = context();
    incrementTownLoyalty(ctx, Town.DRASSEN, 5000);
    expect(ctx.state.economy.towns[Town.DRASSEN]).toMatchObject({ rating: 0, change: 0, started: false });
  });

  it('starts every loyalty town when the rebels are betrayed, so a town not taken yet starts at 0 instead of its sentiment', () => {
    const ctx = context({ [Fact.MIGUEL_READ_LETTER]: 1 });
    setTownLoyalty(ctx, Town.DRASSEN, 60);
    reduceLoyaltyForRebelsBetrayed(ctx);
    expect(ctx.state.economy.towns[Town.DRASSEN]).toMatchObject({ rating: 20, started: true });
    expect(ctx.state.economy.towns[Town.ALMA]).toMatchObject({ rating: 0, started: true });
    expect(ctx.state.economy.towns[Town.TIXA]?.started).toBe(false);
    startTownLoyaltyIfFirstTime(ctx, Town.ALMA);
    expect(ctx.state.economy.towns[Town.ALMA]?.rating).toBe(0);
  });
});

describe('distance-adjusted global events', () => {
  it('maps distances to percentages with the -100 floor', () => {
    expect([0, 1, 2, 3, 4, 13, 20, 999999].map(distancePercentAdjustment)).toEqual([75, 50, 25, 0, -10, -100, -100, -100]);
  });

  it('finds 0 for the town of the event sector and positive distances elsewhere', () => {
    const ctx = context();
    const d = shortestTownDistances(ctx, parseSectorString('D13'));
    expect(d[Town.DRASSEN]).toBe(0);
    expect(d[Town.ALMA]).toBeGreaterThan(3);
    expect(ctx.state.forces.groups).toHaveLength(0);
  });

  it('gives Drassen +2 and a remainder for a battle won in D13, at distance 0 and sentiment 30', () => {
    const ctx = context();
    setTownLoyalty(ctx, Town.DRASSEN, 50);
    handleGlobalLoyaltyEvent(ctx, LoyaltyEvent.BATTLE_WON, parseSectorString('D13'));
    expect(ctx.state.economy.towns[Town.DRASSEN]).toMatchObject({ rating: 52, change: 312 });
  });

  it('doubles distance underground and ignores San Mona events', () => {
    const ctx = context();
    setTownLoyalty(ctx, Town.DRASSEN, 50);
    affectAllTownsLoyaltyByDistanceFrom(ctx, 500, parseSectorString('E13', 1));
    expect(ctx.state.economy.towns[Town.DRASSEN]).toMatchObject({ rating: 51, change: 437 });
    const before = { ...ctx.state.economy.towns[Town.DRASSEN] };
    handleGlobalLoyaltyEvent(ctx, LoyaltyEvent.BATTLE_LOST, parseSectorString('C5'));
    expect(ctx.state.economy.towns[Town.DRASSEN]).toEqual(before);
  });
});

describe('sector control effects', () => {
  it('raises town, mine and liberation events once on a contested capture', () => {
    const morale: string[] = [];
    const { ctx } = economyTestContext({ content, setup: { hooks: { moraleEvent: (k) => morale.push(k) } } });
    initializeMapStructure(ctx);
    setTownNames(ctx);
    initializeMines(ctx);
    const drassen = content.strategic.towns.find((t) => t.townId === Town.DRASSEN);
    setPlayerControlled(ctx, drassen?.sectors ?? []);
    setTownLoyalty(ctx, Town.DRASSEN, 30);
    const d13 = parseSectorString('D13');
    onSectorLiberated(ctx, { sector: d13, townId: Town.DRASSEN, samId: -1, firstTime: true });
    expect(morale).toEqual(['TOWN_LIBERATED', 'MINE_LIBERATED']);
    expect(ctx.state.economy.towns[Town.DRASSEN]?.liberatedAlready).toBe(true);
    expect(ctx.state.map.activity.lastDayOfPlayerActivity).toBe(3);
    const rating = ctx.state.economy.towns[Town.DRASSEN]?.rating;
    checkIfEntireTownHasBeenLiberated(ctx, Town.DRASSEN, d13);
    expect(ctx.state.economy.towns[Town.DRASSEN]?.rating).toBe(rating);
  });

  it('caps theft at 90 and steals in a visited sector at every takeover, also one the enemy already held (reinforcements)', () => {
    const thefts: number[] = [];
    const { ctx } = economyTestContext({ content, setup: { hooks: { removeRandomItemsInSector: (_, c) => thefts.push(c) } } });
    initializeMapStructure(ctx);
    const s = parseSectorString('B13');
    sectorInfo(ctx.state.map, s).numTroops = 30;
    expect(theftChance(ctx, s)).toBe(90);
    sectorInfo(ctx.state.map, s).flags = 0x20;
    onSectorTakenByEnemy(ctx, s, false);
    expect(thefts).toEqual([90]);
  });
});
