import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { testProfile } from '../../../../tests/support/profiles.ts';
import { sectorShortString } from '../../../content/strategic/sector-ids.ts';
import { REPO_ROOT } from '../../../node/repo.ts';
import type { SectorPosition } from '../state.ts';
import { Fact } from './fact-ids.ts';
import { createNarrativeState, fact } from './facts.ts';
import { hourlyLarryUpdate, LARRY_BARS, LARRY_ITEMS, type LarryContext, type LarryOnTeam, swapLarrysProfileRecords } from './larry.ts';
import { Npc } from './npc-ids.ts';

const table = JSON.parse(readFileSync(join(REPO_ROOT, 'data/tables/narrative.json'), 'utf8')) as {
  larryItems: { item: string; temptation: number; points: number }[];
  larryBars: string[];
};

const ON_DUTY = 20;
const SQUAD = 0;
const BAR: SectorPosition = { x: 13, y: 4, z: 0 };
const ROAD: SectorPosition = { x: 12, y: 4, z: 0 };
const NO_SLOT = -1;
const HAND = 5;
const ALCOHOL_PRICE = 15;

interface Log {
  readonly calls: string[];
}

function larry(profile: number, items: Record<string, number>, sector = ROAD, overrides: Partial<LarryOnTeam> = {}): LarryOnTeam & Log {
  const calls: string[] = [];
  return {
    profile,
    assignment: SQUAD,
    betweenSectors: false,
    inLoadedSector: false,
    sector,
    findItem: (item) => items[item] ?? NO_SLOT,
    emptySlotForBooze: () => HAND,
    giveFullItem: (slot, item, status) => calls.push(`give ${slot} ${item} ${status}`),
    useKitPoints: (slot, points) => calls.push(`use ${slot} ${points}`),
    ...overrides,
    calls,
  };
}

function context(merc: LarryOnTeam & Log, npcData: number, rolls: readonly number[], balance = 1000): LarryContext & { ranges: number[] } {
  const narrative = createNarrativeState();
  const counter = testProfile(Npc.LARRY_NORMAL, { npcData });
  const values = [...rolls];
  const ranges: number[] = [];
  return {
    narrative,
    larry: () => merc,
    enemyInLoadedSectorOrTactical: () => true,
    balance: () => balance,
    alcoholPrice: () => ALCOHOL_PRICE,
    payForBooze: (profile, amount) => merc.calls.push(`pay ${profile} ${amount}`),
    normalProfile: () => counter,
    random: (n) => {
      ranges.push(n);
      return values.shift() ?? 0;
    },
    swapProfiles: () => merc.calls.push('swap'),
    onDutyAssignment: ON_DUTY,
    ranges,
  };
}

describe('HourlyLarryUpdate (docs/25 §4.4)', () => {
  it('keeps the transcribed items and bars', () => {
    expect(LARRY_ITEMS).toEqual(table.larryItems);
    expect(LARRY_BARS.map((b) => sectorShortString(b))).toEqual(table.larryBars);
  });

  it('lets sober Larry fall off the wagon over the first item he carries and uses its kit points', () => {
    const merc = larry(Npc.LARRY_NORMAL, { BEER: 9, WINE: 8 });
    const ctx = context(merc, 6, [2]);
    hourlyLarryUpdate(ctx);
    expect(ctx.ranges).toEqual([3]);
    expect(ctx.normalProfile()?.npcData).toBe(8);
    expect(merc.calls).toEqual(['swap', 'use 8 50']);
  });

  it('buys booze in a bar when nothing tempting is carried, and pays even without a free slot', () => {
    const merc = larry(Npc.LARRY_NORMAL, {}, BAR, { emptySlotForBooze: () => NO_SLOT });
    const ctx = context(merc, 7, [3]);
    hourlyLarryUpdate(ctx);
    expect(ctx.ranges).toEqual([4]);
    expect(merc.calls).toEqual([`pay ${Npc.LARRY_NORMAL} ${ALCOHOL_PRICE}`, 'swap']);
  });

  it('keeps drunk Larry drinking up to 24 and sobers him up by Random(2) without temptation', () => {
    const drinking = larry(Npc.LARRY_DRUNK, { ALCOHOL: 10 });
    const ctx = context(drinking, 3, [3]);
    hourlyLarryUpdate(ctx);
    expect(ctx.normalProfile()?.npcData).toBe(11);
    expect(drinking.calls).toEqual(['use 10 25']);
    const capped = context(larry(Npc.LARRY_DRUNK, { ADRENALINE_BOOSTER: 10 }), 23, [4]);
    hourlyLarryUpdate(capped);
    expect(capped.normalProfile()?.npcData).toBe(24);
    const sobering = larry(Npc.LARRY_DRUNK, {});
    const dry = context(sobering, 1, [1], 0);
    hourlyLarryUpdate(dry);
    expect(dry.ranges).toEqual([2]);
    expect(sobering.calls).toEqual(['swap']);
  });

  it('does nothing while Larry is off his squad, travelling, or in a loaded sector with enemies or in tactical', () => {
    for (const overrides of [{ assignment: ON_DUTY }, { betweenSectors: true }, { inLoadedSector: true }]) {
      const merc = larry(Npc.LARRY_NORMAL, { BEER: 9 }, ROAD, overrides);
      const ctx = context(merc, 7, [1]);
      hourlyLarryUpdate(ctx);
      expect([ctx.ranges, merc.calls]).toEqual([[], []]);
    }
  });

  it('copies the campaign fields into the other Larry profile and flips FACT_LARRY_CHANGED', () => {
    const n = createNarrativeState();
    const sober = testProfile(Npc.LARRY_NORMAL, { sectorX: 13, sectorY: 4, kills: 7, inventory: [1, 2], inventoryStatus: [100, 90] });
    const drunk = testProfile(Npc.LARRY_DRUNK, { inventory: [0, 0], inventoryStatus: [0, 0] });
    swapLarrysProfileRecords(n, sober, drunk);
    expect([drunk.sectorX, drunk.sectorY, drunk.kills, drunk.inventory, drunk.inventoryStatus]).toEqual([13, 4, 7, [1, 2], [100, 90]]);
    expect(fact(n, Fact.LARRY_CHANGED)).toBe(true);
    swapLarrysProfileRecords(n, drunk, sober);
    expect(fact(n, Fact.LARRY_CHANGED)).toBe(false);
  });
});
