import { ANIMATION_SCRIPTS_PATH } from '../formats/ja2bin.ts';
import { TILESET_DATABASE_PATH } from '../formats/ja2set.ts';
import { LOCKS_PATH } from '../formats/locks.ts';
import { PROFILES_PATH } from '../formats/prof.ts';
import { STUB_PROFILES_PATH } from '../formats/stub-profiles.ts';
import { vfsExtension } from '../vfs/path.ts';

const BINARY_RULE_FILES: readonly string[] = [ANIMATION_SCRIPTS_PATH, TILESET_DATABASE_PATH, PROFILES_PATH, LOCKS_PATH];
const PROJECT_TABLE_DIRS: readonly string[] = ['externalized/', 'tables/'];
const PROJECT_TABLE_EXTENSION = 'json';
const STRUCTURE_EXTENSION = 'jsd';
const NPC_RECORD_EXTENSION = 'npc';
const TEXT_EXTENSION = 'edt';
const MAP_EXTENSION = 'dat';
const MAP_DIR = 'maps';
const SINGLE_RULE_FILES: ReadonlySet<string> = new Set([STUB_PROFILES_PATH]);

function endsWithFile(path: string, file: string): boolean {
  return path === file || path.endsWith(`/${file}`);
}

function parentDirName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 2] ?? '';
}

export function isProjectTable(path: string): boolean {
  return vfsExtension(path) === PROJECT_TABLE_EXTENSION && PROJECT_TABLE_DIRS.some((dir) => path.startsWith(dir));
}

export function isMapFile(path: string): boolean {
  return vfsExtension(path) === MAP_EXTENSION && parentDirName(path) === MAP_DIR;
}

export function isTextRuleFile(path: string): boolean {
  return vfsExtension(path) === TEXT_EXTENSION;
}

export function isRuleFile(path: string): boolean {
  const extension = vfsExtension(path);
  return (
    extension === STRUCTURE_EXTENSION ||
    extension === NPC_RECORD_EXTENSION ||
    extension === TEXT_EXTENSION ||
    isMapFile(path) ||
    isProjectTable(path) ||
    SINGLE_RULE_FILES.has(path) ||
    BINARY_RULE_FILES.some((file) => endsWithFile(path, file))
  );
}

export const RULE_FAMILIES_SIGNATURE = [
  ...BINARY_RULE_FILES,
  ...PROJECT_TABLE_DIRS,
  PROJECT_TABLE_EXTENSION,
  STRUCTURE_EXTENSION,
  NPC_RECORD_EXTENSION,
  TEXT_EXTENSION,
  `${MAP_DIR}/*.${MAP_EXTENSION}`,
  ...SINGLE_RULE_FILES,
].join(' ');
