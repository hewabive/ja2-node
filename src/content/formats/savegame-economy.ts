// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Mines.cc LoadMineStatusFromSavedGameFile; Strategic_Town_Loyalty.cc
// @src LoadStrategicTownLoyaltyFromSavedGameFile;
// @src Laptop/Finances.cc AppendFinanceToEndOfFile, GetBalanceFromDisk (finances.dat); Tactical/Soldier_Control.h SOLDIERTYPE
// @src (assignment fields).

import { FormatError } from '../binary/errors.ts';
import { decryptRecord as decryptWithOldKey } from './prof.ts';
import type { SaveGame, SaveSection } from './savegame.ts';
import { SaveCursor } from './savegame-cursor.ts';
import { decryptSaveRecord, type SaveEncryptionTable } from './savegame-header.ts';
import { readLayout } from './savegame-layout.ts';
import { SOLDIER_LAYOUT, soldierRecordBytes } from './savegame-soldier.ts';
import { readMercPath } from './savegame-strategic.ts';
import { TOTAL_SOLDIERS } from './savegame-tactical.ts';

const NUM_MINES = 6;
const MINE_FLAGS = 10;
const NUM_TOWNS = 13;
const TOWN_LOYALTY_BYTES = 26;
const FINANCE_HEADER_BYTES = 4;
const FINANCE_RECORD_BYTES = 14;
const KEY_RING_BYTES = 128;

export interface SavedMineStatus {
  readonly mineType: number;
  readonly maxRemovalRate: number;
  readonly remainingOreSupply: number;
  readonly oreRunningOutPoint: number;
  readonly empty: boolean;
  readonly runningOut: boolean;
  readonly warnedOfRunningOut: boolean;
  readonly shutDownIsPermanent: boolean;
  readonly shutDown: boolean;
  readonly prevInvadedByMonsters: boolean;
  readonly spokeToHeadMiner: boolean;
  readonly mineHasProducedForPlayer: boolean;
  readonly queenRetookProducingMine: boolean;
  readonly attackedHeadMiner: boolean;
  readonly timePlayerProductionStarted: number;
}

export interface SavedTownLoyalty {
  readonly rating: number;
  readonly change: number;
  readonly started: boolean;
  readonly liberatedAlready: boolean;
}

export interface SavedFinanceRecord {
  readonly code: number;
  readonly secondCode: number;
  readonly minute: number;
  readonly amount: number;
  readonly balanceAfter: number;
}

export interface SavedFinances {
  readonly balance: number;
  readonly records: readonly SavedFinanceRecord[];
}

export interface SavedEconomy {
  readonly mines: readonly SavedMineStatus[];
  readonly towns: readonly SavedTownLoyalty[];
  readonly finances: SavedFinances | null;
}

export interface SavedSoldierAssignment {
  readonly id: number;
  readonly trainStat: number;
  readonly forcedToStayAwake: boolean;
  readonly lastAssignmentChangeMin: number;
  readonly fixingRobot: boolean;
  readonly collapsed: boolean;
  readonly nothingToDo: boolean;
  readonly asleep: boolean;
  readonly vehicleUnderRepair: number;
  readonly complainedThatTired: boolean;
  readonly quoteSaidExtFlags: number;
  readonly hospitalPriceModifier: number;
}

function sectionCursor(bytes: Uint8Array, sections: readonly SaveSection[], name: string): SaveCursor {
  const s = sections.find((x) => x.name === name);
  if (!s) throw new FormatError(`savegame has no ${name} section`);
  return new SaveCursor(bytes.subarray(s.offset, s.offset + s.size));
}

function readMine(c: SaveCursor): SavedMineStatus {
  const mineType = c.u8();
  c.skip(3);
  const maxRemovalRate = c.u32();
  const remainingOreSupply = c.u32();
  const oreRunningOutPoint = c.u32();
  const flags = Array.from({ length: MINE_FLAGS }, () => c.bool());
  c.skip(2);
  const timePlayerProductionStarted = c.u32();
  c.skip(12);
  return {
    mineType,
    maxRemovalRate,
    remainingOreSupply,
    oreRunningOutPoint,
    empty: flags[0] === true,
    runningOut: flags[1] === true,
    warnedOfRunningOut: flags[2] === true,
    shutDownIsPermanent: flags[3] === true,
    shutDown: flags[4] === true,
    prevInvadedByMonsters: flags[5] === true,
    spokeToHeadMiner: flags[6] === true,
    mineHasProducedForPlayer: flags[7] === true,
    queenRetookProducingMine: flags[8] === true,
    attackedHeadMiner: flags[9] === true,
    timePlayerProductionStarted,
  };
}

function readTownLoyalty(c: SaveCursor): SavedTownLoyalty {
  const rating = c.u8();
  c.skip(1);
  const change = c.i16();
  const started = c.bool();
  c.skip(1);
  const liberatedAlready = c.bool();
  c.skip(TOWN_LOYALTY_BYTES - 7);
  return { rating, change, started, liberatedAlready };
}

export function decodeFinancesFile(data: Uint8Array): SavedFinances | null {
  if (data.length < FINANCE_HEADER_BYTES) return null;
  const c = new SaveCursor(data);
  const balance = c.i32();
  const records: SavedFinanceRecord[] = [];
  while (c.remaining >= FINANCE_RECORD_BYTES)
    records.push({ code: c.u8(), secondCode: c.u8(), minute: c.u32(), amount: c.i32(), balanceAfter: c.i32() });
  return { balance, records };
}

export function readSavedEconomy(bytes: Uint8Array, sections: readonly SaveSection[]): SavedEconomy {
  const mines = sectionCursor(bytes, sections, 'mine status');
  const towns = sectionCursor(bytes, sections, 'town loyalty');
  const finances = sectionCursor(bytes, sections, 'finances file');
  const financeSize = finances.u32();
  return {
    mines: Array.from({ length: NUM_MINES }, () => readMine(mines)),
    towns: Array.from({ length: NUM_TOWNS }, () => readTownLoyalty(towns)),
    finances: decodeFinancesFile(finances.bytes.subarray(4, 4 + financeSize)),
  };
}

function soldierKey(save: SaveGame, table: SaveEncryptionTable): Uint8Array | null {
  if (save.encryptionSet < 0) return null;
  const key = table.sets[save.encryptionSet];
  if (!key) throw new FormatError(`encryption set ${save.encryptionSet} is outside the table`);
  return key;
}

export function readSoldierAssignments(bytes: Uint8Array, save: SaveGame, table: SaveEncryptionTable): SavedSoldierAssignment[] {
  const c = sectionCursor(bytes, save.sections, 'soldiers');
  const key = soldierKey(save, table);
  const linux = save.stracLinuxFormat;
  const out: SavedSoldierAssignment[] = [];
  for (let slot = 0; slot < TOTAL_SOLDIERS; slot++) {
    if (c.u8() === 0) continue;
    const encrypted = c.bytes.subarray(c.pos, c.pos + soldierRecordBytes(linux));
    c.skip(soldierRecordBytes(linux));
    const plain = key ? decryptSaveRecord(encrypted, key) : decryptWithOldKey(encrypted);
    const r = readLayout(new SaveCursor(plain), SOLDIER_LAYOUT, linux, 'SOLDIERTYPE');
    out.push({
      id: r.num('ubID'),
      trainStat: r.num('bTrainStat'),
      forcedToStayAwake: r.bool('fForcedToStayAwake'),
      lastAssignmentChangeMin: r.num('uiLastAssignmentChangeMin'),
      fixingRobot: r.bool('fFixingRobot'),
      collapsed: r.bool('fMercCollapsedFlag'),
      nothingToDo: r.bool('fDoneAssignmentAndNothingToDoFlag'),
      asleep: r.bool('fMercAsleep'),
      vehicleUnderRepair: r.num('bVehicleUnderRepairID'),
      complainedThatTired: r.bool('fComplainedThatTired'),
      quoteSaidExtFlags: r.num('usQuoteSaidExtFlags'),
      hospitalPriceModifier: r.num('bHospitalPriceModifier'),
    });
    readMercPath(c);
    if (c.u8() !== 0) c.skip(KEY_RING_BYTES);
  }
  return out;
}
