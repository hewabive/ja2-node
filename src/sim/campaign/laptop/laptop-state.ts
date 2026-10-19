// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/LaptopSave.h LaptopSaveInfoStruct, LIFE_INSURANCE_PAYOUT, SPECK_QUOTE__*, BOBBYR_*_SITE*;
// @src Laptop/Laptop.h (bookmarks); Laptop/Mercs.h MERC_ACCOUNT_*, MERC_SITE_*; Laptop/Store_Inventory.h STORE_INVENTORY;
// @src Laptop/BobbyRMailOrder.h NewBobbyRayOrderStruct; Laptop/EMail.h Email; Laptop/History.cc HistoryUnit; Laptop/Files.cc
// @src FilesUnit; Laptop/Laptop.cc LaptopScreenInit, InitLaptopAndLaptopScreens; Laptop/Mercs.cc GameInitMercs;
// @src Tactical/Merc_Hiring.cc g_merc_arrive_sector. See docs/21 §0.

import type { MercProfile } from '../../../content/formats/prof.ts';

export const Bookmark = { AIM: 0, BOBBYR: 1, IMP: 2, MERC: 3, FUNERAL: 4, FLORIST: 5, INSURANCE: 6 } as const;
export const BOOKMARK_NAMES: Readonly<Record<number, string>> = {
  [Bookmark.AIM]: 'aim',
  [Bookmark.BOBBYR]: 'bobbyRay',
  [Bookmark.IMP]: 'imp',
  [Bookmark.MERC]: 'merc',
  [Bookmark.FUNERAL]: 'funeral',
  [Bookmark.FLORIST]: 'florist',
  [Bookmark.INSURANCE]: 'insurance',
};
export const MAX_BOOKMARKS = 20;
export const MercAccountStatus = { NO_ACCOUNT: 0, SUSPENDED: 1, INVALID: 2, VALID_FIRST_WARNING: 3, VALID: 4 } as const;
export const SpeckQuoteFlag = { ALREADY_TOLD_PLAYER_THAT_LARRY_RELAPSED: 0x01, SENT_EMAIL_ABOUT_LACK_OF_PAYMENT: 0x02 } as const;
export const MercSiteVisit = { NEVER_VISITED: 0, FIRST_VISIT: 1, SECOND_VISIT: 2, THIRD_OR_MORE_VISITS: 3 } as const;
export const BobbyRaySiteVisit = { NEVER_BEEN_TO_SITE: 0, BEEN_TO_SITE_ONCE: 1, ALREADY_SENT_EMAIL: 2 } as const;
export const PERSONNEL_LIST_ENTRIES = 256;
export const NO_PERSONNEL_ENTRY = -1;
export const FIRST_MERC_LISTING_INDEX = 5;

export interface Email {
  readonly id: number;
  readonly offset: number;
  readonly length: number;
  readonly sender: number;
  readonly date: number;
  readonly firstData: number;
  readonly secondData: number;
  read: boolean;
}

export interface HistoryRecord {
  readonly code: number;
  readonly secondCode: number;
  readonly date: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface FileRecord {
  readonly code: number;
  read: boolean;
}

export interface PersonnelLists {
  readonly dead: number[];
  readonly left: number[];
  readonly other: number[];
}

export interface MercSiteState {
  accountStatus: number;
  accountNumber: number;
  lastMercIndex: number;
  lastMercAvailableId: number;
  totalMoneyPaidToSpeck: number;
  siteHasGoneDownYet: boolean;
  firstVisitSinceServerWentDown: number;
  newMercsAvailable: boolean;
  playerBeenToSiteStatus: number;
  speckQuoteFlags: number;
  speckCanSayPlayersLostQuote: number;
  saidGenericOpening: boolean;
  speckSaidFloMarriedCousinQuote: boolean;
  hasAMercDiedAtSite: boolean;
}

export interface ImpState {
  completed: boolean;
  sentImpWarningAlready: boolean;
  voiceId: number;
  readonly taken: number[];
  readonly profiles: Map<number, MercProfile>;
  readonly voices: Map<number, number>;
}

export interface StoreSlot {
  readonly item: number;
  onHand: number;
  onOrder: number;
  quality: number;
  previouslyEligible: boolean;
}

export interface ShipmentLine {
  readonly item: number;
  readonly count: number;
  readonly quality: number;
  readonly slot: number;
  readonly used: boolean;
}

export interface Shipment {
  active: boolean;
  readonly destination: number;
  readonly speed: number;
  readonly lines: readonly ShipmentLine[];
  readonly weight: number;
  readonly orderDay: number;
  displayedOnShipmentsPage: boolean;
}

export interface BobbyRayState {
  siteCanBeAccessed: boolean;
  underConstructionVisit: number;
  readonly inventory: StoreSlot[];
  readonly used: StoreSlot[];
  readonly shipments: Shipment[];
  shipmentsSinceNoBribes: number;
}

export interface LifeInsurancePayout {
  active: boolean;
  soldier: number;
  profile: number;
  payout: number;
}

export interface InsuranceState {
  readonly payouts: LifeInsurancePayout[];
  used: number;
}

export interface LastHiredMerc {
  profile: number;
  arrival: number;
}

export interface LaptopState {
  newGameLaptop: boolean;
  newMail: boolean;
  readonly bookmarks: number[];
  readonly emails: Email[];
  nextEmailId: number;
  readonly history: HistoryRecord[];
  readonly files: FileRecord[];
  readonly personnel: PersonnelLists;
  readonly merc: MercSiteState;
  readonly imp: ImpState;
  readonly bobbyRay: BobbyRayState;
  readonly insurance: InsuranceState;
  floristOrderNumber: number;
  mercArriveSector: number;
  readonly lastHiredMerc: LastHiredMerc;
  mercSiteOpenedThisSession: boolean;
}

function personnelList(): number[] {
  return new Array<number>(PERSONNEL_LIST_ENTRIES).fill(NO_PERSONNEL_ENTRY);
}

export function createMercSiteState(): MercSiteState {
  return {
    accountStatus: MercAccountStatus.NO_ACCOUNT,
    accountNumber: 0,
    lastMercIndex: FIRST_MERC_LISTING_INDEX,
    lastMercAvailableId: 0,
    totalMoneyPaidToSpeck: 0,
    siteHasGoneDownYet: false,
    firstVisitSinceServerWentDown: 0,
    newMercsAvailable: false,
    playerBeenToSiteStatus: MercSiteVisit.NEVER_VISITED,
    speckQuoteFlags: 0,
    speckCanSayPlayersLostQuote: 0,
    saidGenericOpening: false,
    speckSaidFloMarriedCousinQuote: false,
    hasAMercDiedAtSite: false,
  };
}

export function createLaptopState(startSector = 0): LaptopState {
  return {
    newGameLaptop: true,
    newMail: false,
    bookmarks: [],
    emails: [],
    nextEmailId: 0,
    history: [],
    files: [],
    personnel: { dead: personnelList(), left: personnelList(), other: personnelList() },
    merc: createMercSiteState(),
    imp: { completed: false, sentImpWarningAlready: false, voiceId: 0, taken: [], profiles: new Map(), voices: new Map() },
    bobbyRay: {
      siteCanBeAccessed: false,
      underConstructionVisit: BobbyRaySiteVisit.NEVER_BEEN_TO_SITE,
      inventory: [],
      used: [],
      shipments: [],
      shipmentsSinceNoBribes: 0,
    },
    insurance: { payouts: [], used: 0 },
    floristOrderNumber: 0,
    mercArriveSector: startSector,
    lastHiredMerc: { profile: -1, arrival: 0 },
    mercSiteOpenedThisSession: false,
  };
}

export function resetLaptopState(l: LaptopState, startSector: number): void {
  Object.assign(l, createLaptopState(startSector));
}

export function setBookmark(l: LaptopState, bookmark: number): void {
  if (l.bookmarks.includes(bookmark) || l.bookmarks.length >= MAX_BOOKMARKS) return;
  l.bookmarks.push(bookmark);
}

export function hasBookmark(l: LaptopState, bookmark: number): boolean {
  return l.bookmarks.includes(bookmark);
}

export function bookmarkNames(l: LaptopState): string[] {
  return l.bookmarks.map((b) => BOOKMARK_NAMES[b] ?? String(b));
}
