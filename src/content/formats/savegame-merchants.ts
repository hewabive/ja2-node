// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Arms_Dealer_Init.cc LoadArmsDealerInventoryFromSavedGameFile; Arms_Dealer_Init.h
// @src ARMS_DEALER_STATUS, DEALER_ITEM_HEADER, DEALER_SPECIAL_ITEM, SPECIAL_ITEM_INFO. See docs/14 §4, docs/23 §15.4.

import { FormatError } from '../binary/errors.ts';
import type { SaveSection } from './savegame.ts';
import { SaveCursor } from './savegame-cursor.ts';

export const SAVED_ARMS_DEALERS = 19;
export const SAVED_DEALER_ITEMS = 351;
const STATUS_PADDING_BYTES = 8;
const HEADER_SKIP_AFTER_COUNT = 4;
const HEADER_TAIL_BYTES = 2;
const SPECIAL_INFO_PADDING_BYTES = 2;
const SPECIAL_TAIL_BYTES = 6;
const ATTACHMENTS = 4;
const SECTION = 'arms dealers';

export interface SavedDealerSpecial {
  readonly attachments: readonly number[];
  readonly condition: number;
  readonly imprint: number;
  readonly attachmentStatus: readonly number[];
  readonly repairDoneTime: number;
  readonly active: boolean;
  readonly owner: number;
}

export interface SavedDealerHeader {
  readonly total: number;
  readonly perfect: number;
  readonly strayAmmo: number;
  readonly specialCount: number;
  readonly orderArrivalDay: number;
  readonly qtyOnOrder: number;
  readonly previouslyEligible: boolean;
  readonly specials: readonly SavedDealerSpecial[];
}

export interface SavedDealer {
  readonly cash: number;
  readonly flags: number;
  readonly outOfBusiness: boolean;
  readonly repairDelayUsed: boolean;
  readonly unusedKnowsPlayer: boolean;
  readonly lastSkiMinute: number;
  readonly headers: readonly SavedDealerHeader[];
}

const ZERO_SPECIAL: SavedDealerSpecial = {
  attachments: [0, 0, 0, 0],
  condition: 0,
  imprint: 0,
  attachmentStatus: [0, 0, 0, 0],
  repairDoneTime: 0,
  active: false,
  owner: 0,
};

interface MutableHeader extends Omit<SavedDealerHeader, 'specials'> {
  specials: SavedDealerSpecial[];
}

function readStatus(c: SaveCursor): Omit<SavedDealer, 'headers'> {
  const cash = c.u32();
  const flags = c.u8();
  const outOfBusiness = c.bool();
  const repairDelayUsed = c.bool();
  const unusedKnowsPlayer = c.bool();
  const lastSkiMinute = c.u32();
  c.skip(STATUS_PADDING_BYTES);
  return { cash, flags, outOfBusiness, repairDelayUsed, unusedKnowsPlayer, lastSkiMinute };
}

function readHeader(c: SaveCursor): MutableHeader {
  const total = c.u8();
  const perfect = c.u8();
  const strayAmmo = c.u8();
  const specialCount = c.u8();
  c.skip(HEADER_SKIP_AFTER_COUNT);
  const orderArrivalDay = c.u32();
  const qtyOnOrder = c.u8();
  const previouslyEligible = c.bool();
  c.skip(HEADER_TAIL_BYTES);
  return { total, perfect, strayAmmo, specialCount, orderArrivalDay, qtyOnOrder, previouslyEligible, specials: [] };
}

function readSpecial(c: SaveCursor): SavedDealerSpecial {
  const attachments = Array.from({ length: ATTACHMENTS }, () => c.u16());
  const condition = c.i8();
  const imprint = c.u8();
  const attachmentStatus = Array.from({ length: ATTACHMENTS }, () => c.i8());
  c.skip(SPECIAL_INFO_PADDING_BYTES);
  const repairDoneTime = c.u32();
  const active = c.bool();
  const owner = c.u8();
  c.skip(SPECIAL_TAIL_BYTES);
  return { attachments, condition, imprint, attachmentStatus, repairDoneTime, active, owner };
}

export function decodeArmsDealers(bytes: Uint8Array): SavedDealer[] {
  const c = new SaveCursor(bytes);
  const statuses = Array.from({ length: SAVED_ARMS_DEALERS }, () => readStatus(c));
  const headers = statuses.map(() => Array.from({ length: SAVED_DEALER_ITEMS }, () => readHeader(c)));
  for (const dealer of headers) {
    const unsaved = dealer[0];
    if (unsaved) for (let k = 0; k < unsaved.specialCount; k++) unsaved.specials.push(ZERO_SPECIAL);
    for (let item = 1; item < SAVED_DEALER_ITEMS; item++) {
      const h = dealer[item];
      if (!h) continue;
      for (let k = 0; k < h.specialCount; k++) h.specials.push(readSpecial(c));
    }
  }
  if (c.remaining !== 0) throw new FormatError(`arms dealer section has ${c.remaining} unread bytes`);
  return statuses.map((s, d) => ({ ...s, headers: headers[d] ?? [] }));
}

export function readSavedMerchants(bytes: Uint8Array, sections: readonly SaveSection[]): SavedDealer[] {
  const s = sections.find((x) => x.name === SECTION);
  if (!s) throw new FormatError(`savegame has no ${SECTION} section`);
  return decodeArmsDealers(bytes.subarray(s.offset, s.offset + s.size));
}
