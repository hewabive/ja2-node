// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/externalized/content/NPCQuoteInfo.h NPCQuoteInfo and its constants; src/game/TacticalAI/NPC.cc
// @src ExtractNPCQuoteInfoArrayFromFile, ConditionalInjectNPCQuoteInfoArrayIntoFile; Strategic/Facts.h FACT_NONE,
// @src FACT_PLAYER_KILLED_BOXERS. See docs/24 §1.3.

import { FormatError } from '../binary/errors.ts';
import { BinaryReader } from '../binary/reader.ts';
import { BinaryWriter } from '../binary/writer.ts';

export const NPC_RECORD_BYTES = 32;
export const NUM_NPC_QUOTE_RECORDS = 50;
export const NPC_FILE_BYTES = NPC_RECORD_BYTES * NUM_NPC_QUOTE_RECORDS;

export const QuoteFlag = { SAID: 0x0001, ERASE_ONCE_SAID: 0x0002, SAY_ONCE_PER_CONVO: 0x0004 } as const;

export const NO_QUOTE = 255;
export const IRRELEVANT = 255;
export const MUST_BE_NEW_DAY = 254;
export const NO_QUEST = 255;
export const QUEST_NOT_STARTED_NUM = 100;
export const QUEST_DONE_NUM = 200;
export const FACT_NONE = 65535;
export const LAST_RECORD_FACT = 368;
export const NO_MOVE = 65535;
export const ACCEPT_ANY_ITEM = 1000;
export const ANY_RIFLE = 1001;
export const TRIGGER_CLOSEST_MERC = 0;
export const TRIGGER_SELF = 1;

export const UiCode = { TURN_UI_OFF: 65000, TURN_UI_ON: 65001, SPECIAL_TURN_UI_OFF: 65002, SPECIAL_TURN_UI_ON: 65003 } as const;

export type NpcRecordLayout = 'standard' | 'russian';

export interface NpcRecord {
  identifier: number;
  flags: number;
  requirement: number;
  factMustBeTrue: number;
  factMustBeFalse: number;
  quest: number;
  firstDay: number;
  lastDay: number;
  approachRequired: number;
  opinionRequired: number;
  quoteNum: number;
  numQuotes: number;
  startQuest: number;
  endQuest: number;
  triggerNpc: number;
  triggerNpcRecord: number;
  setFactTrue: number;
  giftItem: number;
  goToGridNo: number;
  actionData: number;
}

export function emptyNpcRecord(): NpcRecord {
  return {
    identifier: 0,
    flags: 0,
    requirement: 0,
    factMustBeTrue: 0,
    factMustBeFalse: 0,
    quest: 0,
    firstDay: 0,
    lastDay: 0,
    approachRequired: 0,
    opinionRequired: 0,
    quoteNum: 0,
    numQuotes: 0,
    startQuest: 0,
    endQuest: 0,
    triggerNpc: 0,
    triggerNpcRecord: 0,
    setFactTrue: 0,
    giftItem: 0,
    goToGridNo: 0,
    actionData: 0,
  };
}

export function requiredItem(r: Pick<NpcRecord, 'requirement'>): number {
  return r.requirement > 0 ? r.requirement : 0;
}

export function requiredGridNo(r: Pick<NpcRecord, 'requirement'>): number {
  return -r.requirement;
}

export function copyNpcRecords(records: readonly NpcRecord[]): NpcRecord[] {
  return records.map((r) => ({ ...r }));
}

function clampFact(fact: number): number {
  return fact > LAST_RECORD_FACT ? FACT_NONE : fact;
}

export function readNpcRecord(r: BinaryReader, layout: NpcRecordLayout): NpcRecord {
  const identifier = layout === 'russian' ? r.u32() : 0;
  const flags = r.u16();
  const requirement = r.i16();
  const factMustBeTrue = clampFact(r.u16());
  const factMustBeFalse = clampFact(r.u16());
  const quest = r.u8();
  const firstDay = r.u8();
  const lastDay = r.u8();
  const approachRequired = r.u8();
  const opinionRequired = r.u8();
  const quoteNum = r.u8();
  const numQuotes = r.u8();
  const startQuest = r.u8();
  const endQuest = r.u8();
  const triggerNpc = r.u8();
  const triggerNpcRecord = r.u8();
  r.skip(1);
  const setFactTrue = r.u16();
  const giftItem = r.u16();
  const goToGridNo = r.u16();
  const actionData = r.i16();
  if (layout === 'standard') r.skip(4);
  return {
    identifier,
    flags,
    requirement,
    factMustBeTrue,
    factMustBeFalse,
    quest,
    firstDay,
    lastDay,
    approachRequired,
    opinionRequired,
    quoteNum,
    numQuotes,
    startQuest,
    endQuest,
    triggerNpc,
    triggerNpcRecord,
    setFactTrue,
    giftItem,
    goToGridNo,
    actionData,
  };
}

export function writeNpcRecord(w: BinaryWriter, q: NpcRecord, layout: NpcRecordLayout): void {
  if (layout === 'russian') w.u32(q.identifier);
  w.u16(q.flags).i16(q.requirement).u16(q.factMustBeTrue).u16(q.factMustBeFalse);
  w.u8(q.quest).u8(q.firstDay).u8(q.lastDay).u8(q.approachRequired).u8(q.opinionRequired);
  w.u8(q.quoteNum).u8(q.numQuotes).u8(q.startQuest).u8(q.endQuest).u8(q.triggerNpc).u8(q.triggerNpcRecord).zeros(1);
  w.u16(q.setFactTrue).u16(q.giftItem).u16(q.goToGridNo).i16(q.actionData);
  if (layout === 'standard') w.zeros(4);
}

export function readNpcRecordArray(r: BinaryReader, layout: NpcRecordLayout = 'standard'): NpcRecord[] {
  return Array.from({ length: NUM_NPC_QUOTE_RECORDS }, () => readNpcRecord(r, layout));
}

export function parseNpcRecords(bytes: Uint8Array, layout: NpcRecordLayout = 'standard'): NpcRecord[] {
  if (bytes.length < NPC_FILE_BYTES) throw new FormatError(`NPC record file needs ${NPC_FILE_BYTES} bytes, got ${bytes.length}`);
  return readNpcRecordArray(new BinaryReader(bytes), layout);
}

export function writeNpcRecordArray(w: BinaryWriter, records: readonly NpcRecord[], layout: NpcRecordLayout = 'standard'): void {
  for (let i = 0; i < NUM_NPC_QUOTE_RECORDS; i++) writeNpcRecord(w, records[i] ?? emptyNpcRecord(), layout);
}

export function encodeNpcRecords(records: readonly NpcRecord[], layout: NpcRecordLayout = 'standard'): Uint8Array {
  const w = new BinaryWriter(NPC_FILE_BYTES);
  writeNpcRecordArray(w, records, layout);
  return w.toBytes();
}
