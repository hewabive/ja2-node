// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Profile.cc WhichBuddy, WhichHated, GetFirstBuddyOnTeam, FindSoldierByProfileIDOnPlayerTeam;
// @src Tactical/Soldier_Add.cc IsMercOnTeam, IsMercOnTeamAndInOmertaAlreadyAndAlive; Soldier_Profile_Type.h BuddySlot,
// @src HatedSlot, BUDDY_OPINION, HATED_OPINION. See docs/22 §5.1.

import { Assignment } from '../../strategic/economy/constants.ts';
import { isProfileDead, type ProfileProgress } from '../../tactical/profiles.ts';
import type { RosterMerc } from '../roster.ts';

export const BuddySlot = { NOT_FOUND: -1, SLOT1: 0, SLOT2: 1, LEARNED_TO_LIKE: 2, COUNT: 3 } as const;
export const HatedSlot = { NOT_FOUND: -1, SLOT1: 0, SLOT2: 1, LEARNED_TO_HATE: 2, COUNT: 3 } as const;
export const BUDDY_OPINION = 25;
export const HATED_OPINION = -25;
export const NO_RELATION = -1;

export interface TeamRelations {
  readonly team: readonly RosterMerc[];
  readonly profiles: ReadonlyMap<number, ProfileProgress>;
}

export function whichBuddy(p: ProfileProgress, other: number): number {
  for (let slot = BuddySlot.SLOT1; slot < BuddySlot.COUNT; slot++) if (p.buddies[slot] === other) return slot;
  return BuddySlot.NOT_FOUND;
}

export function whichHated(p: ProfileProgress, other: number): number {
  for (let slot = HatedSlot.SLOT1; slot < HatedSlot.COUNT; slot++) if (p.hated[slot] === other) return slot;
  return HatedSlot.NOT_FOUND;
}

export function findMercByProfile(team: readonly RosterMerc[], profile: number): RosterMerc | undefined {
  return team.find((m) => m.profile === profile);
}

export function isMercOnTeam(team: readonly RosterMerc[], profile: number): boolean {
  return findMercByProfile(team, profile) !== undefined;
}

export function isMercOnTeamAndArrivedAndAlive(team: readonly RosterMerc[], profile: number): boolean {
  const m = findMercByProfile(team, profile);
  return m !== undefined && m.assignment !== Assignment.IN_TRANSIT && m.life > 0;
}

export function getFirstBuddyOnTeam(r: TeamRelations, p: ProfileProgress): number {
  for (let slot = BuddySlot.SLOT1; slot < BuddySlot.COUNT; slot++) {
    const buddy = p.buddies[slot] ?? NO_RELATION;
    if (buddy < 0 || !isMercOnTeam(r.team, buddy)) continue;
    const progress = r.profiles.get(buddy);
    if (progress && isProfileDead(progress)) continue;
    return slot;
  }
  return BuddySlot.NOT_FOUND;
}
