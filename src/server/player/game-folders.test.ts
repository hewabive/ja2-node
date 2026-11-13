import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findGameFolders, inspectDataFolder, parseLibraryFolders, searchRoots } from './game-folders.ts';

const LIBRARY_FOLDERS = `"libraryfolders"
{
\t"0"
\t{
\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"
\t\t"label"\t\t""
\t}
\t"1"
\t{
\t\t"path"\t\t"/mnt/games/SteamLibrary"
\t}
}`;

async function gameFolder(dir: string, layout: 'root' | 'data'): Promise<void> {
  const data = layout === 'data' ? join(dir, 'Data') : dir;
  await mkdir(data, { recursive: true });
  await writeFile(join(data, 'Maps.slf'), '');
}

describe('looking for the game', () => {
  let home: string | null = null;
  afterEach(async () => {
    if (home) await rm(home, { recursive: true, force: true });
    home = null;
  });

  it('reads the Steam libraries, escaped paths included', () => {
    expect(parseLibraryFolders(LIBRARY_FOLDERS)).toEqual(['C:\\Program Files (x86)\\Steam', '/mnt/games/SteamLibrary']);
  });

  it('looks into the home folder, Steam, GOG and the program folders on Windows', () => {
    const env = { 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramFiles: 'C:\\Program Files', SystemDrive: 'D:' };
    const roots = searchRoots({ os: 'win32', env, home: 'C:\\Users\\p' });
    expect(roots.steam).toEqual(['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam']);
    expect(roots.parents).toContain('C:\\Users\\p');
    expect(roots.parents).toContain('D:\\GOG Games');
    expect(roots.parents).toContain('C:\\Program Files (x86)\\GOG Galaxy\\Games');
  });

  it('finds the Data folders of the games in a Steam library and a GOG folder, once each', async () => {
    home = await mkdtemp(join(tmpdir(), 'ja2-player-home-'));
    const steam = join(home, '.local', 'share', 'Steam');
    const library = join(home, 'SteamLibrary');
    await mkdir(join(steam, 'steamapps', 'common', 'Half-Life'), { recursive: true });
    await writeFile(join(steam, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders" { "1" { "path" "${library}" } }`);
    await gameFolder(join(library, 'steamapps', 'common', 'Jagged Alliance 2 Gold'), 'data');
    await gameFolder(join(home, 'GOG Games', 'JA2 Gold'), 'root');
    await gameFolder(join(home, 'Jagged Alliance 2 Gold'), 'data');
    await mkdir(join(home, 'GOG Games', 'Jagged Alliance 2 Demo'), { recursive: true });
    await mkdir(join(home, '.steam'), { recursive: true });
    await symlink(steam, join(home, '.steam', 'steam'));
    expect((await findGameFolders({ os: 'linux', env: {}, home })).sort()).toEqual(
      [
        join(library, 'steamapps', 'common', 'Jagged Alliance 2 Gold', 'Data'),
        join(home, 'GOG Games', 'JA2 Gold'),
        join(home, 'Jagged Alliance 2 Gold', 'Data'),
      ].sort(),
    );
  });

  it('says why a folder is no game folder', async () => {
    home = await mkdtemp(join(tmpdir(), 'ja2-player-home-'));
    await expect(inspectDataFolder(join(home, 'nothing'), home)).rejects.toThrow(/does not exist/);
    await expect(inspectDataFolder(home, home)).rejects.toThrow(/no \*\.slf files/);
  });
});
