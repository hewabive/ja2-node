// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Laptop.cc LoadLaptopInfoFromSavedGame; Laptop/Mercs.cc SyncLastMercFromSaveGame;
// @src Laptop/BobbyRMailOrder.cc NewWayOfLoadingBobbyRMailOrdersToSaveGameFile; LoadSaveEMail.cc LoadEmailFromSavedGame;
// @src Laptop/History.cc, Laptop/Files.cc (temp files); SaveLoadGame.cc LoadSavedMercProfiles (I.M.P. slot states, the
// @src pre-104 fallback), LoadGeneralInfo (g_merc_arrive_sector), the facts and quests. See docs/14-savegames.md, docs/21 §0.

import type { SaveGame } from '../../../content/formats/savegame.ts';
import { readSavedLaptop, type SavedLaptop, type SavedLaptopInfo } from '../../../content/formats/savegame-laptop.ts';
import type { MercListing } from '../../../content/strategic/laptop-content.ts';
import { MAP_SIDE, sectorId } from '../../../content/strategic/sector-ids.ts';
import type { StrategicState } from '../../strategic/state.ts';
import { importNarrative } from '../narrative/facts.ts';
import type { LaptopState, StoreSlot } from './laptop-state.ts';

export const PLAYER_GENERATED_CHARACTER_ID = 51;
const IMP_SLOT_TAKEN = 1;
const LastMercArrival = { NUMB: 2, COUGAR: 3 } as const;

export interface LaptopImportOptions {
  readonly mercListings?: readonly MercListing[];
  readonly namedProfiles?: Readonly<Record<string, number>>;
  readonly startSector?: number;
  readonly declaredProfiles?: ReadonlySet<number> | ReadonlyMap<number, unknown>;
}

function replace<T>(target: T[], values: readonly T[]): void {
  target.splice(0, target.length, ...values);
}

function storeSlots(slots: SavedLaptopInfo['bobbyRayInventory']): StoreSlot[] {
  return slots.map((s) => ({
    item: s.item,
    onHand: s.onHand,
    onOrder: s.onOrder,
    quality: s.quality,
    previouslyEligible: s.previouslyEligible,
  }));
}

function syncLastMercIndex(info: SavedLaptopInfo, options: LaptopImportOptions): number {
  const named = options.namedProfiles;
  const listings = options.mercListings;
  if (!named || !listings) return info.lastMercIndex;
  const last =
    info.lastMercAvailableId === LastMercArrival.NUMB
      ? named.NUMB
      : info.lastMercAvailableId === LastMercArrival.COUGAR
        ? named.COUGAR
        : undefined;
  if (last === undefined || last <= 0) return info.lastMercIndex;
  const listing = listings.find((m) => m.profile === last);
  return listing && info.lastMercIndex - listing.index === 1 ? info.lastMercIndex - 1 : info.lastMercIndex;
}

function importMercSite(l: LaptopState, info: SavedLaptopInfo, options: LaptopImportOptions): void {
  const merc = l.merc;
  merc.accountStatus = info.mercAccountStatus;
  merc.accountNumber = info.mercAccountNumber;
  merc.lastMercIndex = syncLastMercIndex(info, options);
  merc.lastMercAvailableId = info.lastMercAvailableId;
  merc.totalMoneyPaidToSpeck = info.totalMoneyPaidToSpeck;
  merc.siteHasGoneDownYet = info.mercSiteHasGoneDownYet;
  merc.firstVisitSinceServerWentDown = info.firstVisitSinceServerWentDown;
  merc.newMercsAvailable = info.newMercsAvailableAtMercSite;
  merc.playerBeenToSiteStatus = info.playerBeenToMercSiteStatus;
  merc.speckQuoteFlags = info.speckQuoteFlags;
  merc.speckCanSayPlayersLostQuote = info.speckCanSayPlayersLostQuote;
  merc.saidGenericOpening = info.saidGenericOpeningInMercSite;
  merc.speckSaidFloMarriedCousinQuote = info.speckSaidFloMarriedCousinQuote;
  merc.hasAMercDiedAtSite = info.hasAMercDiedAtMercSite;
}

function takenImpSlots(saved: SavedLaptop): number[] {
  if (saved.impSlotStates) return saved.impSlotStates.flatMap((state, id) => (state === IMP_SLOT_TAKEN ? [id] : []));
  return saved.info.impCompleted ? [PLAYER_GENERATED_CHARACTER_ID + saved.info.voiceId] : [];
}

function importImp(l: LaptopState, saved: SavedLaptop, save: SaveGame, declared: LaptopImportOptions['declaredProfiles']): void {
  const imp = l.imp;
  const info = saved.info;
  imp.completed = info.impCompleted;
  imp.sentImpWarningAlready = info.sentImpWarningAlready;
  imp.voiceId = info.voiceId;
  replace(imp.taken, takenImpSlots(saved));
  imp.profiles.clear();
  imp.voices.clear();
  for (const id of imp.taken) imp.voices.set(id, saved.voiceIds?.[id] ?? id);
  save.profiles.forEach((profile, id) => {
    if (profile && (imp.taken.includes(id) || (declared !== undefined && !declared.has(id)))) imp.profiles.set(id, profile);
  });
}

function importBobbyRay(l: LaptopState, saved: SavedLaptop): void {
  const br = l.bobbyRay;
  const info = saved.info;
  br.siteCanBeAccessed = info.bobbyRaySiteCanBeAccessed;
  br.underConstructionVisit = info.bobbyRayUnderConstructionVisit;
  replace(br.inventory, storeSlots(info.bobbyRayInventory));
  replace(br.used, storeSlots(info.bobbyRayUsedInventory));
  replace(
    br.shipments,
    saved.shipments.map((s) => ({
      active: s.active,
      destination: s.destination,
      speed: s.speed,
      lines: s.lines.map((line) => ({ ...line })),
      weight: s.weight,
      orderDay: s.orderDay,
      displayedOnShipmentsPage: s.displayedOnShipmentsPage,
    })),
  );
  br.shipmentsSinceNoBribes = 0;
}

function validArrival(sector: { readonly x: number; readonly y: number }): boolean {
  return sector.x >= 1 && sector.x <= MAP_SIDE && sector.y >= 1 && sector.y <= MAP_SIDE;
}

export function applySavedLaptop(state: StrategicState, save: SaveGame, saved: SavedLaptop, options: LaptopImportOptions = {}): void {
  const l = state.laptop;
  const info = saved.info;
  l.newGameLaptop = info.newGameLaptop;
  replace(l.bookmarks, info.bookmarks);
  replace(
    l.emails,
    saved.emails.map((m, id) => ({ id, ...m })),
  );
  l.nextEmailId = saved.emails.length;
  replace(
    l.history,
    saved.history.map((h) => ({ ...h })),
  );
  replace(
    l.files,
    saved.files.map((f) => ({ ...f })),
  );
  replace(l.personnel.dead, info.deadCharacters);
  replace(l.personnel.left, info.leftCharacters);
  replace(l.personnel.other, info.otherCharacters);
  importMercSite(l, info, options);
  importImp(l, saved, save, options.declaredProfiles);
  importBobbyRay(l, saved);
  replace(
    l.insurance.payouts,
    info.lifeInsurancePayouts.map((p) => ({ ...p })),
  );
  l.insurance.used = info.lifeInsurancePayoutsUsed;
  l.floristOrderNumber = info.flowerOrderNumber;
  l.mercArriveSector = validArrival(saved.mercArriveSector)
    ? sectorId(saved.mercArriveSector)
    : (options.startSector ?? l.mercArriveSector);
  l.lastHiredMerc.profile = info.lastHiredMerc.profile;
  l.lastHiredMerc.arrival = info.lastHiredMerc.arrival;
  l.mercSiteOpenedThisSession = false;
  importNarrative(state.narrative, save.facts, save.quests);
}

export function importLaptop(state: StrategicState, save: SaveGame, bytes: Uint8Array, options: LaptopImportOptions = {}): SavedLaptop {
  const saved = readSavedLaptop(bytes, save);
  applySavedLaptop(state, save, saved, options);
  return saved;
}
