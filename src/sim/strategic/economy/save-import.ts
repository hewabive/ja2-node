// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/SaveLoadGame.cc LoadSavedGame (mine status, town loyalty, finances temp file, soldier assignment fields;
// @src the strategic status is the Queen's import, src/sim/strategic/ai/save-import.ts). See docs/14 §4, docs/18 §8 (i).

import type { SavedEconomy, SavedSoldierAssignment } from '../../../content/formats/savegame-economy.ts';
import { i32 } from '../../../core/int.ts';
import type { StrategicState } from '../state.ts';
import { SOLDIER_QUOTE_SAID_DONE_ASSIGNMENT } from './constants.ts';
import type { CrewMember } from './ports.ts';
import type { MineStatus } from './state.ts';

export function importEconomy(state: StrategicState, saved: SavedEconomy, laptopBalance: number): void {
  const e = state.economy;
  e.towns = saved.towns.map((t) => ({ ...t }));
  e.mines = saved.mines.map((m): MineStatus => ({ ...m }));
  e.prompts = [];
  e.militiaTrainingCompletedBy = [];
  const f = state.finances;
  f.balance = i32(laptopBalance);
  f.ledger = (saved.finances?.records ?? []).map((r) => ({ ...r }));
}

export function applySavedAssignment(m: CrewMember, saved: SavedSoldierAssignment): void {
  m.trainStat = saved.trainStat;
  m.forcedToStayAwake = saved.forcedToStayAwake;
  m.lastAssignmentChangeMin = saved.lastAssignmentChangeMin;
  m.hospitalPriceModifier = saved.hospitalPriceModifier;
  m.fixingRobot = saved.fixingRobot;
  m.collapsed = saved.collapsed;
  m.nothingToDo = saved.nothingToDo;
  m.asleep = saved.asleep;
  m.vehicleUnderRepair = saved.vehicleUnderRepair;
  m.complainedThatTired = saved.complainedThatTired;
  m.doneQuoteSaid = (saved.quoteSaidExtFlags & SOLDIER_QUOTE_SAID_DONE_ASSIGNMENT) !== 0;
}
