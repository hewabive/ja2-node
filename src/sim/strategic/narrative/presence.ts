// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Tactical_Save.cc ChangeNpcToDifferentSector; Tactical/Items.cc PlaceObjectInSoldierProfile,
// @src RemoveObjectFromSoldierProfile, SetMoneyInSoldierProfile; Tactical/Soldier_Profile.cc g_terrorist_infos,
// @src g_assassin_info, MakeRemainingTerroristsTougher, DecideOnAssassin, MakeRemainingAssassinsTougher; Strategic_Event_Handler.cc
// @src RemoveAssassin; sgp/Types.cc SGPSector::IsValid.

import { ItemClass, type ItemTable } from '../../../content/items/items.ts';
import { idiv, u8 } from '../../../core/int.ts';
import { InvSlot } from '../../tactical/inventory.ts';
import { isProfileDead, type ProfileProgress } from '../../tactical/profiles.ts';
import { Town } from '../economy/constants.ts';
import { Difficulty } from '../forces/constants.ts';
import type { SectorPosition } from '../state.ts';
import { Npc } from './npc-ids.ts';

export const NO_SECTOR: SectorPosition = { x: 0, y: 0, z: 0 };
const LEFT_COUNTRY = 0x02;
const MAX_SECTOR = 16;
const MAX_Z = 3;
const NOTHING = 0;
const FULL_STATUS = 100;
const NUM_PROFILE_SLOTS = 19;
const TOUGHENING_SCALE = 60;
const MEDIUM_TOUGHENING_PERCENT = 130;
const HARD_TOUGHENING_PERCENT = 160;
const TOUGHENING_STEPS = [14, 28, 42, 56, 70] as const;
const ASSASSIN_DELAY_BASE_HOURS = 3;
const ASSASSIN_DELAY_SPREAD_HOURS = 3;
const MINUTES_PER_HOUR = 60;

export const TERRORISTS: readonly number[] = [Npc.DRUGGIST, Npc.SLAY, Npc.ANNIE, Npc.CHRIS, Npc.TIFFANY, Npc.T_REX];

export const ASSASSINS: readonly { readonly profile: number; readonly towns: readonly number[] }[] = [
  { profile: Npc.JIM, towns: [Town.CAMBRIA, Town.DRASSEN, Town.ALMA, Town.BALIME, Town.GRUMM] },
  { profile: Npc.JACK, towns: [Town.CHITZENA, Town.ESTONI, Town.ALMA, Town.BALIME, Town.GRUMM] },
  { profile: Npc.OLAF, towns: [Town.DRASSEN, Town.ESTONI, Town.ALMA, Town.CAMBRIA, Town.BALIME] },
  { profile: Npc.RAY, towns: [Town.CAMBRIA, Town.OMERTA, Town.BALIME, Town.GRUMM, Town.DRASSEN] },
  { profile: Npc.OLGA, towns: [Town.CHITZENA, Town.OMERTA, Town.CAMBRIA, Town.ALMA, Town.GRUMM] },
  { profile: Npc.TYRONE, towns: [Town.CAMBRIA, Town.BALIME, Town.ALMA, Town.GRUMM, Town.DRASSEN] },
];

export function profileSector(p: ProfileProgress): SectorPosition {
  return { x: p.sectorX, y: p.sectorY, z: p.sectorZ };
}

export function profileSectorValid(p: ProfileProgress): boolean {
  return p.sectorX >= 1 && p.sectorX <= MAX_SECTOR && p.sectorY >= 1 && p.sectorY <= MAX_SECTOR && p.sectorZ >= 0 && p.sectorZ <= MAX_Z;
}

export function profileInSector(p: ProfileProgress, s: SectorPosition | null): boolean {
  return s !== null && p.sectorX === s.x && p.sectorY === s.y && p.sectorZ === s.z;
}

export function setProfileSector(p: ProfileProgress, s: SectorPosition | null): void {
  const target = s ?? NO_SECTOR;
  p.sectorX = target.x;
  p.sectorY = target.y;
  p.sectorZ = target.z;
}

export function changeNpcToDifferentSector(p: ProfileProgress, s: SectorPosition | null): void {
  setProfileSector(p, p.miscFlags2 & LEFT_COUNTRY ? null : s);
  p.useProfileInsertion = false;
}

export interface ProfileSoldierInventory {
  slotEmpty(slot: number): boolean;
  put(slot: number, item: number, status: number, count: number): void;
  putMoney(slot: number, amount: number): void;
  remove(item: number): void;
}

export interface ProfileItems {
  readonly table: ItemTable;
  soldier(profile: number): ProfileSoldierInventory | null;
}

function isMoney(items: ProfileItems, item: number): boolean {
  return ((items.table.byIndex.get(item)?.itemClass ?? 0) & ItemClass.MONEY) !== 0;
}

export function removeObjectFromProfile(items: ProfileItems, p: ProfileProgress, item: number): boolean {
  if (item === NOTHING) return true;
  let removed = false;
  for (let slot = 0; slot < NUM_PROFILE_SLOTS; slot++) {
    if (p.inventory[slot] !== item) continue;
    p.inventory[slot] = NOTHING;
    p.inventoryStatus[slot] = 0;
    p.inventoryCount[slot] = 0;
    removed = true;
    break;
  }
  items.soldier(p.id)?.remove(item);
  return removed;
}

export interface ProfileObject {
  readonly item: number;
  readonly status: number;
  readonly count: number;
  readonly money: number;
}

export function placeObjectInProfile(items: ProfileItems, p: ProfileProgress, o: ProfileObject): boolean {
  const money = isMoney(items, o.item);
  if (money && p.money > 0) {
    setMoneyInProfile(items, p, p.money + o.money);
    return true;
  }
  const soldier = items.soldier(p.id);
  for (let slot = InvSlot.BIGPOCK1; slot < InvSlot.SMALLPOCK8; slot++) {
    if ((p.inventoryCount[slot] ?? 0) !== 0 || (soldier !== null && !soldier.slotEmpty(slot))) continue;
    if (money) {
      p.money += o.money;
      soldier?.putMoney(slot, p.money);
    } else {
      p.inventory[slot] = o.item;
      p.inventoryStatus[slot] = o.status;
      p.inventoryCount[slot] = o.count;
      soldier?.put(slot, o.item, o.status, o.count);
    }
    return true;
  }
  return false;
}

export function setMoneyInProfile(items: ProfileItems, p: ProfileProgress, amount: number): void {
  const moneyItem = [...items.table.byIndex.values()].find((d) => d.itemClass & ItemClass.MONEY)?.index ?? NOTHING;
  while (moneyItem !== NOTHING && removeObjectFromProfile(items, p, moneyItem));
  p.money = 0;
  if (amount > 0) placeObjectInProfile(items, p, { item: moneyItem, status: FULL_STATUS, count: 1, money: amount });
}

export interface TougheningItems {
  readonly miniGrenade: number;
  readonly handGrenade: number;
  readonly mustardGrenade: number;
  readonly rocketLauncher: number;
}

function toughening(difficulty: number, removed: number, total: number): number {
  let value = idiv(TOUGHENING_SCALE, total) * removed;
  if (difficulty === Difficulty.MEDIUM) value = idiv(value * MEDIUM_TOUGHENING_PERCENT, 100);
  else if (difficulty === Difficulty.HARD) value = idiv(value * HARD_TOUGHENING_PERCENT, 100);
  return u8(value);
}

function tougheningSwap(t: TougheningItems, level: number): { readonly old: number; readonly next: number } | null {
  const [first, second, third, fourth, fifth] = TOUGHENING_STEPS;
  if (level < first) return null;
  if (level < second) return { old: NOTHING, next: t.miniGrenade };
  if (level < third) return { old: t.miniGrenade, next: t.handGrenade };
  if (level < fourth) return { old: t.handGrenade, next: t.mustardGrenade };
  if (level < fifth) return { old: t.mustardGrenade, next: t.rocketLauncher };
  return { old: NOTHING, next: t.handGrenade };
}

function toughen(items: ProfileItems, profiles: readonly ProfileProgress[], swap: { readonly old: number; readonly next: number }): void {
  for (const p of profiles) {
    if (swap.old !== NOTHING) removeObjectFromProfile(items, p, swap.old);
    placeObjectInProfile(items, p, { item: swap.next, status: FULL_STATUS, count: 1, money: 0 });
  }
}

export interface TougheningContext {
  readonly items: ProfileItems;
  readonly toughening: TougheningItems;
  readonly difficulty: number;
  profile(id: number): ProfileProgress | null;
  slayOnPlayerTeam(): boolean;
}

export function makeRemainingTerroristsTougher(ctx: TougheningContext, numTerrorists: number): void {
  const remaining = TERRORISTS.map((id) => ctx.profile(id)).filter(
    (p): p is ProfileProgress => p !== null && !isProfileDead(p) && profileSectorValid(p) && !(p.id === Npc.SLAY && ctx.slayOnPlayerTeam()),
  );
  if (numTerrorists <= 0) return;
  const swap = tougheningSwap(ctx.toughening, toughening(ctx.difficulty, numTerrorists - remaining.length, numTerrorists));
  if (swap) toughen(ctx.items, remaining, swap);
}

export function makeRemainingAssassinsTougher(ctx: TougheningContext): void {
  const remaining = ASSASSINS.map((a) => ctx.profile(a.profile)).filter((p): p is ProfileProgress => p !== null && !isProfileDead(p));
  const swap = tougheningSwap(ctx.toughening, toughening(ctx.difficulty, ASSASSINS.length - remaining.length, ASSASSINS.length));
  if (swap) toughen(ctx.items, remaining, swap);
}

export interface AssassinContext {
  readonly world: SectorPosition;
  readonly town: number;
  readonly now: number;
  random(n: number): number;
  profile(id: number): ProfileProgress | null;
  removeAssassinAt(minute: number, profile: number): void;
}

export function decideOnAssassin(ctx: AssassinContext): void {
  const candidates = ASSASSINS.filter((a) => {
    const p = ctx.profile(a.profile);
    return p !== null && !isProfileDead(p) && !profileSectorValid(p) && a.towns.includes(ctx.town);
  }).map((a) => a.profile);
  if (candidates.length === 0) return;
  const pid = candidates[ctx.random(candidates.length)] ?? Npc.JIM;
  const p = ctx.profile(pid);
  if (!p) return;
  setProfileSector(p, ctx.world);
  const hours = ASSASSIN_DELAY_BASE_HOURS + ctx.random(ASSASSIN_DELAY_SPREAD_HOURS);
  ctx.removeAssassinAt(ctx.now + MINUTES_PER_HOUR * hours, pid);
}

export function removeAssassin(p: ProfileProgress): void {
  setProfileSector(p, null);
  p.life = p.stats.lifeMax;
}
