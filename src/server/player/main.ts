import { homedir, hostname, networkInterfaces } from 'node:os';
import { parseArgs } from 'node:util';
import { loadOrCreateToken } from '../../node/token.ts';
import { DATA_VERSION_ENV } from '../data-version.ts';
import { packageLayout } from '../package-layout.ts';
import { cacheDirFromEnv } from '../rule-pack.ts';
import { saveDirFromEnv } from '../save-store.ts';
import { DATA_DIR_ENV, HOST_ENV, PORT_ENV, type ServerReport, startServer } from '../start.ts';
import { openBrowser } from './browser.ts';
import { type PlayerDirs, type PlayerPlatform, pathsOf, playerDirs } from './dirs.ts';
import { findGameFolders, inspectDataFolder } from './game-folders.ts';
import { allowedHostsFor, browserOrigin, loginUrl, networkOrigins, portState } from './network.ts';
import { expandHome, PromptCancelled, readlinePrompter } from './prompt.ts';
import {
  ConfigError,
  type PlayerConfig,
  type PlayerFlags,
  type PlayerSettings,
  parsePort,
  readConfig,
  resolveSettings,
  type SettingSource,
  settingValues,
  writeConfig,
} from './settings.ts';
import { runSetup } from './setup.ts';

export const USAGE = `Usage: ja2-node [command] [options]

Commands:
  start             start the game and open it in the browser (the default)
  setup             choose the game folder, the access and the port
  config            show the settings and where they come from

Options of start and config, for this run only:
  --data <folder>   the game folder or its Data folder
  --no-data         play on the stub pack
  --host <address>  the address to listen on
  --port <number>   the port
  --no-open         do not open the browser

  -h, --help        show this help
  -v, --version     show the version`;

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const EXIT_CANCELLED = 130;

export type PlayerCommand =
  | { readonly kind: 'start' | 'config'; readonly flags: PlayerFlags; readonly open: boolean }
  | { readonly kind: 'setup' | 'help' | 'version' };

export class UsageError extends Error {}

const OPTIONS = {
  data: { type: 'string' },
  'no-data': { type: 'boolean' },
  host: { type: 'string' },
  port: { type: 'string' },
  'no-open': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

function parsed(argv: readonly string[]) {
  try {
    return parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true });
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
}

function portFlag(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const port = parsePort(text);
  if (port === null) throw new UsageError(`--port must be a number from 1 to 65535 (got ${text})`);
  return port;
}

export function parsePlayerArgs(argv: readonly string[]): PlayerCommand {
  const { values, positionals } = parsed(argv);
  if (values.help) return { kind: 'help' };
  if (values.version) return { kind: 'version' };
  if (positionals.length > 1) throw new UsageError(`unexpected argument: ${positionals[1]}`);
  const name = positionals[0] ?? 'start';
  if (name === 'setup') return { kind: 'setup' };
  if (name !== 'start' && name !== 'config') throw new UsageError(`unknown command: ${name}`);
  if (values.data !== undefined && values['no-data']) throw new UsageError('--data and --no-data exclude each other');
  const port = portFlag(values.port);
  const flags: PlayerFlags = {
    ...(values['no-data'] ? { dataDir: null } : values.data !== undefined ? { dataDir: values.data } : {}),
    ...(values.host !== undefined ? { host: values.host } : {}),
    ...(port !== undefined ? { port } : {}),
  };
  return { kind: name, flags, open: !values['no-open'] };
}

interface Player {
  readonly root: string;
  readonly platform: PlayerPlatform;
  readonly dirs: PlayerDirs;
  readonly interactive: boolean;
  print(line: string): void;
  fail(line: string): void;
}

const ENV_OF: { readonly [K in keyof PlayerConfig]: string } = {
  dataDir: DATA_DIR_ENV,
  dataVersion: DATA_VERSION_ENV,
  host: HOST_ENV,
  port: PORT_ENV,
};

function sourceLabel(key: keyof PlayerConfig, source: SettingSource): string {
  if (source === 'flag') return 'from the command line';
  if (source === 'environment') return `from ${ENV_OF[key]}`;
  return source === 'file' ? 'from the settings file' : 'default';
}

function expandPath(player: Player, text: string): string {
  const path = pathsOf(player.platform.os);
  return path.resolve(expandHome(text, player.platform.home, path));
}

function stateDirs(player: Player): { tokenFile: string; saveDir: string; cacheDir: string } {
  const { dirs, platform } = player;
  return {
    tokenFile: dirs.tokenFile,
    saveDir: saveDirFromEnv(dirs.saveDir, platform.env),
    cacheDir: cacheDirFromEnv(dirs.cacheDir, platform.env),
  };
}

async function setup(player: Player, current: PlayerConfig | null): Promise<PlayerConfig> {
  const { platform, dirs } = player;
  const layout = packageLayout(player.root);
  const token = loadOrCreateToken(dirs.tokenFile, platform.env);
  const prompter = readlinePrompter(process.stdin, process.stdout, platform.home, pathsOf(platform.os));
  try {
    prompter.say('ja2-node setup');
    prompter.say('');
    const config = await runSetup({
      prompter,
      current,
      expandPath: (text) => expandPath(player, text),
      findGameFolders: () => findGameFolders(platform),
      inspect: (dir) => inspectDataFolder(dir, layout.projectDataDir),
      portState: (host, port) => portState(host, port, token),
    });
    await writeConfig(dirs.configFile, config);
    prompter.say('');
    prompter.say(`Saved to ${dirs.configFile}`);
    return config;
  } finally {
    prompter.close();
  }
}

async function setupCommand(player: Player): Promise<number> {
  if (!player.interactive) {
    player.fail('ja2-node setup needs a terminal.');
    return EXIT_FAILED;
  }
  let current: PlayerConfig | null = null;
  try {
    current = await readConfig(player.dirs.configFile);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    player.print(`${err.message}\nStarting from the defaults.\n`);
  }
  await setup(player, current);
  return EXIT_OK;
}

function settingLines(settings: PlayerSettings): string[] {
  const { dataDir, dataVersion, host, port } = settings;
  return [
    `  game data:    ${dataDir.value ?? 'none, the stub pack'} (${sourceLabel('dataDir', dataDir.source)})`,
    `  data version: ${dataVersion.value ?? (dataDir.value ? 'detected' : 'stubs')} (${sourceLabel('dataVersion', dataVersion.source)})`,
    `  address:      ${host.value} (${sourceLabel('host', host.source)})`,
    `  port:         ${port.value} (${sourceLabel('port', port.source)})`,
  ];
}

async function configCommand(player: Player, flags: PlayerFlags): Promise<number> {
  const file = await readConfig(player.dirs.configFile);
  const settings = resolveSettings(flags, player.platform.env, file);
  const state = stateDirs(player);
  player.print(`Settings file: ${player.dirs.configFile}${file ? '' : ' (not written yet: run ja2-node setup)'}`);
  for (const line of settingLines(settings)) player.print(line);
  player.print(`Saves: ${state.saveDir}`);
  player.print(`Cache: ${state.cacheDir}`);
  player.print(`Token: ${state.tokenFile}`);
  return EXIT_OK;
}

function startLines(report: ServerReport, origin: string, others: readonly string[], version: string): string[] {
  const data = report.dataDir
    ? `${report.dataDir}, ${report.dataVersion.version}`
    : 'none, the stub pack (ja2-node setup chooses the game folder)';
  return [
    `ja2-node ${version} is running.`,
    `  game data: ${data}`,
    ...(report.dataVersion.warning ? [`  warning: ${report.dataVersion.warning}`] : []),
    `  saves: ${report.saveDir}`,
    `  open: ${loginUrl(origin, report.token)}`,
    ...others.map((other) => `  from another device: ${loginUrl(other, report.token)}`),
    'Press Ctrl+C to stop.',
  ];
}

function stopRequested(): Promise<void> {
  return new Promise((resolve) => {
    process.once('SIGINT', () => resolve());
    process.once('SIGTERM', () => resolve());
  });
}

async function startCommand(player: Player, flags: PlayerFlags, open: boolean): Promise<number> {
  const { platform, dirs } = player;
  let file = await readConfig(dirs.configFile);
  if (file === null && player.interactive) {
    player.print('This is the first start of ja2-node: a few questions first.\n');
    file = await setup(player, null);
    player.print('');
  }
  const { dataDir, dataVersion, host, port } = settingValues(resolveSettings(flags, platform.env, file));
  const state = stateDirs(player);
  const token = loadOrCreateToken(state.tokenFile, platform.env);
  const origin = browserOrigin(host, port);
  const busy = await portState(host, port, token);
  if (busy === 'ours') {
    player.print(`ja2-node already runs: ${loginUrl(origin, token)}`);
    if (open) openBrowser(loginUrl(origin, token), platform);
    return EXIT_OK;
  }
  if (busy === 'busy') {
    player.fail(`Port ${port} is in use by another program: choose another one with ja2-node setup or --port.`);
    return EXIT_FAILED;
  }
  if (file === null) player.print('No settings yet: playing on the stub pack. Run ja2-node setup to choose the game folder.');
  const layout = packageLayout(player.root);
  const interfaces = networkInterfaces();
  const allowedHosts = allowedHostsFor(host, interfaces, hostname());
  let server: Awaited<ReturnType<typeof startServer>>;
  try {
    server = await startServer({
      layout,
      state,
      listen: { host, port, ...(allowedHosts ? { allowedHosts } : {}) },
      dataDir: dataDir ? expandPath(player, dataDir) : null,
      env: dataVersion ? { ...platform.env, [DATA_VERSION_ENV]: dataVersion } : platform.env,
      warn: (message) => player.fail(message),
    });
  } catch (err) {
    player.fail(`ja2-node could not start: ${(err as Error).message}`);
    player.fail('Run ja2-node setup to check the game folder, or ja2-node config to see the settings.');
    return EXIT_FAILED;
  }
  for (const line of startLines(server.report, origin, networkOrigins(host, port, interfaces), layout.engine.version)) player.print(line);
  if (open) openBrowser(loginUrl(origin, server.report.token), platform);
  await stopRequested();
  player.print('Stopping...');
  await server.close();
  return EXIT_OK;
}

async function runCommand(player: Player, command: PlayerCommand): Promise<number> {
  switch (command.kind) {
    case 'help':
      player.print(USAGE);
      return EXIT_OK;
    case 'version': {
      const { engine } = packageLayout(player.root);
      player.print(`ja2-node ${engine.version} (${engine.commit})`);
      return EXIT_OK;
    }
    case 'setup':
      return setupCommand(player);
    case 'config':
      return configCommand(player, command.flags);
    case 'start':
      return startCommand(player, command.flags, command.open);
  }
}

export async function runPlayer(root: string, argv: readonly string[]): Promise<number> {
  const platform: PlayerPlatform = { os: process.platform, env: process.env, home: homedir() };
  const player: Player = {
    root,
    platform,
    dirs: playerDirs(platform),
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    print: (line) => process.stdout.write(`${line}\n`),
    fail: (line) => process.stderr.write(`${line}\n`),
  };
  try {
    return await runCommand(player, parsePlayerArgs(argv));
  } catch (err) {
    if (err instanceof UsageError) {
      player.fail(`ja2-node: ${err.message}\n\n${USAGE}`);
      return EXIT_USAGE;
    }
    if (err instanceof PromptCancelled) {
      player.fail('\nSetup cancelled.');
      return EXIT_CANCELLED;
    }
    if (err instanceof ConfigError) {
      player.fail(err.message);
      player.fail('Run ja2-node setup to write the settings again.');
      return EXIT_FAILED;
    }
    throw err;
  }
}
