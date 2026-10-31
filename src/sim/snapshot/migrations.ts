import { gameOptions, ORIGINAL_GAME_OPTIONS } from '../options.ts';
import { decodeBase64, encodeBase64 } from './base64.ts';
import { type EncodedGraph, type Json, SnapshotError } from './codec.ts';

type JsonObject = { readonly [key: string]: Json };
type Section = readonly [string, Json];

export type SnapshotMigration = (snapshot: Readonly<Record<string, unknown>>) => Record<string, unknown>;

export interface SnapshotMigrationContext {
  frameSlotOf(state: number, pc: number, spriteFrame: number): number;
}

export const NO_MIGRATION_CONTEXT: SnapshotMigrationContext = {
  frameSlotOf: () => {
    throw new SnapshotError('a version 2 snapshot holds sprite frames: loading it needs the animation timelines');
  },
};

const OPTIONS_KEY = 'options';
const REF = '$ref';

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(o: Json | undefined, key: string, fallback: Json): Json {
  return isObject(o) && o[key] !== undefined ? (o[key] as Json) : fallback;
}

function withoutKeys(o: JsonObject, keys: readonly string[]): JsonObject {
  return Object.fromEntries(Object.entries(o).filter(([key]) => !keys.includes(key)));
}

function replaceKey(o: JsonObject, key: string, replacement: string, value: Json, dropped: readonly string[]): JsonObject {
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === key) out[replacement] = value;
    else if (!dropped.includes(k)) out[k] = v;
  }
  return out;
}

function sectionOf(sections: readonly Section[], name: string): Json | undefined {
  return sections.find(([n]) => n === name)?.[1];
}

function unifiedTacticalOptions(tactical: JsonObject): JsonObject {
  const legacy = tactical[OPTIONS_KEY];
  return {
    ...gameOptions({
      difficulty: field(tactical.perception, 'difficulty', ORIGINAL_GAME_OPTIONS.difficulty) as number,
      sciFi: field(tactical.equipment, 'sciFi', ORIGINAL_GAME_OPTIONS.sciFi) as boolean,
      gunNut: field(legacy, 'gunNut', ORIGINAL_GAME_OPTIONS.gunNut) as boolean,
      bloodAndGore: field(legacy, 'bloodAndGore', ORIGINAL_GAME_OPTIONS.bloodAndGore) as boolean,
    }),
  };
}

function migrateTactical(tactical: JsonObject, options: Json): JsonObject {
  const ref = isObject(options) && options[REF] !== undefined ? options : { [REF]: `tactical/${OPTIONS_KEY}` };
  const equipment = isObject(tactical.equipment)
    ? replaceKey(tactical.equipment, 'gunNut', OPTIONS_KEY, ref, ['sciFi'])
    : tactical.equipment;
  const perception = isObject(tactical.perception) ? withoutKeys(tactical.perception, ['difficulty']) : tactical.perception;
  const turn = isObject(tactical.turn) ? { ...tactical.turn, lastMercKill: null } : tactical.turn;
  return { ...tactical, [OPTIONS_KEY]: options, equipment: equipment ?? null, perception: perception ?? null, turn: turn ?? null };
}

function migrateStrategic(strategic: JsonObject, tactical: JsonObject | null): JsonObject {
  const options = strategic[OPTIONS_KEY];
  if (!isObject(options)) return strategic;
  const bloodAndGore = field(tactical?.[OPTIONS_KEY], 'bloodAndGore', ORIGINAL_GAME_OPTIONS.bloodAndGore);
  return { ...strategic, [OPTIONS_KEY]: { ...options, bloodAndGore } };
}

function unifyGameOptions(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const tactical = sectionOf(graph.sections, 'tactical');
  const strategic = sectionOf(graph.sections, 'strategic');
  const tacticalObject = isObject(tactical) ? tactical : null;
  const sections = graph.sections.map(([name, value]): Section => {
    if (name === 'strategic' && isObject(value)) return [name, migrateStrategic(value, tacticalObject)];
    if (name !== 'tactical' || !isObject(value)) return [name, value];
    const options: Json = isObject(strategic) ? { [REF]: `strategic/${OPTIONS_KEY}` } : unifiedTacticalOptions(value);
    return [name, migrateTactical(value, options)];
  });
  return { ...snapshot, graph: { ...graph, sections } };
}

const SPRITE_FRAME_KEY = 'frame';
const FRAME_SLOT_KEY = 'frameSlot';
const SOLDIER_KEYS = ['state', 'pc', SPRITE_FRAME_KEY, 'aniDelay'];

function isSoldierWithSpriteFrame(o: JsonObject): boolean {
  return SOLDIER_KEYS.every((key) => o[key] !== undefined) && typeof o.state === 'number' && typeof o.pc === 'number';
}

function withFrameSlots(value: Json, context: SnapshotMigrationContext): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withFrameSlots(v, context));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withFrameSlots(v, context);
  if (!isSoldierWithSpriteFrame(mapped)) return mapped;
  const slot = context.frameSlotOf(mapped.state as number, mapped.pc as number, mapped[SPRITE_FRAME_KEY] as number);
  return replaceKey(mapped, SPRITE_FRAME_KEY, FRAME_SLOT_KEY, slot, []);
}

function spriteFramesToFrameSlots(snapshot: Readonly<Record<string, unknown>>, context: SnapshotMigrationContext): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withFrameSlots(value, context)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const PRESENTATION_SOLDIER_KEYS = ['state', 'pc', FRAME_SLOT_KEY, 'aniDelay'];
const OUR_TEAM = 0;
const TOP_MESSAGE_COMPUTER_TURN = 1;
const TOP_MESSAGE_PLAYER_INTERRUPT = 3;
const TOP_MESSAGE_PLAYER_TURN = 6;

function isSoldierRecord(o: JsonObject): boolean {
  return PRESENTATION_SOLDIER_KEYS.every((key) => o[key] !== undefined) && typeof o.state === 'number';
}

function withSoldierPresentation(value: Json, tick: number): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withSoldierPresentation(v, tick));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withSoldierPresentation(v, tick);
  if (!isSoldierRecord(mapped)) return mapped;
  return { ...mapped, ...withDefault(mapped, 'stateTick', tick), ...withDefault(mapped, 'muted', false) };
}

function withDefault(o: JsonObject, key: string, value: Json): JsonObject {
  return o[key] === undefined ? { [key]: value } : {};
}

function derivedTopMessage(inCombat: boolean, turn: JsonObject): Json {
  if (!inCombat) return null;
  const team = typeof turn.currentTeam === 'number' ? turn.currentTeam : OUR_TEAM;
  const interrupted = Array.isArray(turn.intList) && turn.intList.length > 0;
  if (team === OUR_TEAM || turn.hiddenInterrupt === true)
    return {
      kind: interrupted && team === OUR_TEAM ? TOP_MESSAGE_PLAYER_INTERRUPT : TOP_MESSAGE_PLAYER_TURN,
      team: OUR_TEAM,
      bloodcats: false,
    };
  return { kind: TOP_MESSAGE_COMPUTER_TURN, team, bloodcats: false };
}

function withTurnPresentation(tactical: JsonObject): JsonObject {
  const turn = tactical.turn;
  if (!isObject(turn) || turn[REF] !== undefined) return tactical;
  const topMessage = withDefault(turn, 'topMessage', derivedTopMessage(tactical.inCombat === true, turn));
  const aiProgress = withDefault(turn, 'aiProgress', { current: 0, next: 0, total: 0 });
  return { ...tactical, turn: { ...turn, ...topMessage, ...aiProgress } };
}

function addPresentationState(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const tactical = sectionOf(graph.sections, 'tactical');
  const tick = isObject(tactical) && typeof tactical.tick === 'number' ? tactical.tick : 0;
  const sections = graph.sections.map(([name, value]): Section => {
    const soldiers = withSoldierPresentation(value, tick);
    return [name, name === 'tactical' && isObject(soldiers) ? withTurnPresentation(soldiers) : soldiers];
  });
  return { ...snapshot, graph: { ...graph, sections } };
}

const LAPTOP_KEY = 'laptop';
const NEW_MAIL_KEY = 'newMail';

function withNewMailFlag(strategic: JsonObject): JsonObject {
  const laptop = strategic[LAPTOP_KEY];
  if (!isObject(laptop) || laptop[REF] !== undefined || laptop[NEW_MAIL_KEY] !== undefined) return strategic;
  return { ...strategic, [LAPTOP_KEY]: { ...laptop, [NEW_MAIL_KEY]: false } };
}

function addNewMailFlag(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(
    ([name, value]): Section => [name, name === 'strategic' && isObject(value) ? withNewMailFlag(value) : value],
  );
  return { ...snapshot, graph: { ...graph, sections } };
}

const PROFILE_PROGRESS_KEYS = ['shotsHit', 'timesWounded', 'mercMercContractLength'];
const BATTLES_FOUGHT_KEY = 'battlesFought';

function isProfileProgress(o: JsonObject): boolean {
  return PROFILE_PROGRESS_KEYS.every((key) => typeof o[key] === 'number');
}

function withBattlesFought(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withBattlesFought(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withBattlesFought(v);
  return isProfileProgress(mapped) ? { ...mapped, ...withDefault(mapped, BATTLES_FOUGHT_KEY, 0) } : mapped;
}

function addBattlesFought(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withBattlesFought(value)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const HEARD_NOISE_PAUSE_KEY = 'turnsUntilCanSayHeardNoise';

function withHeardNoisePause(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withHeardNoisePause(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withHeardNoisePause(v);
  return isSoldierRecord(mapped) ? { ...mapped, ...withDefault(mapped, HEARD_NOISE_PAUSE_KEY, 0) } : mapped;
}

function addHeardNoisePause(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withHeardNoisePause(value)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const TURN_QUOTE_FLAG_KEYS = ['pummeledQuoteSaid', 'closeCallQuoteSaid'];

function withTurnQuoteFlags(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withTurnQuoteFlags(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withTurnQuoteFlags(v);
  if (!isSoldierRecord(mapped)) return mapped;
  return Object.assign(mapped, ...TURN_QUOTE_FLAG_KEYS.map((key) => withDefault(mapped, key, false)));
}

function addTurnQuoteFlags(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withTurnQuoteFlags(value)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const MUZZLE_FLASH_KEY = 'muzzleFlash';

function withoutStaleMuzzleFlash(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withoutStaleMuzzleFlash(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withoutStaleMuzzleFlash(v);
  return isSoldierRecord(mapped) ? { ...mapped, [MUZZLE_FLASH_KEY]: false } : mapped;
}

function putOutStaleMuzzleFlashes(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withoutStaleMuzzleFlash(value)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const SMELL_MAP_KEYS = ['smell', 'blood', 'lastDecaySeconds'];
const BYTES_TAG = '$u8';

function isSmellMapRecord(o: JsonObject): boolean {
  return Object.keys(o).length === SMELL_MAP_KEYS.length && SMELL_MAP_KEYS.every((key) => o[key] !== undefined);
}

function bytesOf(value: Json | undefined): Uint8Array {
  const body = isObject(value) ? value[BYTES_TAG] : undefined;
  return typeof body === 'string' ? decodeBase64(body) : new Uint8Array(0);
}

function withBloodGraphics(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withBloodGraphics(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withBloodGraphics(v);
  if (!isSmellMapRecord(mapped)) return mapped;
  const blood = bytesOf(mapped.blood);
  return {
    smell: mapped.smell as Json,
    blood: mapped.blood as Json,
    reevaluateBlood: { [BYTES_TAG]: encodeBase64(blood.map((b) => (b === 0 ? 0 : 1))) },
    shownPools: { [BYTES_TAG]: encodeBase64(new Uint8Array(blood.length)) },
    lastDecaySeconds: mapped.lastDecaySeconds as Json,
  };
}

function addBloodGraphics(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withBloodGraphics(value)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const REALTIME_CLOCK_KEYS = ['lastTurnMs', 'lastDecayMs', 'lastOverheadMs'];
const TACTICAL_MS_DECAY_KEY = 'lastDecayMs';
const WORLD_SECONDS_DECAY_KEY = 'lastOpplistDecaySeconds';
const DECAY_DUE_AT_NEXT_REALTIME_TURN = 0;

function isMsRealtimeClock(o: JsonObject): boolean {
  return Object.keys(o).length === REALTIME_CLOCK_KEYS.length && REALTIME_CLOCK_KEYS.every((key) => typeof o[key] === 'number');
}

function withWorldSecondsDecayStamp(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withWorldSecondsDecayStamp(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withWorldSecondsDecayStamp(v);
  if (!isMsRealtimeClock(mapped)) return mapped;
  return replaceKey(mapped, TACTICAL_MS_DECAY_KEY, WORLD_SECONDS_DECAY_KEY, DECAY_DUE_AT_NEXT_REALTIME_TURN, []);
}

function opplistDecayOnWorldSeconds(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withWorldSecondsDecayStamp(value)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const LAST_KNOWN_KEY = 'lastKnownOpp';
const LAST_KNOWN_LEVEL_KEY = 'lastKnownOppLevel';
const PERCEPTION_KEY = 'perception';
const PUBLIC_LAST_KNOWN_KEY = 'publicLastKnown';
const PUBLIC_LAST_KNOWN_LEVEL_KEY = 'publicLastKnownLevel';
const INT8_TAG = '$i8';
const INT16_TAG = '$i16';
const INT16_BYTES = 2;

function int16Count(value: Json | undefined): number {
  const body = isObject(value) ? value[INT16_TAG] : undefined;
  return typeof body === 'string' ? decodeBase64(body).length / INT16_BYTES : 0;
}

function groundLevels(gridNos: Json | undefined): Json {
  return { [INT8_TAG]: encodeBase64(new Uint8Array(int16Count(gridNos))) };
}

function insertAfter(o: JsonObject, key: string, added: string, value: Json): JsonObject {
  if (o[added] !== undefined) return o;
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(o)) {
    out[k] = v;
    if (k === key) out[added] = value;
  }
  return out;
}

function withSoldierLastKnownLevels(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withSoldierLastKnownLevels(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withSoldierLastKnownLevels(v);
  if (!isSoldierRecord(mapped)) return mapped;
  return insertAfter(mapped, LAST_KNOWN_KEY, LAST_KNOWN_LEVEL_KEY, groundLevels(mapped[LAST_KNOWN_KEY]));
}

function withPublicLastKnownLevels(tactical: JsonObject): JsonObject {
  const perception = tactical[PERCEPTION_KEY];
  if (!isObject(perception) || perception[REF] !== undefined) return tactical;
  const gridNos = perception[PUBLIC_LAST_KNOWN_KEY];
  const levels: Json = Array.isArray(gridNos) ? gridNos.map((team: Json) => groundLevels(team)) : [];
  return { ...tactical, [PERCEPTION_KEY]: insertAfter(perception, PUBLIC_LAST_KNOWN_KEY, PUBLIC_LAST_KNOWN_LEVEL_KEY, levels) };
}

function addLastKnownLevels(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => {
    const soldiers = withSoldierLastKnownLevels(value);
    return [name, name === 'tactical' && isObject(soldiers) ? withPublicLastKnownLevels(soldiers) : soldiers];
  });
  return { ...snapshot, graph: { ...graph, sections } };
}

const FADE_STEP_KEY = 'fadeStep';
const NO_FADE = 0;
const NOWHERE = -1;

function withSoldierFade(o: JsonObject): JsonObject {
  if (o[FADE_STEP_KEY] === undefined) return o;
  const fade = replaceKey(o, FADE_STEP_KEY, 'fade', NO_FADE, []);
  const shade = insertAfter(fade, 'fade', 'fadeShade', o[FADE_STEP_KEY] as Json);
  const started = insertAfter(shade, 'fadeShade', 'fadeStartGridNo', NOWHERE);
  return { ...started, lastRenderVisible: o.visible as Json };
}

function isLightingRecord(o: JsonObject): boolean {
  return o.landLight !== undefined && o.roofLight !== undefined && o.landMaxLight === undefined;
}

function withStrongestLights(o: JsonObject): JsonObject {
  const land = insertAfter(o, 'roofLight', 'landMaxLight', o.landLight as Json);
  return insertAfter(land, 'landMaxLight', 'roofMaxLight', o.roofLight as Json);
}

function withFadeState(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withFadeState(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withFadeState(v);
  if (isLightingRecord(mapped)) return withStrongestLights(mapped);
  return isSoldierRecord(mapped) ? withSoldierFade(mapped) : mapped;
}

function addFadeState(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withFadeState(value)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const TEAM_CHANGE_DURING_DEATH_KEY = 'potentialTeamChangeDuringDeath';
const LAST_MERC_KILL_KEY = 'lastMercKill';

function insertBefore(o: JsonObject, key: string, added: string, value: Json): JsonObject {
  if (o[added] !== undefined) return o;
  if (o[key] === undefined) return { ...o, [added]: value };
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === key) out[added] = value;
    out[k] = v;
  }
  return out;
}

function withTeamChangeDuringDeathFlag(tactical: JsonObject): JsonObject {
  const turn = tactical.turn;
  if (!isObject(turn) || turn[REF] !== undefined) return tactical;
  return { ...tactical, turn: insertBefore(turn, LAST_MERC_KILL_KEY, TEAM_CHANGE_DURING_DEATH_KEY, false) };
}

function addTeamChangeDuringDeathFlag(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(
    ([name, value]): Section => [name, name === 'tactical' && isObject(value) ? withTeamChangeDuringDeathFlag(value) : value],
  );
  return { ...snapshot, graph: { ...graph, sections } };
}

const LOOK_ON_NEXT_TURN_KEY = 'lookOnNextTurn';
const LOOK_FOR_ITEMS_KEY = 'lookForItems';
const KILLED_ENEMY_ON_ATTACK_KEY = 'killedEnemyOnAttack';
const ITEMS_SEEN_ON_ATTACK_KEY = 'itemsSeenOnAttack';
const LOCK_ITEM_LOCATORS_KEY = 'lockItemLocators';

function withSoldierLookForItems(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withSoldierLookForItems(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withSoldierLookForItems(v);
  return isSoldierRecord(mapped) ? insertAfter(mapped, LOOK_ON_NEXT_TURN_KEY, LOOK_FOR_ITEMS_KEY, false) : mapped;
}

function withItemLocatorState(tactical: JsonObject): JsonObject {
  const turn = tactical.turn;
  if (!isObject(turn) || turn[REF] !== undefined) return tactical;
  const seen = insertAfter(turn, KILLED_ENEMY_ON_ATTACK_KEY, ITEMS_SEEN_ON_ATTACK_KEY, null);
  return { ...tactical, turn: insertAfter(seen, ITEMS_SEEN_ON_ATTACK_KEY, LOCK_ITEM_LOCATORS_KEY, false) };
}

function addItemLookingState(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => {
    const soldiers = withSoldierLookForItems(value);
    return [name, name === 'tactical' && isObject(soldiers) ? withItemLocatorState(soldiers) : soldiers];
  });
  return { ...snapshot, graph: { ...graph, sections } };
}

const SECTOR_FLOW_KEY = 'sectorFlow';
const TRASHED_MAP_RESTRICTED_SCROLL_KEY = 'trashedMapRestrictedScroll';
const FULL_MAP_RESTRICTED_SCROLL = 0;

function withTrashedMapRestrictedScroll(strategic: JsonObject): JsonObject {
  const flow = strategic[SECTOR_FLOW_KEY];
  if (!isObject(flow) || flow[REF] !== undefined) return strategic;
  return {
    ...strategic,
    [SECTOR_FLOW_KEY]: { ...flow, ...withDefault(flow, TRASHED_MAP_RESTRICTED_SCROLL_KEY, FULL_MAP_RESTRICTED_SCROLL) },
  };
}

function addTrashedMapRestrictedScroll(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(
    ([name, value]): Section => [name, name === 'strategic' && isObject(value) ? withTrashedMapRestrictedScroll(value) : value],
  );
  return { ...snapshot, graph: { ...graph, sections } };
}

function withoutHeldKillFlag(tactical: JsonObject): JsonObject {
  const turn = tactical.turn;
  if (!isObject(turn) || turn[REF] !== undefined || typeof turn[KILLED_ENEMY_ON_ATTACK_KEY] !== 'boolean') return tactical;
  return { ...tactical, turn: { ...turn, [KILLED_ENEMY_ON_ATTACK_KEY]: null } };
}

function dropHeldKillFlag(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(
    ([name, value]): Section => [name, name === 'tactical' && isObject(value) ? withoutHeldKillFlag(value) : value],
  );
  return { ...snapshot, graph: { ...graph, sections } };
}

export function snapshotMigrations(context: SnapshotMigrationContext): Readonly<Record<number, SnapshotMigration>> {
  return {
    1: unifyGameOptions,
    2: (snapshot) => spriteFramesToFrameSlots(snapshot, context),
    3: addPresentationState,
    4: addNewMailFlag,
    5: addBattlesFought,
    6: addHeardNoisePause,
    7: addTurnQuoteFlags,
    8: putOutStaleMuzzleFlashes,
    9: addBloodGraphics,
    10: opplistDecayOnWorldSeconds,
    11: addLastKnownLevels,
    12: addFadeState,
    13: addTeamChangeDuringDeathFlag,
    14: addItemLookingState,
    15: addTrashedMapRestrictedScroll,
    16: dropHeldKillFlag,
  };
}
