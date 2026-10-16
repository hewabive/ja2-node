// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Hourly_Update.cc HourlyLarryUpdate, LarryItems, BAR_TEMPTATION, LARRY_FALLS_OFF_WAGON (items and bars
// @src checked against data/tables/narrative.json); Tactical/Soldier_Profile.cc SwapLarrysProfiles. See docs/25 §4.4, §4.8.

import { i8 } from '../../../core/int.ts';
import type { ProfileProgress } from '../../tactical/profiles.ts';
import type { SectorPosition } from '../state.ts';
import { Fact } from './fact-ids.ts';
import { type NarrativeState, setFactFalse, setFactTrue } from './facts.ts';
import { Npc } from './npc-ids.ts';

export interface LarryItem {
  readonly item: string;
  readonly temptation: number;
  readonly points: number;
}

const BAR_TEMPTATION = 4;
export const LARRY_ITEMS: readonly LarryItem[] = [
  { item: 'ADRENALINE_BOOSTER', temptation: 5, points: 100 },
  { item: 'ALCOHOL', temptation: BAR_TEMPTATION, points: 25 },
  { item: 'MEDICKIT', temptation: 4, points: 10 },
  { item: 'WINE', temptation: 3, points: 50 },
  { item: 'REGEN_BOOSTER', temptation: 3, points: 100 },
  { item: 'BEER', temptation: 2, points: 100 },
];
export const LARRY_BARS: readonly SectorPosition[] = [
  { x: 13, y: 4, z: 0 },
  { x: 13, y: 3, z: 0 },
  { x: 5, y: 3, z: 0 },
  { x: 5, y: 4, z: 0 },
  { x: 6, y: 3, z: 0 },
  { x: 2, y: 8, z: 0 },
];
const ALCOHOL_ROW = 1;
const LARRY_FALLS_OFF_WAGON = 8;
const MAX_DRUNKENNESS = 24;
const SOBERING_RANGE = 2;
const FULL_STATUS = 100;
const NO_SLOT = -1;

export interface LarryOnTeam {
  readonly profile: number;
  readonly assignment: number;
  readonly betweenSectors: boolean;
  readonly inLoadedSector: boolean;
  readonly sector: SectorPosition;
  findItem(item: string): number;
  emptySlotForBooze(): number;
  giveFullItem(slot: number, item: string, status: number): void;
  useKitPoints(slot: number, points: number): void;
}

export interface LarryContext {
  readonly narrative: NarrativeState;
  larry(): LarryOnTeam | null;
  enemyInLoadedSectorOrTactical(): boolean;
  balance(): number;
  alcoholPrice(): number;
  payForBooze(profile: number, amount: number): void;
  normalProfile(): ProfileProgress | null;
  random(n: number): number;
  swapProfiles(): void;
  onDutyAssignment: number;
}

function inBar(sector: SectorPosition): boolean {
  return LARRY_BARS.some((b) => b.x === sector.x && b.y === sector.y && b.z === sector.z);
}

interface Temptation {
  value: number;
  slot: number;
  row: number;
  bar: boolean;
}

function findTemptation(ctx: LarryContext, larry: LarryOnTeam): Temptation {
  const found: Temptation = { value: 0, slot: NO_SLOT, row: LARRY_ITEMS.length, bar: false };
  for (let row = 0; row < LARRY_ITEMS.length; row++) {
    const entry = LARRY_ITEMS[row] as LarryItem;
    found.slot = larry.findItem(entry.item);
    found.row = row;
    if (found.slot !== NO_SLOT) {
      found.value = entry.temptation;
      break;
    }
  }
  if (found.value < BAR_TEMPTATION && ctx.balance() >= ctx.alcoholPrice() && inBar(larry.sector)) {
    found.bar = true;
    found.value = BAR_TEMPTATION;
  }
  return found;
}

function buyBooze(ctx: LarryContext, larry: LarryOnTeam, t: Temptation): void {
  ctx.payForBooze(larry.profile, ctx.alcoholPrice());
  const slot = larry.emptySlotForBooze();
  if (slot !== NO_SLOT) larry.giveFullItem(slot, 'ALCOHOL', FULL_STATUS);
  t.slot = slot;
  t.row = ALCOHOL_ROW;
}

function useTemptation(larry: LarryOnTeam, t: Temptation): void {
  if (t.slot === NO_SLOT) return;
  larry.useKitPoints(t.slot, LARRY_ITEMS[t.row]?.points ?? 0);
}

export function hourlyLarryUpdate(ctx: LarryContext): void {
  const larry = ctx.larry();
  const counter = ctx.normalProfile();
  if (!larry || !counter) return;
  if (larry.assignment >= ctx.onDutyAssignment || larry.betweenSectors) return;
  if (larry.inLoadedSector && ctx.enemyInLoadedSectorOrTactical()) return;
  const t = findTemptation(ctx, larry);
  if (t.value > 0) {
    if (larry.profile === Npc.LARRY_NORMAL) {
      counter.npcData = i8(counter.npcData + ctx.random(t.value));
      if (counter.npcData < LARRY_FALLS_OFF_WAGON) return;
      if (t.bar) buyBooze(ctx, larry, t);
      ctx.swapProfiles();
      useTemptation(larry, t);
      return;
    }
    counter.npcData = Math.max(counter.npcData, LARRY_FALLS_OFF_WAGON);
    counter.npcData = i8(counter.npcData + ctx.random(t.value));
    counter.npcData = Math.min(counter.npcData, MAX_DRUNKENNESS);
    if (t.bar) buyBooze(ctx, larry, t);
    useTemptation(larry, t);
    return;
  }
  if (larry.profile !== Npc.LARRY_DRUNK) return;
  counter.npcData = i8(counter.npcData - ctx.random(SOBERING_RANGE));
  if (counter.npcData <= 0) ctx.swapProfiles();
}

function copyInto(target: number[], source: readonly number[]): void {
  target.splice(0, target.length, ...source);
}

function copyCampaignFields(from: ProfileProgress, to: ProfileProgress): void {
  to.miscFlags2 = from.miscFlags2;
  to.miscFlags = from.miscFlags;
  to.sectorX = from.sectorX;
  to.sectorY = from.sectorY;
  to.sectorZ = from.sectorZ;
  to.dayBecomesAvailable = from.dayBecomesAvailable;
  to.kills = from.kills;
  to.assists = from.assists;
  to.shotsFired = from.shotsFired;
  to.shotsHit = from.shotsHit;
  to.timesWounded = from.timesWounded;
  to.totalDaysServed = from.totalDaysServed;
  to.useProfileInsertion = from.useProfileInsertion;
  to.gridNo = from.gridNo;
  to.quoteActionId = from.quoteActionId;
  to.lastQuoteSaid = from.lastQuoteSaid;
  to.insertionCode = from.insertionCode;
  to.mercStatus = from.mercStatus;
  to.insertionData = from.insertionData;
  to.miscFlags3 = from.miscFlags3;
  to.daysOfMoraleHangover = from.daysOfMoraleHangover;
  to.precedentQuoteSaid = from.precedentQuoteSaid;
}

export function swapLarrysProfileRecords(n: NarrativeState, from: ProfileProgress, to: ProfileProgress): void {
  copyCampaignFields(from, to);
  copyInto(to.inventory, from.inventory);
  copyInto(to.inventoryStatus, from.inventoryStatus);
  copyInto(to.inventoryCount, from.inventoryCount);
  if (to.id === Npc.LARRY_DRUNK) setFactTrue(n, Fact.LARRY_CHANGED);
  else setFactFalse(n, Fact.LARRY_CHANGED);
}
