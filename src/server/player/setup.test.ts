import { describe, expect, it } from 'vitest';
import type { DataFolderReport } from './game-folders.ts';
import type { PortState } from './network.ts';
import type { AskOptions, Prompter } from './prompt.ts';
import type { PlayerConfig } from './settings.ts';
import { LOCAL_ACCESS_LABEL, NETWORK_ACCESS_LABEL, OTHER_FOLDER_LABEL, runSetup, type SetupContext, STUB_PACK_LABEL } from './setup.ts';

const STEAM_DATA = '/steam/steamapps/common/Jagged Alliance 2 Gold/Data';
const GOG_DATA = '/gog/JA2 Gold';
const TYPED_DATA = '/games/ja2/Data';

const REPORTS: Readonly<Record<string, DataFolderReport>> = {
  [STEAM_DATA]: { dataDir: STEAM_DATA, slfCount: 41, version: 'english', source: 'detected' },
  [GOG_DATA]: { dataDir: GOG_DATA, slfCount: 41, version: 'russian', source: 'detected' },
  '/games/ja2': { dataDir: TYPED_DATA, slfCount: 40, version: 'english', source: 'default' },
};

interface Script extends Prompter {
  readonly said: string[];
  readonly asked: { readonly question: string; readonly initial: string | undefined }[];
}

function script(answers: readonly string[]): Script {
  const pending = [...answers];
  const said: string[] = [];
  const asked: { question: string; initial: string | undefined }[] = [];
  return {
    said,
    asked,
    say: (text) => {
      said.push(text);
    },
    ask: async (question: string, options: AskOptions = {}) => {
      asked.push({ question, initial: options.initial });
      const answer = pending.shift();
      if (answer === undefined) throw new Error(`no answer for: ${question}`);
      return answer || options.initial || '';
    },
    close: () => {},
  };
}

function context(
  prompter: Script,
  options: { current?: PlayerConfig; found?: string[]; ports?: Record<number, PortState> } = {},
): SetupContext {
  return {
    prompter,
    current: options.current ?? null,
    expandPath: (text) => text,
    findGameFolders: async () => options.found ?? [STEAM_DATA, GOG_DATA],
    inspect: async (dir) => {
      const report = REPORTS[dir];
      if (!report) throw new Error(`no *.slf files in ${dir} or its Data subdirectory`);
      return report;
    },
    portState: async (_host, port) => options.ports?.[port] ?? 'free',
  };
}

describe('the setup of an installed ja2-node', () => {
  it('takes the first game it finds, its detected version, this computer and the default port on Enter alone', async () => {
    const prompter = script(['', '', '', '']);
    expect(await runSetup(context(prompter))).toEqual({ dataDir: STEAM_DATA, dataVersion: null, host: '127.0.0.1', port: 7420 });
    expect(prompter.said).toContain(`  1) ${STEAM_DATA} (41 SLF, english)`);
    expect(prompter.said).toContain(`  3) ${OTHER_FOLDER_LABEL}`);
    expect(prompter.said).toContain(`  4) ${STUB_PACK_LABEL}`);
    expect(prompter.said).toContain(`  1) ${LOCAL_ACCESS_LABEL}`);
  });

  it('takes a typed folder after a wrong one and keeps a version the player names', async () => {
    const prompter = script(['3', '/nowhere', '/games/ja2', 'russianGold', '2', '']);
    expect(await runSetup(context(prompter))).toEqual({ dataDir: TYPED_DATA, dataVersion: 'russianGold', host: '0.0.0.0', port: 7420 });
    expect(prompter.said).toContain('  no *.slf files in /nowhere or its Data subdirectory');
    expect(prompter.said).toContain('  The version of this data was not recognised.');
    expect(prompter.said).toContain(`  2) ${NETWORK_ACCESS_LABEL}`);
  });

  it('goes back to the list on an empty folder and plays the stub pack when asked', async () => {
    const prompter = script(['3', '', '4', '', '']);
    expect(await runSetup(context(prompter))).toEqual({ dataDir: null, dataVersion: null, host: '127.0.0.1', port: 7420 });
  });

  it('asks again for a port another program holds and takes the one a running ja2-node holds', async () => {
    const busy = script(['', '', '', '7500', '7501']);
    expect((await runSetup(context(busy, { ports: { 7500: 'busy' } }))).port).toBe(7501);
    expect(busy.said).toContain('  Port 7500 is in use by another program.');
    const ours = script(['', '', '', '']);
    expect((await runSetup(context(ours, { ports: { 7420: 'ours' } }))).port).toBe(7420);
    expect(ours.said).toContain('  ja2-node already runs on this port: restart it to apply the new settings.');
  });

  it('offers the saved settings again on a second run', async () => {
    const current: PlayerConfig = { dataDir: GOG_DATA, dataVersion: 'russianGold', host: '10.0.0.2', port: 7600 };
    const prompter = script(['', '', '', '']);
    expect(await runSetup(context(prompter, { current }))).toEqual(current);
    expect(prompter.asked.map((a) => a.initial)).toEqual(['1', 'russianGold', '3', '7600']);
    expect(prompter.said).toContain('  3) Keep 10.0.0.2');
  });

  it('says when nothing is found or the saved folder is gone', async () => {
    const current: PlayerConfig = { dataDir: '/removed/Data', dataVersion: null, host: '127.0.0.1', port: 7420 };
    const prompter = script(['', '', '']);
    await expect(runSetup(context(prompter, { current, found: [] }))).rejects.toThrow(/no answer/);
    expect(prompter.said).toContain('  The saved game folder /removed/Data cannot be read any more.');
    expect(prompter.said).toContain('  No game folder found.');
    expect(prompter.asked[0]).toEqual({ question: 'Choose', initial: '1' });
  });
});
