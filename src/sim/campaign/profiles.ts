// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Profile.cc InitProfileFromContent (dialogue check, medical deposit, attractiveness, optional gear
// @src cost, relation counters),
// @src LoadMercProfiles; Soldier_Profile_Type.h PROFILE_MISC_FLAG_*, PROFILE_MISC_FLAG2_*, PROFILE_MISC_FLAG3_*; Laptop/AIM.h MAX_NUMBER_MERCS; Laptop/Mercs.h
// @src DAYS_TIL_M_E_R_C_AVAIL; src/externalized/mercs/MercProfile.cc (profile types). See docs/22 §0, docs/21 §0.

import type { MercProfile } from '../../content/formats/prof.ts';
import { ItemClass, type ItemTable } from '../../content/items/items.ts';
import { MercType } from '../../content/strategic/economy-content.ts';
import { i8, u16 } from '../../core/int.ts';
import { reducedGunListInventory } from '../tactical/inventory.ts';
import { MercStatus, type ProfileProgress, profileProgress, progressFromProfile } from '../tactical/profiles.ts';
import { calcMedicalDeposit } from './laptop/profile-state.ts';
import { MercKind } from './roster.ts';

export const NUM_PROFILES = 200;
export const MAX_NUMBER_MERCS = 40;
export const DAYS_TIL_MERC_AVAILABLE = 3;
const NO_ATTRACTIVENESS = -1;
const NOTHING = 0;

export const ProfileMiscFlag = {
  RECRUITED: 0x01,
  HAVE_SEEN_CREATURE: 0x02,
  FORCE_NPC_QUOTE: 0x04,
  WOUNDED_BY_PLAYER: 0x08,
  TEMP_NPC_QUOTE_DATA_EXISTS: 0x10,
  SAID_HOSTILE_QUOTE: 0x20,
  EPC_ACTIVE: 0x40,
  ALREADY_USED_ITEMS: 0x80,
} as const;

export const ProfileMiscFlag2 = {
  DONT_ADD_TO_SECTOR: 0x01,
  LEFT_COUNTRY: 0x02,
  BANDAGED_TODAY: 0x04,
  SAID_FIRSTSEEN_QUOTE: 0x08,
  NEEDS_TO_SAY_HOSTILE_QUOTE: 0x10,
  MARRIED_TO_HICKS: 0x20,
  ASKED_BY_HICKS: 0x40,
} as const;

export const ProfileMiscFlag3 = {
  PLAYER_LEFT_MSG_FOR_MERC_AT_AIM: 0x01,
  PERMANENT_INSERTION_CODE: 0x02,
  PLAYER_HAD_CHANCE_TO_HIRE: 0x04,
  HANDLE_DONE_TRAVERSAL: 0x08,
  NPC_PISSED_OFF: 0x10,
  MERC_MERC_IS_DEAD_AND_QUOTE_SAID: 0x20,
  TOWN_DOESNT_CARE_ABOUT_DEATH: 0x40,
  GOODGUY: 0x80,
} as const;

export interface ProfileContent {
  readonly profiles: readonly MercProfile[];
  readonly items: ItemTable;
  readonly dialogueProfiles?: ReadonlySet<number>;
}

export interface CampaignProfiles {
  readonly profiles: Map<number, ProfileProgress>;
  readonly content: ProfileContent;
}

export function campaignProfile(c: CampaignProfiles, id: number): ProfileProgress | null {
  return profileProgress(c, id);
}

export interface InventoryRatings {
  readonly mainGunAttractiveness: number;
  readonly armourAttractiveness: number;
  readonly optionalGearCost: number;
}

export function inventoryRatings(items: ItemTable, inventory: readonly number[]): InventoryRatings {
  let mainGunAttractiveness = NO_ATTRACTIVENESS;
  let armourAttractiveness = NO_ATTRACTIVENESS;
  let optionalGearCost = 0;
  for (const item of inventory) {
    if (item === NOTHING) continue;
    const def = items.byIndex.get(item);
    if (!def) continue;
    if (def.itemClass === ItemClass.GUN && def.weapon) mainGunAttractiveness = i8(def.weapon.deadliness);
    if (def.itemClass === ItemClass.ARMOUR && def.armour) armourAttractiveness = i8(def.armour.protection);
    optionalGearCost = u16(optionalGearCost + def.price);
  }
  return { mainGunAttractiveness, armourAttractiveness, optionalGearCost };
}

export function initProfileFromContent(p: MercProfile, items: ItemTable, gunNut: boolean, hasDialogue = true): ProfileProgress {
  const progress = progressFromProfile(p);
  progress.mercStatus = hasDialogue ? MercStatus.OK : MercStatus.HAS_NO_TEXT_FILE;
  progress.medicalDepositAmount = progress.medicalDeposit ? calcMedicalDeposit(progress) : 0;
  const inventory = gunNut ? [...p.inventory] : reducedGunListInventory(items, p.inventory);
  progress.inventory.splice(0, progress.inventory.length, ...inventory);
  return Object.assign(progress, inventoryRatings(items, inventory));
}

export function loadMercProfiles(c: CampaignProfiles, gunNut: boolean): void {
  c.content.profiles.forEach((p, id) => {
    if (p) c.profiles.set(id, initProfileFromContent(p, c.content.items, gunNut, c.content.dialogueProfiles?.has(id) ?? true));
  });
}

const KIND_FOR_TYPE: Readonly<Record<number, number>> = {
  [MercType.AIM]: MercKind.AIM_MERC,
  [MercType.MERC]: MercKind.MERC,
  [MercType.IMP]: MercKind.PLAYER_CHARACTER,
  [MercType.RPC]: MercKind.NPC,
};

export function mercKindForProfileType(type: number | undefined): number {
  return (type === undefined ? undefined : KIND_FOR_TYPE[type]) ?? MercKind.AIM_MERC;
}

export function isAimOrMercType(type: number | undefined): boolean {
  return type === MercType.AIM || type === MercType.MERC;
}
