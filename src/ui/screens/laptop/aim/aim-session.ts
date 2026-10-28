// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/AIMSort.cc GameInitAimSort (price, descending), EnterAimSort (the list reset to the A.I.M. listing
// @src order), ExitAimSort and MercArrayCompare (weekly salary, level, marksmanship, medical, explosives, mechanical; the
// @src original's std::sort is unstable, the listing order breaks ties here); src/game/Laptop/AIMMembers.cc gbCurrentIndex,
// @src giCurrentSubPage (the conference mode restored on re-entry), LaptopSaveInfo.sLastHiredMerc.

import type { AimMercView } from '../../../../protocol/view.ts';

export const AimSortCriterion = { PRICE: 0, EXPERIENCE: 1, MARKSMANSHIP: 2, MEDICAL: 3, EXPLOSIVES: 4, MECHANICAL: 5 } as const;
export const AIM_ASCEND = 6;
export const AIM_DESCEND = 7;
export const MAX_NUMBER_MERCS = 40;

export interface LastHiredMerc {
  readonly profile: number;
  readonly arrivalMinute: number;
  readonly sector: string;
}

export interface AimMemory {
  sortCriterion: number;
  listMode: number;
  order: number[];
  index: number;
  conferenceSubPage: number;
  lastHired: LastHiredMerc | null;
}

export function aimMemory(): AimMemory {
  return { sortCriterion: AimSortCriterion.PRICE, listMode: AIM_DESCEND, order: [], index: 0, conferenceSubPage: 0, lastHired: null };
}

function sortValue(merc: AimMercView, criterion: number): number {
  switch (criterion) {
    case AimSortCriterion.PRICE:
      return merc.salary.week;
    case AimSortCriterion.EXPERIENCE:
      return merc.stats.experience;
    case AimSortCriterion.MARKSMANSHIP:
      return merc.stats.marksmanship;
    case AimSortCriterion.MEDICAL:
      return merc.stats.medical;
    case AimSortCriterion.EXPLOSIVES:
      return merc.stats.explosives;
    default:
      return merc.stats.mechanical;
  }
}

export function sortedAimOrder(mercs: readonly AimMercView[], criterion: number, listMode: number): number[] {
  const sign = listMode === AIM_ASCEND ? 1 : -1;
  return mercs
    .map((merc, listing) => ({ merc, listing }))
    .sort((a, b) => sign * (sortValue(a.merc, criterion) - sortValue(b.merc, criterion)) || a.listing - b.listing)
    .map(({ merc }) => merc.profile);
}

export class AimSession {
  readonly memory: AimMemory;

  constructor(memory: AimMemory) {
    this.memory = memory;
  }

  resetOrder(mercs: readonly AimMercView[]): void {
    this.memory.order = mercs.map((m) => m.profile);
  }

  sortOrder(mercs: readonly AimMercView[]): void {
    this.memory.order = sortedAimOrder(mercs, this.memory.sortCriterion, this.memory.listMode);
  }

  ordered(mercs: readonly AimMercView[]): AimMercView[] {
    if (this.memory.order.length === 0) this.resetOrder(mercs);
    const byProfile = new Map(mercs.map((m) => [m.profile, m]));
    return this.memory.order.flatMap((p) => {
      const merc = byProfile.get(p);
      return merc ? [merc] : [];
    });
  }

  current(mercs: readonly AimMercView[]): AimMercView | undefined {
    const list = this.ordered(mercs);
    return list[this.memory.index] ?? list[0];
  }

  step(mercs: readonly AimMercView[], delta: number): void {
    const count = Math.min(MAX_NUMBER_MERCS, this.ordered(mercs).length);
    if (count === 0) return;
    this.memory.index = (this.memory.index + delta + count) % count;
  }
}
