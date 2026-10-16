// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Merc_Contract.cc LoadContractRenewalDataFromSaveGameFile (CONTRACT_NEWAL_LIST_NODE);
// @src Strategic/Map_Screen_Interface.cc LoadLeaveItemList; Laptop/LaptopSave.h gubPlayersMercAccountStatus. See docs/22 §0,
// @src docs/14.

import { FormatError } from '../binary/errors.ts';
import { decodeObject, type ObjectRecord } from './object.ts';
import { LAPTOP_INFO_LAYOUT, type SaveSection } from './savegame.ts';
import { SaveCursor } from './savegame-cursor.ts';
import { readLayout } from './savegame-layout.ts';

const CONTRACT_RENEWAL_SLOTS = 20;
const CONTRACT_RENEWAL_FILLER = 3;
const NUM_LEAVE_LIST_SLOTS = 20;
const LEAVE_ITEM_BYTES = 40;

export interface SavedContractRenewals {
  readonly profiles: readonly number[];
  readonly count: number;
}

export interface SavedLeaveSlot {
  readonly items: readonly ObjectRecord[] | null;
  readonly owner: number;
}

function sectionCursor(bytes: Uint8Array, sections: readonly SaveSection[], name: string): SaveCursor {
  const s = sections.find((x) => x.name === name);
  if (!s) throw new FormatError(`savegame has no ${name} section`);
  return new SaveCursor(bytes.subarray(s.offset, s.offset + s.size));
}

export function readContractRenewals(bytes: Uint8Array, sections: readonly SaveSection[]): SavedContractRenewals {
  const c = sectionCursor(bytes, sections, 'contract renewals');
  const profiles: number[] = [];
  for (let i = 0; i < CONTRACT_RENEWAL_SLOTS; i++) {
    profiles.push(c.u8());
    c.skip(CONTRACT_RENEWAL_FILLER);
  }
  return { profiles, count: c.u8() };
}

export function readLeaveItemList(bytes: Uint8Array, sections: readonly SaveSection[]): SavedLeaveSlot[] {
  const c = sectionCursor(bytes, sections, 'leave item list');
  const lists: (ObjectRecord[] | null)[] = [];
  for (let i = 0; i < NUM_LEAVE_LIST_SLOTS; i++) {
    if (!c.bool()) {
      lists.push(null);
      continue;
    }
    const items: ObjectRecord[] = [];
    for (let n = c.u32(); n > 0; n--) {
      items.push(decodeObject(c.bytes, c.pos));
      c.skip(LEAVE_ITEM_BYTES);
    }
    lists.push(items);
  }
  return lists.map((items) => ({ items, owner: c.u32() }));
}

export function readMercAccountStatus(bytes: Uint8Array, sections: readonly SaveSection[]): number {
  const r = readLayout(sectionCursor(bytes, sections, 'laptop info'), LAPTOP_INFO_LAYOUT, false, 'LaptopSaveInfo');
  return r.num('gubPlayersMercAccountStatus');
}
