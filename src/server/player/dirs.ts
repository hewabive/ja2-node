import { type PlatformPath, posix, win32 } from 'node:path';

export const APP_DIR_NAME = 'ja2-node';
export const PLAYER_HOME_ENV = 'JA2_HOME';

const CONFIG_FILE = 'config.json';
const TOKEN_FILE = 'token';
const SAVES_DIR = 'saves';
const CACHE_DIR = 'cache';

export interface PlayerPlatform {
  readonly os: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
}

export interface PlayerDirs {
  readonly configFile: string;
  readonly tokenFile: string;
  readonly saveDir: string;
  readonly cacheDir: string;
}

export function pathsOf(os: NodeJS.Platform): PlatformPath {
  return os === 'win32' ? win32 : posix;
}

function splitDirs(path: PlatformPath, configDir: string, dataDir: string, cacheDir: string): PlayerDirs {
  return {
    configFile: path.join(configDir, CONFIG_FILE),
    tokenFile: path.join(dataDir, TOKEN_FILE),
    saveDir: path.join(dataDir, SAVES_DIR),
    cacheDir,
  };
}

function oneDir(path: PlatformPath, dir: string): PlayerDirs {
  return splitDirs(path, dir, dir, path.join(dir, CACHE_DIR));
}

function xdgDir(path: PlatformPath, value: string | undefined, fallback: string): string {
  return value && path.isAbsolute(value) ? value : fallback;
}

export function playerDirs({ os, env, home }: PlayerPlatform): PlayerDirs {
  const path = pathsOf(os);
  const custom = env[PLAYER_HOME_ENV]?.trim();
  if (custom) return oneDir(path, path.resolve(custom));
  if (os === 'win32') {
    const roaming = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return splitDirs(path, path.join(roaming, APP_DIR_NAME), path.join(local, APP_DIR_NAME), path.join(local, APP_DIR_NAME, 'Cache'));
  }
  if (os === 'darwin') {
    const support = path.join(home, 'Library', 'Application Support', APP_DIR_NAME);
    return splitDirs(path, support, support, path.join(home, 'Library', 'Caches', APP_DIR_NAME));
  }
  const config = xdgDir(path, env.XDG_CONFIG_HOME, path.join(home, '.config'));
  const data = xdgDir(path, env.XDG_DATA_HOME, path.join(home, '.local', 'share'));
  const cache = xdgDir(path, env.XDG_CACHE_HOME, path.join(home, '.cache'));
  return splitDirs(path, path.join(config, APP_DIR_NAME), path.join(data, APP_DIR_NAME), path.join(cache, APP_DIR_NAME));
}
