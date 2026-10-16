// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/NPC.cc gpNPCQuoteInfoArray, gpBackupNPCQuoteInfoArray, gpCivQuoteInfoArray, LoadQuoteFile,
// @src RevertToOriginalQuoteFile, BackupOriginalQuoteFile, EnsureQuoteFileLoaded, ReloadQuoteFile, ReloadQuoteFileIfLoaded,
// @src RefreshNPCScriptRecord, EnsureCivQuoteFileLoaded, ReloadCivQuoteFileIfLoaded, ShutdownNPCQuotes, ReloadAllQuoteFiles,
// @src SetQuoteRecordAsUsed, ReplaceLocationInNPCData, ResetOncePerConvoRecords, ResetOncePerConvoRecordsForNPC,
// @src ResetOncePerConvoRecordsForAllNPCsInLoadedSector, RecordHasDialogue, ActionIDForMovementRecord,
// @src UpdateDarrelScriptToGoTo; src/externalized/DefaultContentManager.cc getScriptRecords. See docs/24 §1.4, §2.6-§2.7.

import { copyNpcRecords, NO_QUOTE, type NpcRecord, QuoteFlag, requiredGridNo } from '../../content/formats/npc.ts';
import { NpcAction, NUM_CIVQUOTE_SECTORS, NUM_PROFILES, QuoteActionId } from '../../content/narrative/npc-constants.ts';
import type { NpcRecordContent } from '../../content/narrative/npc-records.ts';
import { meanwhileKey } from '../../content/narrative/npc-records.ts';
import { MercType } from '../../content/strategic/economy-content.ts';
import { NarrativeProfile, ProfileFlag } from './narrative-ids.ts';

export const DarrelRecord = { WALK: 10, ARRIVE: 11 } as const;

export interface NpcRecordState {
  readonly arrays: (NpcRecord[] | null)[];
  readonly backups: (NpcRecord[] | null)[];
  readonly civilian: (NpcRecord[] | null)[];
}

export function createNpcRecordState(): NpcRecordState {
  return {
    arrays: new Array<NpcRecord[] | null>(NUM_PROFILES).fill(null),
    backups: new Array<NpcRecord[] | null>(NUM_PROFILES).fill(null),
    civilian: new Array<NpcRecord[] | null>(NUM_CIVQUOTE_SECTORS).fill(null),
  };
}

export interface RecordsEnv {
  readonly records: NpcRecordState;
  readonly content: NpcRecordContent;
  recruited(profile: number): boolean;
  meanwhile(): number | null;
}

export function profileType(env: Pick<RecordsEnv, 'content'>, profile: number): number {
  return env.content.profileTypes.get(profile) ?? MercType.NOT_USED;
}

export function isRpc(env: Pick<RecordsEnv, 'content'>, profile: number): boolean {
  return profileType(env, profile) === MercType.RPC;
}

export function isNpcOrRpc(env: Pick<RecordsEnv, 'content'>, profile: number): boolean {
  const type = profileType(env, profile);
  return type === MercType.RPC || type === MercType.NPC;
}

export function isPlayerMerc(env: Pick<RecordsEnv, 'content'>, profile: number): boolean {
  const type = profileType(env, profile);
  return type === MercType.AIM || type === MercType.MERC || type === MercType.IMP;
}

function scriptRecords(env: RecordsEnv, profile: number): readonly NpcRecord[] | null {
  if (isPlayerMerc(env, profile) || (isRpc(env, profile) && env.recruited(profile))) return env.content.recruited;
  return env.content.scripts[profile] ?? null;
}

export function loadQuoteFile(env: RecordsEnv, profile: number): NpcRecord[] | null {
  const meanwhile = env.meanwhile();
  const meanwhileScripted = profile === NarrativeProfile.QUEEN || profile === NarrativeProfile.ELLIOT;
  const source =
    meanwhile !== null && meanwhileScripted
      ? (env.content.meanwhiles.get(meanwhileKey(meanwhile, profile)) ?? null)
      : scriptRecords(env, profile);
  return source ? copyNpcRecords(source) : null;
}

export function ensureQuoteFileLoaded(env: RecordsEnv, profile: number): NpcRecord[] | null {
  if (profile === NarrativeProfile.ROBOT || profile < 0 || profile >= NUM_PROFILES) return null;
  const { arrays, backups } = env.records;
  let load = arrays[profile] === null;
  if (isRpc(env, profile)) {
    if (env.recruited(profile)) {
      if (backups[profile] === null) {
        load = true;
        backups[profile] = arrays[profile] ?? null;
        arrays[profile] = null;
      }
    } else if (backups[profile] !== null && arrays[profile] !== null) {
      arrays[profile] = backups[profile] ?? null;
      backups[profile] = null;
    }
  }
  if (load) arrays[profile] = loadQuoteFile(env, profile);
  return arrays[profile] ?? null;
}

export function reloadQuoteFile(env: RecordsEnv, profile: number): NpcRecord[] | null {
  env.records.arrays[profile] = null;
  env.records.backups[profile] = null;
  return ensureQuoteFileLoaded(env, profile);
}

function reloadQuoteFileIfLoaded(env: RecordsEnv, profile: number): void {
  if (env.records.arrays[profile] === null) return;
  env.records.arrays[profile] = null;
  ensureQuoteFileLoaded(env, profile);
}

function civilianSource(env: RecordsEnv, index: number): NpcRecord[] | null {
  const source = env.content.civilian[index] ?? null;
  return source ? copyNpcRecords(source) : null;
}

export function ensureCivQuoteFileLoaded(env: RecordsEnv, index: number): NpcRecord[] | null {
  const civ = env.records.civilian;
  if (civ[index] === null) civ[index] = civilianSource(env, index);
  return civ[index] ?? null;
}

export function reloadAllQuoteFiles(env: RecordsEnv): void {
  for (let profile = 0; profile < NUM_PROFILES; profile++) {
    if (!isNpcOrRpc(env, profile)) continue;
    env.records.backups[profile] = null;
    reloadQuoteFileIfLoaded(env, profile);
  }
  for (let index = 0; index < NUM_CIVQUOTE_SECTORS; index++)
    if (env.records.civilian[index] !== null) env.records.civilian[index] = civilianSource(env, index);
}

export function refreshNpcScriptRecord(env: RecordsEnv, profile: number, record: number): void {
  const quotes = env.records.arrays[profile];
  const q = quotes?.[record];
  if (!quotes || !q || q.flags & QuoteFlag.SAID) return;
  const fresh = loadQuoteFile(env, profile)?.[record];
  if (fresh) quotes[record] = fresh;
}

export function refreshPlayerScriptRecord(env: RecordsEnv, record: number): void {
  for (let profile = 0; profile < NUM_PROFILES; profile++) {
    const recruitedRpc = isRpc(env, profile) && env.recruited(profile) && env.records.backups[profile] !== null;
    if (isPlayerMerc(env, profile) || recruitedRpc) refreshNpcScriptRecord(env, profile, record);
  }
}

export function setQuoteRecordAsUsed(env: RecordsEnv, profile: number, record: number): void {
  const q = ensureQuoteFileLoaded(env, profile)?.[record];
  if (q) q.flags |= QuoteFlag.SAID;
}

export function resetOncePerConvoRecords(records: NpcRecord[]): void {
  for (const q of records) if (q.flags & QuoteFlag.SAY_ONCE_PER_CONVO) q.flags &= ~QuoteFlag.SAID;
}

export function resetOncePerConvoRecordsForNpc(env: RecordsEnv, profile: number): void {
  const records = ensureQuoteFileLoaded(env, profile);
  if (records) resetOncePerConvoRecords(records);
}

export interface SectorRef {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function resetOncePerConvoRecordsForAllNpcsInLoadedSector(
  env: RecordsEnv,
  world: SectorRef | null,
  profileSector: (profile: number) => SectorRef | null,
): void {
  if (!world) return;
  for (let profile = 0; profile < NUM_PROFILES; profile++) {
    if (!isNpcOrRpc(env, profile) || env.records.arrays[profile] === null) continue;
    const s = profileSector(profile);
    if (s && s.x === world.x && s.y === world.y && s.z === world.z) resetOncePerConvoRecordsForNpc(env, profile);
  }
}

export function replaceLocationInNpcData(env: RecordsEnv, profile: number, oldGridNo: number, newGridNo: number): void {
  const records = ensureQuoteFileLoaded(env, profile);
  if (!records) return;
  for (const q of records) {
    if (oldGridNo === requiredGridNo(q)) q.requirement = -newGridNo;
    if (oldGridNo === q.goToGridNo) q.goToGridNo = newGridNo;
  }
}

export function recordHasDialogue(env: RecordsEnv, profile: number, record: number): boolean {
  const q = ensureQuoteFileLoaded(env, profile)?.[record];
  return !!q && q.quoteNum !== NO_QUOTE && q.quoteNum !== 0;
}

export function actionIdForMovementRecord(env: RecordsEnv, profile: number, record: number): number {
  const records = ensureQuoteFileLoaded(env, profile);
  if (!records) return 0;
  switch (records[record]?.actionData) {
    case NpcAction.TRAVERSE_MAP_EAST:
      return QuoteActionId.TRAVERSE_EAST;
    case NpcAction.TRAVERSE_MAP_SOUTH:
      return QuoteActionId.TRAVERSE_SOUTH;
    case NpcAction.TRAVERSE_MAP_WEST:
      return QuoteActionId.TRAVERSE_WEST;
    case NpcAction.TRAVERSE_MAP_NORTH:
      return QuoteActionId.TRAVERSE_NORTH;
    default:
      return QuoteActionId.CHECKFORDEST;
  }
}

export function updateDarrelScriptToGoTo(env: RecordsEnv, adjustedGridNo: number, targetProfile: number): void {
  const records = ensureQuoteFileLoaded(env, NarrativeProfile.DARREL);
  const walk = records?.[DarrelRecord.WALK];
  const arrive = records?.[DarrelRecord.ARRIVE];
  if (!walk || !arrive) return;
  walk.goToGridNo = adjustedGridNo;
  arrive.requirement = -adjustedGridNo;
  arrive.triggerNpc = targetProfile;
}

export function profileRecruited(miscFlags: number): boolean {
  return (miscFlags & ProfileFlag.RECRUITED) !== 0;
}
