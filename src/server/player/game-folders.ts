import { readdir, readFile, realpath } from 'node:fs/promises';
import type { PlatformPath } from 'node:path';
import type { DataVersion } from '../../content/text/data-version.ts';
import { openDataVfs, resolveDataDir } from '../../node/data-vfs.ts';
import { type DataVersionSource, detectDataVersion } from '../data-version.ts';
import { type PlayerPlatform, pathsOf } from './dirs.ts';

const GAME_FOLDER = /jagged[\s_-]*alliance[\s_-]*2|^ja2\b/i;
const LIBRARY_PATH = /"path"\s+"((?:[^"\\]|\\.)*)"/gi;
const VDF_ESCAPE = /\\(.)/g;
const LIBRARY_FILES = [
  ['steamapps', 'libraryfolders.vdf'],
  ['config', 'libraryfolders.vdf'],
] as const;

export interface SearchRoots {
  readonly steam: readonly string[];
  readonly parents: readonly string[];
}

export interface DataFolderReport {
  readonly dataDir: string;
  readonly slfCount: number;
  readonly version: DataVersion;
  readonly source: DataVersionSource;
  readonly warning?: string;
}

function windowsRoots(path: PlatformPath, env: NodeJS.ProcessEnv, home: string): SearchRoots {
  const programs = [env['ProgramFiles(x86)'], env.ProgramFiles].filter((dir): dir is string => Boolean(dir));
  const drive = env.SystemDrive ?? 'C:';
  return {
    steam: programs.map((dir) => path.join(dir, 'Steam')),
    parents: [
      home,
      path.join(`${drive}\\`, 'GOG Games'),
      ...programs.map((dir) => path.join(dir, 'GOG Galaxy', 'Games')),
      ...programs.map((dir) => path.join(dir, 'GOG.com')),
      ...programs,
    ],
  };
}

function unixRoots(path: PlatformPath, home: string, os: NodeJS.Platform): SearchRoots {
  const wine = path.join(home, '.wine', 'drive_c');
  const steam =
    os === 'darwin'
      ? [path.join(home, 'Library', 'Application Support', 'Steam')]
      : [
          path.join(home, '.steam', 'steam'),
          path.join(home, '.local', 'share', 'Steam'),
          path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'),
        ];
  return {
    steam,
    parents: [
      home,
      path.join(home, 'GOG Games'),
      path.join(home, 'Games'),
      path.join(wine, 'GOG Games'),
      path.join(wine, 'Program Files (x86)'),
      path.join(wine, 'Program Files'),
      ...(os === 'darwin' ? ['/Applications', path.join(home, 'Applications')] : []),
    ],
  };
}

export function searchRoots({ os, env, home }: PlayerPlatform): SearchRoots {
  const path = pathsOf(os);
  return os === 'win32' ? windowsRoots(path, env, home) : unixRoots(path, home, os);
}

export function parseLibraryFolders(vdf: string): string[] {
  return [...vdf.matchAll(LIBRARY_PATH)].map((m) => (m[1] ?? '').replace(VDF_ESCAPE, '$1'));
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function steamLibraries(path: PlatformPath, steamRoot: string): Promise<string[]> {
  const listed = await Promise.all(
    LIBRARY_FILES.map(async (parts) => parseLibraryFolders((await readText(path.join(steamRoot, ...parts))) ?? '')),
  );
  return [steamRoot, ...listed.flat()];
}

async function gameFoldersIn(path: PlatformPath, parent: string): Promise<string[]> {
  return (await subdirs(parent)).filter((name) => GAME_FOLDER.test(name)).map((name) => path.join(parent, name));
}

async function dataDirOf(folder: string): Promise<string | null> {
  try {
    return await realpath(await resolveDataDir(folder));
  } catch {
    return null;
  }
}

export async function findGameFolders(platform: PlayerPlatform): Promise<string[]> {
  const path = pathsOf(platform.os);
  const roots = searchRoots(platform);
  const libraries = (await Promise.all(roots.steam.map((root) => steamLibraries(path, root)))).flat();
  const parents = [...libraries.map((lib) => path.join(lib, 'steamapps', 'common')), ...roots.parents];
  const folders = (await Promise.all([...new Set(parents)].map((parent) => gameFoldersIn(path, parent)))).flat();
  const dataDirs = await Promise.all(folders.map(dataDirOf));
  return [...new Set(dataDirs.filter((dir): dir is string => dir !== null))];
}

export async function inspectDataFolder(dir: string, projectDataDir: string): Promise<DataFolderReport> {
  const data = await openDataVfs({ projectDataDir, dataDir: dir });
  try {
    const choice = await detectDataVersion(data, {});
    return {
      dataDir: data.dataDir ?? dir,
      slfCount: data.slfCount,
      version: choice.version,
      source: choice.source,
      ...(choice.warning ? { warning: choice.warning } : {}),
    };
  } finally {
    await data.close();
  }
}
