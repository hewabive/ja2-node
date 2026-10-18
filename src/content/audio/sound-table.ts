// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Utils/Sound_Control.cc szSoundEffects; src/game/Tactical/Soldier_Control.cc InternalDoMercBattleSound (the
// @src generic voice names); src/game/Tactical/Soldier_Create.cc (ubBattleSoundID per body); src/game/Tactical/Weapons.cc
// @src GetBurstSoundName (the %d burst names). See docs/27 §3.1.

import { FormatError } from '../binary/errors.ts';
import { asArray, asBool, asInt, asObject, asString, type JsonObject } from '../strategic/json-fields.ts';

export const SOUND_EFFECTS_PATH = 'tables/sound-effects.json';
export const BATTLE_SOUNDS_PATH = 'tables/battle-sounds.json';
export const BURST_ROUNDS_PLACEHOLDER = '%d';
const SOUND_EXTENSION = '.wav';
const SOUND_KEY = /sound/i;

export interface SoundEffect {
  readonly id: number;
  readonly name: string;
  readonly path: string | null;
}

export interface SoundEffectTable {
  readonly pan: Readonly<Record<string, number>>;
  readonly volume: Readonly<Record<string, number>>;
  readonly farVolumeMod: number;
  readonly sounds: readonly SoundEffect[];
  readonly ambient: readonly SoundEffect[];
  readonly files: readonly string[];
}

export interface BattleSoundKind {
  readonly id: number;
  readonly name: string;
  readonly file: string;
  readonly randomVariants: number;
  readonly badGuy: boolean;
  readonly dontAllowTwoInRow: boolean;
  readonly stopDialogue: number;
}

export interface BattleSoundTable {
  readonly directory: string;
  readonly minSubsequentDelayMs: number;
  readonly lowMoraleThreshold: number;
  readonly kinds: readonly BattleSoundKind[];
}

export type VoiceBody = 'male' | 'female' | 'kid';

export interface GenericVoiceSet {
  readonly basename: string;
  readonly body: VoiceBody;
  readonly profileFallback: boolean;
}

const PROFILE_FALLBACK_VOICES: readonly GenericVoiceSet[] = [
  { basename: 'm', body: 'male', profileFallback: true },
  { basename: 'f', body: 'female', profileFallback: true },
];
const NO_PROFILE_PREFIX = { adult: 'bad', kid: 'kid' } as const;
const NO_PROFILE_SETS: readonly { readonly prefix: string; readonly ids: readonly number[]; readonly body: VoiceBody }[] = [
  { prefix: NO_PROFILE_PREFIX.adult, ids: [0, 1, 2], body: 'male' },
  { prefix: NO_PROFILE_PREFIX.adult, ids: [7, 8], body: 'female' },
  { prefix: NO_PROFILE_PREFIX.kid, ids: [0, 1], body: 'kid' },
];

function intTable(value: unknown, what: string): Record<string, number> {
  return Object.fromEntries(Object.entries(asObject(value, what)).map(([k, v]) => [k, asInt(v, `${what}.${k}`)]));
}

function soundEffects(value: unknown, what: string): SoundEffect[] {
  return asArray(value, what).map((entry, i) => {
    const o = asObject(entry, `${what}[${i}]`);
    const id = asInt(o.id, `${what}[${i}].id`);
    if (id !== i) throw new FormatError(`${what}[${i}]: id ${id} out of order`);
    return { id, name: asString(o.name, `${what}[${i}].name`), path: o.path === null ? null : asString(o.path, `${what}[${i}].path`) };
  });
}

export function parseSoundEffects(json: unknown): SoundEffectTable {
  const o = asObject(json, 'sound effects');
  return {
    pan: intTable(o.pan, 'sound effects.pan'),
    volume: intTable(o.volume, 'sound effects.volume'),
    farVolumeMod: asInt(o.farVolumeMod, 'sound effects.farVolumeMod'),
    sounds: soundEffects(o.sounds, 'sound effects.sounds'),
    ambient: soundEffects(o.ambient, 'sound effects.ambient'),
    files: asArray(o.files, 'sound effects.files').map((f, i) => asString(asObject(f, `sound effects.files[${i}]`).path, `files[${i}]`)),
  };
}

function battleKind(o: JsonObject, i: number): BattleSoundKind {
  const what = `battle sounds.kinds[${i}]`;
  const id = asInt(o.id, `${what}.id`);
  if (id !== i) throw new FormatError(`${what}: id ${id} out of order`);
  return {
    id,
    name: asString(o.name, `${what}.name`),
    file: asString(o.file, `${what}.file`),
    randomVariants: asInt(o.randomVariants, `${what}.randomVariants`),
    badGuy: asBool(o.badGuy, `${what}.badGuy`),
    dontAllowTwoInRow: asBool(o.dontAllowTwoInRow, `${what}.dontAllowTwoInRow`),
    stopDialogue: asInt(o.stopDialogue, `${what}.stopDialogue`),
  };
}

export function parseBattleSounds(json: unknown): BattleSoundTable {
  const o = asObject(json, 'battle sounds');
  return {
    directory: asString(o.directory, 'battle sounds.directory'),
    minSubsequentDelayMs: asInt(o.minSubsequentDelayMs, 'battle sounds.minSubsequentDelayMs'),
    lowMoraleThreshold: asInt(o.lowMoraleThreshold, 'battle sounds.lowMoraleThreshold'),
    kinds: asArray(o.kinds, 'battle sounds.kinds').map((k, i) => battleKind(asObject(k, `battle sounds.kinds[${i}]`), i)),
  };
}

export function effectPaths(table: SoundEffectTable): string[] {
  const paths = [...table.sounds, ...table.ambient].flatMap((s) => (s.path ? [s.path] : []));
  return [...new Set([...paths, ...table.files])];
}

export function genericVoiceSets(): GenericVoiceSet[] {
  const noProfile = NO_PROFILE_SETS.flatMap(({ prefix, ids, body }) =>
    ids.map((id) => ({ basename: `${prefix}${id}`, body, profileFallback: false })),
  );
  return [...PROFILE_FALLBACK_VOICES, ...noProfile];
}

export function battleSoundPath(table: BattleSoundTable, basename: string, file: string): string {
  return `${table.directory}/${basename}_${file}${SOUND_EXTENSION}`;
}

export function voiceSetKinds(table: BattleSoundTable, set: GenericVoiceSet): BattleSoundKind[] {
  return table.kinds.filter((k) => set.profileFallback || k.badGuy);
}

export function soundPathsIn(json: unknown): string[] {
  const found = new Set<string>();
  const visit = (value: unknown, key: string): void => {
    if (typeof value === 'string') {
      if (SOUND_KEY.test(key) && value.toLowerCase().endsWith(SOUND_EXTENSION)) found.add(value.toLowerCase());
    } else if (Array.isArray(value)) {
      for (const v of value) visit(v, key);
    } else if (typeof value === 'object' && value !== null) {
      for (const [k, v] of Object.entries(value)) visit(v, k);
    }
  };
  visit(json, '');
  return [...found];
}

export function expandBurstPattern(path: string, maxRounds: number): string[] {
  if (!path.includes(BURST_ROUNDS_PLACEHOLDER)) return [path];
  return Array.from({ length: maxRounds }, (_, i) => path.replace(BURST_ROUNDS_PLACEHOLDER, String(i + 1)));
}
