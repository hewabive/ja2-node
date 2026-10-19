import { gameOptions, ORIGINAL_GAME_OPTIONS } from '../options.ts';
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

export function snapshotMigrations(context: SnapshotMigrationContext): Readonly<Record<number, SnapshotMigration>> {
  return {
    1: unifyGameOptions,
    2: (snapshot) => spriteFramesToFrameSlots(snapshot, context),
  };
}
