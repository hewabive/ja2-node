// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface_Dialogue.cc HandleNPCDoAction (FindSoldierByProfileID, DeleteTalkingMenu, TriggerNPCRecord,
// @src EVENT_SetSoldierDesiredDirection, GetDirectionToGridNoFromGridNo as the actions use them). See docs/25 §3.1.

import { deleteTalkingMenu, triggerNpcRecord } from '../../../narrative/converse.ts';
import { soldierByProfile } from '../../../narrative/dialogue-queue.ts';
import type { ProfileProgress } from '../../profiles.ts';
import type { Soldier } from '../../soldier.ts';
import type { TacticalState } from '../../state.ts';
import type { NpcActionEnv } from './env.ts';

export const ProfileMiscFlag = { SAID_HOSTILE_QUOTE: 0x20 } as const;
export const ProfileMiscFlag2 = { DONT_ADD_TO_SECTOR: 0x01, LEFT_COUNTRY: 0x02, MARRIED_TO_HICKS: 0x20, ASKED_BY_HICKS: 0x40 } as const;
export const ProfileMiscFlag3 = { PERMANENT_INSERTION_CODE: 0x02 } as const;

export function tactical(env: NpcActionEnv): TacticalState | null {
  return env.host.tactical();
}

export function npcSoldier(env: NpcActionEnv, profile: number): Soldier | null {
  return soldierByProfile(env.host, profile);
}

export function profileOf(env: NpcActionEnv, profile: number): ProfileProgress | null {
  return env.host.profile(profile);
}

export function closeMenu(env: NpcActionEnv): void {
  deleteTalkingMenu(env.host, 'script');
}

export function trigger(env: NpcActionEnv, npc: number, record: number): void {
  triggerNpcRecord(env.host, npc, record);
}

export function destSoldier(env: NpcActionEnv): Soldier | null {
  const id = env.host.context.dest;
  if (id === null) return null;
  return env.host.tactical()?.soldiers[id] ?? null;
}

export function srcSoldier(env: NpcActionEnv): Soldier | null {
  const id = env.host.context.src;
  if (id === null) return null;
  return env.host.tactical()?.soldiers[id] ?? null;
}

export { roomAt } from '../../ai/destinations.ts';
