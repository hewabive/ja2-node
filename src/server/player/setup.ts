import { DEFAULT_VANILLA_VERSION, parseVanillaVersion, VANILLA_VERSIONS, type VanillaVersion } from '../../content/text/data-version.ts';
import { DEFAULT_HOST, DEFAULT_PORT } from '../start.ts';
import type { DataFolderReport } from './game-folders.ts';
import { accessOf, NETWORK_HOST, type PortState } from './network.ts';
import type { Prompter } from './prompt.ts';
import { type PlayerConfig, parsePort } from './settings.ts';

export const OTHER_FOLDER_LABEL = 'Another folder';
export const STUB_PACK_LABEL = 'No game data: play on the stub pack';
export const LOCAL_ACCESS_LABEL = 'This computer only';
export const NETWORK_ACCESS_LABEL = 'Local network: other devices join with the login link';

export interface SetupContext {
  readonly prompter: Prompter;
  readonly current: PlayerConfig | null;
  readonly expandPath: (text: string) => string;
  readonly findGameFolders: () => Promise<readonly string[]>;
  readonly inspect: (dir: string) => Promise<DataFolderReport>;
  readonly portState: (host: string, port: number) => Promise<PortState>;
}

interface DataChoice {
  readonly dataDir: string | null;
  readonly dataVersion: VanillaVersion | null;
}

function describeReport(report: DataFolderReport): string {
  return `${report.slfCount} SLF, ${report.source === 'detected' ? report.version : 'version not recognised'}`;
}

async function choose(prompter: Prompter, labels: readonly string[], initial: number): Promise<number> {
  labels.forEach((label, i) => {
    prompter.say(`  ${i + 1}) ${label}`);
  });
  for (;;) {
    const n = Number(await prompter.ask('Choose', { initial: String(initial + 1) }));
    if (Number.isInteger(n) && n >= 1 && n <= labels.length) return n - 1;
    prompter.say(`  Type a number from 1 to ${labels.length}.`);
  }
}

async function inspectQuietly(context: SetupContext, dir: string): Promise<DataFolderReport | null> {
  try {
    return await context.inspect(dir);
  } catch {
    return null;
  }
}

async function foundFolders(context: SetupContext): Promise<DataFolderReport[]> {
  const saved = context.current?.dataDir;
  const candidates = [...new Set([...(saved ? [saved] : []), ...(await context.findGameFolders())])];
  const reports = await Promise.all(candidates.map((dir) => inspectQuietly(context, dir)));
  const unique = new Map<string, DataFolderReport>();
  for (const report of reports) if (report && !unique.has(report.dataDir)) unique.set(report.dataDir, report);
  if (saved && !unique.has(saved)) context.prompter.say(`  The saved game folder ${saved} cannot be read any more.`);
  return [...unique.values()];
}

async function askFolder(context: SetupContext): Promise<DataFolderReport | null> {
  for (;;) {
    const answer = await context.prompter.ask('Game folder or its Data folder (empty to go back)', { paths: true });
    if (answer === '') return null;
    try {
      return await context.inspect(context.expandPath(answer));
    } catch (err) {
      context.prompter.say(`  ${(err as Error).message}`);
    }
  }
}

async function chooseVersion(context: SetupContext, report: DataFolderReport): Promise<VanillaVersion | null> {
  const detected = report.source === 'detected' ? parseVanillaVersion(report.version) : null;
  context.prompter.say(detected ? `  Detected version: ${detected}.` : '  The version of this data was not recognised.');
  const saved = context.current?.dataDir === report.dataDir ? context.current.dataVersion : null;
  const initial = saved ?? detected ?? DEFAULT_VANILLA_VERSION;
  for (;;) {
    const version = parseVanillaVersion(await context.prompter.ask(`Version (${VANILLA_VERSIONS.join(', ')})`, { initial }));
    if (version) return version === detected ? null : version;
    context.prompter.say('  Unknown version.');
  }
}

function initialFolder(current: PlayerConfig | null, found: readonly DataFolderReport[]): number {
  const other = found.length;
  if (current?.dataDir === null) return other + 1;
  const saved = found.findIndex((report) => report.dataDir === current?.dataDir);
  if (saved >= 0) return saved;
  return found.length > 0 ? 0 : other;
}

async function chooseData(context: SetupContext): Promise<DataChoice> {
  const { prompter } = context;
  prompter.say('Game data');
  prompter.say('  Looking for Jagged Alliance 2...');
  const found = await foundFolders(context);
  if (found.length === 0) prompter.say('  No game folder found.');
  const labels = [...found.map((report) => `${report.dataDir} (${describeReport(report)})`), OTHER_FOLDER_LABEL, STUB_PACK_LABEL];
  const other = found.length;
  const initial = initialFolder(context.current, found);
  for (;;) {
    const index = await choose(prompter, labels, initial);
    if (index > other) return { dataDir: null, dataVersion: null };
    const report = index === other ? await askFolder(context) : (found[index] ?? null);
    if (report) return { dataDir: report.dataDir, dataVersion: await chooseVersion(context, report) };
  }
}

async function chooseHost(context: SetupContext): Promise<string> {
  const { prompter } = context;
  const current = context.current?.host ?? DEFAULT_HOST;
  const access = accessOf(current);
  const labels = [LOCAL_ACCESS_LABEL, NETWORK_ACCESS_LABEL, ...(access === 'custom' ? [`Keep ${current}`] : [])];
  const hosts = [DEFAULT_HOST, NETWORK_HOST, current];
  prompter.say('');
  prompter.say('Access');
  const index = await choose(prompter, labels, access === 'local' ? 0 : access === 'network' ? 1 : 2);
  const host = hosts[index] ?? DEFAULT_HOST;
  if (host === NETWORK_HOST) prompter.say('  Whoever gets the login link can play and see your saves.');
  return host;
}

async function choosePort(context: SetupContext, host: string): Promise<number> {
  const { prompter } = context;
  const initial = String(context.current?.port ?? DEFAULT_PORT);
  prompter.say('');
  for (;;) {
    const port = parsePort(await prompter.ask('Port', { initial }));
    if (port === null) {
      prompter.say('  A port is a number from 1 to 65535.');
      continue;
    }
    const state = await context.portState(host, port);
    if (state === 'free') return port;
    if (state === 'ours') {
      prompter.say('  ja2-node already runs on this port: restart it to apply the new settings.');
      return port;
    }
    prompter.say(`  Port ${port} is in use by another program.`);
  }
}

export async function runSetup(context: SetupContext): Promise<PlayerConfig> {
  const data = await chooseData(context);
  const host = await chooseHost(context);
  const port = await choosePort(context, host);
  return { ...data, host, port };
}
