// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-31. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Items.cc MakeNPCGrumpyForMinorOffense, TestPotentialOwner, CheckForPickedOwnership and
// @src the 1 s customizable timer SoldierGetItemFromWorld sets for it; TileEngine/Explosion_Control.cc
// @src HandleBuldingDestruction; Tactical/Soldier_Profile.cc DoesNPCOwnBuilding; Item_Types.h OBJECTTYPE (ubOwnerProfile,
// @src ubOwnerCivGroup).

import { u8 } from '../../../core/int.ts';
import type { ItemObject } from '../../items/object.ts';
import { Fact } from '../../strategic/narrative/fact-ids.ts';
import { Npc } from '../../strategic/narrative/npc-ids.ts';
import { AiAction } from '../ai/actions.ts';
import { soldierToSoldierLos } from '../combat/positions.ts';
import { atan8Of } from '../perception/opp.ts';
import { distanceVisible } from '../perception/sight.ts';
import { CivilianGroup, NO_PROFILE, OKLIFE, type Soldier, Team } from '../soldier.ts';
import { sectorMapOf, type TacticalState, teamMembers } from '../state.ts';
import { isTeamActive } from '../turns/turns.ts';
import { itemsAt } from '../world-items.ts';
import { addToShouldBecomeHostileOrSayQuoteList } from './civ-hostility.ts';

export const PICKED_OWNERSHIP_CHECK_DELAY_MS = 1000;

const NO_ROOM = 0;
const FACING_IRRELEVANT = -1;
const ProfileMiscFlag3 = { NPC_PISSED_OFF: 0x10, GOODGUY: 0x80 } as const;

const PISSED_OFF_INSTEAD_OF_HOSTILE: ReadonlySet<number> = new Set([
  Npc.FREDO,
  Npc.FRANZ,
  Npc.HERVE,
  Npc.PETER,
  Npc.ALBERTO,
  Npc.CARLO,
  Npc.MANNY,
  Npc.GABBY,
  Npc.ARNIE,
  Npc.HOWARD,
  Npc.SAM,
  Npc.FATHER,
  Npc.TINA,
  Npc.ARMAND,
  Npc.WALTER,
]);

function getsPissedOff(t: TacticalState, s: Soldier): void {
  const p = t.profiles.get(s.profile);
  if (p) p.miscFlags3 |= ProfileMiscFlag3.NPC_PISSED_OFF;
  t.narrative.sayHostileQuote(s);
}

export function makeNpcGrumpyForMinorOffense(t: TacticalState, s: Soldier, offender: Soldier): void {
  t.turnHooks.cancelAIAction(t, s);
  if (PISSED_OFF_INSTEAD_OF_HOSTILE.has(s.profile)) getsPissedOff(t, s);
  else addToShouldBecomeHostileOrSayQuoteList(t, s);
  s.ai.nextAction = AiAction.CHANGE_FACING;
  s.ai.nextActionData = atan8Of(s, offender);
}

const ownerProfileOf = (o: ItemObject) => u8(o.status[0] ?? 0);
const ownerCivGroupOf = (o: ItemObject) => o.gunAmmoType;

function soldierWithProfile(t: TacticalState, profile: number): Soldier | null {
  return t.soldiers.find((s) => s?.placed && s.profile === profile) ?? null;
}

function testPotentialOwner(t: TacticalState, s: Soldier, picker: Soldier): void {
  if (s.life < OKLIFE) return;
  const sightLimit = distanceVisible(t, s, FACING_IRRELEVANT, 0, picker.gridNo, picker.level);
  if (soldierToSoldierLos(t, s, picker, sightLimit, true) === 0) return;
  makeNpcGrumpyForMinorOffense(t, s, picker);
}

function hicksAppeased(t: TacticalState, group: number): boolean {
  return group === CivilianGroup.HICKS && t.narrative.fact(Fact.HICKS_MARRIED_PLAYER_MERC, 0);
}

function checkForPickedOwnership(t: TacticalState, picker: Soldier, gridNo: number): void {
  const ownership = t.content.items.byName.get('OWNERSHIP')?.index;
  for (const marker of itemsAt(t, gridNo, picker.level)) {
    if (marker.object.item !== ownership) continue;
    const ownerProfile = ownerProfileOf(marker.object);
    const owner = ownerProfile === NO_PROFILE ? null : soldierWithProfile(t, ownerProfile);
    if (owner) testPotentialOwner(t, owner, picker);
    const group = ownerCivGroupOf(marker.object);
    if (group === CivilianGroup.NONE || hicksAppeased(t, group)) continue;
    for (const s of teamMembers(t, Team.CIV)) if (s.civilianGroup === group) testPotentialOwner(t, s, picker);
  }
}

export function schedulePickedOwnershipCheck(t: TacticalState, picker: Soldier, gridNo: number): void {
  t.pickedOwnershipCheck = { picker, gridNo, dueMs: t.clockMs + PICKED_OWNERSHIP_CHECK_DELAY_MS };
}

export function handlePickedOwnershipCheck(t: TacticalState): void {
  const check = t.pickedOwnershipCheck;
  if (!check || t.clockMs < check.dueMs) return;
  t.pickedOwnershipCheck = null;
  checkForPickedOwnership(t, check.picker, check.gridNo);
}

function ownsRoom(t: TacticalState, s: Soldier, room: number): boolean {
  const p = t.content.profiles[s.profile];
  if (!p) return false;
  return p.roomRangeStart.some((first, k) => room >= first && room <= (p.roomRangeEnd[k] ?? NO_ROOM));
}

function doesNpcOwnBuilding(t: TacticalState, s: Soldier, gridNo: number): boolean {
  const room = sectorMapOf(t).rooms[gridNo] ?? NO_ROOM;
  if (room === NO_ROOM || s.team !== Team.CIV) return false;
  return ownsRoom(t, s, room);
}

function goodGuyBesideTheFight(t: TacticalState, s: Soldier): boolean {
  if (!isTeamActive(t, Team.ENEMY)) return false;
  return ((t.profiles.get(s.profile)?.miscFlags3 ?? 0) & ProfileMiscFlag3.GOODGUY) !== 0;
}

export function handleBuildingDestruction(t: TacticalState, gridNo: number, owner: Soldier | null): void {
  if (!owner || owner.team !== Team.OUR) return;
  for (const s of teamMembers(t, Team.CIV)) {
    if (s.life === 0 || !s.neutral || s.profile === NO_PROFILE) continue;
    if (goodGuyBesideTheFight(t, s)) continue;
    if (doesNpcOwnBuilding(t, s, gridNo)) makeNpcGrumpyForMinorOffense(t, s, owner);
  }
}
