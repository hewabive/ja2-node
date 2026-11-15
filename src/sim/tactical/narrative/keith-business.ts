// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-15. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/NPC.cc HandleVictoryInNPCSector, HandleShopKeepHasBeenShutDown.

import { parseSectorId, sectorId } from '../../../content/strategic/sector-ids.ts';
import { Fact } from '../../strategic/narrative/fact-ids.ts';
import { Npc } from '../../strategic/narrative/npc-ids.ts';
import { CivilianGroup, type Soldier, Team } from '../soldier.ts';
import type { SectorRef, TacticalState } from '../state.ts';
import type { NarrativePort } from './port.ts';

const HILLBILLY_FARM = parseSectorId('F10');
const KeithRecord = { LOYALTY_LOW: 7, OUT_OF_BUSINESS: 11 } as const;

export type ShopKeepScript = Pick<NarrativePort, 'fact' | 'triggerNpcRecord'>;

function activeOnTeam(s: Soldier | undefined, team: number): s is Soldier {
  return s !== undefined && s.team === team && (s.placed || s.offMap || s.away);
}

function hillbilliesAlive(t: TacticalState): boolean {
  return t.soldiers.some((s) => activeOnTeam(s, Team.CIV) && s.civilianGroup === CivilianGroup.HICKS && s.life > 0);
}

export function handleVictoryInNpcSector(t: TacticalState, sector: SectorRef): void {
  if (sector.z !== 0 || sectorId(sector) !== HILLBILLY_FARM || hillbilliesAlive(t)) return;
  if (!t.narrative.fact(Fact.HILLBILLIES_KILLED, Npc.KEITH)) t.narrative.setFactTrue(Fact.HILLBILLIES_KILLED);
  if (t.narrative.fact(Fact.KEITH_OUT_OF_BUSINESS, Npc.KEITH)) t.narrative.setFactFalse(Fact.KEITH_OUT_OF_BUSINESS);
}

function keithShutDownRecord(script: ShopKeepScript): number | null {
  if (script.fact(Fact.KEITH_OUT_OF_BUSINESS, Npc.KEITH)) return KeithRecord.OUT_OF_BUSINESS;
  if (script.fact(Fact.LOYALTY_LOW, Npc.KEITH)) return KeithRecord.LOYALTY_LOW;
  return null;
}

export function handleShopKeepHasBeenShutDown(script: ShopKeepScript, npc: number): boolean {
  if (npc !== Npc.KEITH) return false;
  const record = keithShutDownRecord(script);
  if (record === null) return false;
  script.triggerNpcRecord(Npc.KEITH, record);
  return true;
}
