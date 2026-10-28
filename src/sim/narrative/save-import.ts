// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/SaveLoadGame.cc LoadSavedGame (ShutdownNPCQuotes, LoadNPCInfoFromSavedGameFile,
// @src LoadBackupNPCInfoFromSavedGameFile, ResetOncePerConvoRecordsForAllNPCsInLoadedSector); TacticalAI/NPC.cc
// @src LoadNPCInfoFromSavedGameFile (the RefreshNPCScriptRecord passes for old saves).

import type { NpcRecord } from '../../content/formats/npc.ts';
import type { SavedNpcRecords } from '../../content/formats/savegame-npc.ts';
import { NUM_CIVQUOTE_SECTORS, NUM_PROFILES } from '../../content/narrative/npc-constants.ts';
import {
  type RecordsEnv,
  refreshNpcScriptRecord,
  refreshPlayerScriptRecord,
  resetOncePerConvoRecordsForAllNpcsInLoadedSector,
  type SectorRef,
} from './records.ts';

const PC_SCRIPT_RECORD = 5;
const ProfileId = {
  CONRAD: 70,
  DARREN: 87,
  SKYRIDER: 97,
  FATHER: 100,
  HANS: 117,
  JOHN: 118,
  ARMAND: 122,
  JENNY: 132,
  WALDO: 138,
  MATT: 148,
  DARYL: 150,
  KINGPIN: 86,
  AUNTIE: 76,
  FRANK: 92,
} as const;

interface RefreshStep {
  readonly beforeVersion: number;
  readonly records: readonly (readonly [number, number])[];
}

const REFRESHES: readonly RefreshStep[] = [
  {
    beforeVersion: 88,
    records: [
      [ProfileId.DARYL, 11],
      [ProfileId.DARYL, 14],
      [ProfileId.DARYL, 15],
    ],
  },
  {
    beforeVersion: 89,
    records: [
      [ProfileId.KINGPIN, 23],
      [ProfileId.KINGPIN, 27],
    ],
  },
  {
    beforeVersion: 90,
    records: [
      [ProfileId.KINGPIN, 25],
      [ProfileId.KINGPIN, 26],
    ],
  },
  {
    beforeVersion: 92,
    records: [
      [ProfileId.MATT, 14],
      [ProfileId.AUNTIE, 8],
    ],
  },
  {
    beforeVersion: 93,
    records: [
      [ProfileId.JENNY, 7],
      [ProfileId.JENNY, 8],
      [ProfileId.FRANK, 7],
      [ProfileId.FRANK, 8],
      [ProfileId.FATHER, 12],
      [ProfileId.FATHER, 13],
    ],
  },
  {
    beforeVersion: 94,
    records: [
      [ProfileId.CONRAD, 0],
      [ProfileId.CONRAD, 2],
      [ProfileId.CONRAD, 9],
    ],
  },
  {
    beforeVersion: 95,
    records: [
      [ProfileId.WALDO, 6],
      [ProfileId.WALDO, 7],
      [ProfileId.WALDO, 10],
      [ProfileId.WALDO, 11],
      [ProfileId.WALDO, 12],
    ],
  },
  {
    beforeVersion: 96,
    records: [
      [ProfileId.HANS, 18],
      [ProfileId.ARMAND, 13],
      [ProfileId.DARREN, 4],
      [ProfileId.DARREN, 5],
    ],
  },
  {
    beforeVersion: 97,
    records: [
      [ProfileId.JOHN, 22],
      [ProfileId.JOHN, 23],
      [ProfileId.SKYRIDER, 19],
      [ProfileId.SKYRIDER, 21],
      [ProfileId.SKYRIDER, 22],
    ],
  },
  {
    beforeVersion: 98,
    records: [
      [ProfileId.SKYRIDER, 19],
      [ProfileId.SKYRIDER, 21],
      [ProfileId.SKYRIDER, 22],
    ],
  },
];
const FIRST_VERSION_WITHOUT_PC_REFRESH = 88;

function copyArrays<T>(saved: readonly (T[] | null)[], into: (T[] | null)[], length: number, copy: (a: T[]) => T[]): void {
  for (let i = 0; i < length; i++) {
    const a = saved[i] ?? null;
    into[i] = a ? copy(a) : null;
  }
}

export function importNpcRecords(
  env: RecordsEnv,
  saved: SavedNpcRecords,
  version: number,
  world: SectorRef | null,
  profileSector: (profile: number) => SectorRef | null,
): void {
  const state = env.records;
  const copy = (a: NpcRecord[]) => a.map((r) => ({ ...r }));
  state.backups.fill(null);
  copyArrays(saved.arrays, state.arrays, NUM_PROFILES, copy);
  copyArrays(saved.civilian, state.civilian, NUM_CIVQUOTE_SECTORS, copy);
  if (version < FIRST_VERSION_WITHOUT_PC_REFRESH) refreshPlayerScriptRecord(env, PC_SCRIPT_RECORD);
  for (const step of REFRESHES)
    if (version < step.beforeVersion) for (const [profile, record] of step.records) refreshNpcScriptRecord(env, profile, record);
  copyArrays(saved.backups, state.backups, NUM_PROFILES, copy);
  resetOncePerConvoRecordsForAllNpcsInLoadedSector(env, world, profileSector);
}
