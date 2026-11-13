import { describe, expect, it } from 'vitest';
import { PLAYER_HOME_ENV, playerDirs } from './dirs.ts';

describe('the folders of an installed ja2-node', () => {
  it('follow the XDG folders on Linux and ignore relative ones', () => {
    expect(playerDirs({ os: 'linux', env: {}, home: '/home/p' })).toEqual({
      configFile: '/home/p/.config/ja2-node/config.json',
      tokenFile: '/home/p/.local/share/ja2-node/token',
      saveDir: '/home/p/.local/share/ja2-node/saves',
      cacheDir: '/home/p/.cache/ja2-node',
    });
    const env = { XDG_CONFIG_HOME: '/c', XDG_DATA_HOME: 'relative', XDG_CACHE_HOME: '/k' };
    expect(playerDirs({ os: 'linux', env, home: '/home/p' })).toMatchObject({
      configFile: '/c/ja2-node/config.json',
      saveDir: '/home/p/.local/share/ja2-node/saves',
      cacheDir: '/k/ja2-node',
    });
  });

  it('keep the settings roaming and the saves and the cache local on Windows', () => {
    const env = { APPDATA: 'C:\\Users\\p\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\p\\AppData\\Local' };
    expect(playerDirs({ os: 'win32', env, home: 'C:\\Users\\p' })).toEqual({
      configFile: 'C:\\Users\\p\\AppData\\Roaming\\ja2-node\\config.json',
      tokenFile: 'C:\\Users\\p\\AppData\\Local\\ja2-node\\token',
      saveDir: 'C:\\Users\\p\\AppData\\Local\\ja2-node\\saves',
      cacheDir: 'C:\\Users\\p\\AppData\\Local\\ja2-node\\Cache',
    });
    expect(playerDirs({ os: 'win32', env: {}, home: 'C:\\Users\\p' }).configFile).toBe(
      'C:\\Users\\p\\AppData\\Roaming\\ja2-node\\config.json',
    );
  });

  it('use Application Support and Caches on macOS', () => {
    expect(playerDirs({ os: 'darwin', env: {}, home: '/Users/p' })).toEqual({
      configFile: '/Users/p/Library/Application Support/ja2-node/config.json',
      tokenFile: '/Users/p/Library/Application Support/ja2-node/token',
      saveDir: '/Users/p/Library/Application Support/ja2-node/saves',
      cacheDir: '/Users/p/Library/Caches/ja2-node',
    });
  });

  it('all live in one folder when the player names one', () => {
    expect(playerDirs({ os: 'linux', env: { [PLAYER_HOME_ENV]: '/portable/ja2' }, home: '/home/p' })).toEqual({
      configFile: '/portable/ja2/config.json',
      tokenFile: '/portable/ja2/token',
      saveDir: '/portable/ja2/saves',
      cacheDir: '/portable/ja2/cache',
    });
  });
});
