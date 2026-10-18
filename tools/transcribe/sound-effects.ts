import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { bracedBody, readSource, STRACCIATELLA_COMMIT, STRACCIATELLA_SRC, sequentialEnum, stripCComments, writeTable } from './c-source.ts';

const SOUND_CONTROL_H = 'game/Utils/Sound_Control.h';
const SOUND_CONTROL_CC = 'game/Utils/Sound_Control.cc';
const SOLDIER_CONTROL_H = 'game/Tactical/Soldier_Control.h';
const SOLDIER_CONTROL_CC = 'game/Tactical/Soldier_Control.cc';
const PAN_NAMES = ['FARLEFT', 'LEFTSIDE', 'MIDDLE', 'MIDDLEPAN', 'RIGHTSIDE', 'FARRIGHT'] as const;
const VOLUME_NAMES = ['LOWVOLUME', 'BTNVOLUME', 'MIDVOLUME', 'HIGHVOLUME'] as const;
const DIRECTORY_MACROS = ['SOUNDSDIR', 'STSOUNDSDIR', 'LAPTOPDIR', 'BATTLESNDSDIR'] as const;
const BARE_SOUND_DIRS = ['sounds', 'stsounds', 'laptop', 'battlesnds'] as const;

function code(relativePath: string): string {
  return stripCComments(readSource(relativePath));
}

const directories = code('game/Directories.h');

function directory(macro: string): string {
  const m = new RegExp(`#define\\s+${macro}\\s+"([^"]+)"`).exec(directories);
  if (!m) throw new Error(`${macro} not found`);
  return m[1] as string;
}

function defined(src: string, name: string): number {
  const m = new RegExp(`#define\\s+${name}\\s+(\\d+)\\b`).exec(src);
  if (!m) throw new Error(`#define ${name} not found`);
  return Number(m[1]);
}

function definedTable(src: string, names: readonly string[]): Record<string, number> {
  return Object.fromEntries(names.map((name) => [name, defined(src, name)]));
}

function soundPath(macro: string, file: string): string {
  return `${directory(macro)}${file}`.toLowerCase();
}

function pathArray(src: string, declaration: string): (string | null)[] {
  const body = bracedBody(src, declaration);
  return [...body.matchAll(/(?:(\w+)\s+"([^"]*)"|\bNULL\b)/g)].map((m) => (m[1] ? soundPath(m[1], m[2] as string) : null));
}

interface NamedPath {
  readonly id: number;
  readonly name: string;
  readonly path: string | null;
}

function namedPaths(enumName: string, count: string, paths: readonly (string | null)[]): NamedPath[] {
  const ids = sequentialEnum(code(SOUND_CONTROL_H), enumName);
  const entries = [...ids].filter(([name, id]) => id >= 0 && name !== count);
  if (entries.length !== paths.length) throw new Error(`${enumName}: ${entries.length} ids but ${paths.length} paths`);
  return entries.map(([name, id]) => ({ id, name, path: paths[id] ?? null }));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return e.name.endsWith('.cc') ? [full] : [];
  });
}

function literalFiles(): { readonly path: string; readonly src: string }[] {
  const macro = new RegExp(`\\b(${DIRECTORY_MACROS.join('|')})\\s+"(/[^"{}]+\\.wav)"`, 'g');
  const bare = new RegExp(`"((?:${BARE_SOUND_DIRS.join('|')})/[^"{}]+\\.wav)"`, 'g');
  const found = new Map<string, Set<string>>();
  for (const file of sourceFiles(join(STRACCIATELLA_SRC, 'game')).sort()) {
    const rel = relative(STRACCIATELLA_SRC, file);
    if (rel === SOUND_CONTROL_CC) continue;
    const src = code(rel);
    const paths = [
      ...[...src.matchAll(macro)].map((m) => soundPath(m[1] as string, m[2] as string)),
      ...[...src.matchAll(bare)].map((m) => (m[1] as string).toLowerCase()),
    ];
    for (const path of paths) {
      const sources = found.get(path) ?? new Set<string>();
      sources.add(`src/${rel}`);
      found.set(path, sources);
    }
  }
  return [...found].sort(([a], [b]) => (a < b ? -1 : 1)).map(([path, sources]) => ({ path, src: [...sources].join(', ') }));
}

function soundEffects(): unknown {
  const header = code(SOUND_CONTROL_H);
  const control = code(SOUND_CONTROL_CC);
  const sounds = namedPaths('SoundID', 'NUM_SAMPLES', pathArray(control, 'szSoundEffects[NUM_SAMPLES]'));
  const ambient = namedPaths('AmbientSoundID', 'NUM_AMBIENTS', pathArray(control, 'szAmbientEffects[NUM_AMBIENTS]'));
  if (ambient.some((a) => a.path === null)) throw new Error('an ambient sound has no path');
  return {
    source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/${SOUND_CONTROL_H}, src/${SOUND_CONTROL_CC} szSoundEffects, szAmbientEffects, src/game/Directories.h, and every literal sound path in src/game/**/*.cc`,
    license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
    format:
      'sounds: SoundID enum order, id, name and VFS path (null where the original has none); ambient: AmbientSoundID order; files: sound paths named literally elsewhere in the game code, with the files naming them; pan 0 (left) to 127 (right); volume 0 to 127; farVolumeMod: SOUND_FAR_VOLUME_MOD',
    pan: definedTable(header, PAN_NAMES),
    volume: definedTable(header, VOLUME_NAMES),
    farVolumeMod: defined(control, 'SOUND_FAR_VOLUME_MOD'),
    sounds,
    ambient,
    files: literalFiles(),
  };
}

function battleSounds(): unknown {
  const control = code(SOLDIER_CONTROL_CC);
  const ids = sequentialEnum(code(SOLDIER_CONTROL_H), 'BattleSound');
  const body = bracedBody(control, 'static const BATTLESNDS_STRUCT gBattleSndsData[]');
  const rows = [...body.matchAll(/\{\s*"([^"]+)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(-?\d+)\s*\}/g)];
  const names = [...ids].filter(([name]) => name !== 'NUM_MERC_BATTLE_SOUNDS');
  if (rows.length !== names.length) throw new Error(`battle sounds: ${names.length} ids but ${rows.length} rows`);
  const lowMorale = /constexpr\s+INT8\s+LOW_MORALE_BATTLE_SND_THRESHOLD\s*=\s*(\d+)\s*;/.exec(control);
  if (!lowMorale) throw new Error('LOW_MORALE_BATTLE_SND_THRESHOLD not found');
  return {
    source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/${SOLDIER_CONTROL_H} BattleSound, src/${SOLDIER_CONTROL_CC} gBattleSndsData, MIN_SUBSEQUENT_SNDS_DELAY, InternalDoMercBattleSound, src/game/Directories.h`,
    license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
    format:
      'kinds: BattleSound enum order with the file name part, randomVariants (ubRandomVal: the kind and the next n-1 kinds are drawn from), badGuy (playable without a profile), dontAllowTwoInRow, stopDialogue (0 never, 1 cuts speech, 2 skipped while talking); directory: VFS directory; minSubsequentDelayMs and lowMoraleThreshold: the repeat filter and the morale below which the low-morale kinds replace OK1 and ATTN1',
    directory: directory('BATTLESNDSDIR'),
    minSubsequentDelayMs: defined(control, 'MIN_SUBSEQUENT_SNDS_DELAY'),
    lowMoraleThreshold: Number(lowMorale[1]),
    kinds: names.map(([name, id]) => {
      const row = rows[id];
      if (!row) throw new Error(`battle sound ${name} has no row`);
      return {
        id,
        name: name.replace(/^BATTLE_SOUND_/, ''),
        file: row[1],
        randomVariants: Number(row[2]),
        badGuy: row[3] === '1',
        dontAllowTwoInRow: row[4] === '1',
        stopDialogue: Number(row[5]),
      };
    }),
  };
}

const effectsTarget = join(REPO_ROOT, 'data/tables/sound-effects.json');
const battleTarget = join(REPO_ROOT, 'data/tables/battle-sounds.json');
writeTable(effectsTarget, soundEffects());
writeTable(battleTarget, battleSounds());
console.log(`sound effects → ${effectsTarget}\nbattle sounds → ${battleTarget}`);
