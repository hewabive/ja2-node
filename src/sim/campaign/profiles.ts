// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Profile.cc InitProfileFromContent (attractiveness, optional gear cost, relation counters),
// @src LoadMercProfiles; Soldier_Profile_Type.h PROFILE_MISC_FLAG3_*; Laptop/AIM.h MAX_NUMBER_MERCS; Laptop/Mercs.h
// @src DAYS_TIL_M_E_R_C_AVAIL; src/externalized/mercs/MercProfile.cc (profile types). See docs/22 §0, docs/21 §0.

import type { MercProfile } from '../../content/formats/prof.ts';
import { ItemClass, type ItemTable } from '../../content/items/items.ts';
import { MercType } from '../../content/strategic/economy-content.ts';
import { i8, u16 } from '../../core/int.ts';
import { reducedGunListInventory } from '../tactical/inventory.ts';
import { type ProfileProgress, profileProgress, progressFromProfile } from '../tactical/profiles.ts';
import { MercKind } from './roster.ts';

export const NUM_PROFILES = 200;
export const MAX_NUMBER_MERCS = 40;
export const DAYS_TIL_MERC_AVAILABLE = 3;
const NO_ATTRACTIVENESS = -1;
const NOTHING = 0;

export const ProfileMiscFlag3 = {
  PLAYER_LEFT_MSG_FOR_MERC_AT_AIM: 0x01,
  PERMANENT_INSERTION_CODE: 0x02,
  PLAYER_HAD_CHANCE_TO_HIRE: 0x04,
  MERC_MERC_IS_DEAD_AND_QUOTE_SAID: 0x20,
} as const;

export interface ProfileContent {
  readonly profiles: readonly MercProfile[];
  readonly items: ItemTable;
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

export function initProfileFromContent(p: MercProfile, items: ItemTable, gunNut: boolean): ProfileProgress {
  const progress = progressFromProfile(p);
  const inventory = gunNut ? [...p.inventory] : reducedGunListInventory(items, p.inventory);
  progress.inventory.splice(0, progress.inventory.length, ...inventory);
  return Object.assign(progress, inventoryRatings(items, inventory));
}

export function loadMercProfiles(c: CampaignProfiles, gunNut: boolean): void {
  c.content.profiles.forEach((p, id) => {
    if (p) c.profiles.set(id, initProfileFromContent(p, c.content.items, gunNut));
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
