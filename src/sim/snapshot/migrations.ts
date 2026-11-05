import { WORLD_MAX } from '../../content/world/grid.ts';
import { STRUCTURE_ON_GROUND, STRUCTURE_ON_ROOF, StructureFlags } from '../../content/world/structures.ts';
import { u32 } from '../../core/int.ts';
import { Rng } from '../../core/rng.ts';
import { MOVEMENT_COSMETIC_SALT } from '../campaign/flow-state.ts';
import { gameOptions, ORIGINAL_GAME_OPTIONS } from '../options.ts';
import { isVehicleBody } from '../vehicles/vehicle-list.ts';
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

const PLAYER_TEAM_SAW_CREATURES_KEY = 'playerTeamSawCreatures';
const NO_CREATURE_SEEN = 0;

function withSightedCreatureFlag(tactical: JsonObject): JsonObject {
  const perception = tactical.perception;
  if (!isObject(perception) || perception[REF] !== undefined) return tactical;
  return { ...tactical, perception: { ...perception, ...withDefault(perception, PLAYER_TEAM_SAW_CREATURES_KEY, NO_CREATURE_SEEN) } };
}

function addSightedCreatureFlag(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(
    ([name, value]): Section => [name, name === 'tactical' && isObject(value) ? withSightedCreatureFlag(value) : value],
  );
  return { ...snapshot, graph: { ...graph, sections } };
}

const ECONOMY_KEY = 'economy';
const RE_EVALUATE_NOTHING_TO_DO_KEY = 'reEvaluateNothingToDo';

function withNothingToDoFlag(strategic: JsonObject): JsonObject {
  const economy = strategic[ECONOMY_KEY];
  if (!isObject(economy) || economy[REF] !== undefined) return strategic;
  return { ...strategic, [ECONOMY_KEY]: { ...economy, ...withDefault(economy, RE_EVALUATE_NOTHING_TO_DO_KEY, false) } };
}

function addNothingToDoFlag(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(
    ([name, value]): Section => [name, name === 'strategic' && isObject(value) ? withNothingToDoFlag(value) : value],
  );
  return { ...snapshot, graph: { ...graph, sections } };
}

const CLOCK_KEY = 'clock';
const COMPRESSED_SINCE_MAP_ENTRY_KEY = 'compressedSinceMapEntry';

function withoutCompressionSinceMapEntry(strategic: JsonObject): JsonObject {
  const clock = strategic[CLOCK_KEY];
  if (!isObject(clock) || clock[REF] !== undefined) return strategic;
  return { ...strategic, [CLOCK_KEY]: withoutKeys(clock, [COMPRESSED_SINCE_MAP_ENTRY_KEY]) };
}

function dropCompressionSinceMapEntry(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(
    ([name, value]): Section => [name, name === 'strategic' && isObject(value) ? withoutCompressionSinceMapEntry(value) : value],
  );
  return { ...snapshot, graph: { ...graph, sections } };
}

const COSMETIC_KEY = 'cosmetic';
const HELICOPTER_STREAM_KEY = 'helicopter';
const MOVEMENT_STREAM_KEY = 'movement';
const RNG_TAG = '$rng';

function seedFromStream(stream: Json | undefined): number {
  const words = isObject(stream) ? stream[RNG_TAG] : undefined;
  return Array.isArray(words) && typeof words[0] === 'number' ? words[0] : 0;
}

function withMovementCosmeticStream(strategic: JsonObject): JsonObject {
  const cosmetic = strategic[COSMETIC_KEY];
  if (!isObject(cosmetic) || cosmetic[REF] !== undefined || cosmetic[MOVEMENT_STREAM_KEY] !== undefined) return strategic;
  const seed = seedFromStream(cosmetic[HELICOPTER_STREAM_KEY]) ^ MOVEMENT_COSMETIC_SALT;
  const movement = { [RNG_TAG]: [...Rng.fromSeed(seed).state().s] };
  return { ...strategic, [COSMETIC_KEY]: { ...cosmetic, [MOVEMENT_STREAM_KEY]: movement } };
}

function addMovementCosmeticStream(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(
    ([name, value]): Section => [name, name === 'strategic' && isObject(value) ? withMovementCosmeticStream(value) : value],
  );
  return { ...snapshot, graph: { ...graph, sections } };
}

const CORPSE_KEYS = ['gridNo', 'level', 'bodyType', 'direction', 'state', 'profile', 'type', 'timeOfDeath'];
const TIME_OF_DEATH_KEY = 'timeOfDeath';
const HEAD_TAKEN_KEY = 'headTaken';

function isCorpseRecord(o: JsonObject): boolean {
  return CORPSE_KEYS.every((key) => typeof o[key] === 'number');
}

function withCorpseHeads(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withCorpseHeads(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withCorpseHeads(v);
  return isCorpseRecord(mapped) ? insertAfter(mapped, TIME_OF_DEATH_KEY, HEAD_TAKEN_KEY, false) : mapped;
}

function addCorpseHeads(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withCorpseHeads(value)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const PREFERRED_SELECTION_KEY = 'preferredSelection';
const NOBODY_PREFERRED = -1;

function withPreferredSelection(strategic: JsonObject): JsonObject {
  const flow = strategic[SECTOR_FLOW_KEY];
  if (!isObject(flow) || flow[REF] !== undefined) return strategic;
  return { ...strategic, [SECTOR_FLOW_KEY]: { ...flow, ...withDefault(flow, PREFERRED_SELECTION_KEY, NOBODY_PREFERRED) } };
}

function addPreferredSelection(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(
    ([name, value]): Section => [name, name === 'strategic' && isObject(value) ? withPreferredSelection(value) : value],
  );
  return { ...snapshot, graph: { ...graph, sections } };
}

const PICKED_OWNERSHIP_CHECK_KEY = 'pickedOwnershipCheck';
const PATH_ENV_KEY = 'pathEnv';

function addPickedOwnershipCheck(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(
    ([name, value]): Section => [
      name,
      name === 'tactical' && isObject(value) ? insertBefore(value, PATH_ENV_KEY, PICKED_OWNERSHIP_CHECK_KEY, null) : value,
    ],
  );
  return { ...snapshot, graph: { ...graph, sections } };
}

const ITEM_OBJECT_NUMBER_KEYS = [
  'item',
  'count',
  'gunAmmoType',
  'gunShotsLeft',
  'gunAmmoItem',
  'gunAmmoStatus',
  'money',
  'flags',
  'trap',
  'imprintId',
  'keyId',
];
const OBJECT_FLAGS_KEY = 'flags';
const MISSION_KEY = 'mission';
const NO_MISSION = 0;

function isItemObjectRecord(o: JsonObject): boolean {
  return ITEM_OBJECT_NUMBER_KEYS.every((key) => typeof o[key] === 'number') && Array.isArray(o.status) && Array.isArray(o.attachments);
}

function withObjectMissions(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withObjectMissions(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withObjectMissions(v);
  return isItemObjectRecord(mapped) ? insertAfter(mapped, OBJECT_FLAGS_KEY, MISSION_KEY, NO_MISSION) : mapped;
}

function addObjectMissions(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withObjectMissions(value)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const CLOSE_CALL_QUOTE_SAID_KEY = 'closeCallQuoteSaid';
const DYING_COMMENT_KEY = 'dyingComment';
const WARNED_ABOUT_BLEEDING_KEY = 'warnedAboutBleeding';
const LAST_QUOTE_PROFILE_KEY = 'lastQuoteProfile';
const ME_TOO_BLEED_LOG_KEY = 'meTooBleedLog';
const ME_TOO_LOG_CLOSED = 0;

function isTalkStateRecord(o: JsonObject): boolean {
  return typeof o[LAST_QUOTE_PROFILE_KEY] === 'number' && typeof o.engagedSeen === 'boolean';
}

function withBleedingQuoteState(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withBleedingQuoteState(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withBleedingQuoteState(v);
  if (isTalkStateRecord(mapped)) return insertAfter(mapped, LAST_QUOTE_PROFILE_KEY, ME_TOO_BLEED_LOG_KEY, ME_TOO_LOG_CLOSED);
  if (!isSoldierRecord(mapped)) return mapped;
  const dying = insertAfter(mapped, CLOSE_CALL_QUOTE_SAID_KEY, DYING_COMMENT_KEY, false);
  return insertAfter(dying, DYING_COMMENT_KEY, WARNED_ABOUT_BLEEDING_KEY, false);
}

function addBleedingQuoteState(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withBleedingQuoteState(value)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const ENGAGED_SEEN_KEY = 'engagedSeen';
const PAUSED_FOR_LINE_KEY = 'pausedForLine';

function withLinePauseFlag(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withLinePauseFlag(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withLinePauseFlag(v);
  return isTalkStateRecord(mapped) ? insertAfter(mapped, ENGAGED_SEEN_KEY, PAUSED_FOR_LINE_KEY, false) : mapped;
}

function addLinePauseFlag(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withLinePauseFlag(value)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const EXPLOSIVES_KEY = 'explosives';
const GASSED_KEY = 'gassed';
const COWERING_KEY = 'cowering';

function gassedSoldierIds(tactical: Json | undefined): ReadonlySet<number> {
  const flags = bytesOf(field(field(tactical, EXPLOSIVES_KEY, null), GASSED_KEY, null));
  return new Set([...flags.keys()].filter((id) => flags[id] !== 0));
}

function withSoldierGassedFlag(value: Json, gassed: ReadonlySet<number>): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withSoldierGassedFlag(v, gassed));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withSoldierGassedFlag(v, gassed);
  if (!isSoldierRecord(mapped)) return mapped;
  return insertAfter(mapped, COWERING_KEY, GASSED_KEY, typeof mapped.id === 'number' && gassed.has(mapped.id));
}

function withoutGassedArray(tactical: JsonObject): JsonObject {
  const explosives = tactical[EXPLOSIVES_KEY];
  if (!isObject(explosives) || explosives[REF] !== undefined) return tactical;
  return { ...tactical, [EXPLOSIVES_KEY]: withoutKeys(explosives, [GASSED_KEY]) };
}

function moveGassedOntoSoldiers(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const gassed = gassedSoldierIds(sectionOf(graph.sections, 'tactical'));
  const sections = graph.sections.map(([name, value]): Section => {
    const soldiers = withSoldierGassedFlag(value, gassed);
    return [name, name === 'tactical' && isObject(soldiers) ? withoutGassedArray(soldiers) : soldiers];
  });
  return { ...snapshot, graph: { ...graph, sections } };
}

const CROWS_KEY = 'crows';
const REALTIME_CLOCK_KEY = 'realtimeClock';
const CORPSES_KEY = 'corpses';
const CORPSE_HOLES_KEY = 'corpseHoles';
const HEIGHT_KEY = 'heightAdjustment';
const TARGET_HEIGHT_KEY = 'targetHeightAdjustment';
const ROTTING_CORPSES_STAMP_KEY = 'lastRottingCorpsesSeconds';
const SECONDS_REALTIME_CLOCK_KEYS = ['lastTurnMs', 'lastOpplistDecaySeconds', 'lastOverheadMs'];
const NO_CROWS: JsonObject = { possible: 0, dontAddNew: false };
const SHARED_CROWS: JsonObject = { [REF]: `strategic/${SECTOR_FLOW_KEY}/${CROWS_KEY}` };

function isSecondsRealtimeClock(o: JsonObject): boolean {
  return (
    Object.keys(o).length === SECONDS_REALTIME_CLOCK_KEYS.length && SECONDS_REALTIME_CLOCK_KEYS.every((key) => typeof o[key] === 'number')
  );
}

function withCrowFields(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withCrowFields(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withCrowFields(v);
  if (isSecondsRealtimeClock(mapped)) return { ...mapped, [ROTTING_CORPSES_STAMP_KEY]: 0 };
  return isSoldierRecord(mapped) ? insertAfter(mapped, HEIGHT_KEY, TARGET_HEIGHT_KEY, 0) : mapped;
}

function withSectorFlowCrows(strategic: JsonObject): JsonObject {
  const flow = strategic[SECTOR_FLOW_KEY];
  if (!isObject(flow) || flow[REF] !== undefined) return strategic;
  return { ...strategic, [SECTOR_FLOW_KEY]: insertAfter(flow, REALTIME_CLOCK_KEY, CROWS_KEY, NO_CROWS) };
}

function withTacticalCrows(tactical: JsonObject, shared: boolean): JsonObject {
  const crows = insertAfter(tactical, REALTIME_CLOCK_KEY, CROWS_KEY, shared ? SHARED_CROWS : NO_CROWS);
  return insertAfter(crows, CORPSES_KEY, CORPSE_HOLES_KEY, []);
}

function addCrows(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const shared = isObject(sectionOf(graph.sections, 'strategic'));
  const sections = graph.sections.map(([name, value]): Section => {
    const fields = withCrowFields(value);
    if (name === 'strategic' && isObject(fields)) return [name, withSectorFlowCrows(fields)];
    if (name === 'tactical' && isObject(fields)) return [name, withTacticalCrows(fields, shared)];
    return [name, fields];
  });
  return { ...snapshot, graph: { ...graph, sections } };
}

const PENDING_AID_KEY = 'pendingAid';
const PENDING_ROBOT_RELOAD_KEY = 'pendingRobotReload';

function withPendingRobotReload(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withPendingRobotReload(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withPendingRobotReload(v);
  return isSoldierRecord(mapped) ? insertAfter(mapped, PENDING_AID_KEY, PENDING_ROBOT_RELOAD_KEY, null) : mapped;
}

function addPendingRobotReload(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withPendingRobotReload(value)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const ADDED_EXIT_GRIDS_KEY = 'addedExitGrids';
const LANDED_HELICOPTER_KEY = 'landedHelicopter';

function addLandedHelicopter(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(
    ([name, value]): Section => [
      name,
      name === 'tactical' && isObject(value) ? insertAfter(value, ADDED_EXIT_GRIDS_KEY, LANDED_HELICOPTER_KEY, null) : value,
    ],
  );
  return { ...snapshot, graph: { ...graph, sections } };
}

const SERVICING_CROWS_KEY = 'servicingCrows';

function withServicingCrows(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withServicingCrows(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withServicingCrows(v);
  return isCorpseRecord(mapped) ? insertAfter(mapped, HEAD_TAKEN_KEY, SERVICING_CROWS_KEY, 0) : mapped;
}

function addServicingCrows(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withServicingCrows(value)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const PENDING_ACTION_DATA_1_KEY = 'pendingActionData1';
const RANDOM_ACTION_COUNTER_KEY = 'timeOfLastRandomAction';

function withRandomActionCounter(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withRandomActionCounter(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withRandomActionCounter(v);
  return isSoldierRecord(mapped) ? insertAfter(mapped, PENDING_ACTION_DATA_1_KEY, RANDOM_ACTION_COUNTER_KEY, 0) : mapped;
}

function addRandomActionCounter(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withRandomActionCounter(value)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const ROTTING_CORPSES_REALTIME_CLOCK_KEYS = [...SECONDS_REALTIME_CLOCK_KEYS, ROTTING_CORPSES_STAMP_KEY];
const CREATURE_TENSE_QUOTE_DEFAULTS: JsonObject = { creatureTenseQuoteDelaySeconds: 0, lastCreatureTenseQuoteMs: 0 };

function isRottingCorpsesRealtimeClock(o: JsonObject): boolean {
  const keys = ROTTING_CORPSES_REALTIME_CLOCK_KEYS;
  return Object.keys(o).length === keys.length && keys.every((key) => typeof o[key] === 'number');
}

function withCreatureTenseQuoteTimer(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withCreatureTenseQuoteTimer(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withCreatureTenseQuoteTimer(v);
  return isRottingCorpsesRealtimeClock(mapped) ? { ...mapped, ...CREATURE_TENSE_QUOTE_DEFAULTS } : mapped;
}

function addCreatureTenseQuoteTimer(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withCreatureTenseQuoteTimer(value)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const LIVE_DOOR_STATUS_KEYS = ['perceivedOpen'];
const SAVED_DOOR_STATUS_KEYS = ['gridNo', 'open', 'perceivedOpen'];

function hasExactlyKeys(o: JsonObject, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

function withDoorStatusFlags(o: JsonObject): JsonObject {
  if (hasExactlyKeys(o, LIVE_DOOR_STATUS_KEYS) && typeof o.perceivedOpen === 'boolean')
    return { perceivedOpen: o.perceivedOpen, perceivedNotSet: false, busy: false, shownOpen: o.perceivedOpen };
  if (hasExactlyKeys(o, SAVED_DOOR_STATUS_KEYS) && typeof o.perceivedOpen === 'boolean') return { ...o, perceivedNotSet: false };
  return o;
}

function withDoorStatuses(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withDoorStatuses(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withDoorStatuses(v);
  return withDoorStatusFlags(mapped);
}

function addDoorStatusFlags(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withDoorStatuses(value)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const PRECEDENT_QUOTE_SAID_KEY = 'precedentQuoteSaid';
const PRE_COMBAT_GRIDNO_KEY = 'preCombatGridNo';
const UNSET_PRE_COMBAT_GRIDNO = 0;

function withPreCombatGridNo(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withPreCombatGridNo(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withPreCombatGridNo(v);
  return isProfileProgress(mapped) ? insertAfter(mapped, PRECEDENT_QUOTE_SAID_KEY, PRE_COMBAT_GRIDNO_KEY, UNSET_PRE_COMBAT_GRIDNO) : mapped;
}

function addPreCombatGridNo(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withPreCombatGridNo(value)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const MERC_SLOTS_KEY = 'mercSlots';
const AWAY_SLOTS_KEY = 'awaySlots';
const AI_PASS_KEY = 'aiPass';
const AI_CURSOR_KEY = 'cursor';
const AWAY_AI_CURSOR_KEY = 'awayCursor';
const EMPTY_SLOT = null;

interface SlotCompaction {
  readonly path: string;
  readonly soldiersBefore: readonly number[];
}

function slotCompaction(tactical: JsonObject, key: string): SlotCompaction {
  const slots = tactical[key];
  const soldiersBefore: number[] = [];
  let kept = 0;
  for (const slot of Array.isArray(slots) ? slots : []) {
    soldiersBefore.push(kept);
    if (slot !== EMPTY_SLOT) kept++;
  }
  return { path: `tactical/${key}/`, soldiersBefore };
}

function mappedField(o: JsonObject, key: string, map: (value: Json) => Json): JsonObject {
  const value = o[key];
  return value === undefined ? o : { ...o, [key]: map(value) };
}

function compactedSlots(slots: Json): Json {
  return Array.isArray(slots) ? slots.filter((slot: Json) => slot !== EMPTY_SLOT) : slots;
}

function compactedCursor(cursor: Json, compaction: SlotCompaction): Json {
  if (typeof cursor !== 'number' || cursor < 0 || cursor >= compaction.soldiersBefore.length) return cursor;
  return compaction.soldiersBefore[cursor] ?? cursor;
}

function withCompactedCursors(pass: Json, merc: SlotCompaction, away: SlotCompaction): Json {
  if (!isObject(pass) || pass[REF] !== undefined) return pass;
  const withMercCursor = mappedField(pass, AI_CURSOR_KEY, (cursor) => compactedCursor(cursor, merc));
  return mappedField(withMercCursor, AWAY_AI_CURSOR_KEY, (cursor) => compactedCursor(cursor, away));
}

function movedSlotRef(ref: string, compaction: SlotCompaction): string {
  if (!ref.startsWith(compaction.path)) return ref;
  const [slot = '', ...rest] = ref.slice(compaction.path.length).split('/');
  return [`${compaction.path}${compaction.soldiersBefore[Number(slot)] ?? slot}`, ...rest].join('/');
}

function withMovedSlotRefs(value: Json, compactions: readonly SlotCompaction[]): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withMovedSlotRefs(v, compactions));
  if (!isObject(value)) return value;
  const ref = value[REF];
  if (typeof ref === 'string') return { [REF]: compactions.reduce((moved, c) => movedSlotRef(moved, c), ref) };
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withMovedSlotRefs(v, compactions);
  return mapped;
}

function withCompactedSlots(tactical: JsonObject, merc: SlotCompaction, away: SlotCompaction): JsonObject {
  const withCursors = mappedField(tactical, AI_PASS_KEY, (pass) => withCompactedCursors(pass, merc, away));
  return mappedField(mappedField(withCursors, MERC_SLOTS_KEY, compactedSlots), AWAY_SLOTS_KEY, compactedSlots);
}

function compactMercSlots(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const tactical = sectionOf(graph.sections, 'tactical');
  if (!isObject(tactical)) return { ...snapshot };
  const merc = slotCompaction(tactical, MERC_SLOTS_KEY);
  const away = slotCompaction(tactical, AWAY_SLOTS_KEY);
  const sections = graph.sections.map(([name, value]): Section => {
    const compacted = name === 'tactical' && isObject(value) ? withCompactedSlots(value, merc, away) : value;
    return [name, withMovedSlotRefs(compacted, [merc, away])];
  });
  return { ...snapshot, graph: { ...graph, sections } };
}

const DOOR_STATUS_KEY = 'doorStatus';
const MAP_TAG = '$map';
const STRUCTURES_TAG = '$structures';

function structureListsOf(world: Json | undefined): Json {
  return field(field(field(world, 'structures', null), STRUCTURES_TAG, null), 'lists', null);
}

function doorStructureOpen(lists: Json, gridNo: number): boolean {
  const list = Array.isArray(lists) ? lists[gridNo] : undefined;
  const isDoor = (s: Json) => isObject(s) && typeof s.flags === 'number' && (s.flags & StructureFlags.ANYDOOR) !== 0;
  const door = Array.isArray(list) ? list.find(isDoor) : undefined;
  return isObject(door) && ((door.flags as number) & StructureFlags.OPEN) !== 0;
}

function withRealDoorState(entry: Json, lists: Json): Json {
  if (!Array.isArray(entry) || typeof entry[0] !== 'number') return entry;
  const [gridNo, status] = entry;
  if (!isObject(status) || status.open !== undefined || status[REF] !== undefined) return entry;
  return [gridNo, { open: doorStructureOpen(lists, gridNo), ...status }];
}

function addRealDoorState(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const tactical = sectionOf(graph.sections, 'tactical');
  const doorStatus = isObject(tactical) ? tactical[DOOR_STATUS_KEY] : undefined;
  const entries = isObject(doorStatus) ? doorStatus[MAP_TAG] : undefined;
  if (!Array.isArray(entries)) return { ...snapshot };
  const lists = structureListsOf(sectionOf(graph.sections, 'world'));
  const migrated: Json = { [MAP_TAG]: entries.map((entry: Json) => withRealDoorState(entry, lists)) };
  const sections = graph.sections.map(([name, value]): Section => {
    if (name !== 'tactical' || !isObject(value)) return [name, value];
    return [name, { ...value, [DOOR_STATUS_KEY]: migrated }];
  });
  return { ...snapshot, graph: { ...graph, sections } };
}

const CORPSE_LEVEL_KEY = 'level';
const GROUND_CORPSE_HEIGHT = 0;
const PLACED_ROOF_SOLDIER_CORPSE_HEIGHT = 8;

function levelDefaultCorpseHeight(level: Json | undefined): number {
  return typeof level === 'number' && level > 0 ? PLACED_ROOF_SOLDIER_CORPSE_HEIGHT : GROUND_CORPSE_HEIGHT;
}

function withCorpseHeights(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withCorpseHeights(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withCorpseHeights(v);
  if (!isCorpseRecord(mapped)) return mapped;
  return insertAfter(mapped, CORPSE_LEVEL_KEY, HEIGHT_KEY, levelDefaultCorpseHeight(mapped[CORPSE_LEVEL_KEY]));
}

function addCorpseHeights(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withCorpseHeights(value)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const BULLET_KEYS = ['firer', 'real', 'msPerUpdate', 'tilesPerUpdate', 'toDelete', 'lastStructureHit'];
const BULLET_DELETE_KEY = 'toDelete';
const BULLET_LOCATED_KEY = 'located';

function isBulletRecord(o: JsonObject): boolean {
  return BULLET_KEYS.every((key) => o[key] !== undefined);
}

function withBulletLocatedFlag(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withBulletLocatedFlag(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withBulletLocatedFlag(v);
  return isBulletRecord(mapped) ? insertAfter(mapped, BULLET_DELETE_KEY, BULLET_LOCATED_KEY, false) : mapped;
}

function addBulletLocatedFlags(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withBulletLocatedFlag(value)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const PENDING_WAIT_KEY = 'pendingWait';
const INTERFACE_LOCK_ACTIVE_KEY = 'interfaceLockActive';

function withInterfaceLockFlag(strategic: JsonObject): JsonObject {
  const flow = strategic[SECTOR_FLOW_KEY];
  if (!isObject(flow) || flow[REF] !== undefined) return strategic;
  return { ...strategic, [SECTOR_FLOW_KEY]: insertAfter(flow, PENDING_WAIT_KEY, INTERFACE_LOCK_ACTIVE_KEY, false) };
}

function addInterfaceLockFlag(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(
    ([name, value]): Section => [name, name === 'strategic' && isObject(value) ? withInterfaceLockFlag(value) : value],
  );
  return { ...snapshot, graph: { ...graph, sections } };
}

const ITEMS_SEEN_ON_ATTACK_GRID_NO_KEY = 'itemsSeenOnAttackGridNo';
const ITEM_LOCATOR_KIND = 'itemLocator';
const ITEM_LOCATOR_SPEAKER_KEY = 'speaker';
const ITEM_LOCATOR_GRID_NO_KEY = 'gridNo';
const NO_ITEMS_TILE = -1;

function withItemsSeenGridNo(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withItemsSeenGridNo(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withItemsSeenGridNo(v);
  return mapped.kind === ITEM_LOCATOR_KIND
    ? insertAfter(mapped, ITEM_LOCATOR_SPEAKER_KEY, ITEM_LOCATOR_GRID_NO_KEY, NO_ITEMS_TILE)
    : mapped;
}

function withItemsSeenOnAttackGridNo(tactical: JsonObject): JsonObject {
  const turn = tactical.turn;
  if (!isObject(turn) || turn[REF] !== undefined) return tactical;
  return { ...tactical, turn: insertAfter(turn, ITEMS_SEEN_ON_ATTACK_KEY, ITEMS_SEEN_ON_ATTACK_GRID_NO_KEY, NO_ITEMS_TILE) };
}

function addItemsSeenTiles(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => {
    const located = withItemsSeenGridNo(value);
    return [name, name === 'tactical' && isObject(located) ? withItemsSeenOnAttackGridNo(located) : located];
  });
  return { ...snapshot, graph: { ...graph, sections } };
}

const FOG_KEY = 'fog';
const REVEALED_KEY = 'revealed';
const SLANT_ROOF_CEILINGS_KEY = 'slantRoofCeilings';

function withSlantRoofCeilings(tactical: JsonObject): JsonObject {
  const fog = tactical[FOG_KEY];
  if (!isObject(fog) || fog[REF] !== undefined) return tactical;
  const none: Json = { [BYTES_TAG]: encodeBase64(new Uint8Array(WORLD_MAX)) };
  return { ...tactical, [FOG_KEY]: insertAfter(fog, REVEALED_KEY, SLANT_ROOF_CEILINGS_KEY, none) };
}

function addSlantRoofCeilings(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(
    ([name, value]): Section => [name, name === 'tactical' && isObject(value) ? withSlantRoofCeilings(value) : value],
  );
  return { ...snapshot, graph: { ...graph, sections } };
}

const SLEEP_DRUG_COUNTER_KEY = 'sleepDrugCounter';
const DRUGS_KEY = 'drugs';
const REGENERATION_COUNTER_KEY = 'regenerationCounter';
const REGEN_BOOSTERS_USED_TODAY_KEY = 'regenBoostersUsedToday';
const DAYS_OF_MORALE_HANGOVER_KEY = 'daysOfMoraleHangover';
const DRUG_USES_IN_LIFETIME_KEY = 'numTimesDrugUseInLifetime';

function soberCourses(): Json {
  const course = { future: 0, rate: 0, effect: 0, sideEffectRate: 0, sideEffect: 0 };
  return { adrenaline: { ...course }, alcohol: { ...course } };
}

function withDrugCourses(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withDrugCourses(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withDrugCourses(v);
  if (isProfileProgress(mapped)) return insertAfter(mapped, DAYS_OF_MORALE_HANGOVER_KEY, DRUG_USES_IN_LIFETIME_KEY, 0);
  if (!isSoldierRecord(mapped)) return mapped;
  const drugged = insertAfter(mapped, SLEEP_DRUG_COUNTER_KEY, DRUGS_KEY, soberCourses());
  return insertAfter(drugged, REGENERATION_COUNTER_KEY, REGEN_BOOSTERS_USED_TODAY_KEY, 0);
}

function addDrugCourses(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withDrugCourses(value)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const WORLD_ITEMS_KEY = 'worldItems';
const WORLD_BOMBS_KEY = 'worldBombs';
const MINE_FLAGS_KEY = 'mineFlags';
const ITEMS_SECTION = 'items';
const WORLD_ITEM_DONTRENDER = 0x0001;
const WORLD_ITEM_ARMED_BOMB = 0x0040;

function numberField(o: JsonObject, key: string): number {
  const value = o[key];
  return typeof value === 'number' ? value : 0;
}

function bombSlotsOf(items: Json | undefined): Json {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item: Json, k: number): Json[] =>
    isObject(item) && (numberField(item, 'flags') & WORLD_ITEM_ARMED_BOMB) !== 0
      ? [{ exists: true, item: { [REF]: `${ITEMS_SECTION}/${k}` } }]
      : [],
  );
}

function withWorldBombsAndMineFlags(tactical: JsonObject, items: Json | undefined): JsonObject {
  const noMineFlags: Json = { [BYTES_TAG]: encodeBase64(new Uint8Array(WORLD_MAX)) };
  const withBombs = insertAfter(tactical, WORLD_ITEMS_KEY, WORLD_BOMBS_KEY, bombSlotsOf(items));
  return insertAfter(withBombs, WORLD_BOMBS_KEY, MINE_FLAGS_KEY, noMineFlags);
}

function raisedItemTiles(items: Json | undefined): Map<number, number> {
  const tiles = new Map<number, number>();
  if (!Array.isArray(items)) return tiles;
  for (const item of items) {
    if (!isObject(item) || numberField(item, 'zHeight') <= 0 || numberField(item, 'flags') & WORLD_ITEM_DONTRENDER) continue;
    tiles.set(numberField(item, 'gridNo'), numberField(item, 'level') ? STRUCTURE_ON_ROOF : STRUCTURE_ON_GROUND);
  }
  return tiles;
}

function holdsItems(s: Json, cubeOffset: number): boolean {
  if (!isObject(s) || numberField(s, 'cubeOffset') !== cubeOffset) return false;
  const flags = numberField(s, 'flags');
  if (!(flags & StructureFlags.BLOCKSMOVES) || flags & (StructureFlags.PERSON | StructureFlags.CORPSE)) return false;
  return (flags & (StructureFlags.OPENABLE | StructureFlags.GENERIC)) !== 0;
}

function withItemOnTopFlag(list: Json, cubeOffset: number): Json {
  if (!Array.isArray(list)) return list;
  const at = list.findIndex((s: Json) => holdsItems(s, cubeOffset));
  const s = list[at];
  if (!isObject(s) || numberField(s, 'flags') & StructureFlags.OPENABLE) return list;
  return list.map((x: Json, k: number) => (k === at ? { ...s, flags: u32(numberField(s, 'flags') | StructureFlags.HASITEMONTOP) } : x));
}

function withItemsOnTop(world: Json | undefined, items: Json | undefined): Json | undefined {
  const lists = structureListsOf(world);
  const raised = raisedItemTiles(items);
  if (!Array.isArray(lists) || raised.size === 0 || !isObject(world)) return world;
  const marked = lists.map((list: Json, g: number) => {
    const cubeOffset = raised.get(g);
    return cubeOffset === undefined ? list : withItemOnTopFlag(list, cubeOffset);
  });
  const structures = field(world, 'structures', null);
  const payload = field(structures, STRUCTURES_TAG, null);
  if (!isObject(payload)) return world;
  return { ...world, structures: { [STRUCTURES_TAG]: { ...payload, lists: marked } } };
}

function addWorldBombsAndMineFlags(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const items = sectionOf(graph.sections, ITEMS_SECTION);
  const sections = graph.sections.map(([name, value]): Section => {
    if (name === 'world') return [name, withItemsOnTop(value, items) ?? value];
    return [name, name === 'tactical' && isObject(value) ? withWorldBombsAndMineFlags(value, items) : value];
  });
  return { ...snapshot, graph: { ...graph, sections } };
}

const ACTION_ITEMS_KEY = 'actionItems';
const EXPLOSION_QUEUE_KEY = 'explosionQueue';
const DUE_AT_ONCE = 0;

function slotRefOf(slot: Json): Json {
  return isObject(slot) && slot.exists === true ? field(slot.item, REF, null) : null;
}

function queuedBombsOf(queue: Json | undefined, slots: Json | undefined): Json[] {
  if (!Array.isArray(queue) || !Array.isArray(slots)) return [];
  const refs = slots.map(slotRefOf);
  return queue.flatMap((item: Json): Json[] => {
    const bomb = refs.indexOf(field(item, REF, null));
    return bomb < 0 ? [] : [{ bomb, timestamp: DUE_AT_ONCE, exists: true }];
  });
}

function withExplosionQueue(tactical: JsonObject): JsonObject {
  const actionItems = tactical[ACTION_ITEMS_KEY];
  if (!isObject(actionItems)) return tactical;
  const queue: Json = {
    entries: queuedBombsOf(actionItems.queue, tactical[WORLD_BOMBS_KEY]),
    active: field(actionItems, 'active', false),
    mayHaveChangedSight: field(actionItems, 'sightChanged', false),
    person: field(actionItems, 'person', null),
  };
  return replaceKey(tactical, ACTION_ITEMS_KEY, EXPLOSION_QUEUE_KEY, queue, []);
}

function actionItemsIntoExplosionQueue(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(
    ([name, value]): Section => [name, name === 'tactical' && isObject(value) ? withExplosionQueue(value) : value],
  );
  return { ...snapshot, graph: { ...graph, sections } };
}

const PROMPT_KEY = 'prompt';
const PROMPT_SEQ_KEY = 'promptSeq';
const BOOBY_TRAP_KEY = 'boobyTrap';
const NO_BOOBY_TRAP: Json = { soldier: null, item: null, gridNo: 0, level: 0, buried: false, difficulty: 0, justFound: false };
const STOP_TIME_CALLBACK_KEY = 'stopTimeCallback';
const TACTICAL_MODAL_KEY = 'tacticalModal';
const TACTICAL_MODAL_OFF = 0;
const FACE_KEY = 'face';
const FACE_PC_TRIGGER_KEY = 'pcTrigger';
const FACE_MODAL_KEY = 'modal';

function withTacticalPrompt(tactical: JsonObject): JsonObject {
  const prompt = insertAfter(tactical, EXPLOSION_QUEUE_KEY, PROMPT_KEY, null);
  const seq = insertAfter(prompt, PROMPT_KEY, PROMPT_SEQ_KEY, 0);
  return insertAfter(seq, PROMPT_SEQ_KEY, BOOBY_TRAP_KEY, NO_BOOBY_TRAP);
}

function withFaceModalFlag(face: Json | undefined): Json {
  if (!isObject(face)) return face ?? null;
  return insertAfter(face, FACE_PC_TRIGGER_KEY, FACE_MODAL_KEY, false);
}

function withStopTimeQuoteState(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withStopTimeQuoteState(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withStopTimeQuoteState(v);
  if (!isTalkStateRecord(mapped)) return mapped;
  const talk = insertAfter(
    { ...mapped, [FACE_KEY]: withFaceModalFlag(mapped[FACE_KEY]) },
    PAUSED_FOR_LINE_KEY,
    STOP_TIME_CALLBACK_KEY,
    null,
  );
  return insertAfter(talk, STOP_TIME_CALLBACK_KEY, TACTICAL_MODAL_KEY, TACTICAL_MODAL_OFF);
}

function addTacticalPromptsAndStopTimeQuotes(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => {
    const quoted = withStopTimeQuoteState(value);
    return [name, name === 'tactical' && isObject(quoted) ? withTacticalPrompt(quoted) : quoted];
  });
  return { ...snapshot, graph: { ...graph, sections } };
}

const PENDING_DROP_BOMB_KEY = 'pendingDropBomb';

function withPendingDropBomb(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withPendingDropBomb(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withPendingDropBomb(v);
  return isSoldierRecord(mapped) ? insertAfter(mapped, PENDING_ROBOT_RELOAD_KEY, PENDING_DROP_BOMB_KEY, false) : mapped;
}

function addPendingDropBomb(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withPendingDropBomb(value)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const PANIC_KEY = 'panic';
const HAS_KEYS_KEY = 'hasKeys';
const NO_PANIC_TRIGGER_GRIDNO = -1;
const PANIC_TRIGGER_COUNT = 3;

function noPanic(): Json {
  const triggers = Array.from({ length: PANIC_TRIGGER_COUNT }, () => ({ gridNo: NO_PANIC_TRIGGER_GRIDNO, isAlarm: false, tolerance: 0 }));
  return { flags: 0, triggers, chosenOne: null, armyGuysKilled: 0 };
}

function withKeysByte(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withKeysByte(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = key === HAS_KEYS_KEY && typeof v === 'boolean' ? Number(v) : withKeysByte(v);
  return mapped;
}

function addPanicStateAndKeysByte(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => {
    const keyed = withKeysByte(value);
    return [name, name === 'tactical' && isObject(keyed) ? insertAfter(keyed, BOOBY_TRAP_KEY, PANIC_KEY, noPanic()) : keyed];
  });
  return { ...snapshot, graph: { ...graph, sections } };
}

const PENDING_TILE_TOOL_KEY = 'pendingTileTool';
const XRAY_ACTIVATED_TIME_KEY = 'xrayActivatedTime';
const XRAYED_BY_KEY = 'xrayedBy';
const TIN_CAN_KEY = 'hasTinCan';
const LIVE_DOOR_STATUS_KEYS_BEFORE_TIN_CANS = ['open', 'perceivedOpen', 'perceivedNotSet', 'busy', 'shownOpen'];
const SAVED_DOOR_STATUS_KEYS_BEFORE_TIN_CANS = ['gridNo', 'open', 'perceivedOpen', 'perceivedNotSet'];

function withTileToolAndXRay(o: JsonObject): JsonObject {
  const pending = insertAfter(o, PENDING_DROP_BOMB_KEY, PENDING_TILE_TOOL_KEY, null);
  const activated = insertAfter(pending, PENDING_TILE_TOOL_KEY, XRAY_ACTIVATED_TIME_KEY, 0);
  return insertAfter(activated, XRAY_ACTIVATED_TIME_KEY, XRAYED_BY_KEY, null);
}

function isDoorStatusBeforeTinCans(o: JsonObject): boolean {
  return hasExactlyKeys(o, LIVE_DOOR_STATUS_KEYS_BEFORE_TIN_CANS) || hasExactlyKeys(o, SAVED_DOOR_STATUS_KEYS_BEFORE_TIN_CANS);
}

function withTinCansAndXRay(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withTinCansAndXRay(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withTinCansAndXRay(v);
  if (isSoldierRecord(mapped)) return withTileToolAndXRay(mapped);
  return isDoorStatusBeforeTinCans(mapped) ? { ...mapped, [TIN_CAN_KEY]: false } : mapped;
}

function addTileToolsTinCansAndXRay(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withTinCansAndXRay(value)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const TILES_MOVED_KEY = 'tilesMoved';
const TILES_SINCE_FORGETTING_KEY = 'tilesMovedSinceLastForget';
const NEXT_TILE_CHECK_KEY = 'nextTileCheckAt';
const OVERRIDE_MOVE_SPEED_KEY = 'overrideMoveSpeed';
const USE_OVERRIDE_MOVE_SPEED_KEY = 'useOverrideMoveSpeed';

function withWalkingCounters(o: JsonObject): JsonObject {
  const forgetting = insertAfter(o, TILES_MOVED_KEY, TILES_SINCE_FORGETTING_KEY, 0);
  const speedOf = insertAfter(forgetting, NEXT_TILE_CHECK_KEY, OVERRIDE_MOVE_SPEED_KEY, 0);
  return insertAfter(speedOf, OVERRIDE_MOVE_SPEED_KEY, USE_OVERRIDE_MOVE_SPEED_KEY, false);
}

function withSoldierWalkingCounters(value: Json): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withSoldierWalkingCounters(v));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withSoldierWalkingCounters(v);
  return isSoldierRecord(mapped) ? withWalkingCounters(mapped) : mapped;
}

function addForgetCountAndFollowerSpeed(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const sections = graph.sections.map(([name, value]): Section => [name, withSoldierWalkingCounters(value)]);
  return { ...snapshot, graph: { ...graph, sections } };
}

const VEHICLE_ID_KEY = 'vehicleId';
const MONSTER_OR_ANIMAL_KEY = 'monsterOrAnimal';
const VEHICLES_KEY = 'vehicles';
const PROFILES_KEY = 'profiles';
const NOT_A_VEHICLE = -1;
const SHARED_VEHICLE_LIST: Json = { [REF]: 'strategic/forces/vehicles' };

function vehicleSlotsBySoldier(strategic: Json | undefined): Map<number, number> {
  const slots = new Map<number, number>();
  const vehicles = field(field(strategic, 'forces', null), VEHICLES_KEY, null);
  if (!Array.isArray(vehicles)) return slots;
  vehicles.forEach((v: Json, slot: number) => {
    const soldier = field(v, 'soldierId', NOT_A_VEHICLE);
    if (field(v, 'valid', false) === true && typeof soldier === 'number' && soldier >= 0 && !slots.has(soldier)) slots.set(soldier, slot);
  });
  return slots;
}

function vehicleIdOf(soldier: JsonObject, slots: ReadonlyMap<number, number>): number {
  const { id, bodyType } = soldier;
  if (typeof id !== 'number' || typeof bodyType !== 'number' || !isVehicleBody(bodyType)) return NOT_A_VEHICLE;
  return slots.get(id) ?? NOT_A_VEHICLE;
}

function withVehicleIds(value: Json, slots: ReadonlyMap<number, number>): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withVehicleIds(v, slots));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withVehicleIds(v, slots);
  return isSoldierRecord(mapped) ? insertAfter(mapped, MONSTER_OR_ANIMAL_KEY, VEHICLE_ID_KEY, vehicleIdOf(mapped, slots)) : mapped;
}

function addVehicleIdsAndSharedVehicleList(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const strategic = sectionOf(graph.sections, 'strategic');
  const slots = vehicleSlotsBySoldier(strategic);
  const list: Json = isObject(strategic) ? SHARED_VEHICLE_LIST : [];
  const sections = graph.sections.map(([name, value]): Section => {
    const linked = withVehicleIds(value, slots);
    return [name, name === 'tactical' && isObject(linked) ? insertAfter(linked, PROFILES_KEY, VEHICLES_KEY, list) : linked];
  });
  return { ...snapshot, graph: { ...graph, sections } };
}

const VEHICLE_SEAT_KEY = 'vehicleSeat';
const STATUS_FLAGS_KEY = 'statusFlags';
const MAP_ENTRIES = '$map';
const DRIVER_FLAG = 0x08000000;
const PASSENGER_FLAG = 0x10000000;
const SEAT_FLAGS = DRIVER_FLAG | PASSENGER_FLAG;
const NO_SEAT = 0;
const DRIVER_SEAT = 1;
const PASSENGER_SEAT = 2;

function seatOfFlags(flags: number): number {
  if (flags & DRIVER_FLAG) return DRIVER_SEAT;
  return flags & PASSENGER_FLAG ? PASSENGER_SEAT : NO_SEAT;
}

function rosterEntries(strategic: Json | undefined): readonly Json[] {
  const entries = field(field(field(strategic, 'roster', null), 'mercs', null), MAP_ENTRIES, null);
  return Array.isArray(entries) ? entries : [];
}

function seatsByMerc(strategic: Json | undefined): Map<number, number> {
  const seats = new Map<number, number>();
  for (const entry of rosterEntries(strategic)) {
    if (!Array.isArray(entry)) continue;
    const [id, record] = entry;
    const flags = field(record, STATUS_FLAGS_KEY, 0);
    if (typeof id === 'number' && typeof flags === 'number' && seatOfFlags(flags) !== NO_SEAT) seats.set(id, seatOfFlags(flags));
  }
  return seats;
}

function withoutSeatFlags(entry: Json): Json {
  if (!Array.isArray(entry)) return entry;
  const [id, record] = entry;
  const flags = field(record, STATUS_FLAGS_KEY, 0);
  if (!isObject(record) || typeof flags !== 'number') return entry;
  return [id ?? null, { ...record, [STATUS_FLAGS_KEY]: flags & ~SEAT_FLAGS }];
}

function rosterWithoutSeatFlags(strategic: JsonObject): JsonObject {
  const roster = strategic.roster;
  const mercs = field(roster, 'mercs', null);
  if (!isObject(roster) || !isObject(mercs)) return strategic;
  const entries = rosterEntries(strategic).map((entry: Json) => withoutSeatFlags(entry));
  return { ...strategic, roster: { ...roster, mercs: { ...mercs, [MAP_ENTRIES]: entries } } };
}

function seatOf(soldier: JsonObject, seats: ReadonlyMap<number, number>): number {
  const { id, team } = soldier;
  return typeof id === 'number' && team === OUR_TEAM ? (seats.get(id) ?? NO_SEAT) : NO_SEAT;
}

function withVehicleSeats(value: Json, seats: ReadonlyMap<number, number>): Json {
  if (Array.isArray(value)) return value.map((v: Json) => withVehicleSeats(v, seats));
  if (!isObject(value)) return value;
  const mapped: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value)) mapped[key] = withVehicleSeats(v, seats);
  return isSoldierRecord(mapped) ? insertAfter(mapped, VEHICLE_ID_KEY, VEHICLE_SEAT_KEY, seatOf(mapped, seats)) : mapped;
}

function moveVehicleSeatsOntoSoldiers(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const graph = snapshot.graph as EncodedGraph;
  const seats = seatsByMerc(sectionOf(graph.sections, 'strategic'));
  const sections = graph.sections.map(([name, value]): Section => {
    const seated = withVehicleSeats(value, seats);
    return [name, name === 'strategic' && isObject(seated) ? rosterWithoutSeatFlags(seated) : seated];
  });
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
    17: addSightedCreatureFlag,
    18: addNothingToDoFlag,
    19: dropCompressionSinceMapEntry,
    20: addMovementCosmeticStream,
    21: addCorpseHeads,
    22: addPreferredSelection,
    23: addPickedOwnershipCheck,
    24: addObjectMissions,
    25: addBleedingQuoteState,
    26: addLinePauseFlag,
    27: moveGassedOntoSoldiers,
    28: addCrows,
    29: addPendingRobotReload,
    30: addLandedHelicopter,
    31: addServicingCrows,
    32: addRandomActionCounter,
    33: addCreatureTenseQuoteTimer,
    34: addDoorStatusFlags,
    35: addPreCombatGridNo,
    36: compactMercSlots,
    37: addRealDoorState,
    38: addCorpseHeights,
    39: addBulletLocatedFlags,
    40: addInterfaceLockFlag,
    41: addItemsSeenTiles,
    42: addSlantRoofCeilings,
    43: addDrugCourses,
    44: addWorldBombsAndMineFlags,
    45: actionItemsIntoExplosionQueue,
    46: addTacticalPromptsAndStopTimeQuotes,
    47: addPendingDropBomb,
    48: addPanicStateAndKeysByte,
    49: addTileToolsTinCansAndXRay,
    50: addForgetCountAndFollowerSpeed,
    51: addVehicleIdsAndSharedVehicleList,
    52: moveVehicleSeatsOntoSoldiers,
  };
}
