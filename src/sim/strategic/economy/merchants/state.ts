// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Arms_Dealer_Init.h ARMS_DEALER_STATUS, SPECIAL_ITEM_INFO, DEALER_SPECIAL_ITEM, DEALER_ITEM_HEADER;
// @src Arms_Dealer_Init.cc SetSpecialItemInfoToDefaults, IsItemInfoSpecial. See docs/23 §0, §2.1.

import { NOTHING } from '../../../../content/items/items.ts';
import { MAX_ATTACHMENTS, NO_PROFILE } from '../../../items/object.ts';

export const MAXITEMS = 351;
export const PERFECT_CONDITION = 100;

export interface SpecialItemInfo {
  readonly attachments: number[];
  condition: number;
  imprint: number;
  readonly attachmentStatus: number[];
}

export interface DealerSpecialItem {
  info: SpecialItemInfo;
  repairDoneTime: number;
  active: boolean;
  owner: number;
}

export interface DealerItemHeader {
  total: number;
  perfect: number;
  strayAmmo: number;
  readonly specials: DealerSpecialItem[];
  orderArrivalDay: number;
  qtyOnOrder: number;
  previouslyEligible: boolean;
}

export interface DealerStatus {
  cash: number;
  flags: number;
  outOfBusiness: boolean;
  repairDelayUsed: boolean;
  unusedKnowsPlayer: boolean;
  lastSkiMinute: number;
}

export interface DealerState {
  readonly status: DealerStatus;
  readonly headers: DealerItemHeader[];
}

export interface MerchantState {
  readonly dealers: DealerState[];
}

export function createMerchantState(): MerchantState {
  return { dealers: [] };
}

export function zeroItemInfo(): SpecialItemInfo {
  return {
    attachments: Array.from({ length: MAX_ATTACHMENTS }, () => NOTHING),
    condition: 0,
    imprint: 0,
    attachmentStatus: Array.from({ length: MAX_ATTACHMENTS }, () => 0),
  };
}

export function defaultItemInfo(): SpecialItemInfo {
  return { ...zeroItemInfo(), condition: PERFECT_CONDITION, imprint: NO_PROFILE };
}

export function emptySpecialItem(): DealerSpecialItem {
  return { info: zeroItemInfo(), repairDoneTime: 0, active: false, owner: 0 };
}

export function cloneItemInfo(info: SpecialItemInfo): SpecialItemInfo {
  return {
    attachments: [...info.attachments],
    condition: info.condition,
    imprint: info.imprint,
    attachmentStatus: [...info.attachmentStatus],
  };
}

export function sameItemInfo(a: SpecialItemInfo, b: SpecialItemInfo): boolean {
  if (a.condition !== b.condition || a.imprint !== b.imprint) return false;
  for (let k = 0; k < MAX_ATTACHMENTS; k++) {
    if (a.attachments[k] !== b.attachments[k] || a.attachmentStatus[k] !== b.attachmentStatus[k]) return false;
  }
  return true;
}

export function isItemInfoSpecial(info: SpecialItemInfo): boolean {
  if (info.condition !== PERFECT_CONDITION) return true;
  if (info.imprint !== NO_PROFILE) return true;
  return info.attachments.some((a) => a !== NOTHING);
}

export function emptyHeader(): DealerItemHeader {
  return { total: 0, perfect: 0, strayAmmo: 0, specials: [], orderArrivalDay: 0, qtyOnOrder: 0, previouslyEligible: false };
}

export function emptyDealerStatus(): DealerStatus {
  return { cash: 0, flags: 0, outOfBusiness: false, repairDelayUsed: false, unusedKnowsPlayer: false, lastSkiMinute: 0 };
}

export function emptyDealerState(): DealerState {
  return { status: emptyDealerStatus(), headers: Array.from({ length: MAXITEMS }, emptyHeader) };
}

export function resetMerchantState(state: MerchantState, dealers: number): void {
  state.dealers.length = 0;
  for (let d = 0; d < dealers; d++) state.dealers.push(emptyDealerState());
}

export function dealerState(state: MerchantState, dealer: number): DealerState {
  const d = state.dealers[dealer];
  if (!d) throw new RangeError(`no arms dealer ${dealer}`);
  return d;
}

export function header(state: MerchantState, dealer: number, item: number): DealerItemHeader {
  const h = dealerState(state, dealer).headers[item];
  if (!h) throw new RangeError(`no item ${item}`);
  return h;
}

export function activeSpecials(h: DealerItemHeader): number {
  return h.specials.reduce((n, s) => n + (s.active ? 1 : 0), 0);
}
