// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/externalized/DefaultContentManager.cc loadAllScriptRecords, getScriptRecords, getAllScriptRecords;
// @src src/externalized/content/NPCQuoteInfo.cc deserialize; src/game/TacticalAI/NPC.cc LoadCivQuoteFile,
// @src gsCivQuoteSector, MINERS_CIV_QUOTE_INDEX; src/externalized/mercs/MercProfileInfo.cc (profile names and types).
// @src See docs/24 §1.4, §12.

import { FormatError } from '../binary/errors.ts';
import {
  ACCEPT_ANY_ITEM,
  ANY_RIFLE,
  emptyNpcRecord,
  FACT_NONE,
  IRRELEVANT,
  NO_MOVE,
  NO_QUEST,
  type NpcRecord,
  type NpcRecordLayout,
  NUM_NPC_QUOTE_RECORDS,
  parseNpcRecords,
  QUEST_DONE_NUM,
  QUEST_NOT_STARTED_NUM,
  QuoteFlag,
  TRIGGER_CLOSEST_MERC,
  TRIGGER_SELF,
  UiCode,
} from '../formats/npc.ts';
import { MercType } from '../strategic/economy-content.ts';
import { asArray, asBool, asInt, asObject, asString, type JsonObject } from '../strategic/json-fields.ts';
import { parseJsoncBytes } from '../strategic/jsonc.ts';
import { sectorShortString } from '../strategic/sector-ids.ts';
import type { ReadFile } from '../world/tileset-loader.ts';
import {
  approachByName,
  CIV_QUOTE_SECTORS,
  MINERS_CIV_QUOTE_INDEX,
  NpcAction,
  NUM_CIVQUOTE_SECTORS,
  NUM_PROFILES,
  questByName,
} from './npc-constants.ts';

export const NPC_RECORD_PATHS = {
  control: 'externalized/script-records-control.json',
  overrides: 'tables/npc-script-records.json',
  profileInfo: 'externalized/mercs-profile-info.json',
} as const;
export const NPCDATA_DIR = 'npcdata';
export const STUB_PREFIX = 'stubs/';
const MINERS_FILE = 'miners.npc';
const NO_GIFT_NAME = '65535';
const NO_GIFT_ITEM = 65535;

const MERC_TYPE_NAMES: Readonly<Record<string, number>> = MercType;

export type LayerCount = (path: string) => number;

export interface NpcRecordContent {
  readonly scripts: readonly (readonly NpcRecord[] | null)[];
  readonly recruited: readonly NpcRecord[] | null;
  readonly meanwhiles: ReadonlyMap<string, readonly NpcRecord[]>;
  readonly civilian: readonly (readonly NpcRecord[] | null)[];
  readonly profileIds: ReadonlyMap<string, number>;
  readonly profileTypes: ReadonlyMap<number, number>;
}

export interface NpcRecordSources {
  readonly read: ReadFile;
  readonly items: { readonly byName: ReadonlyMap<string, { readonly index: number }> };
  readonly layout?: NpcRecordLayout;
  readonly layerCount?: LayerCount;
}

export function threeDigits(id: number): string {
  return String(id).padStart(3, '0');
}

export function npcRecordPath(profile: number): string {
  return `${NPCDATA_DIR}/${threeDigits(profile)}.npc`;
}

export function civQuoteRecordPath(index: number): string {
  if (index === MINERS_CIV_QUOTE_INDEX) return `${NPCDATA_DIR}/${MINERS_FILE}`;
  const [x, y] = CIV_QUOTE_SECTORS[index] ?? [0, 0];
  return `${NPCDATA_DIR}/${sectorShortString({ x, y })}.npc`;
}

export function meanwhileKey(meanwhile: number, profile: number): string {
  return `${meanwhile}/${profile}`;
}

export async function readLayered(read: ReadFile, path: string): Promise<Uint8Array | null> {
  return (await read(path)) ?? (await read(`${STUB_PREFIX}${path}`));
}

async function readJson(read: ReadFile, path: string): Promise<unknown | null> {
  const bytes = await read(path);
  return bytes ? parseJsoncBytes(bytes) : null;
}

export interface ProfileInfo {
  readonly ids: ReadonlyMap<string, number>;
  readonly types: ReadonlyMap<number, number>;
}

export function parseProfileInfo(json: unknown): ProfileInfo {
  const ids = new Map<string, number>();
  const types = new Map<number, number>();
  asArray(json, 'mercs profile info').forEach((v, i) => {
    const what = `mercs profile info[${i}]`;
    const o = asObject(v, what);
    const id = asInt(o.profileID, `${what}.profileID`);
    ids.set(asString(o.internalName, `${what}.internalName`), id);
    const type = MERC_TYPE_NAMES[asString(o.type, `${what}.type`)];
    if (type === undefined) throw new FormatError(`${what}: unknown type`);
    types.set(id, type);
  });
  return { ids, types };
}

export interface ScriptJsonEnv {
  readonly items: { readonly byName: ReadonlyMap<string, { readonly index: number }> };
  readonly profiles: ReadonlyMap<string, number>;
}

function optionalInt(o: JsonObject, key: string, fallback: number, what: string): number {
  return o[key] === undefined ? fallback : asInt(o[key], `${what}.${key}`);
}

function optionalFlag(o: JsonObject, key: string, what: string): boolean {
  return o[key] === undefined ? false : asBool(o[key], `${what}.${key}`);
}

function itemIndex(env: ScriptJsonEnv, name: string, what: string): number {
  const item = env.items.byName.get(name);
  if (!item) throw new FormatError(`${what}: unknown item ${name}`);
  return item.index;
}

function profileIndex(env: ScriptJsonEnv, name: string, what: string): number {
  const id = env.profiles.get(name);
  if (id === undefined) throw new FormatError(`${what}: unknown profile ${name}`);
  return id;
}

function recordFlags(o: JsonObject, what: string): number {
  let flags = 0;
  if (optionalFlag(o, 'alreadySaid', what)) flags |= QuoteFlag.SAID;
  if (optionalFlag(o, 'eraseOnceSaid', what)) flags |= QuoteFlag.ERASE_ONCE_SAID;
  if (optionalFlag(o, 'sayOncePerConvo', what)) flags |= QuoteFlag.SAY_ONCE_PER_CONVO;
  return flags;
}

function requirement(env: ScriptJsonEnv, o: JsonObject, what: string): number {
  if (optionalFlag(o, 'requiredAnyItem', what)) return ACCEPT_ANY_ITEM;
  if (optionalFlag(o, 'requiredAnyRifle', what)) return ANY_RIFLE;
  if (o.requiredItem !== undefined) return itemIndex(env, asString(o.requiredItem, `${what}.requiredItem`), what);
  return -optionalInt(o, 'requiredGridNo', 0, what);
}

function questValue(o: JsonObject, what: string): number {
  if (o.quest === undefined) return NO_QUEST;
  const q = asObject(o.quest, `${what}.quest`);
  const id = questByName(asString(q.name, `${what}.quest.name`));
  if (id === undefined) throw new FormatError(`${what}: unknown quest`);
  const status = asString(q.status, `${what}.quest.status`);
  if (status === 'DONE') return id + QUEST_DONE_NUM;
  if (status === 'NOTSTARTED') return id + QUEST_NOT_STARTED_NUM;
  if (status === 'INPROGRESS') return id;
  throw new FormatError(`${what}: unknown quest status ${status}`);
}

function questName(o: JsonObject, key: string, what: string): number {
  if (o[key] === undefined) return NO_QUEST;
  const id = questByName(asString(o[key], `${what}.${key}`));
  if (id === undefined) throw new FormatError(`${what}: unknown quest in ${key}`);
  return id;
}

function triggerNpc(env: ScriptJsonEnv, o: JsonObject, what: string): number {
  if (optionalFlag(o, 'triggerClosestMerc', what)) return TRIGGER_CLOSEST_MERC;
  if (optionalFlag(o, 'triggerSelf', what)) return TRIGGER_SELF;
  if (o.triggerNPC !== undefined) return profileIndex(env, asString(o.triggerNPC, `${what}.triggerNPC`), what);
  return IRRELEVANT;
}

function giftItem(env: ScriptJsonEnv, o: JsonObject, what: string): number {
  if (o.giftItem !== undefined) {
    const name = asString(o.giftItem, `${what}.giftItem`);
    return name === NO_GIFT_NAME ? NO_GIFT_ITEM : itemIndex(env, name, what);
  }
  if (o.userInterface === undefined) return 0;
  const ui = asString(o.userInterface, `${what}.userInterface`);
  if (ui === 'TURN_UI_ON') return UiCode.TURN_UI_ON;
  if (ui === 'TURN_UI_OFF') return UiCode.TURN_UI_OFF;
  return 0;
}

function actionData(env: ScriptJsonEnv, o: JsonObject, what: string): number {
  if (o.actionData === undefined) return NpcAction.NONE;
  const a = asObject(o.actionData, `${what}.actionData`);
  let result = 0;
  if (a.turnToFace !== undefined)
    result = NpcAction.TURN_TO_FACE_NEAREST_MERC + profileIndex(env, asString(a.turnToFace, `${what}.actionData.turnToFace`), what);
  else if (a.code !== undefined) result = asInt(a.code, `${what}.actionData.code`);
  return optionalFlag(a, 'doFirst', `${what}.actionData`) ? -result || 0 : result;
}

export function scriptRecordFromJson(env: ScriptJsonEnv, o: JsonObject, what: string): NpcRecord {
  const approach = o.requiredApproach === undefined ? '' : asString(o.requiredApproach, `${what}.requiredApproach`);
  const approachRequired = approachByName(approach);
  if (approachRequired === undefined) throw new FormatError(`${what}: unknown approach ${approach}`);
  return {
    identifier: asInt(o.index, `${what}.index`),
    flags: recordFlags(o, what),
    requirement: requirement(env, o, what),
    factMustBeTrue: optionalInt(o, 'factMustBeTrue', FACT_NONE, what),
    factMustBeFalse: optionalInt(o, 'factMustBeFalse', FACT_NONE, what),
    quest: questValue(o, what),
    firstDay: optionalInt(o, 'firstDay', 0, what),
    lastDay: optionalInt(o, 'lastDay', IRRELEVANT, what),
    approachRequired,
    opinionRequired: optionalInt(o, 'requiredOpinion', 0, what),
    quoteNum: optionalInt(o, 'quoteNum', IRRELEVANT, what),
    numQuotes: optionalInt(o, 'numQuotes', IRRELEVANT, what),
    startQuest: questName(o, 'startQuest', what),
    endQuest: questName(o, 'endQuest', what),
    triggerNpc: triggerNpc(env, o, what),
    triggerNpcRecord: optionalInt(o, 'triggerRecord', IRRELEVANT, what),
    setFactTrue: optionalInt(o, 'setFactTrue', FACT_NONE, what),
    giftItem: giftItem(env, o, what),
    goToGridNo: optionalInt(o, 'goToGridno', NO_MOVE, what),
    actionData: actionData(env, o, what),
  };
}

export function scriptRecordsFromJson(env: ScriptJsonEnv, json: unknown, what: string): NpcRecord[] {
  const records = Array.from({ length: NUM_NPC_QUOTE_RECORDS }, () => emptyNpcRecord());
  asArray(asObject(json, what).records, `${what}.records`).forEach((v, i) => {
    const o = asObject(v, `${what}.records[${i}]`);
    const record = scriptRecordFromJson(env, o, `${what}.records[${i}]`);
    if (record.identifier < 0 || record.identifier >= NUM_NPC_QUOTE_RECORDS) throw new FormatError(`${what}: bad record index`);
    records[record.identifier] = record;
  });
  return records;
}

async function readRecords(read: ReadFile, path: string, layout: NpcRecordLayout): Promise<NpcRecord[] | null> {
  const bytes = await readLayered(read, path);
  return bytes ? parseNpcRecords(bytes, layout) : null;
}

async function loadMeanwhiles(
  read: ReadFile,
  control: JsonObject | null,
  ids: ReadonlyMap<string, number>,
  layout: NpcRecordLayout,
): Promise<Map<string, NpcRecord[]>> {
  const meanwhiles = new Map<string, NpcRecord[]>();
  if (!control) return meanwhiles;
  for (const [i, entry] of asArray(control.meanwhiles, 'script records control.meanwhiles').entries()) {
    const m = asObject(entry, `script records control.meanwhiles[${i}]`);
    const id = asInt(m.id, `meanwhiles[${i}].id`);
    for (const [k, c] of asArray(m.chars, `meanwhiles[${i}].chars`).entries()) {
      const ch = asObject(c, `meanwhiles[${i}].chars[${k}]`);
      const profile = ids.get(asString(ch.name, `meanwhiles[${i}].chars[${k}].name`));
      if (profile === undefined) continue;
      const records = await readRecords(read, `${NPCDATA_DIR}/${asString(ch.fileName, 'fileName')}`, layout);
      if (records) meanwhiles.set(meanwhileKey(id, profile), records);
    }
  }
  return meanwhiles;
}

async function loadOverrides(read: ReadFile, env: ScriptJsonEnv): Promise<Map<number, NpcRecord[]>> {
  const overrides = new Map<number, NpcRecord[]>();
  const json = await readJson(read, NPC_RECORD_PATHS.overrides);
  if (!json) return overrides;
  asArray(asObject(json, 'npc script records').records, 'npc script records.records').forEach((v, i) => {
    const o = asObject(v, `npc script records[${i}]`);
    const profile = profileIndex(env, asString(o.profile, `npc script records[${i}].profile`), `npc script records[${i}]`);
    overrides.set(profile, scriptRecordsFromJson(env, o, `npc script records[${i}]`));
  });
  return overrides;
}

export async function loadNpcRecordContent(sources: NpcRecordSources): Promise<NpcRecordContent> {
  const { read, items } = sources;
  const layout = sources.layout ?? 'standard';
  const layerCount = sources.layerCount ?? (() => 1);
  const info = parseProfileInfo((await readJson(read, NPC_RECORD_PATHS.profileInfo)) ?? []);
  const controlJson = await readJson(read, NPC_RECORD_PATHS.control);
  const control = controlJson ? asObject(controlJson, 'script records control') : null;
  const meanwhiles = await loadMeanwhiles(read, control, info.ids, layout);
  const recruitedFile = control ? asString(control.fileNameForScriptControlledPCs, 'fileNameForScriptControlledPCs') : '000.npc';
  const recruited = await readRecords(read, `${NPCDATA_DIR}/${recruitedFile}`, layout);
  const overrides = await loadOverrides(read, { items, profiles: info.ids });
  const scripts: (NpcRecord[] | null)[] = Array.from({ length: NUM_PROFILES }, (_, id) => overrides.get(id) ?? null);
  for (let id = 1; id < NUM_PROFILES; id++) {
    const path = npcRecordPath(id);
    if (scripts[id] && layerCount(path) <= 1) continue;
    const records = await readRecords(read, path, layout);
    if (records) scripts[id] = records;
  }
  const civilian: (NpcRecord[] | null)[] = [];
  for (let index = 0; index < NUM_CIVQUOTE_SECTORS; index++)
    civilian.push(index < CIV_QUOTE_SECTORS.length ? await readRecords(read, civQuoteRecordPath(index), layout) : null);
  return { scripts, recruited, meanwhiles, civilian, profileIds: info.ids, profileTypes: info.types };
}

export function emptyNpcRecordContent(): NpcRecordContent {
  return {
    scripts: new Array<null>(NUM_PROFILES).fill(null),
    recruited: null,
    meanwhiles: new Map(),
    civilian: new Array<null>(NUM_CIVQUOTE_SECTORS).fill(null),
    profileIds: new Map(),
    profileTypes: new Map(),
  };
}
